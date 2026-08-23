const Y = require('yjs');
const { applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } = require('y-protocols/awareness');
const Room = require('../models/Room');
const { getOrCreateRoomState, getRoomState, scheduleSnapshot, disposeIfEmpty } = require('./collabStore');
const collabSync = require('./collabSync');

async function isRoomMember(roomId, userId) {
  const room = await Room.findById(roomId).select('owner members');
  if (!room) return false;
  return room.owner.toString() === userId || room.members.some((m) => m.toString() === userId);
}

function collabRoom(roomId, branch) {
  return `collab:${roomId}:${branch}`;
}

function registerCollabHandlers(io, socket) {
  socket.on('collab:join', async ({ roomId, branch, awarenessClientID }, ack) => {
    try {
      if (!roomId || !branch || !(await isRoomMember(roomId, socket.user.id))) {
        return ack?.({ error: 'Not authorized for this room' });
      }

      socket.join(collabRoom(roomId, branch));
      const state = await getOrCreateRoomState(roomId, branch);
      state.clients.set(socket.id, { userId: socket.user.id, awarenessClientID, roomId, branch });

      const initUpdate = Y.encodeStateAsUpdate(state.doc);
      const awarenessUpdate = encodeAwarenessUpdate(state.awareness, Array.from(state.awareness.getStates().keys()));

      ack?.({
        doc: Buffer.from(initUpdate).toString('base64'),
        awareness: Buffer.from(awarenessUpdate).toString('base64'),
      });
    } catch (err) {
      ack?.({ error: 'Failed to join room' });
    }
  });

  socket.on('collab:update', ({ roomId, branch, update }) => {
    const state = getRoomState(roomId, branch);
    if (!state || !state.clients.has(socket.id)) return;

    const bytes = new Uint8Array(Buffer.from(update, 'base64'));
    Y.applyUpdate(state.doc, bytes, socket.id);
    socket.to(collabRoom(roomId, branch)).emit('collab:update', { update });
    collabSync.publishUpdate(`${roomId}::${branch}`, bytes);
  });

  socket.on('collab:awareness', ({ roomId, branch, update }) => {
    const state = getRoomState(roomId, branch);
    if (!state || !state.clients.has(socket.id)) return;

    const bytes = new Uint8Array(Buffer.from(update, 'base64'));
    applyAwarenessUpdate(state.awareness, bytes, socket.id);
    socket.to(collabRoom(roomId, branch)).emit('collab:awareness', { update });
  });

  socket.on('collab:leave', ({ roomId, branch }) => leaveCollabRoom(socket, roomId, branch));

  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (room.startsWith('collab:')) {
        const [roomId, branch] = room.slice('collab:'.length).split(':');
        leaveCollabRoom(socket, roomId, branch);
      }
    }
  });
}

function leaveCollabRoom(socket, roomId, branch) {
  const state = getRoomState(roomId, branch);
  if (!state) return;

  const client = state.clients.get(socket.id);
  state.clients.delete(socket.id);
  socket.leave(collabRoom(roomId, branch));

  if (client?.awarenessClientID != null && state.awareness.meta.has(client.awarenessClientID)) {
    removeAwarenessStates(state.awareness, [client.awarenessClientID], 'disconnect');
    const update = encodeAwarenessUpdate(state.awareness, [client.awarenessClientID]);
    socket.to(collabRoom(roomId, branch)).emit('collab:awareness', { update: Buffer.from(update).toString('base64') });
  }

  scheduleSnapshot(roomId, branch);
  disposeIfEmpty(roomId, branch);
}

module.exports = { registerCollabHandlers };
