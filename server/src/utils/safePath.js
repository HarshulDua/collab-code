const SAFE_PATH_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/;

function isSafeRelativePath(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 200) return false;
  if (!SAFE_PATH_RE.test(candidate)) return false;
  const segments = candidate.split('/');
  return segments.every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

module.exports = { isSafeRelativePath };
