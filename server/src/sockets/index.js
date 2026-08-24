const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const { verifyToken } = require('../utils/jwt');
const { getPubClient, getSubClient } = require('../config/redis');
const env = require('../config/env');
const { registerCollabHandlers } = require('./collabHandlers');
const { registerChatHandlers } = require('./chatHandlers');
const { registerExecutionHandlers } = require('./executionHandlers');
const { registerWebrtcHandlers } = require('./webrtcHandlers');
const { registerGitHandlers } = require('./gitHandlers');
const { registerTerminalHandlers } = require('./terminalHandlers');
const metrics = require('../services/metrics');

function attachSocketAuth(io) {
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error('Authentication required'));
    try {
      const payload = verifyToken(token);
      socket.user = { id: payload.sub, name: payload.name, email: payload.email };
      socket.data.user = socket.user;
      return next();
    } catch (err) {
      return next(new Error('Invalid or expired token'));
    }
  });
}

function createSocketServer(httpServer, { useRedisAdapter = true } = {}) {
  const io = new Server(httpServer, {
    cors: { origin: env.clientOrigin, credentials: true },
  });

  if (useRedisAdapter) {
    io.adapter(createAdapter(getPubClient(), getSubClient()));
  }

  attachSocketAuth(io);

  io.on('connection', (socket) => {
    metrics.increment('connectionsTotal');
    registerCollabHandlers(io, socket);
    registerChatHandlers(io, socket);
    registerExecutionHandlers(io, socket);
    registerWebrtcHandlers(io, socket);
    registerGitHandlers(io, socket);
    registerTerminalHandlers(io, socket);
  });

  return io;
}

module.exports = { createSocketServer };
