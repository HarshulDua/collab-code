import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useRoomStore } from '../store/roomStore';

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
    <div className="rooms-page">
      <header className="rooms-header">
        <h1>Rooms</h1>
        <div>
          <span>{user?.name}</span>
          <Link to="/admin">Admin</Link>
          <button onClick={logout}>Log out</button>
        </div>
      </header>

      <form className="inline-form" onSubmit={onCreate}>
        <input placeholder="New room name" value={name} onChange={(e) => setName(e.target.value)} />
        <button type="submit">Create room</button>
      </form>

      <form className="inline-form" onSubmit={onJoin}>
        <input placeholder="Room ID to join" value={joinId} onChange={(e) => setJoinId(e.target.value.trim())} />
        <button type="submit">Join by ID</button>
      </form>

      {error && <p className="error-text">{error}</p>}

      {loading ? (
        <p>Loading…</p>
      ) : (
        <ul className="room-list">
          {rooms.map((room) => (
            <li key={room.id} className="room-list-row">
              <button className="room-list-item" onClick={() => navigate(`/rooms/${room.id}`)}>
                {room.name}
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
    </div>
  );
}
