import { defineConfig } from '@playwright/test';

// e2e is the one layer that drives the real UI in a real (headless)
// browser — there's no interactive browser tool available in this
// environment, so this is how "test it in a browser" actually happens
// here: Playwright's own Chromium, against the real client + real server
// + real Mongo/Redis/Docker sandbox, not a simulation of any of them.
export default defineConfig({
  testDir: './tests',
  timeout: 30000,
  fullyParallel: false,
  // Serial, not parallel: the execution tests deliberately exercise the
  // same EXEC_MAX_CONCURRENT-limited sandbox load-tests/ stresses on
  // purpose — running several workers' code executions at once here would
  // just make correctness tests flaky for a concurrency property that's
  // already covered for real in load-tests/node/execution-saturation.js.
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm start',
      cwd: '../server',
      url: 'http://localhost:4000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
      env: {
        MONGO_URI: 'mongodb://localhost:27017/collab-e2e',
        REDIS_URL: 'redis://localhost:6379/3',
        ADMIN_EMAIL: 'e2e-admin@example.com',
      },
    },
    {
      command: 'npm run dev',
      cwd: '../client',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
