const EXTENSION_LANGUAGE_MAP = {
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
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'scss',
  json: 'json',
  yml: 'yaml',
  yaml: 'yaml',
  md: 'markdown',
};

const MONACO_LANGUAGE_MAP = {
  python: 'python',
  javascript: 'javascript',
  typescript: 'typescript',
  c: 'c',
  cpp: 'cpp',
  go: 'go',
  rust: 'rust',
  java: 'java',
  csharp: 'csharp',
  html: 'html',
  css: 'css',
  scss: 'scss',
  json: 'json',
  yaml: 'yaml',
  markdown: 'markdown',
};

const RUNNABLE_LANGUAGES = new Set(['python', 'javascript', 'typescript', 'c', 'cpp', 'go', 'rust', 'java', 'csharp']);

function extensionOf(filePath) {
  const base = filePath.split('/').pop() || '';
  const dot = base.lastIndexOf('.');
  return dot === -1 ? '' : base.slice(dot + 1).toLowerCase();
}

export function languageForPath(filePath) {
  return EXTENSION_LANGUAGE_MAP[extensionOf(filePath)] || null;
}

export function monacoLanguageForPath(filePath) {
  const language = languageForPath(filePath);
  return (language && MONACO_LANGUAGE_MAP[language]) || 'plaintext';
}

export function isRunnable(filePath) {
  const language = languageForPath(filePath);
  return language !== null && RUNNABLE_LANGUAGES.has(language);
}
