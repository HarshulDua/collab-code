import { useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { MonacoBinding } from 'y-monaco';
import { watchRemoteCursorStyles } from '../../lib/remoteCursorStyles';
import { monacoLanguageForPath } from '../../lib/languages';

export function CodeEditor({ filesMap, activeFile, awareness }) {
  const editorRef = useRef(null);
  const monacoRef = useRef(null);
  const modelsRef = useRef(new Map());
  const bindingRef = useRef(null);
  const boundTextRef = useRef(null);

  function bindToFile(filePath) {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !filePath) return;

    const ytext = filesMap.get(filePath);
    if (!ytext) return;
    // Already bound to this exact Y.Text instance — rebinding would destroy
    // and recreate the binding on every unrelated map change (and drop the
    // user's cursor), so this is the common no-op path.
    if (bindingRef.current && boundTextRef.current === ytext) return;

    bindingRef.current?.destroy();
    bindingRef.current = null;

    let model = modelsRef.current.get(filePath);
    if (!model) {
      model = monaco.editor.createModel('', monacoLanguageForPath(filePath));
      modelsRef.current.set(filePath, model);
    }
    editor.setModel(model);

    boundTextRef.current = ytext;
    bindingRef.current = new MonacoBinding(ytext, model, new Set([editor]), awareness);
  }

  function handleMount(editor, monaco) {
    editorRef.current = editor;
    monacoRef.current = monaco;
    bindToFile(activeFile);
  }

  useEffect(() => {
    bindToFile(activeFile);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFile, filesMap]);

  // A Y.Map value can be *replaced* by a concurrent write from another
  // client (two clients creating the same path at once, a git restore
  // swapping the tree, …). When that happens the editor is still bound to
  // the old, now-orphaned Y.Text: edits typed into it merge into nothing
  // and no remote edits ever arrive — the doc silently stops being
  // collaborative for that user. Watching the map lets the editor re-bind
  // to whichever instance actually won.
  useEffect(() => {
    const onMapChange = (event) => {
      if (!activeFile) return;
      if (!event.keysChanged || event.keysChanged.has(activeFile)) {
        if (filesMap.get(activeFile) !== boundTextRef.current) bindToFile(activeFile);
      }
    };
    filesMap.observe(onMapChange);
    return () => filesMap.unobserve(onMapChange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filesMap, activeFile]);

  useEffect(() => watchRemoteCursorStyles(awareness), [awareness]);

  useEffect(
    () => () => {
      bindingRef.current?.destroy();
      modelsRef.current.forEach((model) => model.dispose());
    },
    []
  );

  return (
    <div className="code-editor">
      <Editor
        height="100%"
        theme="vs-dark"
        onMount={handleMount}
        options={{
          minimap: { enabled: false },
          fontSize: 13,
          lineHeight: 20,
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          padding: { top: 10 },
          renderLineHighlight: 'line',
          automaticLayout: true,
        }}
      />
    </div>
  );
}
