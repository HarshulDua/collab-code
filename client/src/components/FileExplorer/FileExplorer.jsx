import { useState } from 'react';
import { useFileList } from '../../hooks/useFileList';
import { buildTree, createFile, deleteFile } from '../../lib/fileTree';

export function FileExplorer({ filesMap, activeFile, onSelectFile }) {
  const paths = useFileList(filesMap);
  const [error, setError] = useState(null);
  const tree = buildTree(paths);

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

  return (
    <div className="file-explorer">
      <div className="file-explorer-header">
        <span>Files</span>
        <button onClick={handleNewFile} title="New file">
          +
        </button>
      </div>
      {error && <div className="error-text file-explorer-error">{error}</div>}
      <div className="file-tree">
        <TreeNode node={tree} pathPrefix="" activeFile={activeFile} onSelectFile={onSelectFile} onDelete={handleDelete} />
      </div>
    </div>
  );
}

function TreeNode({ node, pathPrefix, activeFile, onSelectFile, onDelete }) {
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
              />
            </div>
          </div>
        ))}
      {node.files
        .slice()
        .sort()
        .map((filePath) => (
          <div
            key={filePath}
            className={`file-tree-file ${filePath === activeFile ? 'file-tree-file-active' : ''}`}
            onClick={() => onSelectFile(filePath)}
          >
            <span>{filePath.split('/').pop()}</span>
            <button className="file-tree-delete" onClick={(e) => onDelete(filePath, e)} title="Delete file">
              ×
            </button>
          </div>
        ))}
    </>
  );
}
