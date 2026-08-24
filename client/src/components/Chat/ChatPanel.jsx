import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../../lib/apiClient';
import { Avatar } from '../ui/Avatar';
import { SendIcon } from '../ui/Icons';

function timeOf(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function ChatPanel({ socket, roomId, token }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [ready, setReady] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    let cancelled = false;
    setReady(false);

    function onMessage(message) {
      setMessages((prev) => [...prev, message]);
    }

    // Wait for the server to actually add this socket to the room before
    // fetching history or trusting the live listener — otherwise a message
    // from another member can be broadcast (and permanently lost, socket.io
    // never replays a missed room event) in the gap between mount and the
    // join being processed server-side.
    socket.emit('chat:join', { roomId }, () => {
      if (cancelled) return;
      socket.on('chat:message', onMessage);
      apiClient
        .getMessages(token, roomId)
        .then(({ messages: history }) => {
          if (!cancelled) setMessages(history);
        })
        .catch(() => {})
        .finally(() => {
          if (!cancelled) setReady(true);
        });
    });

    return () => {
      cancelled = true;
      socket.off('chat:message', onMessage);
    };
  }, [socket, roomId, token]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  function send(e) {
    e.preventDefault();
    if (!ready || !text.trim()) return;
    socket.emit('chat:send', { roomId, text }, () => {});
    setText('');
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.length === 0 && ready && <p className="chat-empty muted">No messages yet — say hello.</p>}
        {messages.map((m) => (
          <div key={m.id} className="chat-message">
            <Avatar user={{ id: m.author, name: m.authorName }} size={26} />
            <div className="chat-message-body">
              <div className="chat-message-head">
                <span className="chat-author">{m.authorName}</span>
                <span className="chat-time">{timeOf(m.createdAt)}</span>
              </div>
              <div className="chat-text">{m.text}</div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form className="chat-input" onSubmit={send}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={ready ? 'Message the room…' : 'Joining chat…'}
          disabled={!ready}
        />
        <button type="submit" disabled={!ready} aria-label="Send" title="Send">
          <SendIcon />
        </button>
      </form>
    </div>
  );
}
