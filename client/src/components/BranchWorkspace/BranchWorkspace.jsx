import { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { YjsSocketProvider } from '../CodeEditor/YjsSocketProvider';
import { CodeEditor } from '../CodeEditor/CodeEditor';
import { FileExplorer } from '../FileExplorer/FileExplorer';
import { useExecution, ExecutionControls, ExecutionOutput } from '../Execution/ExecutionPanel';
import { TerminalPanel } from '../Terminal/TerminalPanel';
import { GitPanel } from '../Git/GitPanel';
import { ResizeHandle } from '../ResizeHandle/ResizeHandle';
import { Avatar } from '../ui/Avatar';
import { FilesIcon, BranchIcon } from '../ui/Icons';
import { getFilesMap, ensureDefaultFile } from '../../lib/fileTree';
import { useFileList } from '../../hooks/useFileList';
import { useResizableWidth } from '../../hooks/useResizableWidth';
import { colorForUser } from '../../lib/awarenessColor';
import { monacoLanguageForPath } from '../../lib/languages';

export function BranchWorkspace({
  socket,
  roomId,
  branch,
  user,
  onSwitchBranch,
  onAwareness,
  rail,
  setRail,
  bottomTab,
  setBottomTab,
  gitTab,
  setGitTab,
}) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [activeFile, setActiveFile] = useState(null);
  const docRef = useRef(null);
  const providerRef = useRef(null);

  const [panelWidth, onPanelResize] = useResizableWidth({
    storageKey: 'collab.fileExplorerWidth',
    defaultWidth: 232,
    min: 170,
    max: 520,
    side: 'right',
  });

  if (!docRef.current) docRef.current = new Y.Doc();
  const filesMap = getFilesMap(docRef.current);
  const filePaths = useFileList(filesMap);

  // Declared before the early returns below — hooks can't be conditional.
  const exec = useExecution({ socket, roomId, branch, filesMap, activeFile: activeFile || '' });

  useEffect(() => {
    const provider = new YjsSocketProvider(socket, roomId, branch, docRef.current);
    providerRef.current = provider;

    let cancelled = false;
    provider
      .join()
      .then(() => {
        if (cancelled) return;
        provider.awareness.setLocalStateField('user', {
          name: user.name,
          color: colorForUser(String(docRef.current.clientID)),
          picture: user.picture || null,
        });
        setActiveFile(ensureDefaultFile(filesMap));
        setReady(true);
        onAwareness?.(provider.awareness);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message);
      });

    return () => {
      cancelled = true;
      onAwareness?.(null);
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

  useEffect(() => {
    if (!ready || !activeFile) return;
    providerRef.current?.awareness.setLocalStateField('activeFile', activeFile);
  }, [ready, activeFile]);

  if (error) {
    return <p className="error-text">{error}</p>;
  }

  if (!ready || !activeFile) {
    return <p className="page-centered muted">Loading {branch}…</p>;
  }

  return (
    <>
      <nav className="activity-rail" aria-label="Panels">
        <button
          className={`rail-btn ${rail === 'explorer' ? 'rail-btn-active' : ''}`}
          onClick={() => setRail('explorer')}
          aria-label="Explorer"
          title="Explorer"
        >
          <FilesIcon />
        </button>
        <button
          className={`rail-btn ${rail === 'git' ? 'rail-btn-active' : ''}`}
          onClick={() => setRail('git')}
          aria-label="Git"
          title="Git"
        >
          <BranchIcon />
        </button>
        <span className="rail-spacer" />
        <Avatar user={user} size={26} />
      </nav>

      <div className="side-panel" style={{ width: panelWidth }}>
        {rail === 'explorer' ? (
          <FileExplorer
            filesMap={filesMap}
            activeFile={activeFile}
            onSelectFile={setActiveFile}
            awareness={providerRef.current.awareness}
          />
        ) : (
          <>
            <div className="panel-head">Source control</div>
            <GitPanel
              socket={socket}
              roomId={roomId}
              currentBranch={branch}
              onSwitchBranch={onSwitchBranch}
              tab={gitTab}
              setTab={setGitTab}
            />
          </>
        )}

        <div className="side-panel-user">
          <Avatar user={user} size={28} />
          <span className="side-panel-user-text">
            <span className="side-panel-user-name">{user?.name}</span>
            <span className="status-online">Online</span>
          </span>
        </div>
      </div>

      <ResizeHandle onMouseDown={onPanelResize} label="Resize side panel" />

      <div className="editor-column">
        <div className="editor-tabs">
          <span className="editor-tab editor-tab-active">
            <span className="editor-tab-dot" />
            {activeFile}
          </span>
        </div>

        <div className="editor-surface">
          <CodeEditor filesMap={filesMap} activeFile={activeFile} awareness={providerRef.current.awareness} />
        </div>

        <div className="bottom-panel">
          <div className="bottom-tabs">
            <button
              className={bottomTab === 'terminal' ? 'bottom-tab-active' : ''}
              onClick={() => setBottomTab('terminal')}
            >
              Terminal
            </button>
            <button className={bottomTab === 'output' ? 'bottom-tab-active' : ''} onClick={() => setBottomTab('output')}>
              Output
            </button>
            <span className="bottom-tabs-spacer" />
            <ExecutionControls exec={exec} onActivate={() => setBottomTab('output')} />
          </div>

          {/* Both panes stay mounted and are hidden with CSS rather than
              conditionally rendered — unmounting the terminal threw away the
              whole scrollback every time someone looked at the output tab. */}
          <div className={`bottom-pane ${bottomTab === 'terminal' ? '' : 'bottom-pane-hidden'}`}>
            <TerminalPanel socket={socket} roomId={roomId} branch={branch} onSwitchBranch={onSwitchBranch} />
          </div>
          <div className={`bottom-pane ${bottomTab === 'output' ? '' : 'bottom-pane-hidden'}`}>
            <ExecutionOutput exec={exec} />
          </div>
        </div>

        <div className="status-bar">
          <span>{monacoLanguageForPath(activeFile)}</span>
          <span>{branch}</span>
          <span className="status-bar-spacer" />
          <span>{filePaths.length} files</span>
          <span>UTF-8</span>
        </div>
      </div>
    </>
  );
}
