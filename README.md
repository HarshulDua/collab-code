# Real-Time Code Collaboration

A room-based collaborative workspace: a shared, real-time multi-file project (Yjs CRDT, real folders, stdin-capable code execution in Docker across nine languages — Python, JavaScript, TypeScript, C, C++, Go, Rust, Java and C#), live presence showing who is editing which file, an in-room terminal for file, run and git commands, chat, peer-to-peer video/audio (WebRTC), and a full git integration per room (commit history, branching, merging, and pushing/pulling a real remote) — plus a stress-tested, horizontally-scalable backend behind it.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full design write-up (why every decision was made, what broke and how it was fixed, and real measured stress-test results), and **[load-tests/README.md](./load-tests/README.md)** for the load/stress testing suite specifically.

## Quickstart

```
docker-compose up -d                                                          # Mongo + Redis
docker build -t collab-sandbox:latest -f docker/sandbox.Dockerfile docker/
cp server/.env.example server/.env
cd server && npm install && npm start                                         # http://localhost:4000
```

In another terminal:

```
cd client && npm install && npm run dev                                       # http://localhost:5173
```

Open two browser tabs, register two different accounts, create a room in one and join it by ID in the other.

## The in-room terminal

The **Terminal** tab in a room's sidebar is a whitelisted command interpreter, not a shell — every command maps onto a service that already has its own safety model (see [ARCHITECTURE.md §9A](./ARCHITECTURE.md)). Type `help` for the full list.

```
ls  cd  pwd  cat  touch  mkdir  rm [-r]  mv  cp  echo [> >>]
run <file>   python/node/java/go run/rustc/gcc/g++/tsc <file>
git status | log | branch | checkout [-b] | commit -m "…" | diff | merge
```

Files created there are ordinary collaborative edits, so they appear in everyone's file explorer immediately.

## Testing

```
cd server && npm test          # unit + integration + cross-instance regression (Jest)
cd e2e && npm install && npx playwright install chromium && npm test   # real-browser e2e (Playwright)
cd load-tests && npm install && npm run saturation                     # sandbox guardrail saturation
cd load-tests && node node/room-fanout.js                              # multi-instance collab stress test
```

## Layout

```
server/       Express + Socket.IO API — auth, rooms, chat, collab relay, execution sandbox
client/       React + Vite frontend
e2e/          Playwright end-to-end tests (drives a real browser against the real stack)
load-tests/   k6 scripts + custom Node stress/load harnesses
docker/       The locked-down sandbox image untrusted code actually runs in
```
