import { useEffect, useState } from 'react';
import { emitAck } from '../../lib/socket';

export function GitPanel({ socket, roomId, currentBranch, onSwitchBranch }) {
  const [tab, setTab] = useState('commit');
  const [branches, setBranches] = useState({ all: [] });
  const [log, setLog] = useState([]);
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState(null);
  const [diff, setDiff] = useState(null);
  const [newBranchName, setNewBranchName] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteToken, setRemoteToken] = useState('');

  async function refresh() {
    try {
      const [b, l] = await Promise.all([
        emitAck(socket, 'git:branches', { roomId }),
        emitAck(socket, 'git:log', { roomId, branch: currentBranch }),
      ]);
      setBranches(b);
      setLog(l.commits || []);
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    }
  }

  useEffect(() => {
    emitAck(socket, 'git:subscribe', { roomId }).catch(() => {});
    refresh();
    const events = ['git:committed', 'git:branch-created', 'git:merged', 'git:pushed', 'git:pulled'];
    const handlers = events.map((event) => [
      event,
      (payload) => {
        const detail = payload.name || payload.hash?.slice(0, 7) || payload.branch || '';
        setStatus({ type: 'info', text: `${payload.by || 'Someone'} — ${event.replace('git:', '')} ${detail}`.trim() });
        refresh();
      },
    ]);
    handlers.forEach(([event, handler]) => socket.on(event, handler));
    return () => handlers.forEach(([event, handler]) => socket.off(event, handler));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, roomId, currentBranch]);

  async function doCommit(e) {
    e.preventDefault();
    if (!message.trim()) return;
    try {
      const ack = await emitAck(socket, 'git:commit', { roomId, branch: currentBranch, message: message.trim() });
      setMessage('');
      setStatus({ type: 'info', text: ack.noChanges ? 'Nothing to commit' : `Committed ${ack.hash.slice(0, 7)}` });
      refresh();
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    }
  }

  async function viewDiff(hash) {
    try {
      const ack = await emitAck(socket, 'git:show', { roomId, hash });
      setDiff({ hash, text: ack.diff });
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    }
  }

  async function restore(hash) {
    if (!window.confirm(`Restore this version into "${currentBranch}"? Everyone currently viewing that branch will see it change.`)) return;
    try {
      await emitAck(socket, 'git:restore', { roomId, branch: currentBranch, hash });
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    }
  }

  async function createBranch(e) {
    e.preventDefault();
    if (!newBranchName.trim()) return;
    const name = newBranchName.trim();
    try {
      await emitAck(socket, 'git:branch-create', { roomId, name, from: currentBranch });
      setNewBranchName('');
      onSwitchBranch(name);
      refresh();
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    }
  }

  async function mergeBranch(from) {
    if (!window.confirm(`Merge "${from}" into your current branch "${currentBranch}"?`)) return;
    try {
      const ack = await emitAck(socket, 'git:merge', { roomId, from, into: currentBranch });
      if (ack.conflicted) setStatus({ type: 'error', text: `Merge conflict in: ${ack.files.join(', ')}` });
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    }
  }

  async function connectRemote(e) {
    e.preventDefault();
    try {
      await emitAck(socket, 'git:remote-configure', { roomId, url: remoteUrl.trim(), token: remoteToken.trim() });
      setStatus({ type: 'info', text: 'Remote connected' });
      setRemoteToken('');
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    }
  }

  async function push() {
    try {
      await emitAck(socket, 'git:push', { roomId, branch: currentBranch });
      setStatus({ type: 'info', text: 'Pushed' });
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    }
  }

  async function pull() {
    try {
      await emitAck(socket, 'git:pull', { roomId, branch: currentBranch });
      setStatus({ type: 'info', text: 'Pulled' });
    } catch (err) {
      setStatus({ type: 'error', text: err.message });
    }
  }

  return (
    <div className="git-panel">
      <div className="git-tabs">
        {['commit', 'history', 'branches', 'remote'].map((t) => (
          <button key={t} className={tab === t ? 'git-tab-active' : ''} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {status && <div className={`git-status git-status-${status.type}`}>{status.text}</div>}

      {tab === 'commit' && (
        <form className="git-commit-form" onSubmit={doCommit}>
          <div className="git-current-branch">
            on <strong>{currentBranch}</strong> (only your view — others may be on different branches)
          </div>
          <input placeholder="Commit message" value={message} onChange={(e) => setMessage(e.target.value)} />
          <button type="submit">Commit current state</button>
        </form>
      )}

      {tab === 'history' && (
        <div className="git-history">
          <div className="git-current-branch">history for <strong>{currentBranch}</strong></div>
          {log.length === 0 && <p className="git-empty">No commits yet.</p>}
          <ul>
            {log.map((c) => (
              <li key={c.hash}>
                <div className="git-commit-message">{c.message}</div>
                <div className="git-commit-meta">
                  {c.authorName} · {c.hash.slice(0, 7)}
                </div>
                <div className="git-commit-actions">
                  <button onClick={() => viewDiff(c.hash)}>Diff</button>
                  <button onClick={() => restore(c.hash)}>Restore</button>
                </div>
              </li>
            ))}
          </ul>
          {diff && (
            <div className="git-diff">
              <pre>{diff.text}</pre>
            </div>
          )}
        </div>
      )}

      {tab === 'branches' && (
        <div className="git-branches">
          <form className="inline-form" onSubmit={createBranch}>
            <input placeholder="New branch name" value={newBranchName} onChange={(e) => setNewBranchName(e.target.value)} />
            <button type="submit">Create from {currentBranch}</button>
          </form>
          <ul>
            {branches.all.map((name) => (
              <li key={name} className={name === currentBranch ? 'git-branch-current' : ''}>
                <span>{name}</span>
                {name !== currentBranch && (
                  <span className="git-branch-actions">
                    <button onClick={() => onSwitchBranch(name)}>Open</button>
                    <button onClick={() => mergeBranch(name)}>Merge in</button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'remote' && (
        <div className="git-remote">
          <form className="inline-form" onSubmit={connectRemote}>
            <input placeholder="https://github.com/user/repo.git" value={remoteUrl} onChange={(e) => setRemoteUrl(e.target.value)} />
            <input
              placeholder="Personal access token"
              type="password"
              value={remoteToken}
              onChange={(e) => setRemoteToken(e.target.value)}
            />
            <button type="submit">Connect</button>
          </form>
          <div className="git-remote-actions">
            <button onClick={push}>Push {currentBranch}</button>
            <button onClick={pull}>Pull {currentBranch}</button>
          </div>
        </div>
      )}
    </div>
  );
}
