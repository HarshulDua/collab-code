import { test, expect } from '@playwright/test';
import { registerAndGoToRooms, createRoom, waitForEditorReady, uniqueEmail } from './helpers.js';

test('admin dashboard shows a live room and its connected user, and is hidden from a non-admin', async ({ page, browser }) => {
  test.setTimeout(45000);

  const roomName = `Admin-visible room ${uniqueEmail('room')}`;
  await registerAndGoToRooms(page, 'RegularUser');
  await createRoom(page, roomName);
  await waitForEditorReady(page);

  const nonAdminCheckContext = await browser.newContext();
  try {
    const nonAdminPage = await nonAdminCheckContext.newPage();
    await registerAndGoToRooms(nonAdminPage, 'NotAdmin');
    await nonAdminPage.goto('/admin');
    await expect(nonAdminPage.locator('.error-text')).toBeVisible();
  } finally {
    await nonAdminCheckContext.close();
  }

  const adminContext = await browser.newContext();
  try {
    const adminPage = await adminContext.newPage();
    await adminPage.goto('/register');
    await adminPage.getByPlaceholder('Name').fill('E2E Admin');
    await adminPage.getByPlaceholder('Email').fill('e2e-admin@example.com');
    await adminPage.getByPlaceholder('Password (min 8 characters)').fill('password123');
    await adminPage.getByRole('button', { name: 'Register' }).click();
    try {
      await adminPage.waitForURL('**/rooms', { timeout: 5000 });
    } catch {
      await adminPage.goto('/login');
      await adminPage.getByPlaceholder('Email').fill('e2e-admin@example.com');
      await adminPage.getByPlaceholder('Password').fill('password123');
      await adminPage.getByRole('button', { name: 'Log in' }).click();
      await adminPage.waitForURL('**/rooms');
    }

    await adminPage.goto('/admin');
    await expect(adminPage.getByText(roomName)).toBeVisible({ timeout: 10000 });
    await adminPage.getByText(roomName).click();
    await expect(adminPage.getByText(/socket /)).toBeVisible({ timeout: 10000 });
  } finally {
    await adminContext.close();
  }
});
