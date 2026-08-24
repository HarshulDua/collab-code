import { chromium } from '@playwright/test';

const BASE = 'https://65.0.71.210.nip.io';
const stamp = Date.now();

let pass = true;
const check = (name, ok, detail = '') => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) pass = false;
};

async function register(page, label) {
  await page.goto(`${BASE}/register`);
  await page.getByPlaceholder('Name').fill(label);
  await page.getByPlaceholder('Email').fill(`ui-${label.toLowerCase()}-${stamp}@example.com`);
  await page.getByPlaceholder('Password (min 8 characters)').fill('password123');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.waitForURL('**/rooms', { timeout: 25000 });
}

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();

try {
  // ---------- login screen ----------
  await pageA.goto(`${BASE}/login`);
  await pageA.waitForTimeout(1200);
  check('login: brand mark present', await pageA.locator('.brand-name').first().isVisible());
  check('login: split hero', await pageA.locator('.auth-pitch h1').isVisible());
  check('login: card', await pageA.locator('.auth-card').isVisible());
  const googleVisible =
    (await pageA.locator('.google-btn-holder iframe').count()) > 0 ||
    (await pageA.locator('.btn-google').count()) > 0;
  check('login: Continue with Google present', googleVisible);
  await pageA.screenshot({ path: 'scripts/prod-ui-login.png' });

  // ---------- rooms screen ----------
  await register(pageA, 'UiChecker');
  check('rooms: sidebar nav', await pageA.locator('.rooms-nav').isVisible());
  check('rooms: heading', await pageA.locator('.rooms-main-head h1').isVisible());
  check('rooms: user block with avatar', await pageA.locator('.rooms-nav-user .avatar').isVisible());

  await pageA.getByPlaceholder('New room name').fill('ui-verify-room');
  await pageA.getByRole('button', { name: 'Create room' }).click();
  await pageA.waitForURL(/\/rooms\/[a-f0-9]{24}/, { timeout: 25000 });
  const roomId = pageA.url().split('/rooms/')[1];
  await pageA.waitForSelector('.monaco-editor', { state: 'visible' });
  await pageA.waitForSelector('text=Connected', { timeout: 25000 });

  // ---------- room chrome ----------
  check('room: activity rail', (await pageA.locator('.activity-rail .rail-btn').count()) === 2);
  check('room: explorer', await pageA.locator('.file-explorer').isVisible());
  check('room: editor tab strip', await pageA.locator('.editor-tab-active').isVisible());
  check('room: bottom panel tabs', (await pageA.locator('.bottom-tabs button').count()) >= 2);
  check('room: chat panel', await pageA.locator('.room-sidebar .chat-panel').isVisible());
  check('room: status bar', await pageA.locator('.status-bar').isVisible());
  check('room: two resize handles', (await pageA.locator('.resize-handle').count()) === 2);
  check('room: Leave Room button', await pageA.getByRole('button', { name: 'Leave Room' }).isVisible());

  // ---------- terminal scrollback survives panel switches (the reported bug) ----------
  const input = pageA.locator('.terminal-input');
  await input.fill('echo prod_persistence_marker');
  await input.press('Enter');
  await pageA.waitForTimeout(1200);

  await pageA.getByRole('button', { name: 'Output', exact: true }).click();
  await pageA.waitForTimeout(400);
  await pageA.getByRole('button', { name: 'Terminal', exact: true }).click();
  await pageA.waitForTimeout(300);
  let termText = (await pageA.locator('.terminal-output').textContent()) || '';
  check('terminal: survives Output tab switch', termText.includes('prod_persistence_marker'));

  await pageA.getByRole('button', { name: 'Git', exact: true }).click();
  await pageA.waitForTimeout(500);
  termText = (await pageA.locator('.terminal-output').textContent()) || '';
  check('terminal: survives switching to Git panel', termText.includes('prod_persistence_marker'));

  await pageA.getByRole('button', { name: 'Explorer', exact: true }).click();
  await pageA.waitForTimeout(400);
  termText = (await pageA.locator('.terminal-output').textContent()) || '';
  check('terminal: survives switching back to Explorer', termText.includes('prod_persistence_marker'));

  // ---------- video dropdown ----------
  await register(pageB, 'UiPeer');
  await pageB.getByPlaceholder('Room ID to join').fill(roomId);
  await pageB.getByRole('button', { name: 'Join by ID' }).click();
  await pageB.waitForURL(`**/rooms/${roomId}`, { timeout: 25000 });
  await pageB.waitForSelector('.monaco-editor', { state: 'visible' });
  await pageA.waitForTimeout(2000);

  check('room: avatar stack shows both people', (await pageA.locator('.people-trigger .avatar').count()) >= 2);
  await pageA.getByRole('button', { name: 'Video call' }).click();
  await pageA.waitForTimeout(3000);
  check('video: dropdown opens', await pageA.locator('.video-popover-open').isVisible());
  const tiles = await pageA.locator('.video-panel video.video-tile').count();
  check('video: two tiles in the dropdown', tiles === 2, `${tiles} tiles`);
  const decoding = await pageA.evaluate(() =>
    Array.from(document.querySelectorAll('.video-panel video.video-tile'))
      .slice(1)
      .some((v) => v.videoWidth > 0)
  );
  check('video: remote stream actually decoding', decoding);
  await pageA.screenshot({ path: 'scripts/prod-ui-room.png' });

  // ---------- presence still works ----------
  check('presence: peer listed', (await pageA.locator('.presence-item', { hasText: 'UiPeer' }).count()) > 0);
} catch (err) {
  console.log('EXCEPTION:', err.message);
  pass = false;
  await pageA.screenshot({ path: 'scripts/prod-ui-error.png' }).catch(() => {});
} finally {
  await ctxA.close();
  await ctxB.close();
  await browser.close();
}

console.log(pass ? '\nAll UI checks passed on production.' : '\nSome UI checks FAILED.');
process.exitCode = pass ? 0 : 1;
