import { test, expect } from '@playwright/test';
import { registerAndGoToRooms, createRoom, joinRoomById, waitForEditorReady, editorText } from './helpers.js';

async function openTerminal(page) {
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  await page.locator('.terminal-input').waitFor({ state: 'visible' });
}

async function runCmd(page, command) {
  const input = page.locator('.terminal-input');
  await input.fill(command);
  await input.press('Enter');
  await expect(page.locator('.terminal-input')).toBeEnabled({ timeout: 30000 });
  await page.waitForTimeout(150);
}

async function terminalText(page) {
  return (await page.locator('.terminal-output').textContent()) || '';
}

test('file commands create, list, read and remove files, and the editor sees them live', async ({ page }) => {
  test.setTimeout(60000);

  await registerAndGoToRooms(page, 'TermFiles');
  await createRoom(page, 'Terminal Files Room');
  await waitForEditorReady(page);
  await openTerminal(page);

  await runCmd(page, 'ls');
  expect(await terminalText(page)).toContain('main.py');

  await runCmd(page, 'mkdir src');
  await runCmd(page, 'touch src/app.py');
  await runCmd(page, 'ls');
  expect(await terminalText(page)).toContain('src/');

  // The file explorer is driven by the same Yjs document, so a file made in
  // the terminal must appear in the tree without a refresh.
  await expect(page.locator('.file-tree-name', { hasText: 'app.py' })).toBeVisible({ timeout: 10000 });

  await runCmd(page, 'cd src');
  await runCmd(page, 'pwd');
  expect(await terminalText(page)).toContain('/src');

  await runCmd(page, 'echo hello_from_terminal > app.py');
  await runCmd(page, 'cat app.py');
  expect(await terminalText(page)).toContain('hello_from_terminal');

  await runCmd(page, 'cd ..');
  await runCmd(page, 'mv src/app.py src/renamed.py');
  await runCmd(page, 'ls src');
  const afterMove = await terminalText(page);
  expect(afterMove).toContain('renamed.py');

  await runCmd(page, 'rm -r src');
  await runCmd(page, 'ls');
  expect(await page.locator('.file-tree-name', { hasText: 'renamed.py' }).count()).toBe(0);
});

test('unknown commands and bad paths fail cleanly without breaking the session', async ({ page }) => {
  test.setTimeout(45000);

  await registerAndGoToRooms(page, 'TermSafe');
  await createRoom(page, 'Terminal Safety Room');
  await waitForEditorReady(page);
  await openTerminal(page);

  await runCmd(page, 'sudo rm -rf /');
  expect(await terminalText(page)).toContain('command not found');

  await runCmd(page, 'cat ../../etc/passwd');
  const out = await terminalText(page);
  expect(out).not.toContain('root:');

  await runCmd(page, 'cd nowhere');
  expect(await terminalText(page)).toContain('no such directory');

  // Still usable afterwards.
  await runCmd(page, 'pwd');
  expect(await terminalText(page)).toContain('/');
  await expect(page.locator('text=Connected')).toBeVisible();
});

test('run executes code through the sandbox for several languages', async ({ page }) => {
  test.setTimeout(120000);

  await registerAndGoToRooms(page, 'TermRun');
  await createRoom(page, 'Terminal Run Room');
  await waitForEditorReady(page);
  await openTerminal(page);

  await runCmd(page, 'echo print("py_terminal_ok") > hello.py');
  await runCmd(page, 'run hello.py');
  expect(await terminalText(page)).toContain('py_terminal_ok');
  expect(await terminalText(page)).toContain('[exit 0');

  await runCmd(page, 'echo console.log("js_terminal_ok") > hello.js');
  await runCmd(page, 'node hello.js');
  expect(await terminalText(page)).toContain('js_terminal_ok');

  // A runtime error surfaces stderr and a non-zero exit code rather than
  // silently succeeding.
  await runCmd(page, 'echo raise SystemExit(3) > boom.py');
  await runCmd(page, 'run boom.py');
  expect(await terminalText(page)).toContain('[exit 3');
});

test('git commands work from the terminal and stay in step with the Git panel', async ({ page }) => {
  test.setTimeout(90000);

  await registerAndGoToRooms(page, 'TermGit');
  await createRoom(page, 'Terminal Git Room');
  await waitForEditorReady(page);
  await openTerminal(page);

  await runCmd(page, 'git status');
  expect(await terminalText(page)).toContain('On branch main');

  await runCmd(page, 'echo version_one > app.py');
  await runCmd(page, 'git commit -m "first from terminal"');
  expect(await terminalText(page)).toMatch(/\[main [0-9a-f]{7}\]/);

  await runCmd(page, 'git status');
  expect(await terminalText(page)).toContain('nothing to commit');

  await runCmd(page, 'git log');
  expect(await terminalText(page)).toContain('first from terminal');

  await runCmd(page, 'git branch');
  expect(await terminalText(page)).toContain('* main');

  // A commit made in the terminal must be visible in the Git panel's history.
  await page.getByRole('button', { name: 'Git', exact: true }).click();
  await page.getByRole('button', { name: 'history', exact: true }).click();
  await expect(page.locator('.git-commit-message', { hasText: 'first from terminal' })).toBeVisible({ timeout: 10000 });

  // checkout -b switches the whole room view onto the new branch.
  await openTerminal(page);
  await runCmd(page, 'git checkout -b from-terminal');
  await expect(page.locator('.room-branch')).toContainText('from-terminal', { timeout: 15000 });
});

test('a file created in the terminal reaches a second user in real time', async ({ browser }) => {
  test.setTimeout(60000);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    await registerAndGoToRooms(pageA, 'TermShareA');
    const roomId = await createRoom(pageA, 'Terminal Share Room');
    await waitForEditorReady(pageA);

    await registerAndGoToRooms(pageB, 'TermShareB');
    await joinRoomById(pageB, roomId);
    await waitForEditorReady(pageB);

    await openTerminal(pageA);
    await runCmd(pageA, 'echo shared_by_terminal = 1 > shared.py');

    await expect(pageB.locator('.file-tree-name', { hasText: 'shared.py' })).toBeVisible({ timeout: 15000 });
    await pageB.locator('.file-tree-name', { hasText: 'shared.py' }).click();
    await expect.poll(async () => (await editorText(pageB)).includes('shared_by_terminal'), { timeout: 15000 }).toBe(true);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

// Regression: the terminal used to be a sidebar tab, so looking at Chat or Git
// unmounted it and silently threw away the whole scrollback. It now lives in
// the bottom panel and both bottom panes stay mounted, so nothing that changes
// which panel you are looking at can lose terminal history.
test('terminal scrollback survives switching panels and tabs', async ({ page }) => {
  test.setTimeout(60000);

  await registerAndGoToRooms(page, 'TermKeep');
  await createRoom(page, 'Terminal Persistence Room');
  await waitForEditorReady(page);
  await openTerminal(page);

  await runCmd(page, 'echo remember_this_line');
  await runCmd(page, 'pwd');
  expect(await terminalText(page)).toContain('remember_this_line');

  // Output tab and back.
  await page.getByRole('button', { name: 'Output', exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Terminal', exact: true }).click();
  expect(await terminalText(page)).toContain('remember_this_line');

  // Git panel and back to Explorer.
  await page.getByRole('button', { name: 'Git', exact: true }).click();
  await page.waitForTimeout(300);
  expect(await terminalText(page)).toContain('remember_this_line');
  await page.getByRole('button', { name: 'Explorer', exact: true }).click();
  await page.waitForTimeout(300);
  expect(await terminalText(page)).toContain('remember_this_line');

  // Still usable, and command history is intact too.
  await runCmd(page, 'echo second_line');
  const finalText = await terminalText(page);
  expect(finalText).toContain('remember_this_line');
  expect(finalText).toContain('second_line');
});
