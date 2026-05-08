// ============================================================
// SimpleBuild Pro — AI Chat Panel (Phase 2: Sandbox Architecture)
// Tool-calling loop: AI thinks → calls sandbox tools → shows results
// Real Linux sandbox execution via E2B.dev
// ============================================================

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useEditorStore, useChatStore } from '@/lib/store';
import { aiApi, sandboxApi, type AIStreamEvent } from '@/lib/api-client';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import {
  Send, X, Bot, User, Loader2, Sparkles, Copy, Check,
  RotateCcw, CheckCircle2, Circle, FileCode, ArrowRight,
  Terminal, AlertCircle, FolderOpen, Pencil, Trash2,
} from 'lucide-react';
import clsx from 'clsx';

// ─── Tool Call Types ──────────────────────────────────────────
interface ToolCallEvent {
  toolName: string;
  toolCallId: string;
  status: 'running' | 'success' | 'error';
  input?: Record<string, any>;
  result?: any;
  error?: string;
  filesChanged?: string[];
}

// ─── Chat Message Types ──────────────────────────────────────
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  toolCalls?: ToolCallEvent[];
  filesChanged?: string[];
}

// ─── Tool Display Names & Icons ──────────────────────────────
function getToolDisplayName(tool: string): string {
  const names: Record<string, string> = {
    run_command: 'Run Command',
    write_file: 'Write File',
    read_file: 'Read File',
    list_files: 'List Files',
    github_push: 'GitHub Push',
    cloudflare_deploy: 'Cloudflare Deploy',
    vercel_deploy: 'Vercel Deploy',
    export_project: 'Export',
    list_connections: 'Check Connections',
  };
  return names[tool] || tool;
}

function getToolIcon(tool: string): React.ReactNode {
  const iconMap: Record<string, React.ReactNode> = {
    run_command: <Terminal size={12} />,
    write_file: <Pencil size={12} />,
    read_file: <FileCode size={12} />,
    list_files: <FolderOpen size={12} />,
  };
  return iconMap[tool] || <Terminal size={12} />;
}

// ─── Tool Call Badge Component ───────────────────────────────
function ToolCallBadge({ toolCall }: { toolCall: ToolCallEvent }) {
  const [expanded, setExpanded] = useState(false);

  // Truncate long command strings for display
  const displayInput = toolCall.input
    ? toolCall.toolName === 'run_command'
      ? toolCall.input.command?.slice(0, 80) + (toolCall.input.command?.length > 80 ? '...' : '')
      : toolCall.toolName === 'write_file'
        ? toolCall.input.path
        : toolCall.toolName === 'read_file'
          ? toolCall.input.path
          : toolCall.input.path || JSON.stringify(toolCall.input).slice(0, 60)
    : '';

  return (
    <div className="group">
      <button
        onClick={() => setExpanded(!expanded)}
        className={clsx(
          'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs border w-full text-left transition-colors',
          toolCall.status === 'running' && 'bg-amber-50 border-amber-200 text-amber-800',
          toolCall.status === 'success' && 'bg-green-50 border-green-200 text-green-800',
          toolCall.status === 'error' && 'bg-red-50 border-red-200 text-red-800',
        )}
      >
        <span className="shrink-0">{getToolIcon(toolCall.toolName)}</span>
        <span className="font-medium shrink-0">{getToolDisplayName(toolCall.toolName)}</span>
        {displayInput && (
          <span className="font-mono text-2xs truncate opacity-70">{displayInput}</span>
        )}
        <span className="ml-auto shrink-0">
          {toolCall.status === 'running' && <Loader2 size={12} className="animate-spin" />}
          {toolCall.status === 'success' && <CheckCircle2 size={12} className="text-green-600" />}
          {toolCall.status === 'error' && <AlertCircle size={12} className="text-red-600" />}
        </span>
      </button>

      {/* Expanded details */}
      {expanded && toolCall.status !== 'running' && (
        <div className="mt-1 ml-2 px-2.5 py-2 bg-slate-900 rounded-md text-2xs font-mono text-slate-300 max-h-32 overflow-y-auto whitespace-pre-wrap">
          {toolCall.status === 'error' && toolCall.error && (
            <div className="text-red-400 mb-1">{toolCall.error}</div>
          )}
          {toolCall.result && typeof toolCall.result === 'string'
            ? toolCall.result.slice(0, 500)
            : toolCall.result
              ? JSON.stringify(toolCall.result, null, 2).slice(0, 500)
              : 'No output'}
        </div>
      )}

      {/* Files changed badges */}
      {toolCall.filesChanged && toolCall.filesChanged.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1 ml-2">
          {toolCall.filesChanged.map((f) => (
            <FileChangedBadge key={f} path={f} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── File Changed Badge Component ────────────────────────────
function FileChangedBadge({ path }: { path: string }) {
  const { openTab, setActiveFile } = useEditorStore.getState();
  // Strip the sandbox prefix for display
  const displayPath = path.replace(/^\/home\/user\/project\//, '');

  return (
    <button
      onClick={() => { openTab(displayPath); setActiveFile(displayPath); }}
      className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded text-2xs text-slate-700 font-mono transition-colors"
    >
      <FileCode size={10} className="text-brand-600" />
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
          // Only refresh changed files if we know which ones, otherwise refresh all
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

    // Add user message
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

    // Track all files changed during this stream for end-of-stream refresh
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
              if (event.conversationId) {
                setConversationId(event.conversationId);
              }
              if (event.sandboxUrl) {
                setSandboxUrl(event.sandboxUrl);
              }
              break;

            case 'text':
              // AI thinking/response text — append token
              if (event.token) {
                setMessages(prev => prev.map(m =>
                  m.id === assistantMsgId
                    ? { ...m, content: (m.content || '') + event.token }
                    : m
                ));
              }
              break;

            case 'tool_call':
              // AI is calling a sandbox tool — show it running
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
              // Tool finished — update its status
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
                    result: event.result,
                    error: event.error,
                    filesChanged: event.filesChanged,
                  };
                }
                // Accumulate changed files
                const newFilesChanged = [
                  ...(m.filesChanged || []),
                  ...(event.filesChanged || []),
                ];
                return { ...m, toolCalls, filesChanged: newFilesChanged };
              }));
              // Track for end-of-stream refresh
              if (event.filesChanged) {
                allFilesChanged.push(...event.filesChanged);
              }
              break;

            case 'file_changed':
              // Individual file change notification
              if (event.path) {
                const relativePath = event.path.replace(/^\/home\/user\/project\//, '');
                setMessages(prev => prev.map(m =>
                  m.id === assistantMsgId
                    ? { ...m, filesChanged: [...(m.filesChanged || []), event.path!] }
                    : m
                ));
                allFilesChanged.push(event.path);

                // If a file was deleted, remove from editor
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

              if (event.conversationId) {
                setConversationId(event.conversationId);
              }

              // Refresh changed files from sandbox into editor
              if (allFilesChanged.length > 0) {
                refreshFilesFromSandbox(allFilesChanged).then(() => {
                  // Auto-open the first HTML file if one was created
                  const htmlFile = allFilesChanged.find(p => p.endsWith('.html'));
                  if (htmlFile) {
                    const rel = htmlFile.replace(/^\/home\/user\/project\//, '');
                    openTab(rel);
                    setActiveFile(rel);
                  }
                });
                toast(
                  'success',
                  `Updated ${allFilesChanged.length} file${allFilesChanged.length > 1 ? 's' : ''}`,
                  'Changes applied to sandbox',
                );
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
          {/* Sandbox status indicator */}
          {useEditorStore.getState().sandboxStatus === 'running' && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-2xs bg-green-100 text-green-700 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1 animate-pulse" />
              Sandbox
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearMessages}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="New conversation"
          >
            <RotateCcw size={13} />
          </button>
        </div>
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
              Describe what you want to build. I'll create files, run commands, and set up your project in a real Linux sandbox.
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
                  {/* Text content */}
                  {msg.content && (
                    <div className="whitespace-pre-wrap break-words text-xs">
                      {msg.content}
                    </div>
                  )}

                  {/* Tool calls section */}
                  {msg.toolCalls && msg.toolCalls.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {msg.toolCalls.map((tc, idx) => (
                        <ToolCallBadge key={`${tc.toolCallId}-${idx}`} toolCall={tc} />
                      ))}
                    </div>
                  )}

                  {/* Files changed summary */}
                  {!msg.isStreaming && msg.filesChanged && msg.filesChanged.length > 0 && (
                    <div className="pt-1">
                      <p className="text-2xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Files Changed</p>
                      <div className="flex flex-wrap gap-1">
                        {[...new Set(msg.filesChanged)].map((f) => (
                          <FileChangedBadge key={f} path={f} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Loading state */}
                  {msg.isStreaming && !msg.content && (!msg.toolCalls || msg.toolCalls.length === 0) && (
                    <span className="inline-flex items-center gap-1 text-slate-400 text-xs">
                      <Loader2 size={12} className="animate-spin" /> Thinking...
                    </span>
                  )}

                  {/* Streaming with active tool call */}
                  {msg.isStreaming && msg.toolCalls && msg.toolCalls.some(tc => tc.status === 'running') && (
                    <span className="inline-flex items-center gap-1 text-amber-600 text-2xs mt-1">
                      <Loader2 size={10} className="animate-spin" /> Executing...
                    </span>
                  )}

                  {/* Copy button */}
                  {!msg.isStreaming && msg.content && (
                    <button
                      onClick={() => handleCopy(msg.id, msg.content)}
                      className="mt-1.5 flex items-center gap-1 text-2xs text-slate-400 hover:text-slate-600 transition-colors"
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
          AI executes in a real sandbox. Shift+Enter for new line.
        </p>
      </div>
    </div>
  );
}
