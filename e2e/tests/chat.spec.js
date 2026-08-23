import { test, expect } from '@playwright/test';
import { registerAndGoToRooms, createRoom, joinRoomById, waitForEditorReady } from './helpers.js';

test('a chat message sent in one tab is received in another', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await registerAndGoToRooms(pageA, 'Sender');
  const roomId = await createRoom(pageA, 'Chat room');
  await waitForEditorReady(pageA);

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await registerAndGoToRooms(pageB, 'Receiver');
  await joinRoomById(pageB, roomId);
  await waitForEditorReady(pageB);

  await pageA.getByPlaceholder('Message the room…').fill('hello from e2e');
  await pageA.getByRole('button', { name: 'Send' }).click();

  await expect(pageB.locator('.chat-message', { hasText: 'hello from e2e' })).toBeVisible({ timeout: 10000 });
  // Sender sees its own message too — the server broadcasts to the whole room including the sender.
  await expect(pageA.locator('.chat-message', { hasText: 'hello from e2e' })).toBeVisible();

  await ctxA.close();
  await ctxB.close();
});
