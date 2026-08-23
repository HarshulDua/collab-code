const Room = require('../models/Room');
const Message = require('../models/Message');

async function isRoomMember(roomId, userId) {
  const room = await Room.findById(roomId).select('owner members');
  if (!room) return false;
  return room.owner.toString() === userId || room.members.some((m) => m.toString() === userId);
}

function registerChatHandlers(io, socket) {
  socket.on('chat:join', async ({ roomId }, ack) => {
    if (!roomId || !(await isRoomMember(roomId, socket.user.id))) {
      return ack?.({ error: 'Not authorized for this room' });
    }
    socket.join(chatRoom(roomId));
    ack?.({ ok: true });
  });

  socket.on('chat:send', async ({ roomId, text }, ack) => {
    try {
      if (!roomId || !text || !text.trim()) {
        return ack?.({ error: 'roomId and text are required' });
      }
      if (!(await isRoomMember(roomId, socket.user.id))) {
        return ack?.({ error: 'Not authorized for this room' });
      }

      const message = await Message.create({
        room: roomId,
        author: socket.user.id,
        authorName: socket.user.name,
        text: text.trim().slice(0, 4000),
      });

      io.to(chatRoom(roomId)).emit('chat:message', message.toPublicJSON());
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ error: 'Failed to send message' });
    }
  });
}

function chatRoom(roomId) {
  return `chat:${roomId}`;
}

module.exports = { registerChatHandlers };
