jest.mock('../src/services/dockerClient', () => ({ getDocker: jest.fn() }));

const { getDocker } = require('../src/services/dockerClient');
const { reapOrphans, MAX_AGE_MS } = require('../src/services/runners/sandboxReaper');

function makeContainer() {
  return { kill: jest.fn().mockResolvedValue(), remove: jest.fn().mockResolvedValue() };
}

describe('sandboxReaper.reapOrphans', () => {
  it('kills and removes only containers older than the max age', async () => {
    const oldContainer = makeContainer();
    const freshContainer = makeContainer();
    const containersById = { old: oldContainer, fresh: freshContainer };

    const now = Date.now();
    const listContainers = jest.fn().mockResolvedValue([
      { Id: 'old', Created: Math.floor((now - MAX_AGE_MS - 5000) / 1000) },
      { Id: 'fresh', Created: Math.floor((now - 1000) / 1000) },
    ]);
    const getContainer = jest.fn((id) => containersById[id]);

    getDocker.mockReturnValue({ listContainers, getContainer });

    await reapOrphans();

    expect(oldContainer.kill).toHaveBeenCalled();
    expect(oldContainer.remove).toHaveBeenCalledWith({ force: true });
    expect(freshContainer.kill).not.toHaveBeenCalled();
    expect(freshContainer.remove).not.toHaveBeenCalled();
  });

  it('still removes a container even if kill() fails (already stopped)', async () => {
    const oldContainer = { kill: jest.fn().mockRejectedValue(new Error('already stopped')), remove: jest.fn().mockResolvedValue() };
    const now = Date.now();
    const listContainers = jest.fn().mockResolvedValue([{ Id: 'old', Created: Math.floor((now - MAX_AGE_MS - 5000) / 1000) }]);
    const getContainer = jest.fn(() => oldContainer);
    getDocker.mockReturnValue({ listContainers, getContainer });

    await expect(reapOrphans()).resolves.toBeUndefined();
    expect(oldContainer.remove).toHaveBeenCalledWith({ force: true });
  });
});
