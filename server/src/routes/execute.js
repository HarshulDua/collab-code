const express = require('express');
const mongoose = require('mongoose');
const { requireAuth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const Room = require('../models/Room');
const { executeCode } = require('../services/executionService');

const router = express.Router();
router.use(requireAuth);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { language = 'python', code, files, entryPath, stdin, roomId } = req.body || {};

    if (roomId) {
      if (!mongoose.Types.ObjectId.isValid(roomId)) {
        throw new ApiError(404, 'Room not found');
      }
      const room = await Room.findById(roomId);
      if (!room) throw new ApiError(404, 'Room not found');
      const member =
        room.owner.toString() === req.user.id || room.members.some((m) => m.toString() === req.user.id);
      if (!member) throw new ApiError(403, 'Not a member of this room');
    }

    const result = await executeCode({ language, code, files, entryPath, stdin, userId: req.user.id, roomId });
    res.json({ result });
  })
);

module.exports = router;
