const path = require('path');
const { getDocker } = require('../src/services/dockerClient');
const pythonRunner = require('../src/services/runners/pythonRunner');
const env = require('../src/config/env');

// This suite talks to a real Docker daemon and builds/runs the actual
// sandbox image. It self-skips (with a console warning) if Docker isn't
// reachable, so `npm test` still passes on a machine without Docker —
// but on this project's target machine (Docker Desktop confirmed running)
// it exercises the real execution path end-to-end.
let dockerAvailable = false;

beforeAll(async () => {
  const docker = getDocker();
  try {
    await docker.ping();
    await docker.buildImage(
      { context: path.join(__dirname, '..', '..', 'docker'), src: ['sandbox.Dockerfile'] },
      { t: env.sandboxImage, dockerfile: 'sandbox.Dockerfile' }
    ).then(
      (stream) =>
        new Promise((resolve, reject) => {
          docker.modem.followProgress(stream, (err) => (err ? reject(err) : resolve()));
        })
    );
    dockerAvailable = true;
  } catch (err) {
    console.warn('Skipping pythonRunner Docker integration tests — Docker not reachable:', err.message); // eslint-disable-line no-console
  }
}, 120000);

describe('pythonRunner (real Docker)', () => {
  it('runs simple python and captures stdout', async () => {
    if (!dockerAvailable) return;
    const result = await pythonRunner.run({ 'main.py': 'print("hello from sandbox")' }, 'main.py');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello from sandbox');
    expect(result.timedOut).toBe(false);
  }, 20000);

  it('captures stderr and a non-zero exit code', async () => {
    if (!dockerAvailable) return;
    const result = await pythonRunner.run({ 'main.py': 'raise ValueError("boom")' }, 'main.py');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('ValueError');
  }, 20000);

  it('kills an infinite loop after the timeout', async () => {
    if (!dockerAvailable) return;
    const result = await pythonRunner.run({ 'main.py': 'while True: pass' }, 'main.py', { timeoutMs: 2000 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  }, 20000);

  it('has no network access inside the sandbox', async () => {
    if (!dockerAvailable) return;
    const code = `
import socket
try:
    socket.create_connection(("8.8.8.8", 53), timeout=2)
    print("NETWORK_REACHABLE")
except OSError:
    print("NETWORK_BLOCKED")
`;
    const result = await pythonRunner.run({ 'main.py': code }, 'main.py', { timeoutMs: 6000 });
    expect(result.stdout).toContain('NETWORK_BLOCKED');
  }, 20000);

  it('truncates output beyond maxOutputChars', async () => {
    if (!dockerAvailable) return;
    const result = await pythonRunner.run({ 'main.py': 'print("x" * 100000)' }, 'main.py', { maxOutputChars: 500 });
    expect(result.stdout.length).toBeLessThan(600);
    expect(result.stdout).toContain('[output truncated]');
  }, 20000);

  it('resolves imports between files in a multi-file project', async () => {
    if (!dockerAvailable) return;
    const files = {
      'main.py': 'from utils.helper import shout\nshout("hi")',
      'utils/helper.py': 'def shout(msg):\n    print(msg.upper())',
    };
    const result = await pythonRunner.run(files, 'main.py');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('HI');
  }, 20000);

  it('feeds stdin to input() calls', async () => {
    if (!dockerAvailable) return;
    const code = 'name = input()\nprint("hello,", name)';
    const result = await pythonRunner.run({ 'main.py': code }, 'main.py', { stdin: 'world' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello, world');
  }, 20000);

  it('rejects a file path that attempts directory traversal', async () => {
    if (!dockerAvailable) return;
    await expect(pythonRunner.run({ '../evil.py': 'print(1)' }, '../evil.py')).rejects.toThrow(/unsafe file path/);
  });
});
