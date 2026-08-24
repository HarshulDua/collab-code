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

  function bindToFile(filePath) {
    const editor = editorRef.current;
    const monaco = monacoRef.current;
    if (!editor || !monaco || !filePath) return;

    bindingRef.current?.destroy();
    bindingRef.current = null;

    let model = modelsRef.current.get(filePath);
    if (!model) {
      model = monaco.editor.createModel('', monacoLanguageForPath(filePath));
      modelsRef.current.set(filePath, model);
    }
    editor.setModel(model);

    const ytext = filesMap.get(filePath);
    if (!ytext) return;
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
        height="60vh"
        theme="vs-dark"
        onMount={handleMount}
        options={{ minimap: { enabled: false }, fontSize: 14 }}
      />
    </div>
  );
}
