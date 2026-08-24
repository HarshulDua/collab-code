const path = require('path');
const { getDocker } = require('../src/services/dockerClient');
const goRunner = require('../src/services/runners/goRunner');
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
    console.warn('Skipping goRunner Docker integration tests — Docker not reachable:', err.message); // eslint-disable-line no-console
  }
}, 300000);

describe('goRunner (real Docker)', () => {
  it('compiles and runs simple Go, capturing stdout', async () => {
    if (!dockerAvailable) return;
    const code = 'package main\nimport "fmt"\nfunc main() { fmt.Println("hello from sandbox") }';
    const result = await goRunner.run({ 'main.go': code }, 'main.go');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello from sandbox');
    expect(result.timedOut).toBe(false);
  }, 30000);

  it('surfaces a compile error as stderr with a non-zero exit code', async () => {
    if (!dockerAvailable) return;
    const result = await goRunner.run({ 'main.go': 'package main\nfunc main() { this is not valid Go' }, 'main.go');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  }, 30000);

  it('kills an infinite loop after the timeout', async () => {
    if (!dockerAvailable) return;
    const code = 'package main\nfunc main() { for {} }';
    const result = await goRunner.run({ 'main.go': code }, 'main.go', { timeoutMs: 3000 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  }, 30000);

  it('feeds stdin to the compiled program', async () => {
    if (!dockerAvailable) return;
    const code =
      'package main\nimport ("bufio"; "fmt"; "os")\nfunc main() { r := bufio.NewReader(os.Stdin); name, _ := r.ReadString(\'\\n\'); fmt.Printf("hello, %s", name) }';
    const result = await goRunner.run({ 'main.go': code }, 'main.go', { stdin: 'world\n' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello, world');
  }, 30000);
});
