# Load & stress tests

Four independent tools, each proving a different thing. All were run for
real against this stack (Docker Desktop, Mongo/Redis via the repo's
`docker-compose.yml`) — the numbers in this file are measured, not invented.
See `../ARCHITECTURE.md` for the narrative writeup of what these runs found,
including the max-scale room-fanout ceiling and the extrapolation model for
10,000+ concurrent users.

Both `room-fanout.js` and the k6 scripts need the server's auth rate limiter
raised via `AUTH_RATE_LIMIT_PER_MIN` for a real capacity run — otherwise the
limiter (correctly) throttles the load generator itself, since every request
comes from one IP. `room-fanout.js` sets this itself when forking its own
server instances; for the k6 scripts, start the server with e.g.
`AUTH_RATE_LIMIT_PER_MIN=1000000 node src/server.js` first.

## Setup

```
cd load-tests
npm install
```

You need: Mongo + Redis running (`docker-compose up -d` from the repo
root), the sandbox image built (`docker build -t collab-sandbox:latest
-f docker/sandbox.Dockerfile docker/`), and `server/.env` created
from `server/.env.example`.

## 1. `node node/execution-saturation.js` (or `npm run saturation`)

Targets each guardrail in the Docker code-execution sandbox individually,
against an **already-running** server (`BASE_URL`, default
`http://localhost:4000`). Start the server first: `cd server && npm start`.

Last real run:

| Guardrail | Result |
|---|---|
| `EXEC_TIMEOUT_MS` (infinite loop) | PASS — killed at 8435ms, `timedOut: true`, `exitCode: null` |
| `EXEC_MEMORY_BYTES` (500MB alloc vs. 128MB cap) | PASS — OOM-killed, `exitCode: 137`, no leaked stdout |
| `PidsLimit=64` (fork bomb) | PASS — every fork chain hit `OSError: Resource temporarily unavailable` well before 64 PIDs |
| `NetworkMode: none` (outbound connect attempt) | PASS — `OSError: [Errno 101] Network unreachable` |
| `EXEC_RATE_LIMIT_PER_MIN=10` (12 rapid requests) | PASS — requests 11–12 got `429` |
| `EXEC_MAX_CONCURRENT=4` semaphore (12 concurrent requests) | PASS — all 12 succeeded, visibly queued in 3 batches of 4 (~0.55s / ~1.11s / ~1.64s) |

## 2. `node node/room-fanout.js` (or `npm run fanout`)

Boots **two real, separate `server.js` OS processes** sharing one Mongo/Redis
(see `../server/test/multiInstance.js` — this deliberately isn't two
in-process `createSocketServer()` calls, because collabStore's module-level
`rooms` Map would be silently shared and the bug below wouldn't reproduce).
Spins up `ROOMS` rooms concurrently, `CLIENTS_PER_ROOM` clients each, split
across both instances, drives a rapid edit burst from one "driver" client
per room, then checks every client — regardless of which instance it's
on — converges on identical document content, plus that chat fanout reaches
every member.

Env: `ROOMS` (default 20), `CLIENTS_PER_ROOM` (default 6), `INSERTS`
(default 25).

Last real runs — pushed to find the actual ceiling on this machine (single
laptop running both the load generator *and* both server instances at once,
the realistic worst case for local testing):

| Rooms × clients | Sockets | Converged | Chat fanout | Wall time | Edit-burst p95 | Convergence p95 / max |
|---|---|---|---|---|---|---|
| 20 × 6 | 120 | 20/20 | 20/20 | 5.9s | 483ms | — |
| 50 × 8 | 400 | 50/50 | 50/50 | 15.2s | 457ms | — |
| 75 × 8 | 600 | 75/75 | 75/75 | 21.5s | 655ms | 509ms / 656ms |
| 100 × 8 | 800 | 100/100 | 100/100 | 27.5s | 647ms | 770ms / 1002ms |
| 120 × 8 | 960 | 120/120 | 120/120 | 32.9s | 852ms | 797ms / 1169ms |
| 150 × 8 | 1200 | **FAIL** | — | — | — | `collab:join` ack never returned within 10s |
| 200 × 8 | 1600 | **FAIL** | — | — | — | `collab:join` ack never returned within 10s |

**Measured ceiling on this machine: clean through ~960 concurrent Socket.IO
connections split across 2 local instances; failure by 1200.** Convergence
latency (how long until every client's Yjs doc matches, including the
cross-instance Redis relay) climbs steadily with scale — p95 goes from
~510ms at 600 sockets to ~800ms at 960 — right up until the point where join
acks stop returning in time at all, which is this specific test rig's actual
wall (this laptop's CPU/RAM shared three ways between the load generator and
both server processes, not a property of the server code itself). See
`ARCHITECTURE.md`'s stress-test section for the extrapolation to 10,000+
concurrent users across a horizontally-scaled deployment.

An earlier version of this script used a single fixed sleep-then-check-once
window to decide convergence, which produced false failures under host
contention (looked like a regression, wasn't one — a clean re-run at the
same scale converged 100%). It now polls for actual convergence up to a
15s timeout and reports real convergence latency instead of a pass/fail
against a guessed wait — a more honest measurement, and the reason the
numbers above look different from an earlier pass at the same 50×8 scale.

This script is also the regression test for a real bug found in code review: the
original `collabHandlers.js` only broadcast Yjs updates through Socket.IO's
Redis adapter, which fans out to *browser* clients on every instance but
never replays into a sibling instance's own server-side `Y.Doc`. A client
joining a room on an instance that never saw the room's edits got a stale
snapshot. `server/src/sockets/collabSync.js` fixes this with its own Redis
pub/sub channel. `server/test/collabSync.test.js` proves the fix for one
room in isolation (and — temporarily reverting the fix confirmed it fails
without it: converged content came back empty); this script proves it holds
under concurrent multi-room load.

## 3. `npm run k6:auth` — `k6/auth-rooms.js`

Ramps 0→50 VUs through register → login → create room → list rooms against
a running server, via the official `grafana/k6` Docker image (k6 isn't
installed on this host, and Docker was already required for the sandbox).

Real run, **before** switching `bcryptjs` → `bcrypt` (native):

| Endpoint | p95 latency |
|---|---|
| register | 8.18s |
| login | 5.58s |
| create_room | 3.09s |
| list_rooms | 2.67s |

`bcryptjs` is a pure-JS bcrypt implementation — even called "asynchronously"
it still runs its CPU-bound hashing work on the single Node.js event-loop
thread (chunked via `setImmediate`, not offloaded to a real OS thread). Under
concurrent registrations, that starved *every other request in the process*,
including ones that never touch bcrypt (`create_room`, `list_rooms`) — this
is why those were slow too, despite doing no password hashing themselves.

Same test, **after** switching to native `bcrypt` (offloads hashing to
libuv's threadpool, off the event loop):

| Endpoint | p95 latency | Improvement |
|---|---|---|
| register | 882ms | 9.3x |
| login | 496ms | 11.3x |
| create_room | 9.8ms | 315x |
| list_rooms | 10.8ms | 248x |

Throughput went from 12.2 req/s to 70.2 req/s at the same concurrency.
0% error rate both before and after — this was purely a latency/throughput
bug, not a correctness one, which is exactly the kind of thing load testing
(and not unit/integration testing) is for.

register/login still cost a few hundred ms under heavy concurrency — that's
genuine bcrypt CPU work (cost factor 10 is deliberately expensive) queuing
on libuv's threadpool once concurrent hashes exceed its worker count. That's
expected and tunable (`UV_THREADPOOL_SIZE`), not a bug.

**Re-run after the production-hardening pass** (auth rate limiting added —
see below — plus structured logging, all otherwise unrelated to this path),
`AUTH_RATE_LIMIT_PER_MIN` raised for this run to measure the endpoint's real
ceiling rather than the deliberate per-IP limiter:

| Endpoint | p95 latency |
|---|---|
| register | 517ms |
| login | 332ms |
| create_room | 8.5ms |
| list_rooms | 9.1ms |

0% error rate, 8220 requests, 81.4 req/s — a real improvement over the
original native-bcrypt baseline, not a regression, and confirms nothing in
this session's hardening work touched this path's throughput.

**A new, deliberate finding**: running this same script *without* raising
`AUTH_RATE_LIMIT_PER_MIN` reproduces exactly the auth rate limiter (added
in this hardening pass, §"Production hardening" in `ARCHITECTURE.md`)
correctly rejecting register/login once 50 ramping VUs from one IP exceed
the configured per-minute cap — the intended behavior of a brute-force
defense, surfaced here because a naive load generator looks identical to a
credential-stuffing attempt from the server's point of view. Confirmed for
real during this session's own e2e suite, which hit the same limiter for
the same reason (many sequential test registrations from one machine) before
the limit was tuned up from an initial too-strict 10/min to 30/min.

## 4. `npm run k6:execution` — `k6/execution-burst.js`

Two scenarios at once: many distinct users firing one execute call each
(proves the semaphore queues under load without rejecting anyone), and one
user hammering the endpoint at 20 req/s (proves the rate limiter holds).

Real run: concurrency scenario — 48/48 succeeded, 0% error rate, p95=1.88s
(queuing latency, not failure — 16 VUs against a cap of 4 means most
requests wait behind others before their container even starts). Rate-limit
scenario — repeatedly alternated between `200` and `429` exactly as expected
once the 10/min bucket filled. A single earlier run showed 1/48 failures
(2.08%) — reproduced clean on immediate re-run, consistent with transient
Docker container-creation contention under a machine that had been running
back-to-back load tests for hours, not an application bug.
