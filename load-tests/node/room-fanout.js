// Boots two real, separate server.js processes sharing one Mongo/Redis
// (exactly like a horizontally-scaled deployment behind a load balancer),
// then spins up many rooms at once with clients split across both
// instances, driving concurrent Yjs edits and chat traffic. Verifies that
// every client — regardless of which instance it's connected to —
// converges on the same document content, and that chat fanout reaches
// every member. This is the scale test for the collabSync fix in
// server/src/sockets/collabSync.js: server/test/collabSync.test.js proves
// correctness for one room; this proves it holds under many rooms and
// concurrent load, and reports latency/convergence numbers.
//
// Run: node node/room-fanout.js
// Env: ROOMS, CLIENTS_PER_ROOM, INSERTS (see defaults below)
const crypto = require('crypto');
const ioClient = require('socket.io-client');
const Y = require('yjs');
const { forkServerInstance, stopInstance } = require('../../server/test/multiInstance');

const ROOMS = parseInt(process.env.ROOMS || '20', 10);
const CLIENTS_PER_ROOM = parseInt(process.env.CLIENTS_PER_ROOM || '6', 10);
const INSERTS_PER_DRIVER = parseInt(process.env.INSERTS || '25', 10);

const sharedEnv = {
  MONGO_URI: process.env.MONGO_URI || 'mongodb://localhost:27017/collab-loadtest',
  REDIS_URL: process.env.REDIS_URL || 'redis://localhost:6379/2',
  JWT_SECRET: process.env.JWT_SECRET || 'load-test-fanout-secret',
  CLIENT_ORIGIN: 'http://localhost:5173',
  NODE_ENV: 'development',
  AUTH_RATE_LIMIT_PER_MIN: '1000000',
};

async function registerUser(baseUrl, label) {
  const email = `fanout-${label}-${crypto.randomUUID()}@example.com`;
  const res = await fetch(`${baseUrl}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: label, email, password: 'password123' }),
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return { token: body.token, userId: body.user.id };
}

async function createRoom(baseUrl, token, name) {
  const res = await fetch(`${baseUrl}/api/rooms`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ name }),
  });
  const body = await res.json();
  return body.room.id;
}

async function joinRoom(baseUrl, token, roomId) {
  await fetch(`${baseUrl}/api/rooms/${roomId}/join`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
}

function connectSocket(baseUrl, token) {
  return ioClient(baseUrl, { auth: { token }, forceNew: true, transports: ['websocket'] });
}

function waitFor(socket, event, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function emitAck(socket, event, payload, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), timeoutMs);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      if (ack?.error) return reject(new Error(ack.error));
      resolve(ack);
    });
  });
}

async function runRoom(instanceA, instanceB, index) {
  const owner = await registerUser(instanceA.baseUrl, `owner-${index}`);
  const roomId = await createRoom(instanceA.baseUrl, owner.token, `fanout-room-${index}`);

  const members = [owner];
  for (let i = 1; i < CLIENTS_PER_ROOM; i += 1) {
    const member = await registerUser(instanceA.baseUrl, `member-${index}-${i}`);
    await joinRoom(instanceA.baseUrl, member.token, roomId);
    members.push(member);
  }

  // Split clients across both instances so cross-instance sync is actually exercised.
  const clients = members.map((m, i) => {
    const instance = i % 2 === 0 ? instanceA : instanceB;
    return { ...m, instance, socket: connectSocket(instance.baseUrl, m.token), doc: new Y.Doc(), chatReceived: 0 };
  });

  await Promise.all(clients.map((c) => waitFor(c.socket, 'connect')));

  for (const c of clients) {
    c.socket.on('collab:update', ({ update }) => {
      Y.applyUpdate(c.doc, new Uint8Array(Buffer.from(update, 'base64')), 'remote');
    });
    c.socket.on('chat:message', () => {
      c.chatReceived += 1;
    });
    c.doc.on('update', (update, origin) => {
      if (origin === 'remote') return;
      c.socket.emit('collab:update', { roomId, branch: 'main', update: Buffer.from(update).toString('base64') });
    });
  }

  await Promise.all(
    clients.map((c) => emitAck(c.socket, 'collab:join', { roomId, branch: 'main', awarenessClientID: c.doc.clientID }))
  );
  await Promise.all(clients.map((c) => emitAck(c.socket, 'chat:join', { roomId })));

  const driver = clients[0];
  const startEdit = Date.now();
  for (let i = 0; i < INSERTS_PER_DRIVER; i += 1) {
    driver.doc.getText('code').insert(driver.doc.getText('code').length, 'x');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  const editElapsedMs = Date.now() - startEdit;

  const expectedText = driver.doc.getText('code').toString();
  const convergeStart = Date.now();
  const CONVERGE_TIMEOUT_MS = 15000;
  let allConvergedNow = false;
  while (Date.now() - convergeStart < CONVERGE_TIMEOUT_MS) {
    allConvergedNow = clients.every((c) => c.doc.getText('code').toString() === expectedText);
    if (allConvergedNow) break;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const convergeElapsedMs = Date.now() - convergeStart;
  const convergence = clients.map((c) => ({
    userId: c.userId,
    instance: c.instance === instanceA ? 'A' : 'B',
    converged: c.doc.getText('code').toString() === expectedText,
  }));

  await Promise.all(clients.map((c) => emitAck(c.socket, 'chat:send', { roomId, text: `hello from ${c.userId}` })));
  const chatStart = Date.now();
  let chatFanoutOk = false;
  while (Date.now() - chatStart < CONVERGE_TIMEOUT_MS) {
    chatFanoutOk = clients.every((c) => c.chatReceived === clients.length);
    if (chatFanoutOk) break;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  clients.forEach((c) => c.socket.close());

  return {
    roomId,
    clientCount: clients.length,
    editElapsedMs,
    convergeElapsedMs,
    allConverged: convergence.every((c) => c.converged),
    convergence,
    chatFanoutOk,
  };
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

async function main() {
  console.log(`Booting 2 server instances (Mongo db: ${sharedEnv.MONGO_URI}, Redis: ${sharedEnv.REDIS_URL})...`);
  const [instanceA, instanceB] = await Promise.all([forkServerInstance(sharedEnv), forkServerInstance(sharedEnv)]);
  console.log(`instance A: ${instanceA.baseUrl}`);
  console.log(`instance B: ${instanceB.baseUrl}`);
  console.log(`Running ${ROOMS} rooms x ${CLIENTS_PER_ROOM} clients concurrently (split across both instances)...\n`);

  const start = Date.now();
  const results = await Promise.all(
    Array.from({ length: ROOMS }, (_, i) => runRoom(instanceA, instanceB, i))
  );
  const totalElapsedMs = Date.now() - start;

  const converged = results.filter((r) => r.allConverged);
  const chatOk = results.filter((r) => r.chatFanoutOk);
  const editTimes = results.map((r) => r.editElapsedMs).sort((a, b) => a - b);
  const convergeTimes = results.map((r) => r.convergeElapsedMs).sort((a, b) => a - b);

  console.log(`Rooms converged: ${converged.length}/${results.length}`);
  console.log(`Chat fanout correct: ${chatOk.length}/${results.length}`);
  console.log(`Total wall time for ${ROOMS} concurrent rooms: ${totalElapsedMs}ms`);
  console.log(
    `Driver edit-burst latency (ms) — p50: ${percentile(editTimes, 50)}, p95: ${percentile(editTimes, 95)}, max: ${editTimes[editTimes.length - 1]}`
  );
  console.log(
    `Cross-instance convergence latency (ms) — p50: ${percentile(convergeTimes, 50)}, p95: ${percentile(convergeTimes, 95)}, max: ${convergeTimes[convergeTimes.length - 1]}`
  );

  const failures = results.filter((r) => !r.allConverged || !r.chatFanoutOk);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) {
      console.log(`  room ${f.roomId}: allConverged=${f.allConverged} chatFanoutOk=${f.chatFanoutOk}`);
      if (!f.allConverged) console.log(`    ${JSON.stringify(f.convergence)}`);
    }
  }

  await stopInstance(instanceA);
  await stopInstance(instanceB);

  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
