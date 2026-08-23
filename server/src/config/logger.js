const pino = require('pino');
const env = require('./env');

const RING_BUFFER_SIZE = 500;
const ringBuffer = [];

function ringBufferStream() {
  return {
    write(line) {
      let entry;
      try {
        entry = JSON.parse(line);
      } catch (_) {
        return;
      }
      ringBuffer.push(entry);
      if (ringBuffer.length > RING_BUFFER_SIZE) ringBuffer.shift();
    },
  };
}

const destinations = [{ stream: ringBufferStream() }];
if (env.nodeEnv === 'development') {
  destinations.push({ stream: pino.transport({ target: 'pino-pretty', options: { colorize: true } }) });
} else if (env.nodeEnv !== 'test') {
  destinations.push({ stream: process.stdout });
}

const logger = pino(
  { level: process.env.LOG_LEVEL || (env.nodeEnv === 'test' ? 'silent' : 'info') },
  pino.multistream(destinations)
);

function recentLogs(limit = 200) {
  return ringBuffer.slice(-limit);
}

module.exports = { logger, recentLogs };
