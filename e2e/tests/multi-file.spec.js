import { test, expect } from '@playwright/test';
import { registerAndGoToRooms, createRoom, joinRoomById, waitForEditorReady, typeInEditor, waitForEditorText } from './helpers.js';

test('creating a file syncs across tabs, and cross-file imports run correctly', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await registerAndGoToRooms(pageA, 'FileCreator');
  const roomId = await createRoom(pageA, 'Multi-file room');
  await waitForEditorReady(pageA);

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await registerAndGoToRooms(pageB, 'FileWatcher');
  await joinRoomById(pageB, roomId);
  await waitForEditorReady(pageB);

  // A creates a new nested file — proves folder structure (paths with "/") works.
  pageA.once('dialog', (dialog) => dialog.accept('utils/helper.py'));
  await pageA.getByRole('button', { name: '+' }).click();

  // B should see it appear without any action of its own — file-tree
  // mutations ride the same collab:update relay as text edits (§6/§9).
  await expect(pageB.locator('.file-tree-file', { hasText: 'helper.py' })).toBeVisible({ timeout: 10000 });

  await pageB.locator('.file-tree-file', { hasText: 'helper.py' }).click();
  await typeInEditor(pageB, 'def shout(msg):\n    print(msg.upper())');

  await pageA.locator('.file-tree-file', { hasText: 'helper.py' }).click();
  await waitForEditorText(pageA, (text) => text.includes('def shout'), { timeout: 10000 });

  // Back on main.py, import the sibling file and run — proves the whole
  // project (not just the active file) gets mounted for execution. main.py
  // still has its auto-seeded starter comment, so select-all first rather
  // than appending after it. Note: typeInEditor() re-clicks the editor
  // internally, which would collapse this selection before typing — so
  // this uses page.keyboard.type() directly instead of the helper.
  await pageA.locator('.file-tree-file', { hasText: 'main.py' }).click();
  await pageA.click('.monaco-editor');
  await pageA.keyboard.press('Control+A');
  // An embedded "\n" inside a single .type() call doesn't reliably become
  // an Enter keypress right after a Monaco model swap (editor.setModel) —
  // an explicit Enter press between the two lines does.
  await pageA.keyboard.type('from utils.helper import shout', { delay: 15 });
  // Escape dismisses Monaco's IntelliSense suggestion widget if one is
  // open — otherwise Enter accepts the suggestion instead of inserting a
  // newline, silently swallowing the line break.
  await pageA.keyboard.press('Escape');
  await pageA.keyboard.press('Enter');
  await pageA.keyboard.type("shout('hi')", { delay: 15 });
  await pageA.getByRole('button', { name: /^Run/ }).click();

  await expect(pageA.locator('.execution-output')).toContainText('HI', { timeout: 15000 });

  await ctxA.close();
  await ctxB.close();
});
