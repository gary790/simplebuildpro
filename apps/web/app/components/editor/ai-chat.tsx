// ============================================================
// SimpleBuild Pro — AI Chat Panel (Phase 2: Clean UX)
// AI works silently in the sandbox. User sees only:
//   1. A compact "Working..." progress bar while executing
//   2. The AI's text response
//   3. A small clickable file list at the end
// No verbose tool dumps. No command output in chat.
// ============================================================

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useEditorStore, useChatStore } from '@/lib/store';
import { aiApi, sandboxApi, type AIStreamEvent } from '@/lib/api-client';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import {
  Send, Bot, User, Loader2, Sparkles, Copy, Check,
  RotateCcw, FileCode, ArrowRight, AlertCircle,
  ChevronDown, ChevronRight, Terminal,
} from 'lucide-react';
import clsx from 'clsx';

// ─── Internal tracking (not shown to user) ───────────────────
interface ToolCallEvent {
  toolName: string;
  toolCallId: string;
  status: 'running' | 'success' | 'error';
  input?: Record<string, any>;
  error?: string;
}

// ─── Chat Message Types ──────────────────────────────────────
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  // Internal — tracked but mostly hidden
  toolCalls?: ToolCallEvent[];
  filesChanged?: string[];
  hasError?: boolean;
  errorDetail?: string;
}

// ─── Compact "Working" Indicator ─────────────────────────────
// Shows ONE line: "Working... 4 steps done" with a subtle progress bar
function WorkingIndicator({ toolCalls }: { toolCalls: ToolCallEvent[] }) {
  const [showDetails, setShowDetails] = useState(false);
  const done = toolCalls.filter(tc => tc.status !== 'running').length;
  const total = toolCalls.length;
  const hasRunning = toolCalls.some(tc => tc.status === 'running');
  const hasError = toolCalls.some(tc => tc.status === 'error');
  const currentTool = toolCalls.find(tc => tc.status === 'running');

  // Friendly label for what's happening right now
  const currentLabel = currentTool
    ? currentTool.toolName === 'write_file' ? 'Writing files'
      : currentTool.toolName === 'run_command' ? 'Running command'
      : currentTool.toolName === 'read_file' ? 'Reading files'
      : currentTool.toolName === 'list_files' ? 'Scanning project'
      : 'Working'
    : 'Working';

  return (
    <div className="select-none">
      {/* Main compact line */}
      <button
        onClick={() => setShowDetails(!showDetails)}
        className={clsx(
          'flex items-center gap-2 w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition-colors',
          hasError
            ? 'bg-red-50 text-red-700'
            : hasRunning
              ? 'bg-slate-100 text-slate-600'
              : 'bg-slate-50 text-slate-500',
        )}
      >
        {hasRunning ? (
          <Loader2 size={12} className="animate-spin text-brand-500 shrink-0" />
        ) : hasError ? (
          <AlertCircle size={12} className="text-red-500 shrink-0" />
        ) : (
          <Check size={12} className="text-green-500 shrink-0" />
        )}

        <span className="truncate">
          {hasRunning
            ? `${currentLabel}...`
            : hasError
              ? `Completed with errors (${done}/${total} steps)`
              : `Done (${total} step${total !== 1 ? 's' : ''})`
          }
        </span>

        {/* Mini progress dots */}
        {total > 1 && (
          <span className="ml-auto flex items-center gap-0.5 shrink-0">
            {toolCalls.map((tc, i) => (
              <span
                key={i}
                className={clsx(
                  'w-1.5 h-1.5 rounded-full transition-colors',
                  tc.status === 'running' && 'bg-brand-400 animate-pulse',
                  tc.status === 'success' && 'bg-green-400',
                  tc.status === 'error' && 'bg-red-400',
                )}
              />
            ))}
          </span>
        )}

        {/* Expand toggle */}
        {!hasRunning && (
          <span className="shrink-0 text-slate-400">
            {showDetails ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
      </button>

      {/* Expandable details — only shown on click, after completion */}
      {showDetails && !hasRunning && (
        <div className="mt-1 ml-1 space-y-0.5">
          {toolCalls.map((tc, i) => {
            const label = tc.toolName === 'write_file' ? `Write ${tc.input?.path?.replace(/^\/home\/user\/project\//, '') || 'file'}`
              : tc.toolName === 'run_command' ? `$ ${(tc.input?.command || '').slice(0, 50)}${(tc.input?.command || '').length > 50 ? '...' : ''}`
              : tc.toolName === 'read_file' ? `Read ${tc.input?.path?.replace(/^\/home\/user\/project\//, '') || 'file'}`
              : tc.toolName === 'list_files' ? 'List files'
              : tc.toolName;

            return (
              <div key={i} className="flex items-center gap-1.5 text-2xs text-slate-400 font-mono">
                <span className={clsx(
                  'w-1 h-1 rounded-full shrink-0',
                  tc.status === 'success' ? 'bg-green-400' : 'bg-red-400',
                )} />
                <span className="truncate">{label}</span>
                {tc.status === 'error' && tc.error && (
                  <span className="text-red-400 truncate ml-1">— {tc.error.slice(0, 40)}</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── File Chip (clickable, opens in editor) ──────────────────
function FileChip({ path }: { path: string }) {
  const { openTab, setActiveFile } = useEditorStore.getState();
  const displayPath = path.replace(/^\/home\/user\/project\//, '');

  return (
    <button
      onClick={() => { openTab(displayPath); setActiveFile(displayPath); }}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-slate-100 hover:bg-brand-50 hover:text-brand-700 rounded text-2xs text-slate-600 font-mono transition-colors"
    >
      <FileCode size={9} className="text-brand-500" />
      {displayPath}
    </button>
  );
}

export function AiChat() {
  const { project, updateFile, openTab, setActiveFile, setSandboxUrl } = useEditorStore();
  const {
    conversationId, isLoading,
    setConversationId, setLoading,
  } = useChatStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // ─── Refresh files from sandbox into editor store ──────
  const refreshFilesFromSandbox = useCallback(async (changedPaths?: string[]) => {
    if (!project?.id) return;
    try {
      const { files: fileList } = await sandboxApi.listFiles(project.id);
      for (const f of fileList) {
        if (f.type === 'file') {
          const relativePath = f.path.replace(/^\/home\/user\/project\//, '');
          if (!changedPaths || changedPaths.some(cp => cp.includes(relativePath) || relativePath.includes(cp.replace(/^\/home\/user\/project\//, '')))) {
            try {
              const { content } = await sandboxApi.readFile(project.id, f.path);
              updateFile(relativePath, content);
            } catch {
              // skip unreadable files
            }
          }
        }
      }
    } catch (err) {
      console.warn('[AiChat] Failed to refresh files from sandbox:', err);
    }
  }, [project?.id, updateFile]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !project?.id || isLoading) return;

    const userMsg = input.trim();
    setInput('');
    setLoading(true);

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `assistant-${Date.now()}`;

    setMessages(prev => [
      ...prev,
      {
        id: userMsgId,
        role: 'user',
        content: userMsg,
        timestamp: new Date().toISOString(),
      },
      {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        isStreaming: true,
        toolCalls: [],
        filesChanged: [],
      },
    ]);

    const allFilesChanged: string[] = [];

    try {
      await aiApi.streamMessage(
        {
          projectId: project.id,
          conversationId: conversationId || undefined,
          message: userMsg,
        },
        (event: AIStreamEvent) => {
          switch (event.type) {
            case 'stream_start':
              if (event.conversationId) setConversationId(event.conversationId);
              if (event.sandboxUrl) setSandboxUrl(event.sandboxUrl);
              break;

            case 'text':
              if (event.token) {
                setMessages(prev => prev.map(m =>
                  m.id === assistantMsgId
                    ? { ...m, content: (m.content || '') + event.token }
                    : m
                ));
              }
              break;

            case 'tool_call':
              // Silently track — only the compact WorkingIndicator sees this
              setMessages(prev => prev.map(m =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      toolCalls: [
                        ...(m.toolCalls || []),
                        {
                          toolName: event.toolName || '',
                          toolCallId: event.toolCallId || '',
                          status: 'running' as const,
                          input: event.input,
                        },
                      ],
                    }
                  : m
              ));
              break;

            case 'tool_result':
              setMessages(prev => prev.map(m => {
                if (m.id !== assistantMsgId) return m;
                const toolCalls = [...(m.toolCalls || [])];
                const idx = toolCalls.findLastIndex(
                  tc => tc.toolCallId === event.toolCallId && tc.status === 'running'
                );
                if (idx !== -1) {
                  toolCalls[idx] = {
                    ...toolCalls[idx],
                    status: event.success ? 'success' : 'error',
                    error: event.error,
                  };
                }
                const newFilesChanged = [
                  ...(m.filesChanged || []),
                  ...(event.filesChanged || []),
                ];
                return {
                  ...m,
                  toolCalls,
                  filesChanged: newFilesChanged,
                  hasError: !event.success ? true : m.hasError,
                  errorDetail: event.error || m.errorDetail,
                };
              }));
              if (event.filesChanged) {
                allFilesChanged.push(...event.filesChanged);
              }
              break;

            case 'file_changed':
              if (event.path) {
                const relativePath = event.path.replace(/^\/home\/user\/project\//, '');
                setMessages(prev => prev.map(m =>
                  m.id === assistantMsgId
                    ? { ...m, filesChanged: [...(m.filesChanged || []), event.path!] }
                    : m
                ));
                allFilesChanged.push(event.path);
                if (event.action === 'deleted') {
                  useEditorStore.getState().deleteFile(relativePath);
                }
              }
              break;

            case 'stream_end':
              setMessages(prev => prev.map(m =>
                m.id === assistantMsgId
                  ? { ...m, isStreaming: false }
                  : m
              ));
              setLoading(false);
              if (event.conversationId) setConversationId(event.conversationId);

              if (allFilesChanged.length > 0) {
                refreshFilesFromSandbox(allFilesChanged).then(() => {
                  const htmlFile = allFilesChanged.find(p => p.endsWith('.html'));
                  if (htmlFile) {
                    const rel = htmlFile.replace(/^\/home\/user\/project\//, '');
                    openTab(rel);
                    setActiveFile(rel);
                  }
                });
              }
              break;

            case 'error':
              setMessages(prev => prev.map(m =>
                m.id === assistantMsgId
                  ? { ...m, isStreaming: false, content: `Error: ${event.message}` }
                  : m
              ));
              setLoading(false);
              toast('error', 'AI Error', event.message || 'Something went wrong');
              break;
          }
        },
      );
    } catch (err: any) {
      setMessages(prev => prev.map(m =>
        m.id === assistantMsgId
          ? { ...m, isStreaming: false, content: `Error: ${err.message}` }
          : m
      ));
      setLoading(false);
      toast('error', 'AI Error', err.message);
    }
  }, [input, project?.id, conversationId, isLoading, updateFile, openTab, setActiveFile, setConversationId, setLoading, setSandboxUrl, refreshFilesFromSandbox]);

  const handleCopy = (id: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const clearMessages = () => {
    setMessages([]);
    setConversationId(null);
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-slate-200 bg-slate-50 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-brand-600" />
          <span className="text-sm font-semibold text-slate-700">AI Assistant</span>
          {useEditorStore.getState().sandboxStatus === 'running' && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-2xs bg-green-100 text-green-700 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1 animate-pulse" />
              Live
            </span>
          )}
        </div>
        <button
          onClick={clearMessages}
          className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          title="New conversation"
        >
          <RotateCcw size={13} />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 dark-scroll">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-12 h-12 rounded-2xl bg-brand-50 flex items-center justify-center mb-3">
              <Bot size={20} className="text-brand-600" />
            </div>
            <h3 className="text-sm font-semibold text-slate-900 mb-1">Studio AI</h3>
            <p className="text-xs text-slate-500 max-w-[260px] leading-relaxed">
              Describe what you want to build. I'll handle everything behind the scenes.
            </p>
            <div className="mt-4 space-y-1.5">
              {[
                'Build a landing page for my business',
                'Create a React app with a todo list',
                'Set up an Express API with a database',
                'Build a full-stack app with authentication',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                  className="block w-full text-left px-3 py-2 text-xs text-slate-600 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                >
                  <ArrowRight size={10} className="inline mr-1.5 text-brand-500" />
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div key={msg.id} className={clsx('flex gap-2.5', msg.role === 'user' ? 'justify-end' : 'justify-start')}>
            {msg.role === 'assistant' && (
              <div className="w-6 h-6 rounded-full bg-brand-100 flex items-center justify-center shrink-0 mt-0.5">
                <Bot size={12} className="text-brand-700" />
              </div>
            )}

            <div
              className={clsx(
                'max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed',
                msg.role === 'user'
                  ? 'bg-brand-600 text-white rounded-br-sm'
                  : 'bg-slate-50 border border-slate-200 text-slate-800 rounded-bl-sm',
              )}
            >
              {msg.role === 'assistant' ? (
                <div className="space-y-2">
                  {/* AI's text response */}
                  {msg.content && (
                    <div className="whitespace-pre-wrap break-words text-xs">
                      {msg.content}
                    </div>
                  )}

                  {/* Compact working indicator — ONE line, not a dump */}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <WorkingIndicator toolCalls={msg.toolCalls} />
                  )}

                  {/* Files changed — compact chips at the end (only after done) */}
                  {!msg.isStreaming && msg.filesChanged && msg.filesChanged.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {[...new Set(msg.filesChanged)].map((f) => (
                        <FileChip key={f} path={f} />
                      ))}
                    </div>
                  )}

                  {/* Initial thinking state — before any text or tools */}
                  {msg.isStreaming && !msg.content && (!msg.toolCalls || msg.toolCalls.length === 0) && (
                    <span className="inline-flex items-center gap-1.5 text-slate-400 text-xs">
                      <Loader2 size={12} className="animate-spin" /> Thinking...
                    </span>
                  )}

                  {/* Copy button */}
                  {!msg.isStreaming && msg.content && (
                    <button
                      onClick={() => handleCopy(msg.id, msg.content)}
                      className="mt-1 flex items-center gap-1 text-2xs text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      {copiedId === msg.id ? <Check size={10} /> : <Copy size={10} />}
                      {copiedId === msg.id ? 'Copied' : 'Copy'}
                    </button>
                  )}
                </div>
              ) : (
                <div className="whitespace-pre-wrap break-words">
                  {msg.content}
                </div>
              )}
            </div>

            {msg.role === 'user' && (
              <div className="w-6 h-6 rounded-full bg-slate-200 flex items-center justify-center shrink-0 mt-0.5">
                <User size={12} className="text-slate-600" />
              </div>
            )}
          </div>
        ))}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-slate-200 p-3 bg-white shrink-0">
        <div className="flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Describe what to build..."
            rows={1}
            className="flex-1 resize-none px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent max-h-32"
            style={{ minHeight: '38px' }}
            onInput={(e) => {
              const target = e.target as HTMLTextAreaElement;
              target.style.height = 'auto';
              target.style.height = Math.min(target.scrollHeight, 128) + 'px';
            }}
          />
          <Button
            size="sm"
            onClick={handleSend}
            disabled={!input.trim() || isLoading}
            className="shrink-0"
          >
            {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          </Button>
        </div>
        <p className="text-2xs text-slate-400 mt-1.5 text-center">
          Shift+Enter for new line
        </p>
      </div>
    </div>
  );
}
