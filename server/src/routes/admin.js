const express = require('express');
const Room = require('../models/Room');
const { requireAuth } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/requireAdmin');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const metrics = require('../services/metrics');
const { recentLogs } = require('../config/logger');

const router = express.Router();
router.use(requireAuth, requireAdmin);

function parseCollabRoomName(roomName) {
  if (!roomName.startsWith('collab:')) return null;
  const rest = roomName.slice('collab:'.length);
  const [roomId, branch] = rest.split(':');
  if (!roomId || !branch) return null;
  return { roomId, branch };
}

async function getLiveRoomsData(io) {
  const sockets = await io.fetchSockets();
  const byRoom = new Map();
  for (const s of sockets) {
    const user = s.data?.user;
    for (const roomName of s.rooms) {
      const parsed = parseCollabRoomName(roomName);
      if (!parsed) continue;
      if (!byRoom.has(parsed.roomId)) byRoom.set(parsed.roomId, new Map());
      const branches = byRoom.get(parsed.roomId);
      if (!branches.has(parsed.branch)) branches.set(parsed.branch, []);
      branches.get(parsed.branch).push({
        socketId: s.id,
        userId: user?.id || null,
        name: user?.name || 'unknown',
        email: user?.email || null,
      });
    }
  }
  return byRoom;
}

router.get(
  '/rooms',
  asyncHandler(async (req, res) => {
    const io = req.app.get('io');
    const [rooms, live] = await Promise.all([Room.find().sort({ createdAt: -1 }).limit(500), getLiveRoomsData(io)]);

    const result = rooms.map((room) => {
      const roomId = room._id.toString();
      const branches = live.get(roomId);
      const connectedUsers = branches ? Array.from(branches.values()).reduce((n, users) => n + users.length, 0) : 0;
      return {
        id: roomId,
        name: room.name,
        owner: room.owner,
        memberCount: room.members.length,
        createdAt: room.createdAt,
        connectedUsers,
        liveBranches: branches ? Array.from(branches.keys()) : [],
      };
    });

    res.json({ rooms: result });
  })
);

router.get(
  '/rooms/:id',
  asyncHandler(async (req, res) => {
    const room = await Room.findById(req.params.id);
    if (!room) throw new ApiError(404, 'Room not found');

    const io = req.app.get('io');
    const live = await getLiveRoomsData(io);
    const branches = live.get(req.params.id) || new Map();

    res.json({
      room: {
        id: room._id.toString(),
        name: room.name,
        owner: room.owner,
        members: room.members,
        createdAt: room.createdAt,
        gitRemoteUrl: room.gitRemote?.url || null,
      },
      branches: Array.from(branches.entries()).map(([branch, users]) => ({ branch, users })),
    });
  })
);

router.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const io = req.app.get('io');
    const [totalRooms, sockets] = await Promise.all([Room.countDocuments(), io.fetchSockets()]);
    res.json({
      ...metrics.snapshot(),
      totalRooms,
      currentlyConnected: sockets.length,
    });
  })
);

router.get(
  '/logs',
  asyncHandler(async (req, res) => {
    const limit = Math.min(parseInt(req.query.limit, 10) || 200, 500);
    res.json({ logs: recentLogs(limit) });
  })
);

module.exports = router;
