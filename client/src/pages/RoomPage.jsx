import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { createSocket } from '../lib/socket';
import { BranchWorkspace } from '../components/BranchWorkspace/BranchWorkspace';
import { ChatPanel } from '../components/Chat/ChatPanel';
import { VideoCallPanel } from '../components/VideoCall/VideoCallPanel';
import { ResizeHandle } from '../components/ResizeHandle/ResizeHandle';
import { AvatarStack } from '../components/ui/Avatar';
import { CodeMark, ChevronLeft, ChevronDown, UsersIcon, LogOutIcon } from '../components/ui/Icons';
import { useResizableWidth } from '../hooks/useResizableWidth';
import { useAwarenessStates } from '../hooks/useAwarenessStates';

export function RoomPage() {
  const { roomId } = useParams();
  const navigate = useNavigate();
  const { token, user, logout } = useAuthStore();

  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);
  const [currentBranch, setCurrentBranch] = useState('main');
  const [awareness, setAwareness] = useState(null);
  const [videoOpen, setVideoOpen] = useState(false);
  // Held here, above BranchWorkspace's key={branch} remount, so switching
  // branches doesn't throw you back to the Explorer tab.
  const [rail, setRail] = useState('explorer');
  const [bottomTab, setBottomTab] = useState('terminal');
  const [gitTab, setGitTab] = useState('commit');
  const socketRef = useRef(null);
  const peopleRef = useRef(null);

  const [sidebarWidth, onSidebarResize] = useResizableWidth({
    storageKey: 'collab.sidebarWidth',
    defaultWidth: 320,
    min: 260,
    max: 620,
    side: 'left',
  });

  const people = useAwarenessStates(awareness);

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

  // Close the video dropdown on an outside click, the way a menu should behave.
  useEffect(() => {
    if (!videoOpen) return undefined;
    function onDocClick(e) {
      if (peopleRef.current && !peopleRef.current.contains(e.target)) setVideoOpen(false);
    }
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [videoOpen]);

  function signOut() {
    socketRef.current?.close();
    logout();
    navigate('/login');
  }

  if (error) {
    return (
      <div className="page-centered">
        <p className="error-text">{error}</p>
        <button className="btn-primary" onClick={() => navigate('/rooms')}>
          Back to rooms
        </button>
      </div>
    );
  }

  return (
    <div className="room-shell">
      <header className="room-topbar">
        <span className="brand">
          <span className="brand-mark">
            <CodeMark size={15} />
          </span>
          <span className="brand-name">CollabCode</span>
        </span>
      </header>

      <div className="room-subbar">
        <button className="icon-btn" onClick={() => navigate('/rooms')} title="Back to rooms" aria-label="Back to rooms">
          <ChevronLeft />
        </button>

        <span className="room-crumbs">
          <button className="crumb-link" onClick={() => navigate('/rooms')}>
            Rooms
          </button>
          <span className="crumb-sep">/</span>
          <span className="crumb-current">{roomId.slice(0, 8)}</span>
        </span>

        <span className="room-members-count" title={`${people.length} connected`}>
          <UsersIcon />
          {people.length}
        </span>

        <span className={`room-status ${connected ? 'room-status-on' : ''}`}>{connected ? 'Connected' : 'Connecting…'}</span>

        <span className="room-branch">
          branch: <strong>{currentBranch}</strong>
        </span>

        <RoomIdBadge roomId={roomId} />

        <span className="room-subbar-right" ref={peopleRef}>
          <button
            className="people-trigger"
            onClick={() => setVideoOpen((v) => !v)}
            aria-expanded={videoOpen}
            // Explicit label: without one, the accessible name is built from
            // the avatars inside, so the button ends up named after whoever
            // happens to be in the room.
            aria-label="Video call"
            title="Show video call"
          >
            <AvatarStack people={people.map((p) => ({ ...p.user, id: String(p.clientID) }))} max={3} size={26} />
            <ChevronDown size={13} />
          </button>

          {/* Kept mounted whether or not the dropdown is open: unmounting would
              tear down every RTCPeerConnection, and `display:none` stops the
              browser decoding frames. Hidden visually instead. */}
          <div className={`video-popover ${videoOpen ? 'video-popover-open' : ''}`}>
            <div className="video-popover-head">Video call</div>
            {connected && socketRef.current && <VideoCallPanel socket={socketRef.current} roomId={roomId} />}
          </div>
        </span>

        <button className="icon-btn" onClick={signOut} title="Sign out" aria-label="Sign out">
          <LogOutIcon />
        </button>

        <button className="btn-leave" onClick={() => navigate('/rooms')}>
          Leave Room
        </button>
      </div>

      {connected && socketRef.current ? (
        <div className="room-body">
          <BranchWorkspace
            key={currentBranch}
            socket={socketRef.current}
            roomId={roomId}
            branch={currentBranch}
            user={user}
            onSwitchBranch={setCurrentBranch}
            onAwareness={setAwareness}
            rail={rail}
            setRail={setRail}
            bottomTab={bottomTab}
            setBottomTab={setBottomTab}
            gitTab={gitTab}
            setGitTab={setGitTab}
          />

          <ResizeHandle onMouseDown={onSidebarResize} label="Resize chat panel" />

          <aside className="room-sidebar" style={{ width: sidebarWidth }}>
            <div className="panel-head">Chat</div>
            <ChatPanel socket={socketRef.current} roomId={roomId} token={token} />
          </aside>
        </div>
      ) : (
        <div className="room-body room-body-loading">
          <p className="muted">Connecting to the room…</p>
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
      <span className="muted">Room ID:</span> <code>{roomId}</code>
      <button className="btn-tiny" onClick={copy}>
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </span>
  );
}
