const fs = require('fs/promises');
const os = require('os');
const path = require('path');
const { Writable } = require('stream');
const { getDocker } = require('../dockerClient');
const env = require('../../config/env');
const { isSafeRelativePath } = require('../../utils/safePath');

async function runInSandbox(files, entryPath, buildCmd, opts = {}) {
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
  const hasStdin = typeof opts.stdin === 'string' && opts.stdin.length > 0;

  const hostDir = await fs.mkdtemp(path.join(env.execHostTmpDir || os.tmpdir(), 'collab-exec-'));
  await fs.chmod(hostDir, 0o755);
  for (const [relPath, content] of Object.entries(files)) {
    const hostFile = path.join(hostDir, relPath);
    await fs.mkdir(path.dirname(hostFile), { recursive: true, mode: 0o755 });
    await fs.writeFile(hostFile, content, { mode: 0o444 });
  }
  if (hasStdin) {
    await fs.writeFile(path.join(hostDir, '.stdin'), opts.stdin, { mode: 0o444 });
  }

  const cmd = buildCmd({ entryPath, paths, hasStdin });

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
      // /build gets compiled output (C/C++/Go/Rust write a native binary here
      // and exec it directly) so it needs `exec` — Docker's tmpfs default is
      // noexec, which silently produces exit code 126 on every compiled
      // language otherwise. /tmp never holds anything we run, so it stays
      // locked down.
      // A cold Go build compiles the runtime/fmt/etc. from scratch into its
      // work dir before it ever touches the user's file — that alone needs
      // tens of MB of scratch space, well past a small tmpfs cap.
      Tmpfs: { '/tmp': 'size=16m,noexec', '/build': 'rw,exec,nosuid,nodev,size=300m' },
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

    const stdoutChunks = { push: (s) => { stdout = appendCapped(stdout, s, maxOutputChars); } };
    const stderrChunks = { push: (s) => { stderr = appendCapped(stderr, s, maxOutputChars); } };

    docker.modem.demuxStream(stream, writableSink(stdoutChunks), writableSink(stderrChunks));

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
  return new Writable({
    write(chunk, _enc, cb) {
      target.push(chunk.toString('utf8'));
      cb();
    },
  });
}

module.exports = { runInSandbox };
