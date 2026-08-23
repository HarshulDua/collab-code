import { test, expect } from '@playwright/test';
import { registerAndGoToRooms, createRoom, waitForEditorReady, typeInEditor } from './helpers.js';

test('stdin provided in the UI is fed to input() calls', async ({ page }) => {
  await registerAndGoToRooms(page, 'StdinTester');
  await createRoom(page, 'Stdin room');
  await waitForEditorReady(page);

  await typeInEditor(page, 'name = input()\nprint("hello,", name)');

  await page.getByRole('button', { name: 'stdin' }).click();
  await page.locator('.execution-stdin').fill('world');
  await page.getByRole('button', { name: /^Run/ }).click();

  await expect(page.locator('.execution-output')).toContainText('hello, world', { timeout: 15000 });
});
