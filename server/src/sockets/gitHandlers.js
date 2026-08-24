const Room = require('../models/Room');
const gitService = require('../services/gitService');
const { getOrCreateRoomState, replaceFiles } = require('./collabStore');
const { encryptToken } = require('../utils/tokenCrypto');

async function isRoomMember(roomId, userId) {
  const room = await Room.findById(roomId).select('owner members');
  if (!room) return false;
  return room.owner.toString() === userId || room.members.some((m) => m.toString() === userId);
}

function getLiveFiles(state) {
  const filesMap = state.doc.getMap('files');
  const files = {};
  filesMap.forEach((ytext, key) => {
    files[key] = ytext.toString();
  });
  return files;
}

function collabRoom(roomId, branch) {
  return `collab:${roomId}:${branch}`;
}

function gitRoom(roomId) {
  return `git:${roomId}`;
}

function broadcastFileReplace(io, roomId, branch, newFiles) {
  const update = replaceFiles(roomId, branch, newFiles);
  if (update) {
    io.to(collabRoom(roomId, branch)).emit('collab:update', { update: Buffer.from(update).toString('base64') });
  }
}

function registerGitHandlers(io, socket) {
  socket.on('git:subscribe', async ({ roomId }, ack) => {
    if (!roomId || !(await isRoomMember(roomId, socket.user.id))) return ack?.({ error: 'Not authorized for this room' });
    socket.join(gitRoom(roomId));
    ack?.({ ok: true });
  });

  socket.on('git:log', async ({ roomId, branch }, ack) => {
    try {
      if (!roomId || !(await isRoomMember(roomId, socket.user.id))) return ack?.({ error: 'Not authorized for this room' });
      const commits = await gitService.log(roomId, branch);
      ack?.({ commits });
    } catch (err) {
      ack?.({ error: err.message });
    }
  });

  socket.on('git:show', async ({ roomId, hash }, ack) => {
    try {
      if (!roomId || !(await isRoomMember(roomId, socket.user.id))) return ack?.({ error: 'Not authorized for this room' });
      const diff = await gitService.show(roomId, hash);
      ack?.({ diff });
    } catch (err) {
      ack?.({ error: err.message });
    }
  });

  socket.on('git:branches', async ({ roomId }, ack) => {
    try {
      if (!roomId || !(await isRoomMember(roomId, socket.user.id))) return ack?.({ error: 'Not authorized for this room' });
      const branches = await gitService.listBranches(roomId);
      ack?.(branches);
    } catch (err) {
      ack?.({ error: err.message });
    }
  });

  socket.on('git:commit', async ({ roomId, branch, message }, ack) => {
    try {
      if (!roomId || !branch || !(await isRoomMember(roomId, socket.user.id))) {
        return ack?.({ error: 'Not authorized for this room' });
      }
      const state = await getOrCreateRoomState(roomId, branch);
      const files = getLiveFiles(state);
      const result = await gitService.commit({
        roomId,
        branch,
        message,
        authorName: socket.user.name,
        authorEmail: socket.user.email,
        files,
      });
      if (result.noChanges) return ack?.({ ok: true, noChanges: true });
      io.to(collabRoom(roomId, branch)).emit('git:committed', { by: socket.user.name, branch, hash: result.hash, message: result.message });
      ack?.({ ok: true, hash: result.hash });
    } catch (err) {
      ack?.({ error: err.message });
    }
  });

  socket.on('git:branch-create', async ({ roomId, name, from }, ack) => {
    try {
      if (!roomId || !(await isRoomMember(roomId, socket.user.id))) return ack?.({ error: 'Not authorized for this room' });
      await gitService.createBranch(roomId, name, from);
      io.to(gitRoom(roomId)).emit('git:branch-created', { by: socket.user.name, name });
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ error: err.message });
    }
  });

  socket.on('git:merge', async ({ roomId, from, into }, ack) => {
    try {
      if (!roomId || !into || !(await isRoomMember(roomId, socket.user.id))) return ack?.({ error: 'Not authorized for this room' });
      await getOrCreateRoomState(roomId, into);
      const result = await gitService.merge({ roomId, from, into, authorName: socket.user.name, authorEmail: socket.user.email });
      if (result.conflicted) {
        return ack?.({ ok: false, conflicted: true, files: result.files });
      }
      broadcastFileReplace(io, roomId, into, result.files);
      io.to(collabRoom(roomId, into)).emit('git:merged', { by: socket.user.name, from, into });
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ error: err.message });
    }
  });

  socket.on('git:restore', async ({ roomId, branch, hash }, ack) => {
    try {
      if (!roomId || !branch || !(await isRoomMember(roomId, socket.user.id))) return ack?.({ error: 'Not authorized for this room' });
      await getOrCreateRoomState(roomId, branch);
      const files = await gitService.getCommitTree(roomId, hash);
      broadcastFileReplace(io, roomId, branch, files);
      io.to(collabRoom(roomId, branch)).emit('git:restored', { by: socket.user.name, branch, hash });
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ error: err.message });
    }
  });

  socket.on('git:remote-configure', async ({ roomId, url, token }, ack) => {
    try {
      if (!roomId || !(await isRoomMember(roomId, socket.user.id))) return ack?.({ error: 'Not authorized for this room' });
      if (!/^https:\/\/\S+$/.test(url || '')) return ack?.({ error: 'Remote URL must be an https:// URL' });
      await gitService.configureRemote(roomId, url, token);
      await Room.findByIdAndUpdate(roomId, {
        gitRemote: { url, encryptedToken: token ? encryptToken(token) : null },
      });
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ error: err.message });
    }
  });

  socket.on('git:push', async ({ roomId, branch }, ack) => {
    try {
      if (!roomId || !branch || !(await isRoomMember(roomId, socket.user.id))) return ack?.({ error: 'Not authorized for this room' });
      const room = await Room.findById(roomId);
      await gitService.push(roomId, room, branch);
      io.to(gitRoom(roomId)).emit('git:pushed', { by: socket.user.name, branch });
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ error: err.message });
    }
  });

  socket.on('git:pull', async ({ roomId, branch }, ack) => {
    try {
      if (!roomId || !branch || !(await isRoomMember(roomId, socket.user.id))) return ack?.({ error: 'Not authorized for this room' });
      const room = await Room.findById(roomId);
      await getOrCreateRoomState(roomId, branch);
      const files = await gitService.pull(roomId, room, branch);
      broadcastFileReplace(io, roomId, branch, files);
      io.to(collabRoom(roomId, branch)).emit('git:pulled', { by: socket.user.name, branch });
      ack?.({ ok: true });
    } catch (err) {
      ack?.({ error: err.message });
    }
  });
}

module.exports = { registerGitHandlers };
