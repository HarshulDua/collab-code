const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { createApp } = require('./app');
const { createSocketServer } = require('./sockets');
const collabSync = require('./sockets/collabSync');
const sandboxReaper = require('./services/runners/sandboxReaper');
const { connectMongo, disconnectMongo } = require('./config/db');
const { closeRedis } = require('./config/redis');
const env = require('./config/env');
const { logger } = require('./config/logger');

let shuttingDown = false;

async function main() {
  env.assertProductionReady();
  await connectMongo();

  const app = createApp();

  const certPath = path.join(__dirname, '..', '..', 'certs', 'dev-cert.pem');
  const keyPath = path.join(__dirname, '..', '..', 'certs', 'dev-key.pem');
  const hasCert = process.env.ENABLE_HTTPS === '1' && fs.existsSync(certPath) && fs.existsSync(keyPath);
  const httpServer = hasCert
    ? https.createServer({ cert: fs.readFileSync(certPath), key: fs.readFileSync(keyPath) }, app)
    : http.createServer(app);

  const io = createSocketServer(httpServer);
  app.set('io', io);
  const reaperTimer = sandboxReaper.start();

  httpServer.listen(env.port, () => {
    const { port } = httpServer.address();
    const scheme = hasCert ? 'https' : 'http';
    logger.info({ scheme, port }, `Server listening on ${scheme}://localhost:${port}`);
    if (process.send) process.send({ type: 'listening', port });
  });

  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, `${signal} received, shutting down gracefully...`);

    const forceExit = setTimeout(() => process.exit(1), 10_000).unref();

    try {
      clearInterval(reaperTimer);
      await new Promise((resolve) => io.close(resolve));
      await new Promise((resolve) => httpServer.close(resolve));
      await collabSync.stop();
      await disconnectMongo();
      await closeRedis();
      clearTimeout(forceExit);
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'Failed to start server');
  process.exit(1);
});
