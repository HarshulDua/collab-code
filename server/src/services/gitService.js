const fs = require('fs/promises');
const path = require('path');
const simpleGit = require('simple-git');
const env = require('../config/env');
const { isSafeRelativePath } = require('../utils/safePath');
const { encryptToken, decryptToken } = require('../utils/tokenCrypto');

function getRepoDir(roomId) {
  return path.join(env.gitRoomsDir, roomId);
}

async function hasOwnGitDir(dir) {
  return fs
    .access(path.join(dir, '.git'))
    .then(() => true)
    .catch(() => false);
}

const initLocks = new Map();

function ensureRepo(roomId) {
  if (!initLocks.has(roomId)) {
    initLocks.set(roomId, initRepo(roomId));
  }
  return initLocks.get(roomId);
}

async function initRepo(roomId) {
  const dir = getRepoDir(roomId);
  await fs.mkdir(dir, { recursive: true });
  const git = simpleGit(dir);

  if (!(await hasOwnGitDir(dir))) {
    await git.init();
    await git.raw(['branch', '-m', 'main']).catch(() => {});
    await git.addConfig('core.autocrlf', 'false');
    await git.addConfig('user.name', 'Collab Room');
    await git.addConfig('user.email', 'noreply@collab.local');
  }
  return git;
}

const repoLocks = new Map();

function withRepoLock(roomId, fn) {
  const prevTail = repoLocks.get(roomId) || Promise.resolve();
  const result = prevTail.then(fn, fn);
  repoLocks.set(
    roomId,
    result.then(
      () => {},
      () => {}
    )
  );
  return result;
}

async function readWorkingTree(dir) {
  const files = {};

  async function walk(current, prefix) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.git') continue;
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(fullPath, relPath);
      } else {
        // eslint-disable-next-line no-await-in-loop
        files[relPath] = await fs.readFile(fullPath, 'utf8');
      }
    }
  }

  await walk(dir, '');
  return files;
}

async function syncWorkingDir(dir, files) {
  for (const p of Object.keys(files)) {
    if (!isSafeRelativePath(p)) throw new Error(`unsafe file path: ${p}`);
  }

  const existing = await readWorkingTree(dir);
  for (const relPath of Object.keys(existing)) {
    if (!(relPath in files)) {
      // eslint-disable-next-line no-await-in-loop
      await fs.rm(path.join(dir, relPath), { force: true });
    }
  }
  for (const [relPath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, relPath);
    // eslint-disable-next-line no-await-in-loop
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    // eslint-disable-next-line no-await-in-loop
    await fs.writeFile(fullPath, content, 'utf8');
  }
}

async function checkoutBranch(git, branch) {
  const status = await git.status();
  if (status.current === branch) return;
  await git.checkout(branch);
}

async function commit({ roomId, branch, message, authorName, authorEmail, files }) {
  return withRepoLock(roomId, async () => {
    const dir = getRepoDir(roomId);
    const git = await ensureRepo(roomId);
    await checkoutBranch(git, branch);
    await syncWorkingDir(dir, files);
    await git.add('.');
    const status = await git.status();
    if (status.staged.length === 0 && status.created.length === 0 && status.deleted.length === 0) {
      return { noChanges: true };
    }
    const safeMessage = (message || 'Update').slice(0, 500);
    const result = await git.commit(safeMessage, {
      '--author': `${authorName} <${authorEmail || 'noreply@example.com'}>`,
    });
    return { hash: result.commit, message: safeMessage };
  });
}

async function log(roomId, branch) {
  const git = await ensureRepo(roomId);
  const hasCommits = await git.raw(['rev-list', '-n', '1', '--all']).then((r) => r.trim().length > 0).catch(() => false);
  if (!hasCommits) return [];
  const result = await git.log(branch ? [branch] : undefined).catch(() => ({ all: [] }));
  return result.all.map((c) => ({ hash: c.hash, message: c.message, authorName: c.author_name, date: c.date }));
}

async function show(roomId, hash) {
  const git = await ensureRepo(roomId);
  return git.show([hash]);
}

async function getCommitTree(roomId, ref) {
  const git = await ensureRepo(roomId);
  const pathsRaw = await git.raw(['ls-tree', '-r', '--name-only', ref]).catch(() => '');
  const paths = pathsRaw.split('\n').map((p) => p.trim()).filter(Boolean);
  const files = {};
  for (const p of paths) {
    // eslint-disable-next-line no-await-in-loop
    files[p] = await git.show([`${ref}:${p}`]);
  }
  return files;
}

async function branchExists(roomId, branch) {
  const git = await ensureRepo(roomId);
  const summary = await git.branchLocal().catch(() => ({ all: [] }));
  return summary.all.includes(branch);
}

async function listBranches(roomId) {
  const git = await ensureRepo(roomId);
  const summary = await git.branchLocal();
  return { all: summary.all };
}

async function createBranch(roomId, name, from) {
  if (!/^[a-zA-Z0-9_/-]{1,100}$/.test(name)) throw new Error('Invalid branch name');
  return withRepoLock(roomId, async () => {
    const git = await ensureRepo(roomId);
    if (from) await git.branch([name, from]);
    else await git.branch([name]);
    return getCommitTree(roomId, name);
  });
}

async function merge({ roomId, from, into, authorName, authorEmail }) {
  return withRepoLock(roomId, async () => {
    const git = await ensureRepo(roomId);
    await checkoutBranch(git, into);
    try {
      await git
        .env({
          GIT_AUTHOR_NAME: authorName,
          GIT_AUTHOR_EMAIL: authorEmail || 'noreply@example.com',
          GIT_COMMITTER_NAME: authorName,
          GIT_COMMITTER_EMAIL: authorEmail || 'noreply@example.com',
        })
        .merge([from, '--no-edit']);
      return { conflicted: false, files: await readWorkingTree(getRepoDir(roomId)) };
    } catch (err) {
      const conflictFiles = (err.git?.conflicts || []).map((c) => c.file).filter(Boolean);
      await git.merge(['--abort']).catch(() => {});
      return { conflicted: true, files: conflictFiles.length ? conflictFiles : ['unknown — see server logs'] };
    }
  });
}

async function ensureOriginRemote(git, authedUrl) {
  const remotes = await git.getRemotes();
  if (remotes.some((r) => r.name === 'origin')) {
    await git.remote(['set-url', 'origin', authedUrl]);
  } else {
    await git.addRemote('origin', authedUrl);
  }
}

async function configureRemote(roomId, url, token) {
  const git = await ensureRepo(roomId);
  const authedUrl = token ? url.replace('https://', `https://x-access-token:${token}@`) : url;
  await ensureOriginRemote(git, authedUrl);
}

function loadAuthedRemoteUrl(room) {
  if (!room.gitRemote?.url) return null;
  const token = room.gitRemote.encryptedToken ? decryptToken(room.gitRemote.encryptedToken) : null;
  return token ? room.gitRemote.url.replace('https://', `https://x-access-token:${token}@`) : room.gitRemote.url;
}

async function push(roomId, room, branch) {
  return withRepoLock(roomId, async () => {
    const git = await ensureRepo(roomId);
    const authedUrl = loadAuthedRemoteUrl(room);
    if (!authedUrl) throw new Error('No remote configured for this room');
    await ensureOriginRemote(git, authedUrl);
    await git.push('origin', branch, ['--set-upstream']);
  });
}

async function pull(roomId, room, branch) {
  return withRepoLock(roomId, async () => {
    const git = await ensureRepo(roomId);
    const authedUrl = loadAuthedRemoteUrl(room);
    if (!authedUrl) throw new Error('No remote configured for this room');
    await ensureOriginRemote(git, authedUrl);
    await checkoutBranch(git, branch);
    await git.pull('origin', branch);
    return readWorkingTree(getRepoDir(roomId));
  });
}

module.exports = {
  getRepoDir,
  ensureRepo,
  readWorkingTree,
  syncWorkingDir,
  isDirty: async (roomId) => {
    const git = await ensureRepo(roomId);
    const status = await git.status();
    return !status.isClean();
  },
  commit,
  log,
  show,
  getCommitTree,
  branchExists,
  listBranches,
  createBranch,
  merge,
  configureRemote,
  push,
  pull,
  encryptToken,
};
