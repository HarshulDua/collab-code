const Semaphore = require('../src/utils/Semaphore');

describe('Semaphore', () => {
  it('allows up to maxConcurrent acquisitions immediately', async () => {
    const sem = new Semaphore(2);
    await sem.acquire();
    await sem.acquire();
    expect(sem.current).toBe(2);
  });

  it('queues acquisitions beyond the limit until release', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    let acquired = false;
    const pending = sem.acquire().then(() => {
      acquired = true;
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(acquired).toBe(false);

    sem.release();
    await pending;
    expect(acquired).toBe(true);
  });

  it('serializes queued waiters in FIFO order', async () => {
    const sem = new Semaphore(1);
    await sem.acquire();

    const order = [];
    const p1 = sem.acquire().then(() => order.push(1));
    const p2 = sem.acquire().then(() => order.push(2));

    sem.release();
    await p1;
    sem.release();
    await p2;

    expect(order).toEqual([1, 2]);
  });
});
