import { useEffect, useRef, useState } from 'react';
import { emitAck } from '../../lib/socket';

const WELCOME = "Type `help` for the list of supported commands.";

export function TerminalPanel({ socket, roomId, branch, onSwitchBranch }) {
  const [lines, setLines] = useState([{ kind: 'note', text: WELCOME }]);
  const [input, setInput] = useState('');
  const [cwd, setCwd] = useState('');
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const scrollRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [lines, busy]);

  // A new branch is a different working tree, so the prompt returns to its root.
  useEffect(() => setCwd(''), [branch]);

  const prompt = `${branch}:/${cwd}$`;

  async function submit(e) {
    e.preventDefault();
    const command = input.trim();
    if (busy) return;

    setInput('');
    setHistoryIndex(-1);
    if (!command) {
      setLines((prev) => [...prev, { kind: 'prompt', text: `${prompt}` }]);
      return;
    }

    setHistory((prev) => (prev[prev.length - 1] === command ? prev : [...prev, command]));
    setLines((prev) => [...prev, { kind: 'prompt', text: `${prompt} ${command}` }]);
    setBusy(true);

    try {
      const ack = await emitAck(socket, 'terminal:exec', { roomId, branch, cwd, command });

      if (ack.clear) {
        setLines([]);
      } else if (ack.output) {
        setLines((prev) => [...prev, { kind: ack.exitCode === 0 ? 'out' : 'err', text: ack.output }]);
      }

      if (typeof ack.cwd === 'string') setCwd(ack.cwd);
      if (ack.switchBranch) {
        setLines((prev) => [...prev, { kind: 'note', text: `switching to ${ack.switchBranch}…` }]);
        onSwitchBranch?.(ack.switchBranch);
      }
    } catch (err) {
      setLines((prev) => [...prev, { kind: 'err', text: err.message }]);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (history.length === 0) return;
      const nextIndex = historyIndex === -1 ? history.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInput(history[nextIndex]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (historyIndex === -1) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= history.length) {
        setHistoryIndex(-1);
        setInput('');
      } else {
        setHistoryIndex(nextIndex);
        setInput(history[nextIndex]);
      }
    }
  }

  return (
    <div className="terminal-panel" onClick={() => inputRef.current?.focus()}>
      <div className="terminal-output" ref={scrollRef}>
        {lines.map((line, i) => (
          <pre key={i} className={`terminal-line terminal-${line.kind}`}>
            {line.text}
          </pre>
        ))}
        {busy && <pre className="terminal-line terminal-note">running…</pre>}
      </div>
      <form className="terminal-input-row" onSubmit={submit}>
        <span className="terminal-prompt">{prompt}</span>
        <input
          ref={inputRef}
          className="terminal-input"
          value={input}
          spellCheck="false"
          autoComplete="off"
          aria-label="Terminal command"
          placeholder={busy ? '' : 'help'}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
        />
      </form>
    </div>
  );
}
