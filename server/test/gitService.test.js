const mongoose = require('mongoose');
const gitService = require('../src/services/gitService');

function roomId() {
  return new mongoose.Types.ObjectId().toString();
}

const author = { authorName: 'Test User', authorEmail: 'test@example.com' };

describe('gitService', () => {
  it('commits a new file tree and reports no-op on a repeat commit with no changes', async () => {
    const id = roomId();
    const files = { 'main.py': 'print(1)\n' };

    const first = await gitService.commit({ roomId: id, branch: 'main', message: 'Initial', files, ...author });
    expect(first.hash).toBeTruthy();

    const second = await gitService.commit({ roomId: id, branch: 'main', message: 'No changes', files, ...author });
    expect(second.noChanges).toBe(true);
  });

  it('log returns commits newest first with the right message', async () => {
    const id = roomId();
    await gitService.commit({ roomId: id, branch: 'main', message: 'first', files: { 'a.py': '1' }, ...author });
    await gitService.commit({ roomId: id, branch: 'main', message: 'second', files: { 'a.py': '2' }, ...author });

    const commits = await gitService.log(id);
    expect(commits).toHaveLength(2);
    expect(commits[0].message).toBe('second');
    expect(commits[1].message).toBe('first');
  });

  it('log on a repo with no commits yet returns an empty array, not an error', async () => {
    const id = roomId();
    const commits = await gitService.log(id);
    expect(commits).toEqual([]);
  });

  it('getCommitTree reconstructs the exact file contents at a given commit', async () => {
    const id = roomId();
    const files = { 'main.py': 'print("v1")\n', 'utils/helper.py': 'def f(): pass\n' };
    const { hash } = await gitService.commit({ roomId: id, branch: 'main', message: 'v1', files, ...author });

    await gitService.commit({ roomId: id, branch: 'main', message: 'v2', files: { 'main.py': 'print("v2")\n' }, ...author });

    const tree = await gitService.getCommitTree(id, hash);
    expect(tree).toEqual(files);
  });

  it('getCommitTree also resolves a branch name directly, not just a commit hash', async () => {
    const id = roomId();
    const files = { 'a.py': 'x\n' };
    await gitService.commit({ roomId: id, branch: 'main', message: 'v1', files, ...author });

    const tree = await gitService.getCommitTree(id, 'main');
    expect(tree).toEqual(files);
  });

  it('show returns diff text containing the changed line', async () => {
    const id = roomId();
    await gitService.commit({ roomId: id, branch: 'main', message: 'v1', files: { 'a.py': 'x = 1\n' }, ...author });
    const { hash } = await gitService.commit({ roomId: id, branch: 'main', message: 'v2', files: { 'a.py': 'x = 2\n' }, ...author });

    const diff = await gitService.show(id, hash);
    expect(diff).toContain('x = 2');
  });

  it('creates a branch without disturbing the source branch, and lists both', async () => {
    const id = roomId();
    await gitService.commit({ roomId: id, branch: 'main', message: 'base', files: { 'a.py': 'base\n' }, ...author });

    const branchFiles = await gitService.createBranch(id, 'feature', 'main');
    expect(branchFiles).toEqual({ 'a.py': 'base\n' });

    const branches = await gitService.listBranches(id);
    expect(branches.all).toEqual(expect.arrayContaining(['main', 'feature']));

    // Committing independently to each branch shouldn't affect the other —
    // this is the core guarantee the per-room lock (§10.9) exists for.
    await gitService.commit({ roomId: id, branch: 'feature', message: 'feature edit', files: { 'a.py': 'edited on feature\n' }, ...author });
    expect(await gitService.getCommitTree(id, 'main')).toEqual({ 'a.py': 'base\n' });
    expect(await gitService.getCommitTree(id, 'feature')).toEqual({ 'a.py': 'edited on feature\n' });
  });

  it('commits to two different branches concurrently without corrupting either', async () => {
    const id = roomId();
    await gitService.commit({ roomId: id, branch: 'main', message: 'base', files: { 'a.py': 'base\n' }, ...author });
    await gitService.createBranch(id, 'feature', 'main');

    // Fired together, not awaited sequentially — this is exactly the
    // scenario two different users committing to two different branches
    // at the same moment produces, and it's what withRepoLock() (gitService.js)
    // exists to serialize safely against the one shared working directory.
    await Promise.all([
      gitService.commit({ roomId: id, branch: 'main', message: 'main edit', files: { 'a.py': 'main version\n' }, ...author }),
      gitService.commit({ roomId: id, branch: 'feature', message: 'feature edit', files: { 'a.py': 'feature version\n' }, ...author }),
    ]);

    expect(await gitService.getCommitTree(id, 'main')).toEqual({ 'a.py': 'main version\n' });
    expect(await gitService.getCommitTree(id, 'feature')).toEqual({ 'a.py': 'feature version\n' });
  });

  it('merges a clean branch into a target branch and returns the merged tree', async () => {
    const id = roomId();
    await gitService.commit({ roomId: id, branch: 'main', message: 'base', files: { 'a.py': 'base\n', 'b.py': 'unchanged\n' }, ...author });
    await gitService.createBranch(id, 'feature', 'main');
    await gitService.commit({
      roomId: id,
      branch: 'feature',
      message: 'feature change',
      files: { 'a.py': 'base\n', 'b.py': 'unchanged\n', 'c.py': 'new\n' },
      ...author,
    });

    const result = await gitService.merge({ roomId: id, from: 'feature', into: 'main', ...author });
    expect(result.conflicted).toBe(false);
    expect(result.files).toEqual({ 'a.py': 'base\n', 'b.py': 'unchanged\n', 'c.py': 'new\n' });
    expect(await gitService.getCommitTree(id, 'main')).toEqual(result.files);
  });

  it('reports a conflicting merge without leaving the repo half-merged', async () => {
    const id = roomId();
    await gitService.commit({ roomId: id, branch: 'main', message: 'base', files: { 'a.py': 'base\n' }, ...author });
    await gitService.createBranch(id, 'feature', 'main');
    await gitService.commit({ roomId: id, branch: 'feature', message: 'feature edit', files: { 'a.py': 'feature version\n' }, ...author });
    await gitService.commit({ roomId: id, branch: 'main', message: 'main edit', files: { 'a.py': 'main version\n' }, ...author });

    const result = await gitService.merge({ roomId: id, from: 'feature', into: 'main', ...author });
    expect(result.conflicted).toBe(true);
    expect(result.files).toContain('a.py');

    // Repo should be back to a clean, unmerged state — main's own content, not a conflict marker.
    expect(await gitService.getCommitTree(id, 'main')).toEqual({ 'a.py': 'main version\n' });
  });

  it('rejects a file path that attempts directory traversal', async () => {
    const id = roomId();
    await expect(
      gitService.commit({ roomId: id, branch: 'main', message: 'evil', files: { '../evil.py': 'x' }, ...author })
    ).rejects.toThrow(/unsafe file path/);
  });
});
