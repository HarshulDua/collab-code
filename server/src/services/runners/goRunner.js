const { runInSandbox } = require('./execUtils');

// A cold GOCACHE means every run recompiles the standard library packages
// (fmt, etc.) from source before touching the user's own file — that alone
// routinely exceeds the interpreted-language defaults (8s / 128MB), so Go
// gets its own more generous defaults. Still overridable by an explicit opts
// value from the caller.
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_MEMORY_BYTES = 512 * 1024 * 1024;

function run(files, entryPath, opts = {}) {
  return runInSandbox(files, entryPath, ({ paths, hasStdin }) => {
    const sources = paths.filter((p) => p.endsWith('.go')).map((p) => `/code/${p}`).join(' ');
    const runBin = hasStdin ? '/build/a.out < /code/.stdin' : '/build/a.out';
    // Seed this run's GOCACHE from the image's pre-warmed stdlib build (see
    // docker/sandbox.Dockerfile) so `go build` only has to compile the
    // user's own file, not fmt/os/reflect/etc. from scratch every time.
    const seedCache = 'mkdir -p /build/go-cache && cp -a /opt/go-cache-seed/. /build/go-cache/ 2>/dev/null';
    const build = `GOCACHE=/build/go-cache GOPATH=/build/go GOTMPDIR=/build go build -o /build/a.out ${sources}`;
    return ['sh', '-c', `${seedCache}; ${build} && ${runBin}`];
  }, { timeoutMs: DEFAULT_TIMEOUT_MS, memoryBytes: DEFAULT_MEMORY_BYTES, ...opts });
}

module.exports = { run };
