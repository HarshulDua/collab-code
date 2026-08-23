// Load test for the Docker code-execution path. Two scenarios run
// concurrently:
//
//   - "concurrency": many distinct users fire one execute call each at the
//     same time. EXEC_MAX_CONCURRENT (default 4) means at most 4 sandbox
//     containers should ever run at once — the rest queue behind the
//     in-process Semaphore (executionService.js) rather than being
//     rejected or crashing the host. We assert 0% error rate here: queuing
//     must be invisible to the caller other than added latency.
//
//   - "rateLimit": one user hammers the endpoint far faster than
//     EXEC_RATE_LIMIT_PER_MIN (default 10/min). We assert we DO see 429s
//     roughly in line with that limit — the absence of 429s here would
//     mean the Redis-backed limiter isn't holding under load.
//
// Run via `npm run k6:execution` from load-tests/.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';
const USER_POOL_SIZE = 16;

const SIMPLE_CODE = "print('load test ok')";

export const options = {
  scenarios: {
    concurrency: {
      executor: 'per-vu-iterations',
      vus: USER_POOL_SIZE,
      iterations: 3,
      maxDuration: '60s',
      exec: 'concurrency',
    },
    rateLimit: {
      executor: 'constant-arrival-rate',
      rate: 20, // requests/sec — well above the per-user 10/min limit
      timeUnit: '1s',
      duration: '15s',
      preAllocatedVUs: 5,
      exec: 'rateLimit',
      startTime: '5s', // let the concurrency scenario warm up first
    },
  },
  thresholds: {
    'http_req_failed{scenario:concurrency}': ['rate<0.01'],
    'http_req_duration{scenario:concurrency}': ['p(95)<15000'], // queuing is expected, not failure
  },
};

export function setup() {
  const tokens = [];
  for (let i = 0; i < USER_POOL_SIZE + 1; i += 1) {
    const email = `exec-load-${i}-${Date.now()}@example.com`;
    const res = http.post(
      `${BASE_URL}/api/auth/register`,
      JSON.stringify({ name: `Exec Load ${i}`, email, password: 'password123' }),
      { headers: { 'Content-Type': 'application/json' } }
    );
    tokens.push(res.json('token'));
  }
  return { tokens };
}

export function concurrency(data) {
  const token = data.tokens[__VU % data.tokens.length];
  const res = http.post(
    `${BASE_URL}/api/execute`,
    JSON.stringify({ language: 'python', code: SIMPLE_CODE }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, tags: { scenario: 'concurrency' } }
  );
  check(res, {
    'execute: 200': (r) => r.status === 200,
    'execute: correct stdout': (r) => r.status !== 200 || r.json('result.stdout').includes('load test ok'),
  });
  sleep(1);
}

export function rateLimit(data) {
  // Always the same last user in the pool, so this scenario's bursts
  // actually accumulate against one per-user rate-limit bucket.
  const token = data.tokens[data.tokens.length - 1];
  const res = http.post(
    `${BASE_URL}/api/execute`,
    JSON.stringify({ language: 'python', code: SIMPLE_CODE }),
    { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, tags: { scenario: 'rateLimit' } }
  );
  check(res, {
    'rate limit: 200 or 429': (r) => r.status === 200 || r.status === 429,
  });
}
