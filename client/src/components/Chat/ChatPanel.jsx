import { useEffect, useRef, useState } from 'react';
import { apiClient } from '../../lib/apiClient';

export function ChatPanel({ socket, roomId, token }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    apiClient
      .getMessages(token, roomId)
      .then(({ messages: history }) => {
        if (!cancelled) setMessages(history);
      })
      .catch(() => {});

    socket.emit('chat:join', { roomId }, () => {});

    function onMessage(message) {
      setMessages((prev) => [...prev, message]);
    }
    socket.on('chat:message', onMessage);
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
    if (!text.trim()) return;
    socket.emit('chat:send', { roomId, text }, () => {});
    setText('');
  }

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.map((m) => (
          <div key={m.id} className="chat-message">
            <span className="chat-author">{m.authorName}</span>
            <span className="chat-text">{m.text}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form className="chat-input" onSubmit={send}>
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the room…" />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
