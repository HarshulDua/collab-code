import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { YjsSocketProvider } from '../CodeEditor/YjsSocketProvider';
import { CodeEditor } from '../CodeEditor/CodeEditor';
import { FileExplorer } from '../FileExplorer/FileExplorer';
import { ExecutionPanel } from '../Execution/ExecutionPanel';
import { getFilesMap, ensureDefaultFile } from '../../lib/fileTree';
import { useFileList } from '../../hooks/useFileList';
import { colorForUser } from '../../lib/awarenessColor';

export function BranchWorkspace({ socket, roomId, branch, user }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [activeFile, setActiveFile] = useState(null);
  const docRef = useRef(null);
  const providerRef = useRef(null);

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
        provider.awareness.setLocalStateField('user', { name: user.name, color: colorForUser(user.id) });
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

  if (error) {
    return <p className="error-text">{error}</p>;
  }

  if (!ready || !activeFile) {
    return <p className="page-centered">Loading {branch}…</p>;
  }

  return (
    <>
      <FileExplorer filesMap={filesMap} activeFile={activeFile} onSelectFile={setActiveFile} />
      <div className="room-main">
        <CodeEditor filesMap={filesMap} activeFile={activeFile} awareness={providerRef.current.awareness} />
        <ExecutionPanel socket={socket} roomId={roomId} branch={branch} filesMap={filesMap} activeFile={activeFile} />
      </div>
    </>
  );
}
