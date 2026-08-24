const { runInSandbox } = require('./execUtils');

const CPP_EXTENSIONS = ['.cpp', '.cc', '.cxx'];

function run(files, entryPath, opts = {}) {
  return runInSandbox(files, entryPath, ({ paths, hasStdin }) => {
    const sources = paths
      .filter((p) => CPP_EXTENSIONS.some((ext) => p.endsWith(ext)))
      .map((p) => `/code/${p}`)
      .join(' ');
    const runBin = hasStdin ? '/build/a.out < /code/.stdin' : '/build/a.out';
    return ['sh', '-c', `g++ -O2 -std=c++17 -o /build/a.out ${sources} && ${runBin}`];
  }, opts);
}

module.exports = { run };
