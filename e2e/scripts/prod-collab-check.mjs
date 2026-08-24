import { chromium } from '@playwright/test';

const BASE = 'https://65.0.71.210.nip.io';
const stamp = Date.now();

async function registerAndGoToRooms(page, label) {
  await page.goto(`${BASE}/register`);
  await page.getByPlaceholder('Name').fill(label);
  await page.getByPlaceholder('Email').fill(`prod-collab-${label.toLowerCase()}-${stamp}@example.com`);
  await page.getByPlaceholder('Password (min 8 characters)').fill('password123');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.waitForURL('**/rooms', { timeout: 15000 });
}

const browser = await chromium.launch();
const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();

try {
  await registerAndGoToRooms(pageA, 'CollabA');
  await pageA.getByPlaceholder('New room name').fill('Collab Check Room');
  await pageA.getByRole('button', { name: 'Create room' }).click();
  await pageA.waitForURL(/\/rooms\/[a-f0-9]{24}/, { timeout: 15000 });
  const roomId = pageA.url().split('/rooms/')[1];
  await pageA.waitForSelector('.monaco-editor', { state: 'visible' });
  await pageA.waitForSelector('text=Connected', { timeout: 15000 });

  await registerAndGoToRooms(pageB, 'CollabB');
  await pageB.getByPlaceholder('Room ID to join').fill(roomId);
  await pageB.getByRole('button', { name: 'Join by ID' }).click();
  await pageB.waitForURL(`**/rooms/${roomId}`, { timeout: 15000 });
  await pageB.waitForSelector('.monaco-editor', { state: 'visible' });
  await pageB.waitForSelector('text=Connected', { timeout: 15000 });
  await pageB.waitForTimeout(1000);

  // Type in A, check B sees it live
  await pageA.click('.monaco-editor');
  await pageA.keyboard.type('collab_live_check = 42', { delay: 20 });
  await pageB.waitForTimeout(1500);
  const bText = (await pageB.locator('.view-lines').textContent()) || '';
  console.log('B sees A\'s text:', bText.includes('collab_live_check'));
  console.log('B editor content sample:', JSON.stringify(bText.slice(0, 80)));

  // Check remote cursor decoration exists in B's DOM for A's client
  await pageA.keyboard.press('End');
  await pageB.waitForTimeout(800);
  const remoteCursorCount = await pageB.locator('[class*="yRemoteSelectionHead-"]').count();
  console.log('B has remote cursor decoration for A:', remoteCursorCount > 0, '(count:', remoteCursorCount, ')');

  const styleContent = await pageB.evaluate(() => document.getElementById('y-remote-cursor-styles')?.textContent || '');
  console.log('B injected cursor style rule present:', styleContent.length > 0);
  console.log('style content sample:', styleContent.slice(0, 200));

  // Now check B can type independently without moving A's cursor
  const aSelectionBefore = await pageA.evaluate(() => {
    const ed = window.monaco?.editor?.getEditors?.()[0];
    return ed ? ed.getPosition() : null;
  });
  await pageB.click('.monaco-editor');
  await pageB.keyboard.press('Control+End');
  await pageB.keyboard.type('\nb_types_here = 1', { delay: 20 });
  await pageA.waitForTimeout(1000);
  const aSelectionAfter = await pageA.evaluate(() => {
    const ed = window.monaco?.editor?.getEditors?.()[0];
    return ed ? ed.getPosition() : null;
  });
  console.log('A cursor position before:', JSON.stringify(aSelectionBefore));
  console.log('A cursor position after B typed:', JSON.stringify(aSelectionAfter));

  const aText = (await pageA.locator('.view-lines').textContent()) || '';
  console.log('A sees B\'s text:', aText.includes('b_types_here'));

  await pageA.screenshot({ path: 'scripts/prod-collab-a.png' });
  await pageB.screenshot({ path: 'scripts/prod-collab-b.png' });
} finally {
  await ctxA.close();
  await ctxB.close();
  await browser.close();
}
