const request = require('supertest');
const { buildApp, createUser } = require('./helpers');

describe('Rooms API', () => {
  it('creates a room owned by the requester', async () => {
    const app = buildApp();
    const { token, user } = await createUser({ email: 'owner@example.com' });

    const res = await request(app).post('/api/rooms').set('Authorization', `Bearer ${token}`).send({ name: 'Room 1' });

    expect(res.status).toBe(201);
    expect(res.body.room.name).toBe('Room 1');
    expect(res.body.room.owner).toBe(user._id.toString());
    expect(res.body.room.members).toContain(user._id.toString());
  });

  it('rejects room creation without a name', async () => {
    const app = buildApp();
    const { token } = await createUser({ email: 'noname@example.com' });

    const res = await request(app).post('/api/rooms').set('Authorization', `Bearer ${token}`).send({});
    expect(res.status).toBe(400);
  });

  it('requires auth for all room routes', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/rooms');
    expect(res.status).toBe(401);
  });

  it('lists only rooms the user owns or is a member of', async () => {
    const app = buildApp();
    const { token: tokenA } = await createUser({ email: 'a@example.com' });
    const { token: tokenB } = await createUser({ email: 'b@example.com' });

    await request(app).post('/api/rooms').set('Authorization', `Bearer ${tokenA}`).send({ name: 'A room' });
    await request(app).post('/api/rooms').set('Authorization', `Bearer ${tokenB}`).send({ name: 'B room' });

    const res = await request(app).get('/api/rooms').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(200);
    expect(res.body.rooms).toHaveLength(1);
    expect(res.body.rooms[0].name).toBe('A room');
  });

  it('lets a non-member join a room via /join', async () => {
    const app = buildApp();
    const { token: ownerToken } = await createUser({ email: 'owner2@example.com' });
    const { token: joinerToken, user: joiner } = await createUser({ email: 'joiner@example.com' });

    const create = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Shared room' });
    const roomId = create.body.room.id;

    const join = await request(app).post(`/api/rooms/${roomId}/join`).set('Authorization', `Bearer ${joinerToken}`);
    expect(join.status).toBe(200);
    expect(join.body.room.members).toContain(joiner._id.toString());
  });

  it('blocks non-members from reading a room', async () => {
    const app = buildApp();
    const { token: ownerToken } = await createUser({ email: 'owner3@example.com' });
    const { token: strangerToken } = await createUser({ email: 'stranger@example.com' });

    const create = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Private room' });
    const roomId = create.body.room.id;

    const res = await request(app).get(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${strangerToken}`);
    expect(res.status).toBe(403);
  });

  it('returns 404 for a non-existent room id', async () => {
    const app = buildApp();
    const { token } = await createUser({ email: 'ghostroom@example.com' });
    const res = await request(app)
      .get('/api/rooms/000000000000000000000000')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });

  it('only lets the owner delete a room', async () => {
    const app = buildApp();
    const { token: ownerToken } = await createUser({ email: 'owner4@example.com' });
    const { token: strangerToken } = await createUser({ email: 'stranger2@example.com' });

    const create = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Doomed room' });
    const roomId = create.body.room.id;

    const forbidden = await request(app)
      .delete(`/api/rooms/${roomId}`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(forbidden.status).toBe(403);

    const ok = await request(app).delete(`/api/rooms/${roomId}`).set('Authorization', `Bearer ${ownerToken}`);
    expect(ok.status).toBe(204);
  });

  it('returns chat history scoped to room membership', async () => {
    const app = buildApp();
    const { token: ownerToken } = await createUser({ email: 'owner5@example.com' });
    const { token: strangerToken } = await createUser({ email: 'stranger3@example.com' });

    const create = await request(app)
      .post('/api/rooms')
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ name: 'Chatty room' });
    const roomId = create.body.room.id;

    const own = await request(app).get(`/api/rooms/${roomId}/messages`).set('Authorization', `Bearer ${ownerToken}`);
    expect(own.status).toBe(200);
    expect(own.body.messages).toEqual([]);

    const forbidden = await request(app)
      .get(`/api/rooms/${roomId}/messages`)
      .set('Authorization', `Bearer ${strangerToken}`);
    expect(forbidden.status).toBe(403);
  });
});
