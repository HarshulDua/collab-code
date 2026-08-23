# Real-Time Code Collaboration

A room-based collaborative workspace: a shared, real-time multi-file Python project (Yjs CRDT, real folders, stdin-capable code execution in Docker), chat, peer-to-peer video/audio (WebRTC), and a full git integration per room (commit history, branching, merging, and pushing/pulling a real remote) — plus a stress-tested, horizontally-scalable backend behind it.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full design write-up (why every decision was made, what broke and how it was fixed, and real measured stress-test results), and **[load-tests/README.md](./load-tests/README.md)** for the load/stress testing suite specifically.

## Quickstart

```
docker-compose up -d                                                          # Mongo + Redis
docker build -t collab-python-sandbox:latest -f docker/python-sandbox.Dockerfile docker/
cp server/.env.example server/.env
cd server && npm install && npm start                                         # http://localhost:4000
```

In another terminal:

```
cd client && npm install && npm run dev                                       # http://localhost:5173
```

Open two browser tabs, register two different accounts, create a room in one and join it by ID in the other.

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
