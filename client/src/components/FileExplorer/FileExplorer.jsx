import { useState } from 'react';
import { useFileList } from '../../hooks/useFileList';
import { buildTree, createFile, deleteFile, renameFile } from '../../lib/fileTree';
import { PresenceList } from '../Presence/PresenceList';
import { useAwarenessStates } from '../../hooks/useAwarenessStates';

export function FileExplorer({ filesMap, activeFile, onSelectFile, awareness, style }) {
  const paths = useFileList(filesMap);
  const [error, setError] = useState(null);
  const tree = buildTree(paths);
  const people = useAwarenessStates(awareness);

  // path -> the other people currently editing it, so the tree can show at a
  // glance who is where without opening each file.
  const editorsByFile = {};
  people.forEach((person) => {
    if (person.isSelf || !person.activeFile) return;
    (editorsByFile[person.activeFile] ||= []).push(person);
  });

  function handleNewFile() {
    const filePath = window.prompt('New file path (e.g. main.py or utils/helper.py):');
    if (!filePath) return;
    try {
      createFile(filesMap, filePath.trim());
      setError(null);
      onSelectFile(filePath.trim());
    } catch (err) {
      setError(err.message);
    }
  }

  function handleDelete(filePath, e) {
    e.stopPropagation();
    if (!window.confirm(`Delete ${filePath}?`)) return;
    try {
      deleteFile(filesMap, filePath);
      setError(null);
      if (filePath === activeFile) {
        const remaining = paths.filter((p) => p !== filePath);
        if (remaining[0]) onSelectFile(remaining[0]);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  function handleRename(filePath, e) {
    e.stopPropagation();
    const newPath = window.prompt('Rename to:', filePath);
    if (!newPath || newPath.trim() === filePath) return;
    try {
      renameFile(filesMap, filePath, newPath.trim());
      setError(null);
      if (filePath === activeFile) onSelectFile(newPath.trim());
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <div className="file-explorer" style={style}>
      <div className="file-explorer-header">
        <span>Files</span>
        <button onClick={handleNewFile} title="New file">
          +
        </button>
      </div>
      {error && <div className="error-text file-explorer-error">{error}</div>}
      <PresenceList awareness={awareness} onSelectFile={onSelectFile} />
      <div className="file-tree">
        <TreeNode
          node={tree}
          pathPrefix=""
          activeFile={activeFile}
          onSelectFile={onSelectFile}
          onDelete={handleDelete}
          onRename={handleRename}
          editorsByFile={editorsByFile}
        />
      </div>
    </div>
  );
}

function TreeNode({ node, pathPrefix, activeFile, onSelectFile, onDelete, onRename, editorsByFile }) {
  return (
    <>
      {Object.entries(node.folders)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([folderName, child]) => (
          <div key={folderName} className="file-tree-folder">
            <div className="file-tree-folder-label">{folderName}/</div>
            <div className="file-tree-indent">
              <TreeNode
                node={child}
                pathPrefix={`${pathPrefix}${folderName}/`}
                activeFile={activeFile}
                onSelectFile={onSelectFile}
                onDelete={onDelete}
                onRename={onRename}
                editorsByFile={editorsByFile}
              />
            </div>
          </div>
        ))}
      {node.files
        .slice()
        .sort()
        .map((filePath) => {
          const editors = editorsByFile?.[filePath] || [];
          return (
            <div
              key={filePath}
              className={`file-tree-file ${filePath === activeFile ? 'file-tree-file-active' : ''}`}
              onClick={() => onSelectFile(filePath)}
              title={editors.length > 0 ? `Also being edited by ${editors.map((p) => p.user.name).join(', ')}` : filePath}
            >
              <span className="file-tree-name">{filePath.split('/').pop()}</span>
              {editors.length > 0 && (
                <span className="file-tree-editors">
                  {editors.slice(0, 3).map((p) => (
                    <span key={p.clientID} className="file-tree-editor-dot" style={{ backgroundColor: p.user.color }} />
                  ))}
                </span>
              )}
              <button className="file-tree-rename" onClick={(e) => onRename(filePath, e)} title="Rename file">
                ✎
              </button>
              <button className="file-tree-delete" onClick={(e) => onDelete(filePath, e)} title="Delete file">
                ×
              </button>
            </div>
          );
        })}
    </>
  );
}
