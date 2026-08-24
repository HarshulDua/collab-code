import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { YjsSocketProvider } from '../CodeEditor/YjsSocketProvider';
import { CodeEditor } from '../CodeEditor/CodeEditor';
import { FileExplorer } from '../FileExplorer/FileExplorer';
import { ExecutionPanel } from '../Execution/ExecutionPanel';
import { ResizeHandle } from '../ResizeHandle/ResizeHandle';
import { getFilesMap, ensureDefaultFile } from '../../lib/fileTree';
import { useFileList } from '../../hooks/useFileList';
import { useResizableWidth } from '../../hooks/useResizableWidth';
import { colorForUser } from '../../lib/awarenessColor';

export function BranchWorkspace({ socket, roomId, branch, user }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [activeFile, setActiveFile] = useState(null);
  const docRef = useRef(null);
  const providerRef = useRef(null);
  const [fileExplorerWidth, onFileExplorerResize] = useResizableWidth({
    storageKey: 'collab.fileExplorerWidth',
    defaultWidth: 200,
    min: 150,
    max: 480,
    side: 'right',
  });

  if (!docRef.current) docRef.current = new Y.Doc();
  const filesMap = getFilesMap(docRef.current);
  const filePaths = useFileList(filesMap);

  useEffect(() => {
    const provider = new YjsSocketProvider(socket, roomId, branch, docRef.current);
    providerRef.current = provider;

    let cancelled = false;
    provider
      .join()
      .then(() => {
        if (cancelled) return;
        // Color is keyed by this connection's own Yjs clientID, not the
        // account id — two tabs logged into the same account (an easy
        // mistake when testing) still get visually distinct cursors,
        // instead of two identical-colored decorations that look like one
        // cursor "jumping" between positions.
        provider.awareness.setLocalStateField('user', {
          name: user.name,
          color: colorForUser(String(docRef.current.clientID)),
        });
        setActiveFile(ensureDefaultFile(filesMap));
        setReady(true);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
      provider.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, branch]);

  useEffect(() => {
    if (!ready || filePaths.length === 0) return;
    if (activeFile && !filePaths.includes(activeFile)) {
      setActiveFile(filePaths[0]);
    }
  }, [filePaths, activeFile, ready]);

  // Broadcast which file this client currently has open so everyone else's
  // presence list stays live — same awareness channel remote cursors use,
  // just a different field.
  useEffect(() => {
    if (!ready || !activeFile) return;
    providerRef.current?.awareness.setLocalStateField('activeFile', activeFile);
  }, [ready, activeFile]);

  if (error) {
    return <p className="error-text">{error}</p>;
  }

  if (!ready || !activeFile) {
    return <p className="page-centered">Loading {branch}…</p>;
  }

  return (
    <>
      <FileExplorer
        filesMap={filesMap}
        activeFile={activeFile}
        onSelectFile={setActiveFile}
        awareness={providerRef.current.awareness}
        style={{ width: fileExplorerWidth }}
      />
      <ResizeHandle onMouseDown={onFileExplorerResize} label="Resize file explorer" />
      <div className="room-main">
        <CodeEditor filesMap={filesMap} activeFile={activeFile} awareness={providerRef.current.awareness} />
        <ExecutionPanel socket={socket} roomId={roomId} branch={branch} filesMap={filesMap} activeFile={activeFile} />
      </div>
    </>
  );
}
