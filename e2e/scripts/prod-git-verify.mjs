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
  await page.getByPlaceholder('Email').fill(`git-${label.toLowerCase()}-${stamp}@example.com`);
  await page.getByPlaceholder('Password (min 8 characters)').fill('password123');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.waitForURL('**/rooms', { timeout: 20000 });
}

async function editorText(page) {
  const raw = (await page.locator('.view-lines').textContent()) || '';
  return raw.split(String.fromCharCode(160)).join(' ');
}

async function setEditor(page, text) {
  await page.click('.monaco-editor');
  await page.keyboard.press('Control+A');
  await page.keyboard.type(text, { delay: 12 });
  await page.waitForTimeout(400);
}

async function gitTab(page, name) {
  await page.getByRole('button', { name: 'Git', exact: true }).click();
  await page.getByRole('button', { name, exact: true }).click();
  await page.waitForTimeout(400);
}

async function commit(page, message) {
  await gitTab(page, 'commit');
  await page.getByPlaceholder('Commit message').fill(message);
  await page.getByRole('button', { name: 'Commit current state' }).click();
  await page.waitForTimeout(1200);
  return (await page.locator('.git-status').textContent()) || '';
}

const browser = await chromium.launch();
const ctxA = await browser.newContext();
const ctxB = await browser.newContext();
const pageA = await ctxA.newPage();
const pageB = await ctxB.newPage();

try {
  await register(pageA, 'GitA');
  await pageA.getByPlaceholder('New room name').fill('Git Deep Room');
  await pageA.getByRole('button', { name: 'Create room' }).click();
  await pageA.waitForURL(/\/rooms\/[a-f0-9]{24}/, { timeout: 20000 });
  const roomId = pageA.url().split('/rooms/')[1];
  await pageA.waitForSelector('.monaco-editor', { state: 'visible' });
  await pageA.waitForSelector('text=Connected', { timeout: 20000 });

  // ---------- 1. first commit ----------
  await setEditor(pageA, 'version = 1');
  const c1 = await commit(pageA, 'first commit');
  check('commit succeeds', /Committed [0-9a-f]{7}/.test(c1), c1.trim());

  // ---------- 2. no-op commit detected ----------
  const c2 = await commit(pageA, 'should be empty');
  check('re-committing unchanged tree reports nothing to commit', c2.includes('Nothing to commit'), c2.trim());

  // ---------- 3. history ----------
  await gitTab(pageA, 'history');
  const historyCount = await pageA.locator('.git-commit-message').count();
  check('history lists the commit', historyCount >= 1, `${historyCount} entries`);
  const firstMsg = (await pageA.locator('.git-commit-message').first().textContent()) || '';
  check('history shows the commit message', firstMsg.includes('first commit'), firstMsg.trim());

  // ---------- 4. second commit + ordering ----------
  await setEditor(pageA, 'version = 2');
  await commit(pageA, 'second commit');
  await gitTab(pageA, 'history');
  const msgs = await pageA.locator('.git-commit-message').allTextContents();
  check('history is newest-first', msgs[0].includes('second commit'), msgs.join(' | '));
  check('history retains both commits', msgs.length >= 2, `${msgs.length} entries`);

  // ---------- 5. diff ----------
  await pageA.locator('.git-commit-actions button', { hasText: 'Diff' }).first().click();
  await pageA.waitForTimeout(1200);
  const diffText = (await pageA.locator('.git-diff pre').textContent()) || '';
  check('diff renders a real patch', diffText.includes('diff --git') || diffText.includes('version'), diffText.slice(0, 60).replace(/\n/g, ' '));

  // ---------- 6. restore an older commit ----------
  await gitTab(pageA, 'history');
  const restoreButtons = pageA.locator('.git-commit-actions button', { hasText: 'Restore' });
  pageA.once('dialog', (d) => d.accept());
  await restoreButtons.nth(1).click(); // the older (first) commit
  await pageA.waitForTimeout(2000);
  const afterRestore = await editorText(pageA);
  check('restore brings back the older content', afterRestore.includes('version = 1'), afterRestore.trim().slice(0, 40));

  // put it back to v2 so later steps have a known base
  await setEditor(pageA, 'version = 2');
  await commit(pageA, 'back to v2');

  // ---------- 7. create a branch ----------
  await gitTab(pageA, 'branches');
  await pageA.getByPlaceholder('New branch name').fill('feature-x');
  await pageA.getByRole('button', { name: /^Create from/ }).click();
  await pageA.waitForTimeout(2500);
  const branchHeader = (await pageA.locator('.room-branch').textContent()) || '';
  check('creating a branch switches you onto it', branchHeader.includes('feature-x'), branchHeader.trim());

  await gitTab(pageA, 'branches');
  const branchNames = await pageA.locator('.git-branches li span').allTextContents();
  check('branch list contains both branches', branchNames.some((b) => b.includes('main')) && branchNames.some((b) => b.includes('feature-x')), branchNames.join(', '));

  // ---------- 8. branch isolation ----------
  await setEditor(pageA, 'feature_work = True');
  await commit(pageA, 'work on feature-x');

  await gitTab(pageA, 'branches');
  await pageA.locator('.git-branches li', { hasText: 'main' }).getByRole('button', { name: 'Open' }).click();
  await pageA.waitForTimeout(2500);
  const mainContent = await editorText(pageA);
  check('main is unaffected by feature branch work', mainContent.includes('version = 2') && !mainContent.includes('feature_work'), mainContent.trim().slice(0, 50));

  // ---------- 9. merge feature into main ----------
  await gitTab(pageA, 'branches');
  pageA.once('dialog', (d) => d.accept());
  await pageA.locator('.git-branches li', { hasText: 'feature-x' }).getByRole('button', { name: 'Merge in' }).click();
  await pageA.waitForTimeout(3000);
  const merged = await editorText(pageA);
  check('merge brings feature work into main', merged.includes('feature_work'), merged.trim().slice(0, 50));

  const mergeStatus = (await pageA.locator('.git-status').textContent().catch(() => '')) || '';
  check('merge reported no conflict', !mergeStatus.toLowerCase().includes('conflict'), mergeStatus.trim());

  // ---------- 10. second user sees git state ----------
  await register(pageB, 'GitB');
  await pageB.getByPlaceholder('Room ID to join').fill(roomId);
  await pageB.getByRole('button', { name: 'Join by ID' }).click();
  await pageB.waitForURL(`**/rooms/${roomId}`, { timeout: 20000 });
  await pageB.waitForSelector('.monaco-editor', { state: 'visible' });
  await pageB.waitForSelector('text=Connected', { timeout: 20000 });
  await pageB.waitForTimeout(1000);

  await gitTab(pageB, 'history');
  const bMsgs = await pageB.locator('.git-commit-message').allTextContents();
  check('second user sees full commit history', bMsgs.some((m) => m.includes('first commit')) && bMsgs.some((m) => m.includes('work on feature-x')), `${bMsgs.length} entries`);

  await gitTab(pageB, 'branches');
  const bBranches = await pageB.locator('.git-branches li span').allTextContents();
  check('second user sees all branches', bBranches.some((b) => b.includes('feature-x')), bBranches.join(', '));

  // ---------- 11. live commit notification across users ----------
  await gitTab(pageB, 'commit');
  await setEditor(pageA, 'notify_check = 1');
  await commit(pageA, 'notify other user');
  await pageB.waitForTimeout(2500);
  const bStatus = (await pageB.locator('.git-status').textContent().catch(() => '')) || '';
  check('other user is notified of a commit in real time', bStatus.toLowerCase().includes('commit'), bStatus.trim());

  // ---------- 12. per-user branch independence ----------
  await gitTab(pageB, 'branches');
  await pageB.locator('.git-branches li', { hasText: 'feature-x' }).getByRole('button', { name: 'Open' }).click();
  await pageB.waitForTimeout(2500);
  const bBranchHeader = (await pageB.locator('.room-branch').textContent()) || '';
  const aBranchHeader = (await pageA.locator('.room-branch').textContent()) || '';
  check('two users can sit on different branches at once', bBranchHeader.includes('feature-x') && aBranchHeader.includes('main'), `B=${bBranchHeader.trim()} A=${aBranchHeader.trim()}`);

  // ---------- 13. remote validation ----------
  await gitTab(pageA, 'remote');
  await pageA.getByPlaceholder('https://github.com/user/repo.git').fill('not-a-url');
  await pageA.getByRole('button', { name: 'Connect' }).click();
  await pageA.waitForTimeout(1200);
  const remoteStatus = (await pageA.locator('.git-status').textContent().catch(() => '')) || '';
  check('remote rejects a non-https URL', remoteStatus.toLowerCase().includes('https'), remoteStatus.trim());

  // ---------- 14. push without a remote fails cleanly ----------
  await pageA.getByRole('button', { name: /^Push/ }).click();
  await pageA.waitForTimeout(1500);
  const pushStatus = (await pageA.locator('.git-status').textContent().catch(() => '')) || '';
  check('push without a remote errors cleanly (no crash)', pushStatus.length > 0, pushStatus.trim());
  check('room still connected after failed push', await pageA.locator('text=Connected').isVisible());

  await pageA.screenshot({ path: 'scripts/prod-git-a.png', fullPage: true });
} catch (err) {
  console.log('EXCEPTION:', err.message);
  pass = false;
} finally {
  await ctxA.close();
  await ctxB.close();
  await browser.close();
}

console.log(pass ? '\nAll git checks passed on production.' : '\nSome git checks FAILED.');
process.exitCode = pass ? 0 : 1;
