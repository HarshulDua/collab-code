const { runInSandbox } = require('./execUtils');

function run(files, entryPath, opts = {}) {
  return runInSandbox(files, entryPath, ({ paths, hasStdin }) => {
    const sources = paths.filter((p) => p.endsWith('.c')).map((p) => `/code/${p}`).join(' ');
    const runBin = hasStdin ? '/build/a.out < /code/.stdin' : '/build/a.out';
    return ['sh', '-c', `gcc -O2 -o /build/a.out ${sources} && ${runBin}`];
  }, opts);
}

module.exports = { run };
