// ============================================================
// SimpleBuild Pro — Monaco Code Editor Wrapper
// Full VS Code experience in the browser
// FIXED: Reactive to Zustand store updates via key prop
// ============================================================

'use client';

import { useRef, useCallback, useEffect, useState } from 'react';
import Editor, { type OnMount, type OnChange } from '@monaco-editor/react';
import { useEditorStore } from '@/lib/store';

const LANGUAGE_MAP: Record<string, string> = {
  html: 'html', htm: 'html',
  css: 'css', scss: 'scss', less: 'less',
  js: 'javascript', jsx: 'javascript',
  ts: 'typescript', tsx: 'typescriptreact',
  json: 'json',
  md: 'markdown',
  xml: 'xml', svg: 'xml',
  yaml: 'yaml', yml: 'yaml',
  txt: 'plaintext',
};

function getLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || '';
  return LANGUAGE_MAP[ext] || 'plaintext';
}

interface CodeEditorProps {
  onSave?: (path: string, content: string) => void;
}

export function CodeEditor({ onSave }: CodeEditorProps) {
  const { activeFile, files, updateFile } = useEditorStore();
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<any>(null);
  const isExternalUpdate = useRef(false);

  const content = activeFile ? files.get(activeFile) ?? '' : '';
  const language = activeFile ? getLanguage(activeFile) : 'plaintext';

  // Track content version to force Monaco re-render when store changes externally
  // This fixes the issue where AI-generated code doesn't appear in the editor
  const [contentVersion, setContentVersion] = useState(0);
  const lastKnownContent = useRef<string>('');

  // Watch for external content changes (from AI streaming)
  useEffect(() => {
    if (!activeFile) return;
    const currentContent = files.get(activeFile) ?? '';

    // If content changed and it wasn't from user typing in this editor
    if (currentContent !== lastKnownContent.current && editorRef.current) {
      const editorValue = editorRef.current.getValue();
      if (editorValue !== currentContent) {
        // External update detected — force Monaco to sync
        isExternalUpdate.current = true;
        editorRef.current.setValue(currentContent);
        isExternalUpdate.current = false;
        setContentVersion(v => v + 1);
      }
    }
    lastKnownContent.current = currentContent;
  }, [activeFile, files, content]);

  const handleMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Configure editor theme
    monaco.editor.defineTheme('simplebuild-dark', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6A9955' },
        { token: 'keyword', foreground: '569CD6' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'tag', foreground: '569CD6' },
        { token: 'attribute.name', foreground: '9CDCFE' },
        { token: 'attribute.value', foreground: 'CE9178' },
      ],
      colors: {
        'editor.background': '#1E1E1E',
        'editor.foreground': '#D4D4D4',
        'editor.lineHighlightBackground': '#2A2D2E',
        'editor.selectionBackground': '#264F78',
        'editorCursor.foreground': '#AEAFAD',
        'editorWhitespace.foreground': '#3B3B3B',
        'editorIndentGuide.background': '#404040',
        'editorIndentGuide.activeBackground': '#707070',
      },
    });

    monaco.editor.setTheme('simplebuild-dark');

    // Keyboard shortcuts
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      if (activeFile && onSave) {
        onSave(activeFile, editor.getValue());
      }
    });

    // Better IntelliSense settings
    editor.updateOptions({
      minimap: { enabled: true, maxColumn: 80 },
      fontSize: 13,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontLigatures: true,
      lineNumbers: 'on',
      renderWhitespace: 'selection',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true, indentation: true },
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      tabSize: 2,
      formatOnPaste: true,
      autoClosingBrackets: 'always',
      autoClosingQuotes: 'always',
      suggest: {
        showKeywords: true,
        showSnippets: true,
      },
      padding: { top: 8 },
    });

    // Set initial content
    lastKnownContent.current = content;
    editor.focus();
  };

  const handleChange: OnChange = useCallback(
    (value) => {
      // Skip if this was triggered by our external setValue
      if (isExternalUpdate.current) return;

      if (activeFile && value !== undefined) {
        lastKnownContent.current = value;
        updateFile(activeFile, value);
      }
    },
    [activeFile, updateFile],
  );

  // Refocus editor when active file changes
  useEffect(() => {
    if (editorRef.current && activeFile) {
      editorRef.current.focus();
    }
  }, [activeFile]);

  if (!activeFile) {
    return (
      <div className="h-full flex items-center justify-center bg-[#1E1E1E]">
        <div className="text-center">
          <p className="text-sm text-slate-500 mb-1">No file open</p>
          <p className="text-xs text-slate-600">Select a file from the sidebar or ask the AI to generate code</p>
        </div>
      </div>
    );
  }

  return (
    <Editor
      key={activeFile} // Force remount when switching files
      height="100%"
      language={language}
      value={content}
      onChange={handleChange}
      onMount={handleMount}
      theme="simplebuild-dark"
      loading={
        <div className="h-full flex items-center justify-center bg-[#1E1E1E]">
          <div className="flex items-center gap-2 text-slate-500">
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <span className="text-xs">Loading editor...</span>
          </div>
        </div>
      }
      options={{
        readOnly: false,
        automaticLayout: true,
      }}
    />
  );
}
