import { test, expect } from '@playwright/test';
import { registerAndGoToRooms, createRoom, joinRoomById, waitForEditorReady, editorText } from './helpers.js';

// Regression coverage for the concurrent-join seeding race: two clients that
// joined a brand-new room at the same time used to each create their own
// `main.py` Y.Text. Y.Map keeps exactly one, so the loser's editor stayed
// bound to an orphaned Y.Text — their edits merged into nothing and they
// stopped receiving anyone else's. The default file is now created once,
// server-side, before any join ack goes out.
test('two users joining the same new room both stay live — edits flow in both directions', async ({ browser }) => {
  test.setTimeout(60000);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    await registerAndGoToRooms(pageA, 'ConcA');
    const roomId = await createRoom(pageA, 'Concurrent Room');
    await waitForEditorReady(pageA);

    await registerAndGoToRooms(pageB, 'ConcB');
    await joinRoomById(pageB, roomId);
    await waitForEditorReady(pageB);
    await pageB.waitForTimeout(500);

    // The starter comment must appear exactly once, not once per client.
    const initial = await editorText(pageB);
    expect(initial.match(/Start typing/g)).toHaveLength(1);

    // A types -> B must see it.
    await pageA.click('.monaco-editor');
    await pageA.keyboard.press('Control+A');
    await pageA.keyboard.type('from_a = 1', { delay: 15 });
    await expect
      .poll(async () => (await editorText(pageB)).includes('from_a = 1'), { timeout: 10000 })
      .toBe(true);

    // B types -> A must see it. This is the direction that silently broke:
    // whichever client lost the Y.Text race could type forever with nobody
    // else ever seeing a character of it.
    await pageB.click('.monaco-editor');
    await pageB.keyboard.press('Control+End');
    await pageB.keyboard.type('\nfrom_b = 2', { delay: 15 });
    await expect
      .poll(async () => (await editorText(pageA)).includes('from_b = 2'), { timeout: 10000 })
      .toBe(true);

    // Both documents converge on identical content.
    const textA = await editorText(pageA);
    const textB = await editorText(pageB);
    expect(textA).toBe(textB);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('simultaneous edits at different positions both survive without duplicating content', async ({ browser }) => {
  test.setTimeout(60000);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();

  try {
    await registerAndGoToRooms(pageA, 'RaceA');
    const roomId = await createRoom(pageA, 'Race Room');
    await waitForEditorReady(pageA);

    await registerAndGoToRooms(pageB, 'RaceB');
    await joinRoomById(pageB, roomId);
    await waitForEditorReady(pageB);

    // Establish a known multi-line baseline from one side.
    await pageA.click('.monaco-editor');
    await pageA.keyboard.press('Control+A');
    await pageA.keyboard.type('ALPHA\nBETA\nGAMMA', { delay: 15 });
    await expect.poll(async () => (await editorText(pageB)).includes('GAMMA'), { timeout: 10000 }).toBe(true);

    // Park each caret on a different line, then type at the same moment.
    await pageA.locator('.view-line', { hasText: 'ALPHA' }).click({ position: { x: 2, y: 5 } });
    await pageA.keyboard.press('Home');
    await pageB.locator('.view-line', { hasText: 'GAMMA' }).click({ position: { x: 2, y: 5 } });
    await pageB.keyboard.press('Home');
    await pageB.waitForTimeout(400);

    await Promise.all([
      pageA.keyboard.type('AAA_', { delay: 10 }),
      pageB.keyboard.type('BBB_', { delay: 10 }),
    ]);

    await pageA.waitForTimeout(1500);

    const textA = await editorText(pageA);
    const textB = await editorText(pageB);

    // Converged, both edits present, and each landed on its own line — not
    // two whole copies of the document concatenated.
    expect(textA).toBe(textB);
    expect(textA).toContain('AAA_ALPHA');
    expect(textA).toContain('BBB_GAMMA');
    expect(textA.match(/ALPHA/g)).toHaveLength(1);
    expect(textA.match(/GAMMA/g)).toHaveLength(1);
    expect(textA.match(/BETA/g)).toHaveLength(1);
  } finally {
    await ctxA.close();
    await ctxB.close();
  }
});

test('a third user joining mid-session receives the current state and stays in sync', async ({ browser }) => {
  test.setTimeout(60000);

  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const ctxC = await browser.newContext();
  const pageA = await ctxA.newPage();
  const pageB = await ctxB.newPage();
  const pageC = await ctxC.newPage();

  try {
    await registerAndGoToRooms(pageA, 'ThirdA');
    const roomId = await createRoom(pageA, 'Third Party Room');
    await waitForEditorReady(pageA);

    await registerAndGoToRooms(pageB, 'ThirdB');
    await joinRoomById(pageB, roomId);
    await waitForEditorReady(pageB);

    await pageA.click('.monaco-editor');
    await pageA.keyboard.press('Control+A');
    await pageA.keyboard.type('established_before_c = True', { delay: 15 });
    await expect.poll(async () => (await editorText(pageB)).includes('established_before_c'), { timeout: 10000 }).toBe(true);

    // C joins late and must get the existing content, not a fresh default.
    // (waitForEditorReady can't be used here: it waits for the starter
    // comment, which this room's content has already replaced.)
    await registerAndGoToRooms(pageC, 'ThirdC');
    await joinRoomById(pageC, roomId);
    await pageC.waitForSelector('.monaco-editor', { state: 'visible' });
    await pageC.waitForSelector('text=Connected');
    await expect.poll(async () => (await editorText(pageC)).includes('established_before_c'), { timeout: 15000 }).toBe(true);

    // And C's own edits reach everyone already in the room.
    await pageC.click('.monaco-editor');
    await pageC.keyboard.press('Control+End');
    await pageC.keyboard.type('\nfrom_c = 3', { delay: 15 });
    await expect.poll(async () => (await editorText(pageA)).includes('from_c = 3'), { timeout: 10000 }).toBe(true);
    await expect.poll(async () => (await editorText(pageB)).includes('from_c = 3'), { timeout: 10000 }).toBe(true);
  } finally {
    await ctxA.close();
    await ctxB.close();
    await ctxC.close();
  }
});
