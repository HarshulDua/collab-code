import { chromium } from '@playwright/test';

const BASE = process.env.UI_BASE || 'http://localhost:5173';
const stamp = Date.now();

const browser = await chromium.launch({
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
});
const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();

async function register(page, label) {
  await page.goto(`${BASE}/register`);
  await page.getByPlaceholder('Name').fill(label);
  await page.getByPlaceholder('Email').fill(`shot-${label.toLowerCase()}-${stamp}@example.com`);
  await page.getByPlaceholder('Password (min 8 characters)').fill('password123');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.waitForURL('**/rooms', { timeout: 20000 });
}

try {
  // 1. login page
  await pageA.goto(`${BASE}/login`);
  await pageA.waitForTimeout(700);
  await pageA.screenshot({ path: 'scripts/ui-1-login.png' });

  // 2. rooms page (a few rooms so the grid is visible)
  await register(pageA, 'Ananya');
  for (const name of ['project-alpha', 'web-redesign', 'data-analytics']) {
    await pageA.getByPlaceholder('New room name').fill(name);
    await pageA.getByRole('button', { name: 'Create room' }).click();
    await pageA.waitForURL(/\/rooms\/[a-f0-9]{24}/, { timeout: 20000 });
    await pageA.goto(`${BASE}/rooms`);
    await pageA.waitForTimeout(400);
  }
  await pageA.waitForTimeout(600);
  await pageA.screenshot({ path: 'scripts/ui-2-rooms.png' });

  // 3. the room itself, with a second person present
  await pageA.locator('.room-card', { hasText: 'project-alpha' }).click();
  await pageA.waitForURL(/\/rooms\/[a-f0-9]{24}/, { timeout: 20000 });
  const roomId = pageA.url().split('/rooms/')[1];
  await pageA.waitForSelector('.monaco-editor', { state: 'visible' });
  await pageA.waitForSelector('text=Connected', { timeout: 20000 });

  await register(pageB, 'Manoj');
  await pageB.getByPlaceholder('Room ID to join').fill(roomId);
  await pageB.getByRole('button', { name: 'Join by ID' }).click();
  await pageB.waitForURL(`**/rooms/${roomId}`, { timeout: 20000 });
  await pageB.waitForSelector('.monaco-editor', { state: 'visible' });
  await pageB.waitForTimeout(1500);

  // some code, a chat message and a terminal command so the panels have content
  await pageA.click('.monaco-editor');
  await pageA.keyboard.press('Control+A');
  await pageA.keyboard.type(
    'class Point:\n    def __init__(self, x, y):\n        self.x = x\n        self.y = y\n\n    def distance(self):\n        return (self.x**2 + self.y**2) ** 0.5\n',
    { delay: 5 }
  );

  await pageB.getByPlaceholder('Message the room…').fill('Hey! Can you check the distance function?');
  await pageB.getByRole('button', { name: 'Send' }).click();
  await pageA.waitForTimeout(500);
  await pageA.getByPlaceholder('Message the room…').fill('Sure, looks good!');
  await pageA.getByRole('button', { name: 'Send' }).click();
  await pageA.waitForTimeout(600);

  const input = pageA.locator('.terminal-input');
  await input.fill('ls');
  await input.press('Enter');
  await pageA.waitForTimeout(900);
  await input.fill('git status');
  await input.press('Enter');
  await pageA.waitForTimeout(1400);

  await pageA.screenshot({ path: 'scripts/ui-3-room.png' });

  // 4. the video dropdown open
  await pageA.getByRole('button', { name: 'Video call' }).click();
  await pageA.waitForTimeout(2500);
  await pageA.screenshot({ path: 'scripts/ui-4-video.png' });

  console.log('screenshots written');
} catch (err) {
  console.log('EXCEPTION:', err.message);
  await pageA.screenshot({ path: 'scripts/ui-error.png' }).catch(() => {});
  process.exitCode = 1;
} finally {
  await ctxA.close();
  await ctxB.close();
  await browser.close();
}
