const { fork } = require('child_process');
const path = require('path');

/**
 * Boots a real, separate `server.js` process (genuine OS-level isolation —
 * its own module registry, its own in-memory collabStore) so tests can
 * reproduce bugs that only exist across truly independent instances.
 * Module-level singletons like collabStore's `rooms` Map would be silently
 * shared if we just called `createSocketServer()` twice in this process,
 * which would mask exactly the kind of cross-instance divergence this is
 * meant to catch.
 */
function forkServerInstance(env = {}) {
  return new Promise((resolve, reject) => {
    const child = fork(path.join(__dirname, '../src/server.js'), {
      env: { ...process.env, PORT: '0', ...env },
      silent: true,
    });

    let settled = false;
    let logs = '';
    child.stdout?.on('data', (d) => { logs += d.toString(); });
    child.stderr?.on('data', (d) => { logs += d.toString(); });

    const onMessage = (msg) => {
      if (msg?.type === 'listening' && !settled) {
        settled = true;
        child.removeListener('message', onMessage);
        resolve({ child, port: msg.port, baseUrl: `http://localhost:${msg.port}`, getLogs: () => logs });
      }
    };
    child.on('message', onMessage);

    child.once('error', reject);
    child.once('exit', (code) => {
      if (!settled) reject(new Error(`server instance exited before listening (code ${code})\n${logs}`));
    });
  });
}

async function stopInstance(instance) {
  if (!instance?.child || instance.child.killed) return;
  const exited = new Promise((resolve) => instance.child.once('exit', resolve));
  instance.child.kill();
  await exited;
}

module.exports = { forkServerInstance, stopInstance };
