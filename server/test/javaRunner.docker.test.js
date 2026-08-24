const path = require('path');
const { getDocker } = require('../src/services/dockerClient');
const javaRunner = require('../src/services/runners/javaRunner');
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
    console.warn('Skipping javaRunner Docker integration tests — Docker not reachable:', err.message); // eslint-disable-line no-console
  }
}, 120000);

describe('javaRunner (real Docker)', () => {
  it('compiles and runs simple Java, capturing stdout', async () => {
    if (!dockerAvailable) return;
    const code = 'public class Main { public static void main(String[] args) { System.out.println("hello from sandbox"); } }';
    const result = await javaRunner.run({ 'Main.java': code }, 'Main.java');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello from sandbox');
    expect(result.timedOut).toBe(false);
  }, 30000);

  it('surfaces a compile error as stderr with a non-zero exit code', async () => {
    if (!dockerAvailable) return;
    const result = await javaRunner.run({ 'Main.java': 'public class Main { this is not valid Java' }, 'Main.java');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  }, 30000);

  it('kills an infinite loop after the timeout', async () => {
    if (!dockerAvailable) return;
    const code = 'public class Main { public static void main(String[] args) { while (true) {} } }';
    const result = await javaRunner.run({ 'Main.java': code }, 'Main.java', { timeoutMs: 4000 });
    expect(result.timedOut).toBe(true);
    expect(result.exitCode).toBeNull();
  }, 30000);

  it('feeds stdin to the compiled program', async () => {
    if (!dockerAvailable) return;
    const code =
      'import java.util.Scanner;\npublic class Main { public static void main(String[] args) { Scanner sc = new Scanner(System.in); String name = sc.nextLine(); System.out.println("hello, " + name); } }';
    const result = await javaRunner.run({ 'Main.java': code }, 'Main.java', { stdin: 'world\n' });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('hello, world');
  }, 30000);
});
