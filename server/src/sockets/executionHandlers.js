const Room = require('../models/Room');
const { executeCode } = require('../services/executionService');
const metrics = require('../services/metrics');

async function isRoomMember(roomId, userId) {
  const room = await Room.findById(roomId).select('owner members');
  if (!room) return false;
  return room.owner.toString() === userId || room.members.some((m) => m.toString() === userId);
}

function collabRoom(roomId, branch) {
  return `collab:${roomId}:${branch}`;
}

function registerExecutionHandlers(io, socket) {
  socket.on('execution:run', async ({ roomId, branch, language = 'python', code, files, entryPath, stdin }, ack) => {
    try {
      if (!roomId || !branch || !(await isRoomMember(roomId, socket.user.id))) {
        return ack?.({ error: 'Not authorized for this room' });
      }

      const room = collabRoom(roomId, branch);
      io.to(room).emit('execution:started', { by: socket.user.name });
      const result = await executeCode({ language, code, files, entryPath, stdin, userId: socket.user.id, roomId });
      metrics.increment('executionsRun');
      io.to(room).emit('execution:result', { by: socket.user.name, result });
      ack?.({ ok: true });
    } catch (err) {
      metrics.increment('executionsFailed');
      if (!err.statusCode) console.error('execution:run failed', err);
      const message = err.statusCode ? err.message : 'Execution failed';
      io.to(collabRoom(roomId, branch)).emit('execution:error', { by: socket.user.name, error: message });
      ack?.({ error: message });
    }
  });
}

module.exports = { registerExecutionHandlers };
