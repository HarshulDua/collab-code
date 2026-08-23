const http = require('http');
const Y = require('yjs');
const ioClient = require('socket.io-client');
const { createSocketServer } = require('../src/sockets');
const { createUser } = require('./helpers');
const Room = require('../src/models/Room');

let httpServer;
let io;
let baseUrl;

beforeAll((done) => {
  httpServer = http.createServer();
  io = createSocketServer(httpServer, { useRedisAdapter: false });
  httpServer.listen(() => {
    const { port } = httpServer.address();
    baseUrl = `http://localhost:${port}`;
    done();
  });
});

afterAll((done) => {
  io.close();
  httpServer.close(done);
});

function connect(token) {
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

function emitAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`ack timeout for ${event}`)), 8000);
    socket.emit(event, payload, (ack) => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

async function makeRoom(ownerId, memberIds = []) {
  const room = await Room.create({ name: 'Git room', owner: ownerId, members: [ownerId, ...memberIds] });
  return room._id.toString();
}

/** Joins a (room, branch) collab session and seeds the files map, mirroring what the client's ensureDefaultFile does. */
async function joinAndSeed(socket, roomId, branch, files) {
  const doc = new Y.Doc();
  await emitAck(socket, 'collab:join', { roomId, branch, awarenessClientID: doc.clientID });
  socket.on('collab:update', ({ update }) => {
    Y.applyUpdate(doc, new Uint8Array(Buffer.from(update, 'base64')), 'remote');
  });
  doc.transact(() => {
    const filesMap = doc.getMap('files');
    Object.entries(files).forEach(([path, content]) => filesMap.set(path, new Y.Text(content)));
  });
  const update = Y.encodeStateAsUpdate(doc);
  socket.emit('collab:update', { roomId, branch, update: Buffer.from(update).toString('base64') });
  await new Promise((resolve) => setTimeout(resolve, 200)); // let the server apply it
  return doc;
}

async function joinExisting(socket, roomId, branch) {
  const doc = new Y.Doc();
  const ack = await emitAck(socket, 'collab:join', { roomId, branch, awarenessClientID: doc.clientID });
  Y.applyUpdate(doc, new Uint8Array(Buffer.from(ack.doc, 'base64')), 'remote');
  socket.on('collab:update', ({ update }) => {
    Y.applyUpdate(doc, new Uint8Array(Buffer.from(update, 'base64')), 'remote');
  });
  return doc;
}

function readFiles(doc) {
  const files = {};
  doc.getMap('files').forEach((ytext, key) => {
    files[key] = ytext.toString();
  });
  return files;
}

describe('git socket handlers', () => {
  it('rejects git operations from a non-member', async () => {
    const { user: owner } = await createUser({ email: 'git-owner1@example.com' });
    const { token: strangerToken } = await createUser({ email: 'git-stranger@example.com' });
    const roomId = await makeRoom(owner._id.toString());

    const socket = connect(strangerToken);
    await waitFor(socket, 'connect');
    const ack = await emitAck(socket, 'git:commit', { roomId, branch: 'main', message: 'hack' });
    expect(ack.error).toMatch(/Not authorized/);
    socket.close();
  });

  it('commits the live doc content for a branch and broadcasts git:committed to clients on that branch', async () => {
    const { user: owner, token: ownerToken } = await createUser({ email: 'git-owner2@example.com' });
    const roomId = await makeRoom(owner._id.toString());

    const socket = connect(ownerToken);
    await waitFor(socket, 'connect');
    await joinAndSeed(socket, roomId, 'main', { 'main.py': 'print(1)\n' });

    const committedPromise = waitFor(socket, 'git:committed');
    const ack = await emitAck(socket, 'git:commit', { roomId, branch: 'main', message: 'Initial commit' });
    expect(ack.ok).toBe(true);
    expect(ack.hash).toBeTruthy();

    const broadcast = await committedPromise;
    expect(broadcast.message).toBe('Initial commit');
    expect(broadcast.branch).toBe('main');

    const logAck = await emitAck(socket, 'git:log', { roomId, branch: 'main' });
    expect(logAck.commits).toHaveLength(1);
    expect(logAck.commits[0].message).toBe('Initial commit');

    socket.close();
  });

  it('two clients on different branches of the same room see fully independent content', async () => {
    const { user: owner, token: ownerToken } = await createUser({ email: 'git-owner3@example.com' });
    const { user: guest, token: guestToken } = await createUser({ email: 'git-guest3@example.com' });
    const roomId = await makeRoom(owner._id.toString(), [guest._id.toString()]);

    const socketA = connect(ownerToken);
    await waitFor(socketA, 'connect');
    const docA = await joinAndSeed(socketA, roomId, 'main', { 'main.py': 'print("main")\n' });
    await emitAck(socketA, 'git:commit', { roomId, branch: 'main', message: 'base' });
    await emitAck(socketA, 'git:branch-create', { roomId, name: 'feature', from: 'main' });

    const socketB = connect(guestToken);
    await waitFor(socketB, 'connect');
    const docB = await joinExisting(socketB, roomId, 'feature');

    // B, on "feature", edits — A, still on "main", must never see this.
    docB.transact(() => {
      docB.getMap('files').get('main.py').insert(0, 'EDITED ON FEATURE ');
    });
    socketB.emit('collab:update', {
      roomId,
      branch: 'feature',
      update: Buffer.from(Y.encodeStateAsUpdate(docB)).toString('base64'),
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(readFiles(docB)['main.py']).toContain('EDITED ON FEATURE');
    expect(readFiles(docA)['main.py']).toBe('print("main")\n'); // untouched

    // Committing on B's branch shouldn't create any commit visible from "main"'s log.
    await emitAck(socketB, 'git:commit', { roomId, branch: 'feature', message: 'feature edit' });
    const mainLog = await emitAck(socketA, 'git:log', { roomId, branch: 'main' });
    expect(mainLog.commits.map((c) => c.message)).not.toContain('feature edit');

    socketA.close();
    socketB.close();
  });

  it('rejoining a branch after every client left it restores content from the last commit', async () => {
    const { user: owner, token: ownerToken } = await createUser({ email: 'git-owner5@example.com' });
    const roomId = await makeRoom(owner._id.toString());

    const socket = connect(ownerToken);
    await waitFor(socket, 'connect');
    await joinAndSeed(socket, roomId, 'main', { 'main.py': "print('v1')" });
    const firstCommit = await emitAck(socket, 'git:commit', { roomId, branch: 'main', message: 'v1' });
    expect(firstCommit.ok).toBe(true);

    await emitAck(socket, 'git:branch-create', { roomId, name: 'feature', from: 'main' });

    // Fully leave "main" — zero clients left on it — then work on "feature"
    // and commit there too, exactly like RoomPage.jsx unmounting the old
    // BranchWorkspace and mounting a new one on branch switch. collab:leave
    // has no ack (fire-and-forget, matching YjsSocketProvider.destroy()),
    // so give the server a beat to process it before moving on.
    socket.emit('collab:leave', { roomId, branch: 'main' });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const featureDoc = await joinExisting(socket, roomId, 'feature');
    featureDoc.transact(() => {
      const ytext = featureDoc.getMap('files').get('main.py');
      ytext.delete(0, ytext.length);
      ytext.insert(0, "print('v2 on feature')");
    });
    socket.emit('collab:update', {
      roomId,
      branch: 'feature',
      update: Buffer.from(Y.encodeStateAsUpdate(featureDoc)).toString('base64'),
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await emitAck(socket, 'git:commit', { roomId, branch: 'feature', message: 'v2 on feature' });
    socket.emit('collab:leave', { roomId, branch: 'feature' });
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Rejoin "main" — its in-memory state was fully disposed when we left
    // it above, so this must reconstruct content from the "v1" commit, not
    // come back empty.
    const mainDocAgain = await joinExisting(socket, roomId, 'main');
    expect(readFiles(mainDocAgain)['main.py']).toBe("print('v1')");

    socket.close();
  });

  it('survives React StrictMode double-invoking the join effect (join, immediate leave, join again — before the first ack lands)', async () => {
    const { user: owner, token: ownerToken } = await createUser({ email: 'git-owner6@example.com' });
    const roomId = await makeRoom(owner._id.toString());

    const socket = connect(ownerToken);
    await waitFor(socket, 'connect');
    await joinAndSeed(socket, roomId, 'main', { 'main.py': "print('v1')" });
    const firstCommit = await emitAck(socket, 'git:commit', { roomId, branch: 'main', message: 'v1' });
    expect(firstCommit.ok).toBe(true);
    socket.emit('collab:leave', { roomId, branch: 'main' });
    await new Promise((resolve) => setTimeout(resolve, 100)); // fully disposed, like a real branch switch away and back

    // StrictMode's dev-only double-invoke: BranchWorkspace's effect runs,
    // then its cleanup runs synchronously (before the join ack can possibly
    // have arrived over the network), then the effect runs again for real —
    // all three emits (join, leave, join) go out back-to-back on the same
    // socket before any of their acks come back.
    const doc = new Y.Doc();
    const joinPromise1 = new Promise((resolve) => socket.emit('collab:join', { roomId, branch: 'main', awarenessClientID: doc.clientID }, resolve));
    socket.emit('collab:leave', { roomId, branch: 'main' });
    const joinPromise2 = new Promise((resolve) => socket.emit('collab:join', { roomId, branch: 'main', awarenessClientID: doc.clientID }, resolve));

    const [ack1, ack2] = await Promise.all([joinPromise1, joinPromise2]);
    expect(ack1.error).toBeUndefined();
    expect(ack2.error).toBeUndefined();

    // Mirrors BranchWorkspace.jsx: apply whichever ack corresponds to the
    // *second* (real, non-cancelled) effect invocation.
    Y.applyUpdate(doc, new Uint8Array(Buffer.from(ack2.doc, 'base64')), 'remote');
    expect(readFiles(doc)['main.py']).toBe("print('v1')");

    socket.close();
  });

  it('merge and restore propagate via collab:update only to clients on the affected branch', async () => {
    const { user: owner, token: ownerToken } = await createUser({ email: 'git-owner4@example.com' });
    const roomId = await makeRoom(owner._id.toString());

    const socket = connect(ownerToken);
    await waitFor(socket, 'connect');
    const mainDoc = await joinAndSeed(socket, roomId, 'main', { 'a.py': 'v1\n' });
    const firstCommit = await emitAck(socket, 'git:commit', { roomId, branch: 'main', message: 'v1' });
    expect(firstCommit.ok).toBe(true);

    await emitAck(socket, 'git:branch-create', { roomId, name: 'feature', from: 'main' });

    // Join "feature" on the SAME socket (a client can be joined to more
    // than one branch's collab room at once — RoomPage.jsx never does
    // this in practice since BranchWorkspace unmounts the old one first,
    // but the server has no reason to forbid it, and it's convenient here
    // for observing both branches from one connection).
    const featureDoc = await joinExisting(socket, roomId, 'feature');
    featureDoc.transact(() => {
      const ytext = featureDoc.getMap('files').get('a.py');
      ytext.delete(0, ytext.length);
      ytext.insert(0, 'v2 on feature\n');
    });
    socket.emit('collab:update', {
      roomId,
      branch: 'feature',
      update: Buffer.from(Y.encodeStateAsUpdate(featureDoc)).toString('base64'),
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    await emitAck(socket, 'git:commit', { roomId, branch: 'feature', message: 'v2' });

    // Merging feature into main must update main's live doc...
    const mergeAck = await emitAck(socket, 'git:merge', { roomId, from: 'feature', into: 'main' });
    expect(mergeAck.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(readFiles(mainDoc)['a.py']).toBe('v2 on feature\n');
    // ...and must NOT touch feature's own doc.
    expect(readFiles(featureDoc)['a.py']).toBe('v2 on feature\n'); // unchanged from feature's own edit

    const restoreAck = await emitAck(socket, 'git:restore', { roomId, branch: 'main', hash: firstCommit.hash });
    expect(restoreAck.ok).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(readFiles(mainDoc)['a.py']).toBe('v1\n');
    expect(readFiles(featureDoc)['a.py']).toBe('v2 on feature\n'); // restore on main doesn't touch feature

    socket.close();
  });
});
