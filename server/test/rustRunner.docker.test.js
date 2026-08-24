const path = require('path');
const { getDocker } = require('../src/services/dockerClient');
const rustRunner = require('../src/services/runners/rustRunner');
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
    console.warn('Skipping rustRunner Docker integration tests — Docker not reachable:', err.message); // eslint-disable-line no-console
  }
}, 300000);

describe('rustRunner (real Docker)', () => {
  it('compiles and runs simple Rust, capturing stdout', async () => {
    if (!dockerAvailable) return;
    const code = 'fn main() { println!("hello from sandbox"); }';
    const result = await rustRunner.run({ 'main.rs': code }, 'main.rs');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello from sandbox');
    expect(result.timedOut).toBe(false);
  }, 30000);

  it('surfaces a compile error as stderr with a non-zero exit code', async () => {
    if (!dockerAvailable) return;
    const result = await rustRunner.run({ 'main.rs': 'fn main() { this is not valid Rust' }, 'main.rs');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  }, 30000);

  it('kills an infinite loop after the timeout', async () => {
    if (!dockerAvailable) return;
    const code = 'fn main() { loop {} }';
    const result = await rustRunner.run({ 'main.rs': code }, 'main.rs', { timeoutMs: 3000 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  }, 30000);

  it('feeds stdin to the compiled program', async () => {
    if (!dockerAvailable) return;
    const code =
      'use std::io;\nfn main() { let mut name = String::new(); io::stdin().read_line(&mut name).unwrap(); println!("hello, {}", name.trim()); }';
    const result = await rustRunner.run({ 'main.rs': code }, 'main.rs', { stdin: 'world\n' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello, world');
  }, 30000);
});
