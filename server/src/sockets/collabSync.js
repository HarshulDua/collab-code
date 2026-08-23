const crypto = require('crypto');
const Y = require('yjs');
const { getPubClient, getDataClient } = require('../config/redis');

const CHANNEL = 'collab:sync';
const STATE_REQUEST_TIMEOUT_MS = parseInt(process.env.COLLAB_SYNC_TIMEOUT_MS || '200', 10);

const instanceId = crypto.randomUUID();

let subClient;
let getLocalState = () => undefined;

function publish(message) {
  getDataClient().publish(CHANNEL, JSON.stringify(message));
}

function handleMessage(channel, raw) {
  if (channel !== CHANNEL) return;

  let msg;
  try {
    msg = JSON.parse(raw);
  } catch (_) {
    return;
  }
  if (msg.instanceId === instanceId) return;

  if (msg.type === 'update') {
    const state = getLocalState(msg.roomId);
    if (!state) return;
    Y.applyUpdate(state.doc, new Uint8Array(Buffer.from(msg.update, 'base64')), 'redis-sync');
    return;
  }

  if (msg.type === 'state-request') {
    const state = getLocalState(msg.roomId);
    if (!state) return;
    const update = Y.encodeStateAsUpdate(state.doc);
    publish({
      type: 'state-response',
      roomId: msg.roomId,
      to: msg.instanceId,
      update: Buffer.from(update).toString('base64'),
      instanceId,
    });
    return;
  }

  if (msg.type === 'state-response') {
    if (msg.to !== instanceId) return;
    const state = getLocalState(msg.roomId);
    if (!state) return;
    Y.applyUpdate(state.doc, new Uint8Array(Buffer.from(msg.update, 'base64')), 'redis-sync');
  }
}

function init(getRoomStateFn) {
  getLocalState = getRoomStateFn;
  if (subClient) return;
  subClient = getPubClient().duplicate();
  subClient.subscribe(CHANNEL);
  subClient.on('message', handleMessage);
}

function publishUpdate(roomId, update) {
  publish({ type: 'update', roomId, update: Buffer.from(update).toString('base64'), instanceId });
}

function requestPeerState(roomId) {
  publish({ type: 'state-request', roomId, instanceId });
  return new Promise((resolve) => setTimeout(resolve, STATE_REQUEST_TIMEOUT_MS));
}

async function stop() {
  if (subClient) {
    subClient.removeListener('message', handleMessage);
    await subClient.quit();
    subClient = undefined;
  }
}

module.exports = { init, publishUpdate, requestPeerState, stop, instanceId, CHANNEL };
