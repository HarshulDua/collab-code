const path = require('path');
const { getDocker } = require('../src/services/dockerClient');
const cRunner = require('../src/services/runners/cRunner');
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
    console.warn('Skipping cRunner Docker integration tests — Docker not reachable:', err.message); // eslint-disable-line no-console
  }
}, 300000);

describe('cRunner (real Docker)', () => {
  it('compiles and runs simple C, capturing stdout', async () => {
    if (!dockerAvailable) return;
    const code = '#include <stdio.h>\nint main() { printf("hello from sandbox\\n"); return 0; }';
    const result = await cRunner.run({ 'main.c': code }, 'main.c');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello from sandbox');
    expect(result.timedOut).toBe(false);
  }, 20000);

  it('surfaces a compile error as stderr with a non-zero exit code', async () => {
    if (!dockerAvailable) return;
    const result = await cRunner.run({ 'main.c': 'int main() { this is not valid C' }, 'main.c');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  }, 20000);

  it('kills an infinite loop after the timeout', async () => {
    if (!dockerAvailable) return;
    const code = 'int main() { while (1) {} return 0; }';
    const result = await cRunner.run({ 'main.c': code }, 'main.c', { timeoutMs: 2000 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  }, 20000);

  it('feeds stdin to the compiled program', async () => {
    if (!dockerAvailable) return;
    const code = '#include <stdio.h>\nint main() { char name[64]; scanf("%63s", name); printf("hello, %s\\n", name); return 0; }';
    const result = await cRunner.run({ 'main.c': code }, 'main.c', { stdin: 'world' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello, world');
  }, 20000);

  it('links multiple .c files in one project', async () => {
    if (!dockerAvailable) return;
    const files = {
      'main.c': '#include <stdio.h>\nvoid shout(const char*);\nint main() { shout("hi"); return 0; }',
      'helper.c': '#include <stdio.h>\n#include <ctype.h>\nvoid shout(const char* msg) { while (*msg) putchar(toupper(*msg++)); putchar(10); }',
    };
    const result = await cRunner.run(files, 'main.c');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('HI');
  }, 20000);
});
