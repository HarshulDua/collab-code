const { isSafeRelativePath } = require('../src/utils/safePath');

describe('isSafeRelativePath', () => {
  it('accepts ordinary relative paths, including nested ones', () => {
    expect(isSafeRelativePath('main.py')).toBe(true);
    expect(isSafeRelativePath('utils/helper.py')).toBe(true);
    expect(isSafeRelativePath('a/b/c/d.py')).toBe(true);
    expect(isSafeRelativePath('file-name_v2.py')).toBe(true);
  });

  it('rejects directory traversal in any position', () => {
    expect(isSafeRelativePath('../evil.py')).toBe(false);
    expect(isSafeRelativePath('a/../../evil.py')).toBe(false);
    expect(isSafeRelativePath('a/..')).toBe(false);
    expect(isSafeRelativePath('..')).toBe(false);
  });

  it('rejects absolute paths', () => {
    expect(isSafeRelativePath('/etc/passwd')).toBe(false);
  });

  it('rejects empty or malformed segments', () => {
    expect(isSafeRelativePath('')).toBe(false);
    expect(isSafeRelativePath('a//b')).toBe(false);
    expect(isSafeRelativePath('./a')).toBe(false);
    expect(isSafeRelativePath('a/./b')).toBe(false);
  });

  it('rejects shell metacharacters and whitespace', () => {
    expect(isSafeRelativePath('main.py; rm -rf /')).toBe(false);
    expect(isSafeRelativePath('$(whoami).py')).toBe(false);
    expect(isSafeRelativePath('`whoami`.py')).toBe(false);
    expect(isSafeRelativePath('main.py | cat')).toBe(false);
    expect(isSafeRelativePath('main.py && echo hi')).toBe(false);
    expect(isSafeRelativePath('"main".py')).toBe(false);
    expect(isSafeRelativePath('a b.py')).toBe(false);
  });

  it('rejects non-strings and absurdly long paths', () => {
    expect(isSafeRelativePath(null)).toBe(false);
    expect(isSafeRelativePath(undefined)).toBe(false);
    expect(isSafeRelativePath(42)).toBe(false);
    expect(isSafeRelativePath('a'.repeat(500))).toBe(false);
  });
});
