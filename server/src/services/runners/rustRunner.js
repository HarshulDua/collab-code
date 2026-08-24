const { runInSandbox } = require('./execUtils');

// rustc alone (no cargo/incremental cache) is noticeably heavier than gcc/g++
// even for a trivial file — the interpreted-language defaults are too tight.
const DEFAULT_TIMEOUT_MS = 12000;
const DEFAULT_MEMORY_BYTES = 256 * 1024 * 1024;

function run(files, entryPath, opts = {}) {
  return runInSandbox(files, entryPath, ({ entryPath: entry, hasStdin }) => {
    const runBin = hasStdin ? '/build/a.out < /code/.stdin' : '/build/a.out';
    return ['sh', '-c', `rustc -O -o /build/a.out /code/${entry} && ${runBin}`];
  }, { timeoutMs: DEFAULT_TIMEOUT_MS, memoryBytes: DEFAULT_MEMORY_BYTES, ...opts });
}

module.exports = { run };
