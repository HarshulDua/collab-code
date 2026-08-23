const Room = require('../models/Room');

async function isRoomMember(roomId, userId) {
  const room = await Room.findById(roomId).select('owner members');
  if (!room) return false;
  return room.owner.toString() === userId || room.members.some((m) => m.toString() === userId);
}

function registerWebrtcHandlers(io, socket) {
  socket.on('webrtc:join', async ({ roomId }, ack) => {
    if (!roomId || !(await isRoomMember(roomId, socket.user.id))) {
      return ack?.({ error: 'Not authorized for this room' });
    }
    const room = webrtcRoom(roomId);
    const peers = Array.from(io.sockets.adapter.rooms.get(room) || []).filter((id) => id !== socket.id);

    socket.join(room);
    socket.to(room).emit('webrtc:peer-joined', { peerId: socket.id, name: socket.user.name });
    ack?.({ peers });
  });

  socket.on('webrtc:signal', ({ roomId, to, data }) => {
    if (!roomId || !to) return;
    if (!socket.rooms.has(webrtcRoom(roomId))) return;
    io.to(to).emit('webrtc:signal', { from: socket.id, name: socket.user.name, data });
  });

  socket.on('webrtc:leave', ({ roomId }) => leaveWebrtcRoom(socket, roomId));

  socket.on('disconnecting', () => {
    for (const room of socket.rooms) {
      if (room.startsWith('webrtc:')) {
        leaveWebrtcRoom(socket, room.slice('webrtc:'.length));
      }
    }
  });
}

function leaveWebrtcRoom(socket, roomId) {
  const room = webrtcRoom(roomId);
  socket.to(room).emit('webrtc:peer-left', { peerId: socket.id });
  socket.leave(room);
}

function webrtcRoom(roomId) {
  return `webrtc:${roomId}`;
}

module.exports = { registerWebrtcHandlers };
