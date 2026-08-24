const path = require('path');
const { getDocker } = require('../src/services/dockerClient');
const csharpRunner = require('../src/services/runners/csharpRunner');
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
    console.warn('Skipping csharpRunner Docker integration tests — Docker not reachable:', err.message); // eslint-disable-line no-console
  }
}, 300000);

describe('csharpRunner (real Docker)', () => {
  it('compiles and runs simple C#, capturing stdout', async () => {
    if (!dockerAvailable) return;
    const code = 'using System;\nclass Program { static void Main() { Console.WriteLine("hello from sandbox"); } }';
    const result = await csharpRunner.run({ 'Main.cs': code }, 'Main.cs');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello from sandbox');
    expect(result.timedOut).toBe(false);
  }, 30000);

  it('surfaces a compile error as stderr with a non-zero exit code', async () => {
    if (!dockerAvailable) return;
    const result = await csharpRunner.run({ 'Main.cs': 'class Program { this is not valid C#' }, 'Main.cs');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  }, 30000);

  it('kills an infinite loop after the timeout', async () => {
    if (!dockerAvailable) return;
    const code = 'class Program { static void Main() { while (true) {} } }';
    const result = await csharpRunner.run({ 'Main.cs': code }, 'Main.cs', { timeoutMs: 4000 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  }, 30000);

  it('feeds stdin to the compiled program', async () => {
    if (!dockerAvailable) return;
    const code =
      'using System;\nclass Program { static void Main() { string name = Console.ReadLine(); Console.WriteLine("hello, " + name); } }';
    const result = await csharpRunner.run({ 'Main.cs': code }, 'Main.cs', { stdin: 'world\n' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello, world');
  }, 30000);
});
