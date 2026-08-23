import { test, expect } from '@playwright/test';
import { registerAndGoToRooms, createRoom, waitForEditorReady, typeInEditor } from './helpers.js';

test('running code shows stdout, and an infinite loop surfaces a timeout', async ({ page }) => {
  test.setTimeout(45000); // the infinite-loop case waits out the real EXEC_TIMEOUT_MS (8s default)

  await registerAndGoToRooms(page, 'Runner');
  await createRoom(page, 'Execution room');
  await waitForEditorReady(page);

  await typeInEditor(page, "print('hello from the sandbox')");
  await page.getByRole('button', { name: 'Run' }).click();

  await expect(page.locator('.execution-output')).toContainText('hello from the sandbox', { timeout: 15000 });

  // Clear the editor and try a payload designed to trip EXEC_TIMEOUT_MS.
  await page.click('.monaco-editor');
  await page.keyboard.press('Control+A');
  await page.keyboard.type('while True:\n    pass', { delay: 15 });
  await page.getByRole('button', { name: 'Run' }).click();

  await expect(page.locator('.execution-badge')).toContainText('Timed out', { timeout: 15000 });
});
