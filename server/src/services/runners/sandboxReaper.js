const { getDocker } = require('../dockerClient');
const env = require('../../config/env');

const REAP_INTERVAL_MS = 30_000;
const MAX_AGE_MS = env.execTimeoutMs * 3;

async function reapOrphans() {
  const docker = getDocker();
  const containers = await docker.listContainers({
    all: true,
    filters: JSON.stringify({ ancestor: [env.sandboxImage] }),
  });

  const now = Date.now();
  await Promise.all(
    containers.map(async (info) => {
      const startedAtMs = info.Created * 1000;
      if (now - startedAtMs <= MAX_AGE_MS) return;

      const container = docker.getContainer(info.Id);
      try {
        await container.kill();
      } catch (_) {}
      try {
        await container.remove({ force: true });
      } catch (_) {}
    })
  );
}

function start() {
  const timer = setInterval(() => {
    reapOrphans().catch(() => {});
  }, REAP_INTERVAL_MS);
  timer.unref();
  return timer;
}

module.exports = { start, reapOrphans, MAX_AGE_MS };
