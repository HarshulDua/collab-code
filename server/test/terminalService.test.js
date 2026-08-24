const terminalService = require('../src/services/terminalService');

jest.mock('../src/services/executionService', () => ({
  executeCode: jest.fn(),
}));
jest.mock('../src/services/gitService', () => ({
  getCommitTree: jest.fn(),
  log: jest.fn(),
  show: jest.fn(),
  listBranches: jest.fn(),
  createBranch: jest.fn(),
  branchExists: jest.fn(),
  commit: jest.fn(),
  merge: jest.fn(),
}));

const { executeCode } = require('../src/services/executionService');
const gitService = require('../src/services/gitService');

const user = { id: 'u1', name: 'Tester', email: 't@example.com' };

function baseFiles() {
  return {
    'main.py': 'print("hi")\n',
    'README.md': '# project\n',
    'utils/helper.py': 'def h(): pass\n',
    'utils/deep/inner.py': 'x = 1\n',
  };
}

function run(command, { files = baseFiles(), cwd = '' } = {}) {
  return terminalService.execute({ command, cwd, files, roomId: 'r1', branch: 'main', user });
}

beforeEach(() => jest.clearAllMocks());

describe('tokenizer', () => {
  it('keeps quoted arguments together', () => {
    expect(terminalService.tokenize('git commit -m "a real message"')).toEqual([
      'git', 'commit', '-m', 'a real message',
    ]);
  });

  it('supports single quotes and empty quoted strings', () => {
    expect(terminalService.tokenize("echo 'hello world' ''")).toEqual(['echo', 'hello world', '']);
  });
});

describe('navigation', () => {
  it('pwd reports the root as /', async () => {
    expect((await run('pwd')).output).toBe('/');
  });

  it('ls shows directories before files, with a trailing slash', async () => {
    const { output } = await run('ls');
    expect(output.split('\n')).toEqual(['utils/', 'README.md', 'main.py']);
  });

  it('cd descends and pwd reflects it', async () => {
    const cd = await run('cd utils');
    expect(cd.cwd).toBe('utils');
    const pwd = await run('pwd', { cwd: cd.cwd });
    expect(pwd.output).toBe('/utils');
  });

  it('ls is relative to the current directory', async () => {
    const { output } = await run('ls', { cwd: 'utils' });
    expect(output.split('\n')).toEqual(['deep/', 'helper.py']);
  });

  it('cd .. climbs back up', async () => {
    expect((await run('cd ..', { cwd: 'utils/deep' })).cwd).toBe('utils');
  });

  it('cd .. can never escape the project root', async () => {
    expect((await run('cd ../../..', { cwd: 'utils' })).cwd).toBe('');
  });

  it('cd into a missing directory fails without changing cwd', async () => {
    const res = await run('cd nope');
    expect(res.exitCode).toBe(1);
    expect(res.output).toMatch(/no such directory/);
    expect(res.cwd).toBe('');
  });
});

describe('reading files', () => {
  it('cat prints file contents', async () => {
    expect((await run('cat main.py')).output).toBe('print("hi")\n');
  });

  it('cat resolves relative to cwd', async () => {
    expect((await run('cat helper.py', { cwd: 'utils' })).output).toContain('def h()');
  });

  it('cat on a missing file is a clean error', async () => {
    const res = await run('cat ghost.py');
    expect(res.exitCode).toBe(1);
    expect(res.output).toMatch(/no such file/);
    expect(res.files).toBeUndefined();
  });
});

describe('mutating the project tree', () => {
  it('touch creates an empty file', async () => {
    const res = await run('touch new.py');
    expect(res.files['new.py']).toBe('');
  });

  it('touch on an existing file changes nothing', async () => {
    const res = await run('touch main.py');
    expect(res.files).toBeUndefined();
    expect(res.exitCode).toBe(0);
  });

  it('mkdir creates a directory via a .gitkeep placeholder', async () => {
    const res = await run('mkdir src');
    expect(res.files['src/.gitkeep']).toBe('');
    const ls = await run('ls', { files: res.files });
    expect(ls.output).toContain('src/');
  });

  it('mkdir refuses to clobber an existing directory', async () => {
    const res = await run('mkdir utils');
    expect(res.exitCode).toBe(1);
    expect(res.files).toBeUndefined();
  });

  it('nested mkdir then touch works', async () => {
    const mk = await run('mkdir a/b');
    const touched = await run('touch a/b/c.py', { files: mk.files });
    expect(touched.files['a/b/c.py']).toBe('');
  });

  it('rm deletes a file', async () => {
    const res = await run('rm README.md');
    expect('README.md' in res.files).toBe(false);
    expect('main.py' in res.files).toBe(true);
  });

  it('rm refuses a directory without -r', async () => {
    const res = await run('rm utils');
    expect(res.exitCode).toBe(1);
    expect(res.output).toMatch(/is a directory/);
  });

  it('rm -r removes a directory and everything under it', async () => {
    const res = await run('rm -r utils');
    expect(Object.keys(res.files)).toEqual(expect.arrayContaining(['main.py', 'README.md']));
    expect(Object.keys(res.files).some((p) => p.startsWith('utils/'))).toBe(false);
  });

  it('refuses to remove the last remaining file', async () => {
    const res = await run('rm only.py', { files: { 'only.py': 'x' } });
    expect(res.exitCode).toBe(1);
    expect(res.output).toMatch(/last file/);
  });

  it('mv renames a file, preserving content', async () => {
    const res = await run('mv main.py renamed.py');
    expect(res.files['renamed.py']).toBe('print("hi")\n');
    expect('main.py' in res.files).toBe(false);
  });

  it('mv into a directory keeps the basename', async () => {
    const res = await run('mv main.py utils');
    expect(res.files['utils/main.py']).toBe('print("hi")\n');
  });

  it('cp copies without removing the source', async () => {
    const res = await run('cp main.py copy.py');
    expect(res.files['copy.py']).toBe('print("hi")\n');
    expect(res.files['main.py']).toBe('print("hi")\n');
  });

  it('refuses to overwrite an existing destination', async () => {
    const res = await run('cp main.py README.md');
    expect(res.exitCode).toBe(1);
    expect(res.files).toBeUndefined();
  });

  it('echo without redirection just prints', async () => {
    const res = await run('echo hello world');
    expect(res.output).toBe('hello world');
    expect(res.files).toBeUndefined();
  });

  it('echo > writes a file, echo >> appends', async () => {
    const written = await run('echo first > notes.txt');
    expect(written.files['notes.txt']).toBe('first\n');
    const appended = await run('echo second >> notes.txt', { files: written.files });
    expect(appended.files['notes.txt']).toBe('first\nsecond\n');
  });
});

describe('path safety', () => {
  it.each([
    'touch ../escape.py',
    'cat ../../etc/passwd',
    'mkdir ../../evil',
  ])('%s cannot escape the project root', async (command) => {
    const res = await run(command);
    // Either rejected outright, or normalized back inside the root — never a
    // path containing '..' reaching the filesystem layer.
    if (res.files) {
      Object.keys(res.files).forEach((p) => expect(p).not.toContain('..'));
    } else {
      expect(res.exitCode).toBe(1);
    }
  });

  it('rejects shell metacharacters in filenames', async () => {
    const res = await run('touch "evil;rm -rf /.py"');
    expect(res.exitCode).toBe(1);
    expect(res.output).toMatch(/invalid path/);
  });
});

describe('running code', () => {
  it('run infers the language from the extension', async () => {
    executeCode.mockResolvedValue({ stdout: 'hi\n', stderr: '', exitCode: 0, timedOut: false, durationMs: 12 });
    const res = await run('run main.py');
    expect(executeCode).toHaveBeenCalledWith(expect.objectContaining({ language: 'python', entryPath: 'main.py' }));
    expect(res.output).toContain('hi');
    expect(res.output).toContain('[exit 0');
  });

  it('language-native aliases map onto the right runner', async () => {
    executeCode.mockResolvedValue({ stdout: '', stderr: '', exitCode: 0, timedOut: false, durationMs: 5 });
    await run('python main.py');
    expect(executeCode).toHaveBeenCalledWith(expect.objectContaining({ language: 'python' }));

    await run('go run main.go', { files: { 'main.go': 'package main' } });
    expect(executeCode).toHaveBeenLastCalledWith(expect.objectContaining({ language: 'go', entryPath: 'main.go' }));
  });

  it('surfaces stderr and a non-zero exit code', async () => {
    executeCode.mockResolvedValue({ stdout: '', stderr: 'Traceback...', exitCode: 1, timedOut: false, durationMs: 9 });
    const res = await run('run main.py');
    expect(res.output).toContain('Traceback');
    expect(res.exitCode).toBe(1);
  });

  it('reports a timeout distinctly', async () => {
    executeCode.mockResolvedValue({ stdout: '', stderr: '', exitCode: null, timedOut: true, durationMs: 8000 });
    const res = await run('run main.py');
    expect(res.output).toMatch(/timed out/);
  });

  it('refuses to run a file type with no runner', async () => {
    const res = await run('run README.md');
    expect(res.exitCode).toBe(1);
    expect(executeCode).not.toHaveBeenCalled();
  });

  it('run on a missing file does not reach the sandbox', async () => {
    const res = await run('run ghost.py');
    expect(res.exitCode).toBe(1);
    expect(executeCode).not.toHaveBeenCalled();
  });
});

describe('git commands', () => {
  it('status reports a clean tree when live files match the commit', async () => {
    gitService.getCommitTree.mockResolvedValue(baseFiles());
    const res = await run('git status');
    expect(res.output).toContain('nothing to commit');
  });

  it('status classifies modified, new, and deleted files', async () => {
    gitService.getCommitTree.mockResolvedValue({
      'main.py': 'OLD\n',
      'gone.py': 'x',
      'README.md': '# project\n',
      'utils/helper.py': 'def h(): pass\n',
      'utils/deep/inner.py': 'x = 1\n',
    });
    const res = await run('git status');
    expect(res.output).toContain('modified:   main.py');
    expect(res.output).toContain('deleted:    gone.py');
  });

  it('commit requires a message', async () => {
    const res = await run('git commit');
    expect(res.exitCode).toBe(1);
    expect(gitService.commit).not.toHaveBeenCalled();
  });

  it('commit passes the live tree and quoted message through', async () => {
    gitService.commit.mockResolvedValue({ hash: 'abcdef1234', message: 'my message' });
    const res = await run('git commit -m "my message"');
    expect(gitService.commit).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'my message', branch: 'main', files: baseFiles() })
    );
    expect(res.output).toContain('abcdef1');
    expect(res.refreshGit).toBe(true);
  });

  it('reports an empty commit rather than failing', async () => {
    gitService.commit.mockResolvedValue({ noChanges: true });
    expect((await run('git commit -m "nothing"')).output).toContain('nothing to commit');
  });

  it('log renders one line per commit', async () => {
    gitService.log.mockResolvedValue([
      { hash: 'aaaaaaa1111', message: 'second', authorName: 'Tester', date: '' },
      { hash: 'bbbbbbb2222', message: 'first', authorName: 'Tester', date: '' },
    ]);
    const res = await run('git log');
    expect(res.output.split('\n')).toHaveLength(2);
    expect(res.output).toContain('second');
  });

  it('branch with no argument marks the current branch', async () => {
    gitService.listBranches.mockResolvedValue({ all: ['main', 'feature'] });
    const res = await run('git branch');
    expect(res.output).toContain('* main');
    expect(res.output).toContain('  feature');
  });

  it('checkout -b creates and asks the client to switch', async () => {
    gitService.createBranch.mockResolvedValue({});
    const res = await run('git checkout -b feature');
    expect(gitService.createBranch).toHaveBeenCalledWith('r1', 'feature', 'main');
    expect(res.switchBranch).toBe('feature');
  });

  it('checkout of a missing branch fails without switching', async () => {
    gitService.branchExists.mockResolvedValue(false);
    const res = await run('git checkout ghost');
    expect(res.exitCode).toBe(1);
    expect(res.switchBranch).toBeUndefined();
  });

  it('merge reports a conflict without changing files', async () => {
    gitService.merge.mockResolvedValue({ conflicted: true, files: ['main.py'] });
    const res = await run('git merge feature');
    expect(res.exitCode).toBe(1);
    expect(res.output).toContain('merge conflict');
    expect(res.files).toBeUndefined();
  });

  it('a successful merge returns the merged tree', async () => {
    gitService.merge.mockResolvedValue({ conflicted: false, files: { 'main.py': 'merged\n' } });
    const res = await run('git merge feature');
    expect(res.files).toEqual({ 'main.py': 'merged\n' });
    expect(res.refreshGit).toBe(true);
  });

  it('explains that git add is unnecessary rather than failing silently', async () => {
    expect((await run('git add .')).output).toMatch(/no staging area/i);
  });

  it('rejects unsupported git verbs with a helpful list', async () => {
    const res = await run('git rebase -i HEAD~3');
    expect(res.exitCode).toBe(1);
    expect(res.output).toContain('not supported');
  });
});

describe('unknown and empty input', () => {
  it('an empty line is a no-op', async () => {
    const res = await run('   ');
    expect(res.output).toBe('');
    expect(res.exitCode).toBe(0);
  });

  it('an unknown command returns 127 and points at help', async () => {
    const res = await run('sudo rm -rf /');
    expect(res.exitCode).toBe(127);
    expect(res.output).toMatch(/command not found/);
  });

  it('help lists the supported commands', async () => {
    const res = await run('help');
    expect(res.output).toContain('git commit');
    expect(res.output).toContain('mkdir');
  });
});
