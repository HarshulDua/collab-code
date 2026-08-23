const mongoose = require('mongoose');
const Y = require('yjs');
const ioClient = require('socket.io-client');
const { forkServerInstance, stopInstance } = require('./multiInstance');
const { createUser } = require('./helpers');
const Room = require('../src/models/Room');

// Regression test for a real bug found in review: collabStore.js keeps the
// authoritative Y.Doc only in the process's own memory, and the original
// collabHandlers.js only broadcast raw updates through Socket.IO's Redis
// adapter — which fans out to *browser* clients on every instance but
// never replays into a sibling instance's own server-side doc. A client
// joining a room on an instance that never saw the room's edits got a
// stale snapshot instead of the live document. collabSync.js fixes this
// with its own Redis pub/sub channel, independent of the Socket.IO
// adapter. This test boots two genuinely separate `server.js` processes
// (see multiInstance.js for why that matters) to prove it.

function connect(baseUrl, token) {
  return ioClient(baseUrl, { auth: { token }, forceNew: true, transports: ['websocket'] });
}

function waitFor(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), 8000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

function joinAck(socket, roomId, branch, awarenessClientID) {
  return new Promise((resolve, reject) => {
    socket.emit('collab:join', { roomId, branch, awarenessClientID }, (ack) => {
      if (ack?.error) return reject(new Error(ack.error));
      resolve(ack);
    });
  });
}

function docTextFromAck(ack) {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, new Uint8Array(Buffer.from(ack.doc, 'base64')));
  return doc.getText('code').toString();
}

describe('cross-instance collab sync', () => {
  let instanceA;
  let instanceB;

  beforeAll(async () => {
    const mongoUri = `mongodb://${mongoose.connection.host}:${mongoose.connection.port}/${mongoose.connection.name}`;
    const sharedEnv = {
      MONGO_URI: mongoUri,
      REDIS_URL: process.env.REDIS_URL,
      JWT_SECRET: process.env.JWT_SECRET,
      CLIENT_ORIGIN: process.env.CLIENT_ORIGIN,
      NODE_ENV: 'development',
    };
    [instanceA, instanceB] = await Promise.all([forkServerInstance(sharedEnv), forkServerInstance(sharedEnv)]);
  }, 30000);

  afterAll(async () => {
    await Promise.all([stopInstance(instanceA), stopInstance(instanceB)]);
  }, 15000);

  it(
    'keeps a room live on two different instances in sync, both for a cold join and for a live edit',
    async () => {
      const { user: owner, token: ownerToken } = await createUser({ email: 'sync-owner@example.com' });
      const { user: guest, token: guestToken } = await createUser({ email: 'sync-guest@example.com' });
      const room = await Room.create({ name: 'multi-instance room', owner: owner._id, members: [owner._id, guest._id] });
      const roomId = room._id.toString();

      // Client 1 joins the room only on instance A and writes some text
      // through a persistent local Y.Doc, exactly like a real browser client.
      const client1 = connect(instanceA.baseUrl, ownerToken);
      await waitFor(client1, 'connect');
      await joinAck(client1, roomId, 'main', 1001);

      const docA = new Y.Doc();
      docA.on('update', (update, origin) => {
        if (origin === 'remote') return;
        client1.emit('collab:update', { roomId, branch: 'main', update: Buffer.from(update).toString('base64') });
      });

      docA.getText('code').insert(0, "print('from instance A')");
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Cold join on instance B: it has never seen this room before, so it
      // has to ask the cluster (via collabSync.requestPeerState) for a live
      // copy instead of relying on the (still-unsnapshotted) Mongo record.
      const client2 = connect(instanceB.baseUrl, guestToken);
      await waitFor(client2, 'connect');
      const ackB = await joinAck(client2, roomId, 'main', 1002);
      expect(docTextFromAck(ackB)).toBe("print('from instance A')");

      // Now both instances hold this room live at the same time. A further
      // edit from instance A must reach instance B's *server-side* doc, not
      // just browser clients — verified by joining again on B and reading
      // its now-cached state back out.
      docA.getText('code').insert(docA.getText('code').length, ' # edited');

      await new Promise((resolve) => setTimeout(resolve, 500));

      const client3 = connect(instanceB.baseUrl, guestToken);
      await waitFor(client3, 'connect');
      const ackB2 = await joinAck(client3, roomId, 'main', 1003);
      expect(docTextFromAck(ackB2)).toContain('# edited');

      client1.close();
      client2.close();
      client3.close();
    },
    20000
  );
});
