const { runInSandbox } = require('./execUtils');

function run(files, entryPath, opts = {}) {
  return runInSandbox(files, entryPath, ({ paths, hasStdin }) => {
    const sources = paths.filter((p) => p.endsWith('.cs')).map((p) => `/code/${p}`).join(' ');
    const runCmd = hasStdin ? 'mono /build/a.exe < /code/.stdin' : 'mono /build/a.exe';
    return ['sh', '-c', `mcs -out:/build/a.exe ${sources} && ${runCmd}`];
  }, opts);
}

module.exports = { run };
