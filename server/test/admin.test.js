const http = require('http');
const request = require('supertest');
const ioClient = require('socket.io-client');
const { createApp } = require('../src/app');
const { createSocketServer } = require('../src/sockets');
const { createUser } = require('./helpers');
const Room = require('../src/models/Room');

let httpServer;
let io;
let baseUrl;

beforeAll((done) => {
  const app = createApp();
  httpServer = http.createServer(app);
  io = createSocketServer(httpServer, { useRedisAdapter: false });
  app.set('io', io);
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

function waitFor(socket, event) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), 5000);
    socket.once(event, (payload) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

describe('admin API', () => {
  it('returns 404 to a non-admin user', async () => {
    const { token } = await createUser({ email: 'not-admin@example.com' });
    const res = await request(httpServer).get('/api/admin/rooms').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(httpServer).get('/api/admin/rooms');
    expect(res.status).toBe(401);
  });

  it('lists rooms with live connected-user data for the admin user', async () => {
    const { user: owner, token: ownerToken } = await createUser({ email: 'admin-room-owner@example.com' });
    const { token: adminToken } = await createUser({ email: 'admin@example.com' });
    const room = await Room.create({ name: 'Admin-visible room', owner: owner._id, members: [owner._id] });
    const roomId = room._id.toString();

    const socket = ioClient(baseUrl, { auth: { token: ownerToken }, forceNew: true, transports: ['websocket'] });
    await waitFor(socket, 'connect');
    await new Promise((resolve) => socket.emit('collab:join', { roomId, branch: 'main' }, resolve));

    const listRes = await request(httpServer).get('/api/admin/rooms').set('Authorization', `Bearer ${adminToken}`);
    expect(listRes.status).toBe(200);
    const found = listRes.body.rooms.find((r) => r.id === roomId);
    expect(found).toBeTruthy();
    expect(found.connectedUsers).toBe(1);
    expect(found.liveBranches).toContain('main');

    const detailRes = await request(httpServer)
      .get(`/api/admin/rooms/${roomId}`)
      .set('Authorization', `Bearer ${adminToken}`);
    expect(detailRes.status).toBe(200);
    const mainBranch = detailRes.body.branches.find((b) => b.branch === 'main');
    expect(mainBranch.users[0].email).toBe('admin-room-owner@example.com');

    socket.close();
  });

  it('exposes summary stats and recent logs to the admin', async () => {
    const { token: adminToken } = await createUser({ email: 'admin@example.com' });

    const statsRes = await request(httpServer).get('/api/admin/stats').set('Authorization', `Bearer ${adminToken}`);
    expect(statsRes.status).toBe(200);
    expect(typeof statsRes.body.totalRooms).toBe('number');
    expect(typeof statsRes.body.currentlyConnected).toBe('number');

    const logsRes = await request(httpServer).get('/api/admin/logs').set('Authorization', `Bearer ${adminToken}`);
    expect(logsRes.status).toBe(200);
    expect(Array.isArray(logsRes.body.logs)).toBe(true);
  });
});
