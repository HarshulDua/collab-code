import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useRoomStore } from '../store/roomStore';
import { Avatar } from '../components/ui/Avatar';
import { CodeMark, PlusIcon, LogOutIcon } from '../components/ui/Icons';

function relativeTime(iso) {
  if (!iso) return '';
  const seconds = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// A stable per-room accent, so a room keeps the same colour tile every visit.
const TILE_HUES = ['#7c5cff', '#e0568a', '#e0913f', '#3ecf8e', '#4aa8f0', '#b566e8'];
function hueFor(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return TILE_HUES[Math.abs(hash) % TILE_HUES.length];
}

export function RoomsPage() {
  const navigate = useNavigate();
  const { token, user, logout } = useAuthStore();
  const { rooms, loading, error, fetchRooms, createRoom, joinRoom, deleteRoom } = useRoomStore();
  const [name, setName] = useState('');
  const [joinId, setJoinId] = useState('');

  useEffect(() => {
    if (!token) {
      navigate('/login');
      return;
    }
    fetchRooms(token);
  }, [token, navigate, fetchRooms]);

  async function onCreate(e) {
    e.preventDefault();
    if (!name.trim()) return;
    const room = await createRoom(token, name.trim());
    setName('');
    if (room) navigate(`/rooms/${room.id}`);
  }

  async function onJoin(e) {
    e.preventDefault();
    if (!joinId.trim()) return;
    const room = await joinRoom(token, joinId.trim());
    if (room) navigate(`/rooms/${room.id}`);
  }

  async function onDelete(room, e) {
    e.stopPropagation();
    if (!window.confirm(`Delete "${room.name}"? This cannot be undone.`)) return;
    await deleteRoom(token, room.id);
  }

  return (
    <div className="rooms-shell">
      <aside className="rooms-nav">
        <span className="brand">
          <span className="brand-mark">
            <CodeMark size={16} />
          </span>
          <span className="brand-name">CollabCode</span>
        </span>

        <nav className="rooms-nav-links">
          <span className="rooms-nav-link rooms-nav-link-active">Rooms</span>
          <Link className="rooms-nav-link" to="/admin">
            Admin
          </Link>
        </nav>

        <div className="rooms-nav-user">
          <Avatar user={user} size={32} />
          <span className="rooms-nav-user-text">
            <span className="rooms-nav-user-name">{user?.name}</span>
            <span className="status-online">Online</span>
          </span>
          <button className="icon-btn" onClick={logout} title="Sign out" aria-label="Sign out">
            <LogOutIcon />
          </button>
        </div>
      </aside>

      <main className="rooms-main">
        <header className="rooms-main-head">
          <div>
            <h1>Rooms</h1>
            <p className="muted">Your collaboration spaces</p>
          </div>
          <form className="rooms-create" onSubmit={onCreate}>
            <input placeholder="New room name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn-primary" type="submit">
              <PlusIcon />
              <span>Create room</span>
            </button>
          </form>
        </header>

        <form className="rooms-join" onSubmit={onJoin}>
          <input placeholder="Room ID to join" value={joinId} onChange={(e) => setJoinId(e.target.value.trim())} />
          <button className="btn-ghost" type="submit">
            Join by ID
          </button>
        </form>

        {error && <p className="error-text">{error}</p>}

        {loading ? (
          <p className="muted">Loading…</p>
        ) : rooms.length === 0 ? (
          <p className="rooms-empty muted">No rooms yet — create one above, or join an existing one by ID.</p>
        ) : (
          <ul className="room-list">
            {rooms.map((room) => (
              <li key={room.id} className="room-list-row">
                <button className="room-card" onClick={() => navigate(`/rooms/${room.id}`)}>
                  <span className="room-card-tile" style={{ background: hueFor(room.id) }}>
                    <CodeMark size={15} />
                  </span>
                  <span className="room-card-name">{room.name}</span>
                  <span className="room-card-meta">
                    <span>
                      {room.members.length} member{room.members.length === 1 ? '' : 's'}
                    </span>
                    {room.createdAt && <span>Created {relativeTime(room.createdAt)}</span>}
                  </span>
                </button>
                {room.owner === user?.id && (
                  <button className="room-delete" title="Delete room" onClick={(e) => onDelete(room, e)}>
                    Delete
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
