import { chromium } from '@playwright/test';

const BASE = 'https://65.0.71.210.nip.io';
const stamp = Date.now();

async function registerAndGoToRooms(page, label) {
  await page.goto(`${BASE}/register`);
  await page.getByPlaceholder('Name').fill(label);
  await page.getByPlaceholder('Email').fill(`prod-hijack-${label.toLowerCase()}-${stamp}@example.com`);
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
  await registerAndGoToRooms(pageA, 'HijackA');
  await pageA.getByPlaceholder('New room name').fill('Hijack Check Room');
  await pageA.getByRole('button', { name: 'Create room' }).click();
  await pageA.waitForURL(/\/rooms\/[a-f0-9]{24}/, { timeout: 15000 });
  const roomId = pageA.url().split('/rooms/')[1];
  await pageA.waitForSelector('.monaco-editor', { state: 'visible' });
  await pageA.waitForSelector('text=Connected', { timeout: 15000 });

  await registerAndGoToRooms(pageB, 'HijackB');
  await pageB.getByPlaceholder('Room ID to join').fill(roomId);
  await pageB.getByRole('button', { name: 'Join by ID' }).click();
  await pageB.waitForURL(`**/rooms/${roomId}`, { timeout: 15000 });
  await pageB.waitForSelector('.monaco-editor', { state: 'visible' });
  await pageB.waitForSelector('text=Connected', { timeout: 15000 });
  await pageB.waitForTimeout(1000);

  // Clear starter content on A, set known baseline text with clear line markers.
  await pageA.click('.monaco-editor');
  await pageA.keyboard.press('Control+A');
  await pageA.keyboard.type('LINE_ONE\nLINE_TWO\nLINE_THREE', { delay: 15 });
  await pageB.waitForTimeout(1000);

  // B clicks at the START of LINE_THREE (their own deliberate cursor position).
  const lineThree = pageB.locator('.view-line', { hasText: 'LINE_THREE' });
  await lineThree.click({ position: { x: 2, y: 5 } });
  await pageB.keyboard.press('Home');

  // A now moves ITS OWN cursor somewhere completely different: start of LINE_ONE.
  const lineOneOnA = pageA.locator('.view-line', { hasText: 'LINE_ONE' });
  await lineOneOnA.click({ position: { x: 2, y: 5 } });
  await pageA.keyboard.press('Home');
  await pageB.waitForTimeout(1000); // give awareness update time to propagate to B

  // B types a marker WITHOUT re-clicking — if B's caret got hijacked to A's
  // remote cursor position, the marker lands next to LINE_ONE instead of
  // LINE_THREE where B actually put their own cursor.
  await pageB.keyboard.type('MARKER_B', { delay: 15 });
  await pageA.waitForTimeout(1000);

  const finalText = (await pageA.locator('.view-lines').textContent()) || '';
  console.log('Final shared document text:', JSON.stringify(finalText));

  const markerNextToLineThree = finalText.includes('MARKER_BLINE_THREE') || finalText.includes('MARKER_B\nLINE_THREE') || /MARKER_B\s*LINE_THREE/.test(finalText);
  const markerNextToLineOne = /LINE_ONE\s*MARKER_B/.test(finalText) || finalText.includes('LINE_ONEMARKER_B');

  console.log('RESULT: marker landed at B\'s own cursor position (LINE_THREE) — correct:', markerNextToLineThree);
  console.log('RESULT: marker landed at A\'s cursor position (LINE_ONE) — BUG if true:', markerNextToLineOne);

  await pageA.screenshot({ path: 'scripts/prod-hijack-a.png' });
  await pageB.screenshot({ path: 'scripts/prod-hijack-b.png' });
} finally {
  await ctxA.close();
  await ctxB.close();
  await browser.close();
}
