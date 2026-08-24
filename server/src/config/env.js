require('dotenv').config();

function required(name, fallback) {
  const value = process.env[name] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const INSECURE_DEFAULTS = {
  jwtSecret: 'dev-only-insecure-secret',
  gitTokenEncryptionKey: 'dev-only-insecure-git-token-key',
};

const env = {
  nodeEnv: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '4000', 10),
  clientOrigin: (process.env.CLIENT_ORIGIN || 'http://localhost:5173').split(',').map((o) => o.trim()),

  mongoUri: required('MONGO_URI', 'mongodb://localhost:27017/collab'),
  redisUrl: required('REDIS_URL', 'redis://localhost:6379'),

  jwtSecret: required('JWT_SECRET', INSECURE_DEFAULTS.jwtSecret),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  gitRoomsDir: process.env.GIT_ROOMS_DIR || require('path').join(__dirname, '..', '..', '.git-rooms'),
  gitTokenEncryptionKey: process.env.GIT_TOKEN_ENCRYPTION_KEY || INSECURE_DEFAULTS.gitTokenEncryptionKey,

  sandboxImage: process.env.SANDBOX_IMAGE || 'collab-sandbox:latest',
  execHostTmpDir: process.env.EXEC_HOST_TMP_DIR || null,
  execTimeoutMs: parseInt(process.env.EXEC_TIMEOUT_MS || '8000', 10),
  execMemoryBytes: parseInt(process.env.EXEC_MEMORY_BYTES || String(128 * 1024 * 1024), 10),
  execMaxOutputChars: parseInt(process.env.EXEC_MAX_OUTPUT_CHARS || '20000', 10),
  execMaxConcurrent: parseInt(process.env.EXEC_MAX_CONCURRENT || '4', 10),
  execRateLimitPerMin: parseInt(process.env.EXEC_RATE_LIMIT_PER_MIN || '10', 10),

  adminEmail: process.env.ADMIN_EMAIL || null,
  authRateLimitPerMin: parseInt(process.env.AUTH_RATE_LIMIT_PER_MIN || '30', 10),
};

function assertProductionReady() {
  if (env.nodeEnv !== 'production') return;
  const problems = [];
  if (!env.jwtSecret || env.jwtSecret === INSECURE_DEFAULTS.jwtSecret) {
    problems.push('JWT_SECRET is unset or using the dev default');
  }
  if (!env.gitTokenEncryptionKey || env.gitTokenEncryptionKey === INSECURE_DEFAULTS.gitTokenEncryptionKey) {
    problems.push('GIT_TOKEN_ENCRYPTION_KEY is unset or using the dev default');
  }
  if (!env.adminEmail) problems.push('ADMIN_EMAIL is unset');
  if (problems.length > 0) {
    throw new Error(`Refusing to start in production with insecure config:\n  - ${problems.join('\n  - ')}`);
  }
}

module.exports = { ...env, assertProductionReady };
