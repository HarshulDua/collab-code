class Semaphore {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.current = 0;
    this.queue = [];
  }

  acquire() {
    if (this.current < this.maxConcurrent) {
      this.current += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release() {
    this.current -= 1;
    const next = this.queue.shift();
    if (next) {
      this.current += 1;
      next();
    }
  }
}

module.exports = Semaphore;
