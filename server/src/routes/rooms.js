const express = require('express');
const mongoose = require('mongoose');
const Room = require('../models/Room');
const Message = require('../models/Message');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const metrics = require('../services/metrics');

const router = express.Router();
router.use(requireAuth);

function isValidId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

async function loadRoomOrThrow(id) {
  if (!isValidId(id)) throw new ApiError(404, 'Room not found');
  const room = await Room.findById(id);
  if (!room) throw new ApiError(404, 'Room not found');
  return room;
}

function isMember(room, userId) {
  return room.owner.toString() === userId || room.members.some((m) => m.toString() === userId);
}

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name } = req.body || {};
    if (!name || !name.trim()) {
      throw new ApiError(400, 'Room name is required');
    }
    const room = await Room.create({
      name: name.trim(),
      owner: req.user.id,
      members: [req.user.id],
    });
    metrics.increment('roomsCreated');
    res.status(201).json({ room: room.toPublicJSON() });
  })
);

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const rooms = await Room.find({
      $or: [{ owner: req.user.id }, { members: req.user.id }],
    }).sort({ createdAt: -1 });
    res.json({ rooms: rooms.map((r) => r.toPublicJSON()) });
  })
);

router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const room = await loadRoomOrThrow(req.params.id);
    if (!isMember(room, req.user.id)) {
      throw new ApiError(403, 'Not a member of this room');
    }
    res.json({ room: room.toPublicJSON() });
  })
);

router.post(
  '/:id/join',
  asyncHandler(async (req, res) => {
    const room = await loadRoomOrThrow(req.params.id);
    if (!isMember(room, req.user.id)) {
      room.members.push(req.user.id);
      await room.save();
    }
    res.json({ room: room.toPublicJSON() });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const room = await loadRoomOrThrow(req.params.id);
    if (room.owner.toString() !== req.user.id) {
      throw new ApiError(403, 'Only the room owner can delete this room');
    }
    await room.deleteOne();
    await Message.deleteMany({ room: room._id });
    res.status(204).send();
  })
);

router.get(
  '/:id/messages',
  asyncHandler(async (req, res) => {
    const room = await loadRoomOrThrow(req.params.id);
    if (!isMember(room, req.user.id)) {
      throw new ApiError(403, 'Not a member of this room');
    }
    const messages = await Message.find({ room: room._id }).sort({ createdAt: 1 }).limit(500);
    res.json({ messages: messages.map((m) => m.toPublicJSON()) });
  })
);

module.exports = router;
