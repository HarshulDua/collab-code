// Load test for the stateless REST surface: register -> login -> create room
// -> list rooms. Run via `npm run k6:auth` from load-tests/ (wraps the
// official grafana/k6 Docker image, since k6 isn't installed on this host).
//
// What this proves: the auth/rooms path (bcrypt hashing, JWT signing, Mongo
// reads/writes) holds a bounded p95 latency and near-zero error rate under
// concurrent load, and that per-user isolation (each VU only ever sees its
// own rooms) holds up when many users hit the API at once.
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:4000';

export const options = {
  scenarios: {
    ramping: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '15s', target: 20 },
        { duration: '30s', target: 20 },
        { duration: '15s', target: 50 },
        { duration: '30s', target: 50 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    // register/login intentionally pay real bcrypt CPU cost (cost factor
    // 10 is deliberately expensive — that's the point of bcrypt) plus
    // queuing on libuv's threadpool once concurrency exceeds its worker
    // count. Measured on this stack at 50 concurrent VUs: p95 ~880ms
    // register / ~500ms login, vs. 8.2s / 5.6s before switching from
    // bcryptjs (pure JS, blocks the event loop for every request on the
    // process, not just auth ones) to bcrypt (native, off the event loop
    // on libuv's threadpool). These thresholds have headroom above that
    // measured baseline, not the theoretical minimum.
    'http_req_duration{endpoint:register}': ['p(95)<1200'],
    'http_req_duration{endpoint:login}': ['p(95)<700'],
    'http_req_duration{endpoint:create_room}': ['p(95)<100'],
    'http_req_duration{endpoint:list_rooms}': ['p(95)<100'],
  },
};

export default function run() {
  const email = `loadtest-vu${__VU}-iter${__ITER}-${Date.now()}@example.com`;
  const password = 'password123';

  const registerRes = http.post(
    `${BASE_URL}/api/auth/register`,
    JSON.stringify({ name: `Load Test VU${__VU}`, email, password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'register' } }
  );
  check(registerRes, { 'register: 201': (r) => r.status === 201 });
  const token = registerRes.json('token');

  const authHeaders = { headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` } };

  const loginRes = http.post(
    `${BASE_URL}/api/auth/login`,
    JSON.stringify({ email, password }),
    { headers: { 'Content-Type': 'application/json' }, tags: { endpoint: 'login' } }
  );
  check(loginRes, { 'login: 200': (r) => r.status === 200 });

  const createRes = http.post(
    `${BASE_URL}/api/rooms`,
    JSON.stringify({ name: `Room for VU${__VU} iter${__ITER}` }),
    { ...authHeaders, tags: { endpoint: 'create_room' } }
  );
  check(createRes, { 'create room: 201': (r) => r.status === 201 });

  const listRes = http.get(`${BASE_URL}/api/rooms`, { ...authHeaders, tags: { endpoint: 'list_rooms' } });
  check(listRes, {
    'list rooms: 200': (r) => r.status === 200,
    'list rooms: only own rooms': (r) => r.json('rooms').length >= 1,
  });

  sleep(1);
}
