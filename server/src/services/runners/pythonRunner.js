const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { getDocker } = require('../dockerClient');
const env = require('../../config/env');
const { isSafeRelativePath } = require('../../utils/safePath');

async function run(files, entryPath, opts = {}) {
  const paths = Object.keys(files);
  if (paths.length === 0) throw new Error('files must contain at least one entry');
  if (!paths.includes(entryPath)) throw new Error('entryPath must be a key in files');
  for (const p of paths) {
    if (!isSafeRelativePath(p)) throw new Error(`unsafe file path: ${p}`);
  }

  const docker = getDocker();
  const timeoutMs = opts.timeoutMs ?? env.execTimeoutMs;
  const memoryBytes = opts.memoryBytes ?? env.execMemoryBytes;
  const maxOutputChars = opts.maxOutputChars ?? env.execMaxOutputChars;

  const hostDir = await fs.mkdtemp(path.join(env.execHostTmpDir || os.tmpdir(), 'collab-exec-'));
  await fs.chmod(hostDir, 0o755);
  for (const [relPath, content] of Object.entries(files)) {
    const hostFile = path.join(hostDir, relPath);
    await fs.mkdir(path.dirname(hostFile), { recursive: true, mode: 0o755 });
    await fs.writeFile(hostFile, content, { mode: 0o444 });
  }

  let cmd;
  if (typeof opts.stdin === 'string' && opts.stdin.length > 0) {
    await fs.writeFile(path.join(hostDir, '.stdin'), opts.stdin, { mode: 0o444 });
    cmd = ['sh', '-c', `python3 -E -s -B /code/${entryPath} < /code/.stdin`];
  } else {
    cmd = ['python3', '-E', '-s', '-B', `/code/${entryPath}`];
  }

  const container = await docker.createContainer({
    Image: env.sandboxImage,
    Cmd: cmd,
    User: 'sandbox',
    AttachStdout: true,
    AttachStderr: true,
    Tty: false,
    NetworkDisabled: true,
    HostConfig: {
      Binds: [`${hostDir}:/code:ro`],
      Memory: memoryBytes,
      MemorySwap: memoryBytes,
      NanoCpus: 500_000_000,
      PidsLimit: 64,
      ReadonlyRootfs: true,
      Tmpfs: { '/tmp': 'size=16m,noexec' },
      AutoRemove: true,
      CapDrop: ['ALL'],
      SecurityOpt: ['no-new-privileges'],
      NetworkMode: 'none',
    },
  });

  const startedAt = Date.now();
  let stdout = '';
  let stderr = '';
  let timedOut = false;
  let killTimer;

  try {
    const stream = await container.attach({ stream: true, stdout: true, stderr: true });

    const stdoutChunks = { text: () => stdout, push: (s) => { stdout = appendCapped(stdout, s, maxOutputChars); } };
    const stderrChunks = { text: () => stderr, push: (s) => { stderr = appendCapped(stderr, s, maxOutputChars); } };

    const stdoutSink = writableSink(stdoutChunks);
    const stderrSink = writableSink(stderrChunks);
    docker.modem.demuxStream(stream, stdoutSink, stderrSink);

    await container.start();

    const waitPromise = container.wait();
    const timeoutPromise = new Promise((resolve) => {
      killTimer = setTimeout(async () => {
        timedOut = true;
        try {
          await container.kill();
        } catch (_) {}
        resolve({ StatusCode: null });
      }, timeoutMs);
    });

    const result = await Promise.race([waitPromise, timeoutPromise]);
    clearTimeout(killTimer);

    return {
      stdout,
      stderr,
      exitCode: timedOut ? null : result.StatusCode,
      timedOut,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(killTimer);
    try {
      await container.remove({ force: true });
    } catch (_) {}
    await fs.rm(hostDir, { recursive: true, force: true });
  }
}

function appendCapped(current, chunk, maxChars) {
  if (current.length >= maxChars) return current;
  const combined = current + chunk;
  return combined.length > maxChars ? `${combined.slice(0, maxChars)}\n...[output truncated]` : combined;
}

function writableSink(target) {
  const { Writable } = require('stream');
  return new Writable({
    write(chunk, _enc, cb) {
      target.push(chunk.toString('utf8'));
      cb();
    },
  });
}

module.exports = { run };
