// Server-side mirror of the client's lib/languages.js extension map. Kept
// separate rather than shared because the client bundles Monaco mode names
// alongside it and the server only ever needs the runner id.
const EXTENSION_LANGUAGE = {
  py: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  jsx: 'javascript',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  go: 'go',
  rs: 'rust',
  java: 'java',
  cs: 'csharp',
};

function extensionOf(filePath) {
  const base = filePath.split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase();
}

function languageForPath(filePath) {
  return EXTENSION_LANGUAGE[extensionOf(filePath)] || null;
}

module.exports = { languageForPath, extensionOf };
