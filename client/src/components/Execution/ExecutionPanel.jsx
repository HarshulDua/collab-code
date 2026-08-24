import { useEffect, useState } from 'react';
import { languageForPath, isRunnable } from '../../lib/languages';

export function ExecutionPanel({ socket, roomId, branch, filesMap, activeFile }) {
  const [running, setRunning] = useState(false);
  const [runBy, setRunBy] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [stdin, setStdin] = useState('');
  const [showStdin, setShowStdin] = useState(false);

  useEffect(() => {
    function onStarted({ by }) {
      setRunning(true);
      setRunBy(by);
      setResult(null);
      setError(null);
    }
    function onResult({ result: r }) {
      setRunning(false);
      setResult(r);
    }
    function onError({ error: e }) {
      setRunning(false);
      setError(e);
    }

    socket.on('execution:started', onStarted);
    socket.on('execution:result', onResult);
    socket.on('execution:error', onError);
    return () => {
      socket.off('execution:started', onStarted);
      socket.off('execution:result', onResult);
      socket.off('execution:error', onError);
    };
  }, [socket]);

  const language = languageForPath(activeFile);
  const runnable = isRunnable(activeFile);

  function run() {
    if (!runnable) {
      setError(
        `No runner for "${activeFile}" — supported extensions: .py, .js/.mjs/.cjs, .ts, .c, .cpp, .go, .rs, .java, .cs`
      );
      return;
    }
    const files = {};
    filesMap.forEach((ytext, path) => {
      files[path] = ytext.toString();
    });
    socket.emit(
      'execution:run',
      { roomId, branch, language, files, entryPath: activeFile, stdin: stdin || undefined },
      (ack) => {
        if (ack?.error) setError(ack.error);
      }
    );
  }

  return (
    <div className="execution-panel">
      <div className="execution-toolbar">
        <button onClick={run} disabled={running || !runnable}>
          {running ? `Running (${runBy})…` : `Run ${activeFile}`}
        </button>
        <button className="execution-stdin-toggle" onClick={() => setShowStdin((v) => !v)}>
          stdin {showStdin ? '▲' : '▼'}
        </button>
      </div>
      {showStdin && (
        <textarea
          className="execution-stdin"
          placeholder="Input for input() calls, one value per line…"
          value={stdin}
          onChange={(e) => setStdin(e.target.value)}
        />
      )}
      <pre className="execution-output">
        {error && <div className="execution-error">{error}</div>}
        {result && (
          <>
            {result.stdout}
            {result.stderr && <span className="execution-stderr">{result.stderr}</span>}
            {result.timedOut && <div className="execution-badge">Timed out</div>}
            <div className="execution-meta">
              exit code: {result.exitCode ?? 'n/a'} · {result.durationMs}ms
            </div>
          </>
        )}
      </pre>
    </div>
  );
}
