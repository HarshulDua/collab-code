const Y = require('yjs');
const Room = require('../src/models/Room');
const User = require('../src/models/User');
const { getOrCreateRoomState, disposeIfEmpty } = require('../src/sockets/collabStore');

async function makeRoom() {
  const user = await User.create({ name: 'Store', email: `store-${Date.now()}@example.com`, passwordHash: 'x' });
  return Room.create({ name: 'Store room', owner: user._id, members: [user._id] });
}

describe('collabStore snapshot durability', () => {
  it('flushes pending edits when the last client leaves instead of discarding them', async () => {
    const room = await makeRoom();
    const roomId = room._id.toString();

    const state = await getOrCreateRoomState(roomId, 'main');
    state.doc.getMap('files').set('main.py', new Y.Text('work that must survive\n'));

    // The last client leaves well inside SNAPSHOT_DEBOUNCE_MS. The pending
    // snapshot timer used to just be cleared here, silently throwing away
    // every edit made in the final seconds of a session.
    disposeIfEmpty(roomId, 'main');
    await new Promise((r) => setTimeout(r, 300));

    const saved = await Room.findById(roomId).select('ydocSnapshots');
    expect(saved.ydocSnapshots.get('main')?.length).toBeGreaterThan(0);

    const reopened = await getOrCreateRoomState(roomId, 'main');
    expect(reopened.doc.getMap('files').get('main.py').toString()).toContain('work that must survive');

    disposeIfEmpty(roomId, 'main');
  }, 20000);
});

// Documents the Yjs hazard that made live collaboration silently break for
// one user: two clients creating the same file path concurrently each build
// their own Y.Text, and Y.Map keeps exactly one. Whoever loses is left
// holding a detached Y.Text — every keystroke they type merges into nothing
// and no remote edit ever reaches them. The editor now watches the files map
// and re-binds when the instance at its path is replaced
// (client/src/components/CodeEditor/CodeEditor.jsx); this test pins the
// underlying CRDT behaviour that fix exists to absorb.
describe('concurrent creation of the same file path', () => {
  it('keeps exactly one Y.Text and orphans the loser, so the editor must re-bind', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const textA = new Y.Text('from A\n');
    const textB = new Y.Text('from B\n');
    docA.getMap('files').set('main.py', textA);
    docB.getMap('files').set('main.py', textB);

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    const winnerA = docA.getMap('files').get('main.py');
    const winnerB = docB.getMap('files').get('main.py');

    // Both peers agree on the same surviving content — no duplicated file,
    // no two copies of the content concatenated.
    expect(winnerA.toString()).toBe(winnerB.toString());

    // ...but exactly one side is still holding the instance it created.
    const orphanedSomeone = winnerA !== textA || winnerB !== textB;
    expect(orphanedSomeone).toBe(true);

    // Writing to the orphan is silently lost — this is the failure mode the
    // client-side re-bind exists to prevent.
    const orphan = winnerA === textA ? textB : textA;
    orphan.insert(orphan.length, 'lost edit');
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    expect(docA.getMap('files').get('main.py').toString()).not.toContain('lost edit');
  });

  it('propagates edits normally once both clients hold the same instance', () => {
    // The healthy path: everyone joins an existing doc rather than racing to
    // create it, so both bind to the same Y.Text and concurrent edits at
    // different offsets both survive.
    const server = new Y.Doc();
    server.getMap('files').set('main.py', new Y.Text('ALPHA\nBETA\n'));
    const joinAck = Y.encodeStateAsUpdate(server);

    const docA = new Y.Doc();
    const docB = new Y.Doc();
    Y.applyUpdate(docA, joinAck, 'remote');
    Y.applyUpdate(docB, joinAck, 'remote');

    const textA = docA.getMap('files').get('main.py');
    const textB = docB.getMap('files').get('main.py');

    textA.insert(0, 'A_');
    textB.insert(textB.length, 'B_');

    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));

    const finalA = docA.getMap('files').get('main.py').toString();
    const finalB = docB.getMap('files').get('main.py').toString();

    expect(finalA).toBe(finalB);
    expect(finalA).toContain('A_');
    expect(finalA).toContain('B_');
    expect(finalA.match(/ALPHA/g)).toHaveLength(1);
    expect(docA.getMap('files').get('main.py')).toBe(textA);
    expect(docB.getMap('files').get('main.py')).toBe(textB);
  });
});
