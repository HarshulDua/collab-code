const Redis = require('ioredis');
const env = require('./env');

let pubClient;
let subClient;
let dataClient;

function getPubClient() {
  if (!pubClient) pubClient = new Redis(env.redisUrl, { maxRetriesPerRequest: null });
  return pubClient;
}

function getSubClient() {
  if (!subClient) subClient = getPubClient().duplicate();
  return subClient;
}

function getDataClient() {
  if (!dataClient) dataClient = new Redis(env.redisUrl, { maxRetriesPerRequest: null });
  return dataClient;
}

async function closeRedis() {
  await Promise.all([pubClient?.quit(), subClient?.quit(), dataClient?.quit()].filter(Boolean));
  pubClient = subClient = dataClient = undefined;
}

module.exports = { getPubClient, getSubClient, getDataClient, closeRedis };
