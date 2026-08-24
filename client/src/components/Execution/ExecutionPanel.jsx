import { useEffect, useState } from 'react';
import { languageForPath, isRunnable } from '../../lib/languages';

/**
 * Run state for the active file. Split out from the rendering so the Run
 * controls can sit permanently in the bottom panel's tab row while the output
 * lives inside the (switchable) Output pane — one source of state, two places
 * it surfaces.
 */
export function useExecution({ socket, roomId, branch, filesMap, activeFile }) {
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

  return { running, runBy, result, error, stdin, setStdin, showStdin, setShowStdin, run, runnable, activeFile };
}

/** Run + stdin buttons. Always visible, whichever bottom tab is open. */
export function ExecutionControls({ exec, onActivate }) {
  return (
    <span className="execution-toolbar">
      <button
        onClick={() => {
          onActivate?.();
          exec.run();
        }}
        disabled={exec.running || !exec.runnable}
      >
        {exec.running ? `Running (${exec.runBy})…` : `Run ${exec.activeFile}`}
      </button>
      <button
        className="execution-stdin-toggle"
        onClick={() => {
          onActivate?.();
          exec.setShowStdin((v) => !v);
        }}
      >
        stdin {exec.showStdin ? '▲' : '▼'}
      </button>
    </span>
  );
}

/** Stdin box and the run's output. Lives in the Output pane. */
export function ExecutionOutput({ exec }) {
  const { result, error, showStdin, stdin, setStdin } = exec;
  return (
    <div className="execution-panel">
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
