const { runInSandbox } = require('./execUtils');

function run(files, entryPath, opts = {}) {
  return runInSandbox(files, entryPath, ({ entryPath: entry, hasStdin }) => {
    if (hasStdin) {
      return ['sh', '-c', `node /code/${entry} < /code/.stdin`];
    }
    return ['node', `/code/${entry}`];
  }, opts);
}

module.exports = { run };
