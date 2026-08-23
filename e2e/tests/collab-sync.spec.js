import { test } from '@playwright/test';
import { registerAndGoToRooms, createRoom, joinRoomById, waitForEditorReady, typeInEditor, waitForEditorText } from './helpers.js';

// The real end-to-end proof that YjsSocketProvider.js (client/src/components/CodeEditor)
// actually works: two different users, two different browser contexts (so
// two different sockets, two different Y.Doc replicas), typing in one tab
// must converge in the other — the same property server/test/collabSync.test.js
// and load-tests/node/room-fanout.js prove at the protocol level, proven
// here through the real UI.
test('typing in one tab is reflected in a second tab in the same room', async ({ browser }) => {
  const ctxA = await browser.newContext();
  const pageA = await ctxA.newPage();
  await registerAndGoToRooms(pageA, 'Typist');
  const roomId = await createRoom(pageA, 'Collab sync room');
  await waitForEditorReady(pageA);

  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  await registerAndGoToRooms(pageB, 'Watcher');
  await joinRoomById(pageB, roomId);
  await waitForEditorReady(pageB);

  await typeInEditor(pageA, "print('hello e2e')");

  await waitForEditorText(pageB, (text) => text.includes("print('hello e2e')"), { timeout: 10000 });

  await ctxA.close();
  await ctxB.close();
});
