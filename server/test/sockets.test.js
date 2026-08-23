const http = require('http');
const { AddressInfo } = require('net');
const Y = require('yjs');
const ioClient = require('socket.io-client');
const { createSocketServer } = require('../src/sockets');
const { createUser } = require('./helpers');
const Room = require('../src/models/Room');
const Message = require('../src/models/Message');

jest.mock('../src/services/executionService', () => ({
  executeCode: jest.fn(),
}));
const { executeCode } = require('../src/services/executionService');

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
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), 5000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

async function makeRoom(ownerId, memberIds = []) {
  const room = await Room.create({ name: 'Socket room', owner: ownerId, members: [ownerId, ...memberIds] });
  return room._id.toString();
}

describe('socket auth', () => {
  it('rejects connections without a token', async () => {
    const socket = connect(undefined);
    const err = await waitFor(socket, 'connect_error');
    expect(err.message).toMatch(/Authentication required/);
    socket.close();
  });

  it('rejects connections with an invalid token', async () => {
    const socket = connect('garbage-token');
    const err = await waitFor(socket, 'connect_error');
    expect(err.message).toMatch(/Invalid or expired token/);
    socket.close();
  });
});

describe('collab namespace (Yjs relay)', () => {
  it('converges two clients editing the same shared text', async () => {
    const { user: owner, token: ownerToken } = await createUser({ email: 'collab-owner@example.com' });
    const { user: guest, token: guestToken } = await createUser({ email: 'collab-guest@example.com' });
    const roomId = await makeRoom(owner._id.toString(), [guest._id.toString()]);

    const clientA = connect(ownerToken);
    const clientB = connect(guestToken);
    await Promise.all([waitFor(clientA, 'connect'), waitFor(clientB, 'connect')]);

    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const joinAck = (socket, awarenessClientID) =>
      new Promise((resolve) => socket.emit('collab:join', { roomId, branch: 'main', awarenessClientID }, resolve));

    await joinAck(clientA, docA.clientID);
    await joinAck(clientB, docB.clientID);

    clientB.on('collab:update', ({ update }) => {
      Y.applyUpdate(docB, new Uint8Array(Buffer.from(update, 'base64')), 'remote');
    });

    docA.on('update', (update, origin) => {
      if (origin === 'remote') return;
      clientA.emit('collab:update', { roomId, branch: 'main', update: Buffer.from(update).toString('base64') });
    });

    docA.getText('code').insert(0, 'print("hello")');

    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(docB.getText('code').toString()).toBe('print("hello")');

    clientA.close();
    clientB.close();
  });

  it('rejects joining a room the user is not a member of', async () => {
    const { user: owner } = await createUser({ email: 'collab-owner2@example.com' });
    const { token: strangerToken } = await createUser({ email: 'collab-stranger@example.com' });
    const roomId = await makeRoom(owner._id.toString());

    const socket = connect(strangerToken);
    await waitFor(socket, 'connect');

    const ack = await new Promise((resolve) => socket.emit('collab:join', { roomId, branch: 'main' }, resolve));
    expect(ack.error).toBeDefined();

    socket.close();
  });
});

describe('chat namespace', () => {
  it('broadcasts and persists a chat message', async () => {
    const { user: owner, token: ownerToken } = await createUser({ email: 'chat-owner@example.com' });
    const { user: guest, token: guestToken } = await createUser({ email: 'chat-guest@example.com' });
    const roomId = await makeRoom(owner._id.toString(), [guest._id.toString()]);

    const clientA = connect(ownerToken);
    const clientB = connect(guestToken);
    await Promise.all([waitFor(clientA, 'connect'), waitFor(clientB, 'connect')]);

    await Promise.all([
      new Promise((resolve) => clientA.emit('chat:join', { roomId }, resolve)),
      new Promise((resolve) => clientB.emit('chat:join', { roomId }, resolve)),
    ]);

    const received = waitFor(clientB, 'chat:message');
    clientA.emit('chat:send', { roomId, text: 'hello room' }, () => {});
    const message = await received;

    expect(message.text).toBe('hello room');
    expect(message.authorName).toBe(owner.name);

    const stored = await Message.find({ room: roomId });
    expect(stored).toHaveLength(1);

    clientA.close();
    clientB.close();
  });
});

describe('execution namespace', () => {
  it('relays a successful run to the room', async () => {
    executeCode.mockResolvedValue({ stdout: 'ok\n', stderr: '', exitCode: 0, timedOut: false, durationMs: 5 });

    const { user: owner, token: ownerToken } = await createUser({ email: 'exec-owner@example.com' });
    const roomId = await makeRoom(owner._id.toString());

    const socket = connect(ownerToken);
    await waitFor(socket, 'connect');
    await new Promise((resolve) => socket.emit('collab:join', { roomId, branch: 'main' }, resolve));

    const resultPromise = waitFor(socket, 'execution:result');
    socket.emit('execution:run', { roomId, branch: 'main', language: 'python', code: 'print("ok")' }, () => {});
    const payload = await resultPromise;

    expect(payload.result.stdout).toBe('ok\n');
    socket.close();
  });

  it('emits execution:error when the service rejects', async () => {
    const err = new Error('Execution rate limit exceeded. Try again shortly.');
    err.statusCode = 429;
    executeCode.mockRejectedValue(err);

    const { user: owner, token: ownerToken } = await createUser({ email: 'exec-owner2@example.com' });
    const roomId = await makeRoom(owner._id.toString());

    const socket = connect(ownerToken);
    await waitFor(socket, 'connect');
    await new Promise((resolve) => socket.emit('collab:join', { roomId, branch: 'main' }, resolve));

    const errorPromise = waitFor(socket, 'execution:error');
    socket.emit('execution:run', { roomId, branch: 'main', language: 'python', code: 'print(1)' }, () => {});
    const payload = await errorPromise;

    expect(payload.error).toMatch(/rate limit/);
    socket.close();
  });
});

describe('webrtc namespace', () => {
  it('notifies existing peers and relays signaling payloads', async () => {
    const { user: owner, token: ownerToken } = await createUser({ email: 'webrtc-owner@example.com' });
    const { user: guest, token: guestToken } = await createUser({ email: 'webrtc-guest@example.com' });
    const roomId = await makeRoom(owner._id.toString(), [guest._id.toString()]);

    const clientA = connect(ownerToken);
    await waitFor(clientA, 'connect');
    await new Promise((resolve) => clientA.emit('webrtc:join', { roomId }, resolve));

    const peerJoined = waitFor(clientA, 'webrtc:peer-joined');
    const clientB = connect(guestToken);
    await waitFor(clientB, 'connect');
    const bAck = await new Promise((resolve) => clientB.emit('webrtc:join', { roomId }, resolve));

    const joinedPayload = await peerJoined;
    expect(joinedPayload.peerId).toBe(clientB.id);
    expect(bAck.peers).toContain(clientA.id);

    const signalReceived = waitFor(clientA, 'webrtc:signal');
    clientB.emit('webrtc:signal', { roomId, to: clientA.id, data: { type: 'offer', sdp: 'fake-sdp' } });
    const signal = await signalReceived;

    expect(signal.from).toBe(clientB.id);
    expect(signal.data.type).toBe('offer');

    clientA.close();
    clientB.close();
  });
});
