import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiClient } from '../lib/apiClient';
import { useAuthStore } from '../store/authStore';

const POLL_MS = 5000;
const LEVEL_LABELS = { 10: 'trace', 20: 'debug', 30: 'info', 40: 'warn', 50: 'error', 60: 'fatal' };

export function AdminPage() {
  const token = useAuthStore((s) => s.token);
  const [stats, setStats] = useState(null);
  const [rooms, setRooms] = useState([]);
  const [logs, setLogs] = useState([]);
  const [expandedRoomId, setExpandedRoomId] = useState(null);
  const [roomDetail, setRoomDetail] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const [statsRes, roomsRes, logsRes] = await Promise.all([
          apiClient.adminStats(token),
          apiClient.adminListRooms(token),
          apiClient.adminLogs(token),
        ]);
        if (cancelled) return;
        setStats(statsRes);
        setRooms(roomsRes.rooms);
        setLogs(logsRes.logs);
        setError(null);
      } catch (err) {
        if (!cancelled) setError(err.message);
      }
    }

    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [token]);

  useEffect(() => {
    if (!expandedRoomId) {
      setRoomDetail(null);
      return;
    }
    let cancelled = false;
    apiClient.adminRoomDetail(token, expandedRoomId).then((res) => {
      if (!cancelled) setRoomDetail(res);
    });
    return () => {
      cancelled = true;
    };
  }, [expandedRoomId, token]);

  if (error) {
    return (
      <div className="page-centered">
        <p className="error-text">{error}</p>
        <Link to="/rooms">Back to rooms</Link>
      </div>
    );
  }

  return (
    <div className="admin-page">
      <div className="admin-header">
        <h1>Admin</h1>
        <Link to="/rooms">Back to rooms</Link>
      </div>

      {stats && (
        <div className="admin-stat-cards">
          <StatCard label="Total rooms" value={stats.totalRooms} />
          <StatCard label="Connected now" value={stats.currentlyConnected} />
          <StatCard label="Rooms created" value={stats.roomsCreated} />
          <StatCard label="Executions run" value={stats.executionsRun} />
          <StatCard label="Executions failed" value={stats.executionsFailed} />
          <StatCard label="Errors" value={stats.errors} />
        </div>
      )}

      <div className="admin-body">
        <div className="admin-rooms">
          <h2>Active rooms</h2>
          <table className="admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Members</th>
                <th>Connected</th>
                <th>Live branches</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {rooms.map((room) => (
                <Fragment key={room.id}>
                  <tr className="admin-room-row" onClick={() => setExpandedRoomId(expandedRoomId === room.id ? null : room.id)}>
                    <td>{room.name}</td>
                    <td>{room.memberCount}</td>
                    <td>{room.connectedUsers}</td>
                    <td>{room.liveBranches.join(', ') || '—'}</td>
                    <td>{new Date(room.createdAt).toLocaleString()}</td>
                  </tr>
                  {expandedRoomId === room.id && roomDetail && (
                    <tr className="admin-room-detail-row">
                      <td colSpan={5}>
                        {roomDetail.branches.length === 0 && <p className="admin-empty">No one connected right now.</p>}
                        {roomDetail.branches.map(({ branch, users }) => (
                          <div key={branch} className="admin-branch-detail">
                            <div className="admin-branch-name">branch: {branch}</div>
                            <ul>
                              {users.map((u) => (
                                <li key={u.socketId}>
                                  {u.name} ({u.email}) — socket {u.socketId}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        <div className="admin-logs">
          <h2>Recent logs</h2>
          <div className="admin-log-list">
            {logs
              .slice()
              .reverse()
              .map((entry, i) => (
                <div key={i} className={`admin-log-line admin-log-level-${LEVEL_LABELS[entry.level] || 'info'}`}>
                  <span className="admin-log-time">{new Date(entry.time).toLocaleTimeString()}</span>
                  <span className="admin-log-level">{LEVEL_LABELS[entry.level] || entry.level}</span>
                  <span>{entry.msg}</span>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value }) {
  return (
    <div className="admin-stat-card">
      <div className="admin-stat-value">{value}</div>
      <div className="admin-stat-label">{label}</div>
    </div>
  );
}
