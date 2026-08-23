// Shared page-driving helpers. Each test that needs a logged-in user calls
// registerAndGoToRooms with a fresh, unique email — there's no per-test
// database reset (the e2e server points at a dedicated Mongo db, see
// playwright.config.js, but it isn't wiped between test files), so unique
// emails/room names are what keep tests independent of each other and of
// however many times the suite has run before.
let counter = 0;

export function uniqueEmail(label) {
  counter += 1;
  return `e2e-${label}-${Date.now()}-${counter}@example.com`;
}

export async function registerAndGoToRooms(page, name) {
  await page.goto('/register');
  await page.getByPlaceholder('Name').fill(name);
  await page.getByPlaceholder('Email').fill(uniqueEmail(name.toLowerCase().replace(/\s+/g, '')));
  await page.getByPlaceholder('Password (min 8 characters)').fill('password123');
  await page.getByRole('button', { name: 'Register' }).click();
  await page.waitForURL('**/rooms');
}

export async function createRoom(page, roomName) {
  await page.getByPlaceholder('New room name').fill(roomName);
  await page.getByRole('button', { name: 'Create room' }).click();
  await page.waitForURL(/\/rooms\/[a-f0-9]{24}/);
  return page.url().split('/rooms/')[1];
}

export async function joinRoomById(page, roomId) {
  await page.getByPlaceholder('Room ID to join').fill(roomId);
  await page.getByRole('button', { name: 'Join by ID' }).click();
  await page.waitForURL(`**/rooms/${roomId}`);
}

export async function waitForEditorReady(page) {
  await page.waitForSelector('.monaco-editor', { state: 'visible' });
  // MonacoBinding attaches once collab:join resolves — the header flips
  // from "Connecting…" to "Connected" at exactly that point.
  await page.waitForSelector('text=Connected');
  // "Connected" only means the socket/collab handshake finished — it does
  // NOT mean MonacoBinding has finished its own initial Yjs->Monaco sync
  // (CodeEditor.jsx's onMount fires once Monaco's own library has loaded,
  // asynchronously and separately). Typing before that sync completes is
  // a real race: a keystroke can land before the model's seeded starter
  // content arrives, then get pushed after it once the sync catches up,
  // producing "<placeholder><your text>" instead of a clean replace. This
  // waits for the model to actually contain the seeded starter comment
  // every new file gets (see lib/fileTree.js's DEFAULT_CONTENT) — the
  // reliable signal that the initial sync has actually landed.
  await waitForEditorText(page, (text) => text.includes('Start typing'), { timeout: 10000 });
}

export async function typeInEditor(page, text) {
  await page.click('.monaco-editor');
  await page.keyboard.type(text, { delay: 15 });
}

export async function waitForEditorText(page, predicate, { timeout = 10000, interval = 250 } = {}) {
  const deadline = Date.now() + timeout;
  let last = '';
  while (Date.now() < deadline) {
    last = await editorText(page);
    if (predicate(last)) return last;
    // eslint-disable-next-line no-await-in-loop
    await page.waitForTimeout(interval);
  }
  throw new Error(`editor text never matched predicate within ${timeout}ms — last value: ${JSON.stringify(last)}`);
}

export async function editorText(page) {
  // textContent, not innerText: Monaco renders each token as its own
  // inline span, and innerText's CSS-aware whitespace handling inserts
  // spurious spaces between adjacent spans that aren't actually in the
  // document — textContent just concatenates the raw text nodes.
  // Monaco also renders plain spaces as U+00A0 (non-breaking space) in the
  // DOM to stop the browser from collapsing them — normalize back to a
  // regular space, or a string like "hello e2e" (typed with an ordinary
  // space) never matches what comes back from the DOM even though the
  // underlying Yjs document content is correct.
  const raw = await page.locator('.view-lines').textContent();
  return raw.split(String.fromCharCode(160)).join(String.fromCharCode(32));
}
