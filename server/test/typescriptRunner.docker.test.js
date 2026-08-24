const path = require('path');
const { getDocker } = require('../src/services/dockerClient');
const typescriptRunner = require('../src/services/runners/typescriptRunner');
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
    console.warn('Skipping typescriptRunner Docker integration tests — Docker not reachable:', err.message); // eslint-disable-line no-console
  }
}, 300000);

describe('typescriptRunner (real Docker)', () => {
  it('compiles and runs simple TypeScript, capturing stdout', async () => {
    if (!dockerAvailable) return;
    const code = 'const msg: string = "hello from sandbox";\nconsole.log(msg);';
    const result = await typescriptRunner.run({ 'main.ts': code }, 'main.ts');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello from sandbox');
    expect(result.timedOut).toBe(false);
  }, 30000);

  it('surfaces a compile error with a non-zero exit code', async () => {
    if (!dockerAvailable) return;
    const result = await typescriptRunner.run({ 'main.ts': 'const x: number = "not a number";' }, 'main.ts');
    expect(result.exitCode).not.toBe(0);
    // tsc writes its own diagnostics to stdout, not stderr, unlike every
    // other compiler this project wraps.
    expect(result.stdout).toContain('error TS');
  }, 30000);

  it('kills an infinite loop after the timeout', async () => {
    if (!dockerAvailable) return;
    const code = 'while (true) {}';
    const result = await typescriptRunner.run({ 'main.ts': code }, 'main.ts', { timeoutMs: 3000 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  }, 30000);

  it('feeds stdin to the compiled program', async () => {
    if (!dockerAvailable) return;
    const code =
      'declare function require(id: string): any;\nconst who = require("fs").readFileSync(0, "utf-8").trim();\nconsole.log("hello, " + who);';
    const result = await typescriptRunner.run({ 'main.ts': code }, 'main.ts', { stdin: 'world' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello, world');
  }, 30000);
});
