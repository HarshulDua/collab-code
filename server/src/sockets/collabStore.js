const Y = require('yjs');
const { Awareness } = require('y-protocols/awareness');
const Room = require('../models/Room');
const collabSync = require('./collabSync');
const gitService = require('../services/gitService');

const states = new Map();

const SNAPSHOT_DEBOUNCE_MS = 4000;


function stateKey(roomId, branch) {
  return `${roomId}::${branch}`;
}

function createRoomState(roomId, branch) {
  const doc = new Y.Doc();
  const awareness = new Awareness(doc);

  doc.on('update', (_update, origin) => {
    if (origin === 'snapshot') return;
    scheduleSnapshot(roomId, branch);
  });

  return {
    roomId,
    branch,
    doc,
    awareness,
    clients: new Map(),
    snapshotTimer: null,
  };
}

const loading = new Map();

async function getOrCreateRoomState(roomId, branch) {
  const key = stateKey(roomId, branch);
  let state = states.get(key);
  if (state) {
    if (loading.has(key)) await loading.get(key);
    return state;
  }

  state = createRoomState(roomId, branch);
  states.set(key, state);

  const seedPromise = seedRoomState(roomId, branch, state);
  loading.set(key, seedPromise);
  try {
    await seedPromise;
  } finally {
    loading.delete(key);
  }

  return state;
}

async function seedRoomState(roomId, branch, state) {
  const key = stateKey(roomId, branch);
  const room = await Room.findById(roomId).select('ydocSnapshots');
  const snapshot = room?.ydocSnapshots?.get(branch);
  if (snapshot?.length) {
    Y.applyUpdate(state.doc, new Uint8Array(snapshot), 'snapshot');
  } else {
    const files = await gitService.getCommitTree(roomId, branch).catch(() => ({}));
    if (Object.keys(files).length > 0) {
      state.doc.transact(() => {
        const filesMap = state.doc.getMap('files');
        Object.entries(files).forEach(([p, content]) => filesMap.set(p, new Y.Text(content)));
      }, 'snapshot');
    }
  }

  await collabSync.requestPeerState(key);

}

function scheduleSnapshot(roomId, branch) {
  const key = stateKey(roomId, branch);
  const state = states.get(key);
  if (!state) return;
  if (state.snapshotTimer) return;

  state.snapshotTimer = setTimeout(async () => {
    state.snapshotTimer = null;
    try {
      const update = Y.encodeStateAsUpdate(state.doc);
      await Room.findByIdAndUpdate(roomId, { [`ydocSnapshots.${branch}`]: Buffer.from(update) });
    } catch (_) {}
  }, SNAPSHOT_DEBOUNCE_MS);
}

function disposeIfEmpty(roomId, branch) {
  const key = stateKey(roomId, branch);
  const state = states.get(key);
  if (!state || state.clients.size !== 0) return;

  // A snapshot may still be pending inside the debounce window. Dropping the
  // timer here would silently discard every edit made in the last few
  // seconds before the last client left — so encode the final state now
  // (synchronously, before the doc is destroyed) and persist it.
  const hadPendingSnapshot = Boolean(state.snapshotTimer);
  if (state.snapshotTimer) {
    clearTimeout(state.snapshotTimer);
    state.snapshotTimer = null;
  }
  const finalUpdate = hadPendingSnapshot ? Y.encodeStateAsUpdate(state.doc) : null;

  state.doc.destroy();
  states.delete(key);

  if (finalUpdate) {
    Room.findByIdAndUpdate(roomId, { [`ydocSnapshots.${branch}`]: Buffer.from(finalUpdate) }).catch(() => {});
  }
}

function getRoomState(roomId, branch) {
  return states.get(stateKey(roomId, branch));
}

function replaceFiles(roomId, branch, newFiles) {
  const key = stateKey(roomId, branch);
  const state = states.get(key);
  if (!state) return null;

  let capturedUpdate = null;
  const capture = (update) => {
    capturedUpdate = update;
  };
  state.doc.on('update', capture);

  state.doc.transact(() => {
    const filesMap = state.doc.getMap('files');
    const oldKeys = new Set(filesMap.keys());
    const newKeys = new Set(Object.keys(newFiles));

    oldKeys.forEach((k) => {
      if (!newKeys.has(k)) filesMap.delete(k);
    });

    newKeys.forEach((k) => {
      const content = newFiles[k];
      if (filesMap.has(k)) {
        const ytext = filesMap.get(k);
        if (ytext.toString() !== content) {
          ytext.delete(0, ytext.length);
          ytext.insert(0, content);
        }
      } else {
        filesMap.set(k, new Y.Text(content));
      }
    });
  }, 'server');

  state.doc.off('update', capture);

  if (capturedUpdate) {
    collabSync.publishUpdate(key, capturedUpdate);
  }
  return capturedUpdate;
}

collabSync.init((key) => states.get(key));

module.exports = { getOrCreateRoomState, getRoomState, scheduleSnapshot, disposeIfEmpty, replaceFiles, stateKey };
