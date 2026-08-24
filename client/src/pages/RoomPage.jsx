import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createSocket } from '../lib/socket';
import { BranchWorkspace } from '../components/BranchWorkspace/BranchWorkspace';
import { ChatPanel } from '../components/Chat/ChatPanel';
import { VideoCallPanel } from '../components/VideoCall/VideoCallPanel';
import { GitPanel } from '../components/Git/GitPanel';
import { TerminalPanel } from '../components/Terminal/TerminalPanel';
import { ResizeHandle } from '../components/ResizeHandle/ResizeHandle';
import { useResizableWidth } from '../hooks/useResizableWidth';

export function RoomPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { token, user, logout } = useAuthStore();

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [currentBranch, setCurrentBranch] = useState('main');
  const [sidebarTab, setSidebarTab] = useState('chat');
  const socketRef = useRef(null);
  const [sidebarWidth, onSidebarResize] = useResizableWidth({
    storageKey: 'collab.sidebarWidth',
    defaultWidth: 320,
    min: 260,
    max: 600,
    side: 'left',
  });

  function signOut() {
    socketRef.current?.close();
    logout();
    navigate('/login');
  }

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return undefined;
    }

    const socket = createSocket(token);
    socketRef.current = socket;

    let cancelled = false;
    socket.on('connect', () => {
      if (!cancelled) setConnected(true);
    });
    socket.on('connect_error', (err) => {
      if (!cancelled) setError(err.message);
    });

    return () => {
      cancelled = true;
      socket.close();
    };
  }, [roomId, token, navigate]);

  if (error) {
    return (
      <div className="page-centered">
        <p className="error-text">{error}</p>
        <button onClick={() => navigate('/rooms')}>Back to rooms</button>
      </div>
    );
  }

  return (
    <div className="room-layout">
      <header className="room-header">
        <button onClick={() => navigate('/rooms')}>&larr; Rooms</button>
        <span className="room-status">{connected ? 'Connected' : 'Connecting…'}</span>
        <RoomIdBadge roomId={roomId} />
        <span className="room-branch">
          branch: <strong>{currentBranch}</strong>
        </span>
        <span className="room-user">{user?.name}</span>
        <button className="room-signout" onClick={signOut}>
          Sign out
        </button>
      </header>

      {connected && socketRef.current && (
        <div className="room-body">
          <BranchWorkspace key={currentBranch} socket={socketRef.current} roomId={roomId} branch={currentBranch} user={user} />
          <ResizeHandle onMouseDown={onSidebarResize} label="Resize sidebar" />
          <aside className="room-sidebar" style={{ width: sidebarWidth }}>
            <VideoCallPanel socket={socketRef.current} roomId={roomId} />
            <div className="sidebar-tabs">
              {['chat', 'git', 'terminal'].map((t) => (
                <button
                  key={t}
                  className={sidebarTab === t ? 'sidebar-tab-active' : ''}
                  onClick={() => setSidebarTab(t)}
                >
                  {t === 'chat' ? 'Chat' : t === 'git' ? 'Git' : 'Terminal'}
                </button>
              ))}
            </div>
            {sidebarTab === 'chat' && <ChatPanel socket={socketRef.current} roomId={roomId} token={token} />}
            {sidebarTab === 'git' && (
              <GitPanel
                socket={socketRef.current}
                roomId={roomId}
                currentBranch={currentBranch}
                onSwitchBranch={setCurrentBranch}
              />
            )}
            {sidebarTab === 'terminal' && (
              <TerminalPanel
                socket={socketRef.current}
                roomId={roomId}
                branch={currentBranch}
                onSwitchBranch={setCurrentBranch}
              />
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function RoomIdBadge({ roomId }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt('Copy this room ID:', roomId);
    }
  }

  return (
    <span className="room-id-badge">
      Room ID: <code>{roomId}</code>
      <button onClick={copy}>{copied ? 'Copied!' : 'Copy'}</button>
    </span>
  );
}
