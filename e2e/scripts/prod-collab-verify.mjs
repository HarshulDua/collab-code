import { chromium } from '@playwright/test';

const BASE = 'https://65.0.71.210.nip.io';
const stamp = Date.now();

async function register(page, label) {
  await page.goto(`${BASE}/register`);
  await page.getByPlaceholder('Name').fill(label);
  await page.getByPlaceholder('Email').fill(`pv-${label.toLowerCase()}-${stamp}@example.com`);
  await page.getByPlaceholder('Password (min 8 characters)').fill('password123');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.waitForURL('**/rooms', { timeout: 20000 });
}

async function editorText(page) {
  const raw = (await page.locator('.view-lines').textContent()) || '';
  return raw.split(String.fromCharCode(160)).join(' ');
}

let pass = true;
const check = (name, ok) => {
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name}`);
  if (!ok) pass = false;
};

const browser = await chromium.launch();
const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();

try {
  await register(pageA, 'VerA');
  await pageA.getByPlaceholder('New room name').fill('Prod Verify Room');
  await pageA.getByRole('button', { name: 'Create room' }).click();
  await pageA.waitForURL(/\/rooms\/[a-f0-9]{24}/, { timeout: 20000 });
  const roomId = pageA.url().split('/rooms/')[1];
  await pageA.waitForSelector('.monaco-editor', { state: 'visible' });
  await pageA.waitForSelector('text=Connected', { timeout: 20000 });

  await register(pageB, 'VerB');
  await pageB.getByPlaceholder('Room ID to join').fill(roomId);
  await pageB.getByRole('button', { name: 'Join by ID' }).click();
  await pageB.waitForURL(`**/rooms/${roomId}`, { timeout: 20000 });
  await pageB.waitForSelector('.monaco-editor', { state: 'visible' });
  await pageB.waitForSelector('text=Connected', { timeout: 20000 });
  await pageB.waitForTimeout(1200);

  // 1. presence list shows the other person
  await pageB.locator('.presence-item', { hasText: 'VerA' }).first().waitFor({ timeout: 15000 });
  await pageA.locator('.presence-item', { hasText: 'VerB' }).first().waitFor({ timeout: 15000 });
  check('presence list shows both peers', true);

  // 2. bidirectional live sync (the headline bug)
  await pageA.click('.monaco-editor');
  await pageA.keyboard.press('Control+A');
  await pageA.keyboard.type('alpha_from_a = 1', { delay: 20 });
  await pageB.waitForTimeout(2000);
  check("A's edits reach B", (await editorText(pageB)).includes('alpha_from_a'));

  await pageB.click('.monaco-editor');
  await pageB.keyboard.press('Control+End');
  await pageB.keyboard.type('\nbeta_from_b = 2', { delay: 20 });
  await pageA.waitForTimeout(2000);
  check("B's edits reach A (the bug that was silent)", (await editorText(pageA)).includes('beta_from_b'));

  check('both converge identically', (await editorText(pageA)) === (await editorText(pageB)));

  // 3. remote cursor decoration + label
  const remoteCursors = await pageA.locator('[class*="yRemoteSelectionHead-"]').count();
  check('remote cursor rendered', remoteCursors > 0);

  // 4. active-file presence
  await pageA.locator('.presence-item', { hasText: 'VerB' }).first().waitFor();
  const presenceText = (await pageA.locator('.presence-item', { hasText: 'VerB' }).first().textContent()) || '';
  check('presence shows peer active file', presenceText.includes('main.py'));

  // 5. resize handles present
  check('two resize handles present', (await pageA.locator('.resize-handle').count()) === 2);

  // 6. sign out button present
  check('sign out button present', await pageA.getByRole('button', { name: 'Sign out' }).isVisible());

  // 7. room delete (owner only)
  await pageA.goto(`${BASE}/rooms`);
  await pageA.locator('.room-list-row', { hasText: 'Prod Verify Room' }).first().waitFor({ timeout: 15000 });
  await pageA.getByRole('button', { name: 'Delete', exact: true }).first().waitFor({ timeout: 15000 });
  check('owner sees delete', await pageA.getByRole('button', { name: 'Delete', exact: true }).first().isVisible());

  await pageB.goto(`${BASE}/rooms`);
  await pageB.locator('.room-list-row', { hasText: 'Prod Verify Room' }).first().waitFor({ timeout: 15000 });
  check('non-owner does not see delete', (await pageB.getByRole('button', { name: 'Delete', exact: true }).count()) === 0);

  pageA.once('dialog', (d) => d.accept());
  await pageA.getByRole('button', { name: 'Delete', exact: true }).first().click();
  await pageA.waitForTimeout(2000);
  await pageA.reload();
  await pageA.waitForTimeout(1500);
  check('room deleted and gone after reload', (await pageA.locator('.room-list-row', { hasText: 'Prod Verify Room' }).count()) === 0);

  await pageA.screenshot({ path: 'scripts/prod-verify-a.png', fullPage: true });
} catch (err) {
  console.log('EXCEPTION:', err.message);
  pass = false;
} finally {
  await ctxA.close();
  await ctxB.close();
  await browser.close();
}

console.log(pass ? '\nAll production checks passed.' : '\nSome production checks FAILED.');
process.exitCode = pass ? 0 : 1;
