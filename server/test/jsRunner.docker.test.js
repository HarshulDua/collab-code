const path = require('path');
const { getDocker } = require('../src/services/dockerClient');
const jsRunner = require('../src/services/runners/jsRunner');
const env = require('../src/config/env');

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
    console.warn('Skipping jsRunner Docker integration tests — Docker not reachable:', err.message); // eslint-disable-line no-console
  }
}, 300000);

describe('jsRunner (real Docker)', () => {
  it('runs simple javascript and captures stdout', async () => {
    if (!dockerAvailable) return;
    const result = await jsRunner.run({ 'main.js': 'console.log("hello from sandbox")' }, 'main.js');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello from sandbox');
    expect(result.timedOut).toBe(false);
  }, 20000);

  it('captures stderr and a non-zero exit code', async () => {
    if (!dockerAvailable) return;
    const result = await jsRunner.run({ 'main.js': 'throw new Error("boom")' }, 'main.js');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('boom');
  }, 20000);

  it('kills an infinite loop after the timeout', async () => {
    if (!dockerAvailable) return;
    const result = await jsRunner.run({ 'main.js': 'while (true) {}' }, 'main.js', { timeoutMs: 2000 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  }, 20000);

  it('has no network access inside the sandbox', async () => {
    if (!dockerAvailable) return;
    const code = `
const net = require('net');
const sock = net.createConnection({ host: '8.8.8.8', port: 53, timeout: 2000 });
sock.on('connect', () => { console.log('NETWORK_REACHABLE'); process.exit(0); });
sock.on('error', () => { console.log('NETWORK_BLOCKED'); process.exit(0); });
sock.on('timeout', () => { console.log('NETWORK_BLOCKED'); process.exit(0); });
`;
    const result = await jsRunner.run({ 'main.js': code }, 'main.js', { timeoutMs: 6000 });
    expect(result.stdout).toContain('NETWORK_BLOCKED');
  }, 20000);

  it('feeds stdin to the process', async () => {
    if (!dockerAvailable) return;
    const code = `
const data = require('fs').readFileSync(0, 'utf8').trim();
console.log('hello,', data);
`;
    const result = await jsRunner.run({ 'main.js': code }, 'main.js', { stdin: 'world' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello, world');
  }, 20000);

  it('rejects a file path that attempts directory traversal', async () => {
    if (!dockerAvailable) return;
    await expect(jsRunner.run({ '../evil.js': 'console.log(1)' }, '../evil.js')).rejects.toThrow(/unsafe file path/);
  });
});
