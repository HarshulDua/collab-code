const path = require('path');
const { getDocker } = require('../src/services/dockerClient');
const cppRunner = require('../src/services/runners/cppRunner');
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
    console.warn('Skipping cppRunner Docker integration tests — Docker not reachable:', err.message); // eslint-disable-line no-console
  }
}, 120000);

describe('cppRunner (real Docker)', () => {
  it('compiles and runs simple C++, capturing stdout', async () => {
    if (!dockerAvailable) return;
    const code = '#include <iostream>\nint main() { std::cout << "hello from sandbox\\n"; return 0; }';
    const result = await cppRunner.run({ 'main.cpp': code }, 'main.cpp');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello from sandbox');
    expect(result.timedOut).toBe(false);
  }, 20000);

  it('surfaces a compile error as stderr with a non-zero exit code', async () => {
    if (!dockerAvailable) return;
    const result = await cppRunner.run({ 'main.cpp': 'int main() { this is not valid C++' }, 'main.cpp');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  }, 20000);

  it('kills an infinite loop after the timeout', async () => {
    if (!dockerAvailable) return;
    const code = 'int main() { while (true) {} return 0; }';
    const result = await cppRunner.run({ 'main.cpp': code }, 'main.cpp', { timeoutMs: 2000 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  }, 20000);

  it('feeds stdin to the compiled program', async () => {
    if (!dockerAvailable) return;
    const code = '#include <iostream>\n#include <string>\nint main() { std::string name; std::cin >> name; std::cout << "hello, " << name << "\\n"; return 0; }';
    const result = await cppRunner.run({ 'main.cpp': code }, 'main.cpp', { stdin: 'world' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello, world');
  }, 20000);
});
