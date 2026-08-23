const { getDataClient } = require('../config/redis');

async function checkAndConsume(key, limit, windowSeconds) {
  const redis = getDataClient();
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, windowSeconds);
  }
  return count <= limit;
}

module.exports = { checkAndConsume };
