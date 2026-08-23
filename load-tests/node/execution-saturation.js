// Targets each individual guardrail in the code-execution sandbox with a
// payload specifically designed to trip it, and checks the sandbox
// actually enforces it rather than hanging, crashing the host, or silently
// letting something through. Run against an already-running server:
//
//   BASE_URL=http://localhost:4000 node node/execution-saturation.js
//
// Requires the server + Mongo + Redis + the collab-python-sandbox image to
// already be up (see the repo root docker-compose.yml and
// docker/python-sandbox.Dockerfile).
const BASE_URL = process.env.BASE_URL || 'http://localhost:4000';

async function registerUser(label) {
  const email = `saturation-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.com`;
  const res = await fetch(`${BASE_URL}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: `Saturation ${label}`, email, password: 'password123' }),
  });
  if (res.status !== 201) throw new Error(`register failed for ${label}: ${res.status} ${await res.text()}`);
  const body = await res.json();
  return body.token;
}

async function execute(token, code) {
  const start = Date.now();
  const res = await fetch(`${BASE_URL}/api/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ language: 'python', code }),
  });
  const elapsedMs = Date.now() - start;
  const body = await res.json().catch(() => ({}));
  return { status: res.status, elapsedMs, body };
}

async function checkTimeout(results) {
  const token = await registerUser('timeout');
  const { status, body, elapsedMs } = await execute(token, 'while True:\n    pass');
  const result = body.result || {};
  results.push({
    guardrail: 'EXEC_TIMEOUT_MS (infinite loop)',
    pass: status === 200 && result.timedOut === true && result.exitCode === null,
    detail: `status=${status} timedOut=${result.timedOut} exitCode=${result.exitCode} elapsedMs=${elapsedMs}`,
  });
}

async function checkMemoryLimit(results) {
  const token = await registerUser('membomb');
  const { status, body, elapsedMs } = await execute(token, "x = bytearray(500 * 1024 * 1024)\nprint(len(x))");
  const result = body.result || {};
  results.push({
    guardrail: 'EXEC_MEMORY_BYTES (500MB allocation vs 128MB cap)',
    pass: status === 200 && result.exitCode !== 0 && !result.stdout.includes('524288000'),
    detail: `status=${status} exitCode=${result.exitCode} stdout=${JSON.stringify(result.stdout)} elapsedMs=${elapsedMs}`,
  });
}

async function checkPidsLimit(results) {
  const token = await registerUser('forkbomb');
  const code = [
    'import os',
    'n = 0',
    'try:',
    '    while True:',
    '        os.fork()',
    '        n += 1',
    'except OSError as e:',
    '    print(f"stopped after {n} forks: {e}")',
  ].join('\n');
  const { status, body, elapsedMs } = await execute(token, code);
  const result = body.result || {};
  const stoppedCleanly = /stopped after \d+ forks/.test(result.stdout || '');
  results.push({
    guardrail: 'PidsLimit (fork bomb, cap=64)',
    pass: status === 200 && !result.timedOut && stoppedCleanly,
    detail: `status=${status} timedOut=${result.timedOut} stdout=${JSON.stringify(result.stdout)} elapsedMs=${elapsedMs}`,
  });
}

async function checkNetworkDisabled(results) {
  const token = await registerUser('network');
  const code = [
    'import socket',
    'try:',
    '    socket.create_connection(("8.8.8.8", 53), timeout=3)',
    '    print("NETWORK_REACHABLE")',
    'except OSError as e:',
    '    print(f"NETWORK_BLOCKED: {e}")',
  ].join('\n');
  const { status, body, elapsedMs } = await execute(token, code);
  const result = body.result || {};
  results.push({
    guardrail: 'NetworkMode=none (outbound connection attempt)',
    pass: status === 200 && (result.stdout || '').includes('NETWORK_BLOCKED'),
    detail: `status=${status} stdout=${JSON.stringify(result.stdout)} elapsedMs=${elapsedMs}`,
  });
}

async function checkRateLimit(results) {
  const token = await registerUser('ratelimit');
  const statuses = [];
  for (let i = 0; i < 12; i += 1) {
    const { status } = await execute(token, 'print(1)');
    statuses.push(status);
  }
  const rejected = statuses.filter((s) => s === 429).length;
  results.push({
    guardrail: 'EXEC_RATE_LIMIT_PER_MIN (12 rapid requests, limit=10/min)',
    pass: rejected >= 2,
    detail: `statuses=${JSON.stringify(statuses)} rejectedCount=${rejected}`,
  });
}

async function checkConcurrencySemaphore(results) {
  const tokens = await Promise.all(Array.from({ length: 12 }, (_, i) => registerUser(`concurrency-${i}`)));
  const start = Date.now();
  const runs = await Promise.all(tokens.map((t) => execute(t, "print('semaphore ok')")));
  const elapsedMs = Date.now() - start;
  const allSucceeded = runs.every((r) => r.status === 200 && r.body?.result?.stdout?.includes('semaphore ok'));
  results.push({
    guardrail: 'EXEC_MAX_CONCURRENT semaphore (12 concurrent runs, cap=4)',
    pass: allSucceeded,
    detail: `allSucceeded=${allSucceeded} totalElapsedMs=${elapsedMs} individual=${JSON.stringify(runs.map((r) => r.elapsedMs))}`,
  });
}

async function main() {
  const results = [];
  console.log(`Running execution-sandbox saturation checks against ${BASE_URL}...\n`);

  await checkTimeout(results);
  await checkMemoryLimit(results);
  await checkPidsLimit(results);
  await checkNetworkDisabled(results);
  await checkRateLimit(results);
  await checkConcurrencySemaphore(results);

  let allPass = true;
  for (const r of results) {
    const mark = r.pass ? 'PASS' : 'FAIL';
    if (!r.pass) allPass = false;
    console.log(`[${mark}] ${r.guardrail}`);
    console.log(`       ${r.detail}\n`);
  }

  console.log(allPass ? 'All sandbox guardrails held under saturation.' : 'One or more guardrails FAILED — see above.');
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL', err);
  process.exit(1);
});
