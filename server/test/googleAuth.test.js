const request = require('supertest');

// Mocked so the suite never reaches Google's servers: the thing worth testing
// here is what this application does with a verified (or unverifiable) token,
// not Google's signature checking.
const mockVerifyIdToken = jest.fn();
jest.mock('google-auth-library', () => ({
  OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: mockVerifyIdToken })),
}));

const env = require('../src/config/env');
const { buildApp } = require('./helpers');
const User = require('../src/models/User');

const app = buildApp();

function payload(overrides = {}) {
  return {
    sub: 'google-sub-123',
    email: 'gauth@example.com',
    email_verified: true,
    name: 'G Auth',
    picture: 'https://lh3.googleusercontent.com/photo.jpg',
    ...overrides,
  };
}

describe('POST /api/auth/google', () => {
  const originalClientId = env.googleClientId;

  beforeEach(() => {
    jest.clearAllMocks();
    env.googleClientId = 'test-client-id.apps.googleusercontent.com';
  });

  afterAll(() => {
    env.googleClientId = originalClientId;
  });

  it('refuses when the deployment has no Google client id configured', async () => {
    env.googleClientId = null;
    const res = await request(app).post('/api/auth/google').send({ credential: 'anything' });
    expect(res.status).toBe(503);
    expect(mockVerifyIdToken).not.toHaveBeenCalled();
  });

  it('requires a credential', async () => {
    const res = await request(app).post('/api/auth/google').send({});
    expect(res.status).toBe(400);
  });

  it('rejects a token Google will not verify', async () => {
    mockVerifyIdToken.mockRejectedValue(new Error('Invalid token signature'));
    const res = await request(app).post('/api/auth/google').send({ credential: 'forged' });
    expect(res.status).toBe(401);
    expect(await User.countDocuments()).toBe(0);
  });

  it('verifies against our own client id, not just any Google token', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload() });
    await request(app).post('/api/auth/google').send({ credential: 'good' });
    expect(mockVerifyIdToken).toHaveBeenCalledWith(
      expect.objectContaining({ audience: 'test-client-id.apps.googleusercontent.com' })
    );
  });

  it('rejects an unverified email address', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload({ email_verified: false }) });
    const res = await request(app).post('/api/auth/google').send({ credential: 'good' });
    expect(res.status).toBe(401);
    expect(await User.countDocuments()).toBe(0);
  });

  it('creates an account on first sign-in, carrying the profile picture through', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload() });
    const res = await request(app).post('/api/auth/google').send({ credential: 'good' });

    expect(res.status).toBe(200);
    expect(res.body.token).toEqual(expect.any(String));
    expect(res.body.user).toMatchObject({
      name: 'G Auth',
      email: 'gauth@example.com',
      picture: 'https://lh3.googleusercontent.com/photo.jpg',
    });

    const stored = await User.findOne({ email: 'gauth@example.com' });
    expect(stored.googleId).toBe('google-sub-123');
    // No password was set, and specifically not an empty hash that bcrypt
    // would then be asked to compare against.
    expect(stored.passwordHash).toBeNull();
  });

  it('signs the same person back in without creating a second account', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload() });
    await request(app).post('/api/auth/google').send({ credential: 'good' });
    await request(app).post('/api/auth/google').send({ credential: 'good' });
    expect(await User.countDocuments({ email: 'gauth@example.com' })).toBe(1);
  });

  it('links Google to an existing password account with the same email', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Existing', email: 'gauth@example.com', password: 'password123' });

    mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload() });
    const res = await request(app).post('/api/auth/google').send({ credential: 'good' });

    expect(res.status).toBe(200);
    expect(await User.countDocuments({ email: 'gauth@example.com' })).toBe(1);

    const stored = await User.findOne({ email: 'gauth@example.com' });
    expect(stored.googleId).toBe('google-sub-123');
    // The original password still works — linking must not lock them out.
    expect(stored.passwordHash).toEqual(expect.any(String));

    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'gauth@example.com', password: 'password123' });
    expect(login.status).toBe(200);
  });

  it('issues a usable session token', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload() });
    const res = await request(app).post('/api/auth/google').send({ credential: 'good' });

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${res.body.token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('gauth@example.com');
  });
});

describe('password login against a Google-only account', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    env.googleClientId = 'test-client-id.apps.googleusercontent.com';
  });

  it('explains that the account has no password rather than saying "invalid credentials"', async () => {
    mockVerifyIdToken.mockResolvedValue({ getPayload: () => payload() });
    await request(app).post('/api/auth/google').send({ credential: 'good' });

    const res = await request(app).post('/api/auth/login').send({ email: 'gauth@example.com', password: 'guessing' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/Google/i);
  });
});
