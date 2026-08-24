import { chromium } from '@playwright/test';

const BASE = 'https://65.0.71.210.nip.io';
const stamp = Date.now();

async function registerAndGoToRooms(page, label) {
  await page.goto(`${BASE}/register`);
  await page.getByPlaceholder('Name').fill(label);
  await page.getByPlaceholder('Email').fill(`prod-feat-${label.toLowerCase()}-${stamp}@example.com`);
  await page.getByPlaceholder('Password (min 8 characters)').fill('password123');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.waitForURL('**/rooms', { timeout: 15000 });
}

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();

let allPass = true;
function check(name, pass) {
  console.log(`[${pass ? 'PASS' : 'FAIL'}] ${name}`);
  if (!pass) allPass = false;
}

try {
  await registerAndGoToRooms(pageA, 'ProdA');
  await pageA.getByPlaceholder('New room name').fill('Prod Features Room');
  await pageA.getByRole('button', { name: 'Create room' }).click();
  await pageA.waitForURL(/\/rooms\/[a-f0-9]{24}/, { timeout: 15000 });
  const roomId = pageA.url().split('/rooms/')[1];
  await pageA.waitForSelector('.monaco-editor', { state: 'visible' });
  await pageA.waitForSelector('text=Connected', { timeout: 15000 });

  await registerAndGoToRooms(pageB, 'ProdB');
  await pageB.getByPlaceholder('Room ID to join').fill(roomId);
  await pageB.getByRole('button', { name: 'Join by ID' }).click();
  await pageB.waitForURL(`**/rooms/${roomId}`, { timeout: 15000 });
  await pageB.waitForSelector('.monaco-editor', { state: 'visible' });
  await pageB.waitForSelector('text=Connected', { timeout: 15000 });

  // --- WebRTC: two-way video ---
  for (const page of [pageA, pageB]) {
    await page.waitForFunction(
      () => document.querySelector('.video-panel video.video-tile')?.readyState >= 2,
      { timeout: 15000 }
    );
  }
  for (const page of [pageA, pageB]) {
    await page.waitForFunction(
      () => Array.from(document.querySelectorAll('.video-panel video.video-tile')).slice(1).some((v) => v.videoWidth > 0),
      { timeout: 20000 }
    );
  }
  check('WebRTC two-way video', true);

  // --- Chat ---
  await pageA.getByPlaceholder('Message the room…').fill('prod chat check');
  await pageA.getByRole('button', { name: 'Send' }).click();
  await pageB.locator('.chat-message', { hasText: 'prod chat check' }).waitFor({ timeout: 10000 });
  check('Chat delivery', true);

  // --- Git panel: commit ---
  await pageA.getByRole('button', { name: 'Git', exact: true }).click();
  await pageA.click('.monaco-editor');
  await pageA.keyboard.press('Control+End');
  await pageA.keyboard.type('\n# prod git check\n', { delay: 10 });
  const commitInput = pageA.getByPlaceholder('Commit message');
  await commitInput.fill('prod git check commit');
  await pageA.getByRole('button', { name: 'Commit current state' }).click();
  await pageA.waitForTimeout(1000);
  await pageA.getByRole('button', { name: 'history', exact: true }).click();
  await pageA.locator('.git-commit-message', { hasText: 'prod git check commit' }).waitFor({ timeout: 10000 });
  check('Git commit + history', true);

  await pageA.screenshot({ path: 'scripts/prod-features-result.png' });
} catch (err) {
  console.log('FAIL (exception):', err.message);
  allPass = false;
  await pageA.screenshot({ path: 'scripts/prod-features-error.png' }).catch(() => {});
} finally {
  await ctxA.close();
  await ctxB.close();
  await browser.close();
}

console.log(allPass ? '\nAll production feature checks passed.' : '\nSome checks failed.');
process.exitCode = allPass ? 0 : 1;
