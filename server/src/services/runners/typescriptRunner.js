const { runInSandbox } = require('./execUtils');

function run(files, entryPath, opts = {}) {
  return runInSandbox(files, entryPath, ({ entryPath: entry, hasStdin }) => {
    const jsEntry = entry.replace(/\.tsx?$/, '.js');
    const runCmd = hasStdin ? `node /build/${jsEntry} < /code/.stdin` : `node /build/${jsEntry}`;
    const compile = `tsc --outDir /build --target es2020 --module commonjs /code/${entry}`;
    return ['sh', '-c', `${compile} && ${runCmd}`];
  }, opts);
}

module.exports = { run };
