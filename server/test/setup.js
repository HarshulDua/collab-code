const os = require('os');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/15';
process.env.CLIENT_ORIGIN = 'http://localhost:5173';
process.env.ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@example.com';
// Isolated per-test-file temp dir, never the real server/.git-rooms — env.js
// reads this at first require, so it must be set before anything requires it.
process.env.GIT_ROOMS_DIR = path.join(os.tmpdir(), `collab-git-rooms-test-${crypto.randomUUID()}`);

const { getDataClient, closeRedis } = require('../src/config/redis');
const collabSync = require('../src/sockets/collabSync');

let mongod;

beforeAll(async () => {
  if (process.env.MONGO_URI) {
    await mongoose.connect(process.env.MONGO_URI);
  } else {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }
}, 60000);

afterEach(async () => {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
  try {
    await getDataClient().flushdb();
  } catch (_) {
    // redis not needed/available for this test file — ignore
  }
});

afterAll(async () => {
  await mongoose.disconnect();
  // collabSync opens its own dedicated Redis subscriber connection,
  // separate from the ones closeRedis() owns — a test file that never
  // touches sockets/collabStore never opens it, so this is a no-op there.
  await collabSync.stop();
  await closeRedis();
  if (mongod) await mongod.stop();
  await fs.rm(process.env.GIT_ROOMS_DIR, { recursive: true, force: true }).catch(() => {});
});
