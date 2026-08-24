import * as Y from 'yjs';

const DEFAULT_FILE = 'main.py';
const DEFAULT_CONTENT = '# Start typing Python here.\n';

export function getFilesMap(doc) {
  return doc.getMap('files');
}

// The server seeds the default file authoritatively before sending any join
// ack (see server/src/sockets/collabStore.js), so this is only a fallback for
// a doc that somehow arrives empty. It deliberately does NOT overwrite an
// existing entry: replacing a Y.Text that another client is already bound to
// orphans their editor, and their edits then merge into nothing.
export function ensureDefaultFile(filesMap) {
  const paths = listFilePaths(filesMap);
  if (paths.length > 0) {
    return paths.includes(DEFAULT_FILE) ? DEFAULT_FILE : paths[0];
  }
  filesMap.set(DEFAULT_FILE, new Y.Text(DEFAULT_CONTENT));
  return DEFAULT_FILE;
}

export function listFilePaths(filesMap) {
  return Array.from(filesMap.keys()).sort();
}

const SAFE_PATH_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_./-]*$/;

export function isValidFilePath(candidate) {
  if (typeof candidate !== 'string' || candidate.length === 0 || candidate.length > 200) return false;
  if (!SAFE_PATH_RE.test(candidate)) return false;
  return candidate.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..');
}

export function createFile(filesMap, filePath) {
  if (!isValidFilePath(filePath)) throw new Error('Invalid file path — use letters, numbers, "_-./" only, no ".."');
  if (filesMap.has(filePath)) throw new Error('A file with that path already exists');
  filesMap.set(filePath, new Y.Text());
}

export function deleteFile(filesMap, filePath) {
  if (filesMap.size <= 1) throw new Error('A project needs at least one file');
  filesMap.delete(filePath);
}

export function renameFile(filesMap, oldPath, newPath) {
  if (!filesMap.has(oldPath)) throw new Error(`No such file: ${oldPath}`);
  if (!isValidFilePath(newPath)) throw new Error('Invalid file path — use letters, numbers, "_-./" only, no ".."');
  if (newPath === oldPath) return;
  if (filesMap.has(newPath)) throw new Error('A file with that path already exists');
  const content = filesMap.get(oldPath).toString();
  filesMap.set(newPath, new Y.Text(content));
  filesMap.delete(oldPath);
}

export function buildTree(paths) {
  const root = { folders: {}, files: [] };
  for (const filePath of paths) {
    const parts = filePath.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      const folder = parts[i];
      if (!node.folders[folder]) node.folders[folder] = { folders: {}, files: [] };
      node = node.folders[folder];
    }
    node.files.push(filePath);
  }
  return root;
}
