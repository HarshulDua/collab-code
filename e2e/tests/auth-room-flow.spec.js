import { test, expect } from '@playwright/test';
import { registerAndGoToRooms, createRoom, joinRoomById } from './helpers.js';

test('register, create a room, and a second user joins by ID', async ({ browser }) => {
  const ownerCtx = await browser.newContext();
  const ownerPage = await ownerCtx.newPage();
  await registerAndGoToRooms(ownerPage, 'Owner');

  const roomId = await createRoom(ownerPage, 'Auth flow room');
  expect(roomId).toMatch(/^[a-f0-9]{24}$/);
  await expect(ownerPage.getByText('Connecting…').or(ownerPage.getByText('Connected'))).toBeVisible();

  const guestCtx = await browser.newContext();
  const guestPage = await guestCtx.newPage();
  await registerAndGoToRooms(guestPage, 'Guest');
  await joinRoomById(guestPage, roomId);

  expect(guestPage.url()).toContain(`/rooms/${roomId}`);

  await ownerCtx.close();
  await guestCtx.close();
});
