import { test, expect } from '@playwright/test';
import { registerAndGoToRooms, createRoom } from './helpers.js';

// Regression test for a real bug reported from live usage: the room ID
// was never shown anywhere in the app (only visible in the URL bar, easy
// to select incompletely by hand — which is exactly what happened), and a
// failed join request produced literally no visible feedback, so it just
// looked like the button did nothing.
test('the room ID is visible/copyable in-room, and a bad join ID shows a visible error', async ({ page }) => {
  await registerAndGoToRooms(page, 'IdTester');
  const roomId = await createRoom(page, 'Room ID test');

  await expect(page.locator('.room-id-badge code')).toHaveText(roomId);

  await page.goto('/rooms');
  await page.getByPlaceholder('Room ID to join').fill('not-a-real-room-id');
  await page.getByRole('button', { name: 'Join by ID' }).click();

  await expect(page.locator('.error-text')).toBeVisible({ timeout: 10000 });
});
