import { chromium } from '@playwright/test';

const BASE = 'https://65.0.71.210.nip.io';
const stamp = Date.now();
const email = `prod-smoke-${stamp}@example.com`;

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', (msg) => console.log('[console]', msg.type(), msg.text()));

try {
  await page.goto(`${BASE}/register`);
  await page.getByPlaceholder('Name').fill('Prod Smoke');
  await page.getByPlaceholder('Email').fill(email);
  await page.getByPlaceholder('Password (min 8 characters)').fill('password123');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.waitForURL('**/rooms', { timeout: 15000 });
  console.log('registered + reached /rooms');

  await page.getByPlaceholder('New room name').fill('Prod Smoke Room');
  await page.getByRole('button', { name: 'Create room' }).click();
  await page.waitForURL(/\/rooms\/[a-f0-9]{24}/, { timeout: 15000 });
  console.log('room created:', page.url());

  await page.waitForSelector('.monaco-editor', { state: 'visible' });
  await page.waitForSelector('text=Connected', { timeout: 15000 });
  console.log('editor connected');

  await page.click('.monaco-editor');
  await page.keyboard.type("print('hello from prod smoke test')", { delay: 15 });
  await page.getByRole('button', { name: /^Run /i }).click();
  console.log('clicked run, waiting for result...');

  let output = '';
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    output = await page.locator('.execution-output').textContent();
    if (output && output.trim().length > 0) break;
    await page.waitForTimeout(300);
  }
  console.log('execution-output:', JSON.stringify(output));

  await page.screenshot({ path: 'scripts/prod-smoke-result.png' });

  if (!output.includes('hello from prod smoke test')) {
    console.log('SMOKE_RESULT: FAIL — expected stdout not found');
    process.exitCode = 1;
  } else {
    console.log('SMOKE_RESULT: PASS');
  }
} catch (err) {
  console.log('SMOKE_RESULT: ERROR', err.message);
  await page.screenshot({ path: 'scripts/prod-smoke-error.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
