const request = require('supertest');
const { buildApp, createUser } = require('./helpers');

describe('POST /api/auth/register', () => {
  it('creates a user and returns a token', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Ada', email: 'ada@example.com', password: 'password123' });

    expect(res.status).toBe(201);
    expect(res.body.token).toBeDefined();
    expect(res.body.user).toMatchObject({ name: 'Ada', email: 'ada@example.com' });
    expect(res.body.user.passwordHash).toBeUndefined();
  });

  it('rejects a duplicate email', async () => {
    const app = buildApp();
    await createUser({ email: 'dupe@example.com' });

    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Second', email: 'dupe@example.com', password: 'password123' });

    expect(res.status).toBe(409);
  });

  it('rejects an invalid email', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Bad', email: 'not-an-email', password: 'password123' });

    expect(res.status).toBe(400);
  });

  it('rejects a short password', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Bad', email: 'shortpw@example.com', password: '123' });

    expect(res.status).toBe(400);
  });

  it('rejects missing fields', async () => {
    const app = buildApp();
    const res = await request(app).post('/api/auth/register').send({ email: 'a@b.com' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials', async () => {
    const app = buildApp();
    await createUser({ email: 'login@example.com', password: 'password123' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'login@example.com', password: 'password123' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });

  it('rejects a wrong password', async () => {
    const app = buildApp();
    await createUser({ email: 'wrongpw@example.com', password: 'password123' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'wrongpw@example.com', password: 'nope12345' });

    expect(res.status).toBe(401);
  });

  it('rejects an unknown email', async () => {
    const app = buildApp();
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'ghost@example.com', password: 'password123' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns the current user with a valid token', async () => {
    const app = buildApp();
    const { token, user } = await createUser({ email: 'me@example.com' });

    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe(user._id.toString());
  });

  it('rejects a missing token', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed token', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/auth/me').set('Authorization', 'Bearer not-a-real-token');
    expect(res.status).toBe(401);
  });
});
