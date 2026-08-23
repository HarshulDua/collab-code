import { test, expect } from '@playwright/test';
import { registerAndGoToRooms, createRoom, waitForEditorReady, waitForEditorText } from './helpers.js';

test('commit, branch, edit, switch, and merge through the Git panel', async ({ page }) => {
  test.setTimeout(45000);

  await registerAndGoToRooms(page, 'GitTester');
  await createRoom(page, 'Git flow room');
  await waitForEditorReady(page); // now waits for the initial Yjs->Monaco sync too, not just "Connected"

  await page.click('.monaco-editor');
  await page.keyboard.press('Control+A');
  await page.keyboard.type("print('v1')", { delay: 15 });

  await page.getByRole('button', { name: 'Git' }).click();
  await page.getByPlaceholder('Commit message').fill('Initial commit');
  await page.getByRole('button', { name: 'Commit current state' }).click();
  await expect(page.locator('.git-status')).toContainText('Committed', { timeout: 10000 });

  await page.getByRole('button', { name: 'history' }).click();
  await expect(page.locator('.git-history li')).toContainText('Initial commit');

  // Create and switch to a feature branch, edit, commit.
  await page.getByRole('button', { name: 'branches' }).click();
  await page.getByPlaceholder('New branch name').fill('feature');
  await page.getByRole('button', { name: 'Create' }).click();
  await expect(page.locator('.git-branch-current')).toContainText('feature', { timeout: 10000 });

  // Same race as the initial waitForEditorReady, one level up: branch-create
  // just replayed main's committed content into the live doc over the
  // network — wait for it to actually land before clearing and typing over
  // it, or the same "stale content + new text" corruption can happen here.
  await waitForEditorText(page, (text) => text.includes("print('v1')"), { timeout: 10000 });

  await page.click('.monaco-editor');
  await page.keyboard.press('Control+A');
  await page.keyboard.type("print('v2 on feature')", { delay: 15 });

  await page.getByRole('button', { name: 'commit' }).click();
  await page.getByPlaceholder('Commit message').fill('v2 on feature');
  await page.getByRole('button', { name: 'Commit current state' }).click();
  await expect(page.locator('.git-status')).toContainText('Committed', { timeout: 10000 });

  // Switch back to main — editor content should revert to v1.
  await page.getByRole('button', { name: 'branches' }).click();
  await page.getByText('main', { exact: true }).locator('..').getByRole('button', { name: 'Open' }).click();
  await expect(page.locator('.git-branch-current')).toContainText('main', { timeout: 10000 });

  const revertedText = await waitForEditorText(page, (text) => text.includes("print('v1')"), { timeout: 10000 });
  expect(revertedText).not.toContain('v2 on feature');

  // Merge feature into main — content should become v2.
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByText('feature', { exact: true }).locator('..').getByRole('button', { name: 'Merge in' }).click();

  const mergedText = await waitForEditorText(page, (text) => text.includes('v2 on feature'), { timeout: 10000 });
  expect(mergedText).not.toContain('Start typing');
});
