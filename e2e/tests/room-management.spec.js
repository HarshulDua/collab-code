import { test, expect } from '@playwright/test';
import { registerAndGoToRooms, createRoom } from './helpers.js';

test('sign out from within a room returns to login and clears the session', async ({ page }) => {
  await registerAndGoToRooms(page, 'SignOut');
  await createRoom(page, 'Sign Out Room');
  await page.waitForSelector('text=Connected');

  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL('**/login', { timeout: 10000 });

  // session actually cleared, not just navigated away
  await page.goto('/rooms');
  await page.waitForURL('**/login', { timeout: 10000 });
});

test('deleting a room removes it from the list and only the owner sees the delete button', async ({ browser }) => {
  const ctxOwner = await browser.newContext();
  const ctxOther = await browser.newContext();
  const pageOwner = await ctxOwner.newPage();
  const pageOther = await ctxOther.newPage();

  try {
    await registerAndGoToRooms(pageOwner, 'Owner');
    const roomId = await createRoom(pageOwner, 'Deletable Room');
    await pageOwner.goto('/rooms');

    await expect(pageOwner.getByRole('button', { name: 'Delete', exact: true })).toBeVisible();

    await registerAndGoToRooms(pageOther, 'Other');
    await pageOther.getByPlaceholder('Room ID to join').fill(roomId);
    await pageOther.getByRole('button', { name: 'Join by ID' }).click();
    await pageOther.waitForURL(`**/rooms/${roomId}`, { timeout: 15000 });
    await pageOther.goto('/rooms');
    await expect(pageOther.getByText('Deletable Room')).toBeVisible();
    await expect(pageOther.getByRole('button', { name: 'Delete', exact: true })).toHaveCount(0);

    pageOwner.once('dialog', (dialog) => dialog.accept());
    await pageOwner.getByRole('button', { name: 'Delete', exact: true }).click();

    // Assert on the room row itself rather than a substring match anywhere
    // on the page, and confirm it's gone from the server too (a reload that
    // still shows it would mean only the local store was updated).
    await expect(pageOwner.locator('.room-list-row', { hasText: 'Deletable Room' })).toHaveCount(0, { timeout: 15000 });
    await pageOwner.reload();
    await expect(pageOwner.locator('.room-list-row', { hasText: 'Deletable Room' })).toHaveCount(0, { timeout: 15000 });
  } finally {
    await ctxOwner.close();
    await ctxOther.close();
  }
});

test('file explorer and sidebar panels can be resized by dragging their handles', async ({ page }) => {
  await registerAndGoToRooms(page, 'Resizer');
  await createRoom(page, 'Resize Room');
  await page.waitForSelector('text=Connected');
  await page.waitForSelector('.monaco-editor', { state: 'visible' });

  const explorer = page.locator('.file-explorer');
  const sidebar = page.locator('.room-sidebar');
  const handles = page.locator('.resize-handle');
  await expect(handles).toHaveCount(2);

  const explorerBoxBefore = await explorer.boundingBox();
  const leftHandleBox = await handles.nth(0).boundingBox();
  await page.mouse.move(leftHandleBox.x + 2, leftHandleBox.y + leftHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(leftHandleBox.x + 120, leftHandleBox.y + leftHandleBox.height / 2, { steps: 10 });
  await page.mouse.up();
  const explorerBoxAfter = await explorer.boundingBox();
  expect(explorerBoxAfter.width).toBeGreaterThan(explorerBoxBefore.width + 80);

  const sidebarBoxBefore = await sidebar.boundingBox();
  const rightHandleBox = await handles.nth(1).boundingBox();
  await page.mouse.move(rightHandleBox.x + 2, rightHandleBox.y + rightHandleBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(rightHandleBox.x - 100, rightHandleBox.y + rightHandleBox.height / 2, { steps: 10 });
  await page.mouse.up();
  const sidebarBoxAfter = await sidebar.boundingBox();
  expect(sidebarBoxAfter.width).toBeGreaterThan(sidebarBoxBefore.width + 60);

  // persists across reload
  await page.reload();
  await page.waitForSelector('text=Connected');
  const explorerBoxReloaded = await page.locator('.file-explorer').boundingBox();
  expect(explorerBoxReloaded.width).toBeCloseTo(explorerBoxAfter.width, -1);
});
