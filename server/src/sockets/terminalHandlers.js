const Room = require('../models/Room');
const terminalService = require('../services/terminalService');
const { getOrCreateRoomState, replaceFiles } = require('./collabStore');
const metrics = require('../services/metrics');

const MAX_COMMAND_LENGTH = 2000;

async function isRoomMember(roomId, userId) {
  const room = await Room.findById(roomId).select('owner members');
  if (!room) return false;
  return room.owner.toString() === userId || room.members.some((m) => m.toString() === userId);
}

function collabRoom(roomId, branch) {
  return `collab:${roomId}:${branch}`;
}

function gitRoom(roomId) {
  return `git:${roomId}`;
}

function getLiveFiles(state) {
  const files = {};
  state.doc.getMap('files').forEach((ytext, key) => {
    files[key] = ytext.toString();
  });
  return files;
}

function registerTerminalHandlers(io, socket) {
  socket.on('terminal:exec', async ({ roomId, branch, cwd, command }, ack) => {
    try {
      if (!roomId || !branch || !(await isRoomMember(roomId, socket.user.id))) {
        return ack?.({ error: 'Not authorized for this room' });
      }
      if (typeof command !== 'string' || command.length > MAX_COMMAND_LENGTH) {
        return ack?.({ error: `Command must be a string under ${MAX_COMMAND_LENGTH} characters` });
      }

      const state = await getOrCreateRoomState(roomId, branch);
      const files = getLiveFiles(state);

      const result = await terminalService.execute({
        command,
        cwd: typeof cwd === 'string' ? cwd : '',
        files,
        roomId,
        branch,
        user: socket.user,
      });

      // A command that changed the tree writes back through the same path git
      // restore/merge use, so every client on this branch sees it live and the
      // file explorer updates without a refresh.
      if (result.files) {
        const update = replaceFiles(roomId, branch, result.files);
        if (update) {
          io.to(collabRoom(roomId, branch)).emit('collab:update', {
            update: Buffer.from(update).toString('base64'),
          });
        }
      }

      // Commit/branch/merge through the terminal should light up the Git panel
      // for everyone, exactly as the panel's own buttons do.
      if (result.refreshGit) {
        io.to(gitRoom(roomId)).emit('git:committed', { by: socket.user.name, branch });
      }

      metrics.increment('terminalCommands');

      ack?.({
        output: result.output ?? '',
        cwd: result.cwd ?? '',
        exitCode: result.exitCode ?? 0,
        clear: Boolean(result.clear),
        switchBranch: result.switchBranch || null,
      });
    } catch (err) {
      console.error('terminal:exec failed', err); // eslint-disable-line no-console
      ack?.({ error: 'Command failed' });
    }
  });
}

module.exports = { registerTerminalHandlers };
