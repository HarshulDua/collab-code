const { createApp } = require('../src/app');
const User = require('../src/models/User');
const { signToken } = require('../src/utils/jwt');
const bcrypt = require('bcrypt');

function buildApp({ io } = {}) {
  const app = createApp();
  if (io) app.set('io', io);
  return app;
}

async function createUser({ name = 'Test User', email = 'test@example.com', password = 'password123' } = {}) {
  const passwordHash = await bcrypt.hash(password, 4);
  const user = await User.create({ name, email, passwordHash });
  const token = signToken(user);
  return { user, token };
}

module.exports = { buildApp, createUser };
