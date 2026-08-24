const { runInSandbox } = require('./execUtils');

function run(files, entryPath, opts = {}) {
  return runInSandbox(files, entryPath, ({ entryPath: entry, paths, hasStdin }) => {
    const mainClass = entry.split('/').pop().replace(/\.java$/, '');
    const sources = paths.filter((p) => p.endsWith('.java')).map((p) => `/code/${p}`).join(' ');
    const runCmd = hasStdin
      ? `java -cp /build ${mainClass} < /code/.stdin`
      : `java -cp /build ${mainClass}`;
    return ['sh', '-c', `javac -d /build ${sources} && ${runCmd}`];
  }, opts);
}

module.exports = { run };
