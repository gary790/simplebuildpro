// ============================================================
// SimpleBuild Pro — AI Chat Panel
// Structured streaming: plan → files → explanation
// Code goes into editor, NOT into chat
// ============================================================

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useEditorStore, useChatStore } from '@/lib/store';
import { aiApi, type AIStreamEvent } from '@/lib/api-client';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import {
  Send, X, Bot, User, Loader2, Sparkles, Copy, Check,
  RotateCcw, CheckCircle2, Circle, FileCode, ArrowRight,
} from 'lucide-react';
import clsx from 'clsx';

// ─── Plan Item Component ─────────────────────────────────────
function PlanItem({ text, completed }: { text: string; completed: boolean }) {
  return (
    <div className="flex items-start gap-2 py-0.5">
      {completed ? (
        <CheckCircle2 size={14} className="text-green-500 mt-0.5 shrink-0" />
      ) : (
        <Circle size={14} className="text-slate-300 mt-0.5 shrink-0" />
      )}
      <span className={clsx(
        'text-xs leading-relaxed',
        completed ? 'text-slate-500 line-through' : 'text-slate-700',
      )}>
        {text}
      </span>
    </div>
  );
}

// ─── File Badge Component ────────────────────────────────────
function FileBadge({ path, isStreaming }: { path: string; isStreaming?: boolean }) {
  const { openTab, setActiveFile } = useEditorStore.getState();

  return (
    <button
      onClick={() => { openTab(path); setActiveFile(path); }}
      className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 hover:bg-slate-200 rounded text-xs text-slate-700 font-mono transition-colors"
    >
      <FileCode size={10} className={isStreaming ? 'text-amber-500 animate-pulse' : 'text-brand-600'} />
      {path}
      {isStreaming && <Loader2 size={10} className="animate-spin text-amber-500" />}
    </button>
  );
}

// ─── Chat Message Types ──────────────────────────────────────
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  plan?: string[];
  planCompleted?: number[];
  files?: string[];
  streamingFile?: string;
  explanation?: string;
}

export function AiChat() {
  const { project, updateFile, isChatOpen, toggleChat, openTab, setActiveFile } = useEditorStore();
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

  // Focus input on open
  useEffect(() => {
    if (isChatOpen) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isChatOpen]);

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
        plan: [],
        planCompleted: [],
        files: [],
      },
    ]);

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
              break;

            case 'plan':
              setMessages(prev => prev.map(m =>
                m.id === assistantMsgId
                  ? { ...m, plan: event.items || [], content: 'Building...' }
                  : m
              ));
              break;

            case 'file_start':
              setMessages(prev => prev.map(m =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      streamingFile: event.path,
                      files: [...(m.files || []).filter(f => f !== event.path), event.path!],
                    }
                  : m
              ));
              break;

            case 'file_chunk':
              // Stream file content directly into the editor store
              if (event.path && event.content) {
                const { files } = useEditorStore.getState();
                const current = files.get(event.path) || '';
                // Only append if this is incremental
                // The chunk is just the new token, not accumulated
                updateFile(event.path, current + event.content);
              }
              break;

            case 'file_end':
              // Set the COMPLETE file content (authoritative)
              if (event.path && event.content !== undefined) {
                updateFile(event.path, event.content);
                // Auto-open the file in a tab
                openTab(event.path);
                // If this is index.html, make it active
                if (event.path === 'index.html') {
                  setActiveFile(event.path);
                }
              }
              setMessages(prev => prev.map(m =>
                m.id === assistantMsgId
                  ? { ...m, streamingFile: undefined }
                  : m
              ));
              break;

            case 'plan_progress':
              if (event.completedIndex !== undefined) {
                setMessages(prev => prev.map(m =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        planCompleted: [...(m.planCompleted || []), event.completedIndex!],
                      }
                    : m
                ));
              }
              break;

            case 'explanation':
              setMessages(prev => prev.map(m =>
                m.id === assistantMsgId
                  ? { ...m, explanation: event.text, content: event.text || '' }
                  : m
              ));
              break;

            case 'text_token':
              // Plain text response (no code generation)
              if (event.token) {
                setMessages(prev => prev.map(m =>
                  m.id === assistantMsgId
                    ? { ...m, content: (m.content || '') + event.token }
                    : m
                ));
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

              // Open first file if not already open
              if (event.filesPaths && event.filesPaths.length > 0) {
                const primary = event.filesPaths.find(p => p === 'index.html') || event.filesPaths[0];
                openTab(primary);
                setActiveFile(primary);
                // Open all other files as tabs
                for (const p of event.filesPaths) {
                  openTab(p);
                }
                toast('success', `Generated ${event.filesPaths.length} file${event.filesPaths.length > 1 ? 's' : ''}`, 'Code is in the editor.');
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
  }, [input, project?.id, conversationId, isLoading, updateFile, openTab, setActiveFile, setConversationId, setLoading]);

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

  if (!isChatOpen) return null;

  return (
    <div className="flex flex-col h-full bg-white border-l border-slate-200 w-[380px] shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-slate-200 bg-slate-50 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-brand-600" />
          <span className="text-sm font-semibold text-slate-700">AI Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={clearMessages}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
            title="New conversation"
          >
            <RotateCcw size={13} />
          </button>
          <button
            onClick={toggleChat}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <X size={14} />
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
              Describe what you want to create. I'll generate code, apps, documents, or anything — directly into the editor with a live preview.
            </p>
            <div className="mt-4 space-y-1.5">
              {[
                'Build a landing page for my business',
                'Create a React dashboard with charts',
                'Generate a Python data processing script',
                'Build a full-stack todo app with API',
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
                  {/* Plan section */}
                  {msg.plan && msg.plan.length > 0 && (
                    <div className="space-y-0.5">
                      <p className="text-2xs font-semibold text-slate-500 uppercase tracking-wide mb-1">Plan</p>
                      {msg.plan.map((item, idx) => (
                        <PlanItem
                          key={idx}
                          text={item}
                          completed={(msg.planCompleted || []).includes(idx)}
                        />
                      ))}
                    </div>
                  )}

                  {/* Files section */}
                  {msg.files && msg.files.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {msg.files.map((f) => (
                        <FileBadge
                          key={f}
                          path={f}
                          isStreaming={msg.streamingFile === f}
                        />
                      ))}
                    </div>
                  )}

                  {/* Explanation / content */}
                  {msg.explanation ? (
                    <p className="text-xs text-slate-700 pt-1 leading-relaxed">
                      {msg.explanation}
                    </p>
                  ) : msg.content && !msg.plan?.length && !msg.files?.length ? (
                    <div className="whitespace-pre-wrap break-words text-xs">
                      {msg.content}
                    </div>
                  ) : null}

                  {/* Loading state */}
                  {msg.isStreaming && !msg.plan?.length && !msg.content && (
                    <span className="inline-flex items-center gap-1 text-slate-400 text-xs">
                      <Loader2 size={12} className="animate-spin" /> Thinking...
                    </span>
                  )}

                  {/* Streaming indicator */}
                  {msg.isStreaming && msg.streamingFile && (
                    <span className="inline-flex items-center gap-1 text-amber-600 text-2xs mt-1">
                      <Loader2 size={10} className="animate-spin" /> Writing {msg.streamingFile}...
                    </span>
                  )}

                  {/* Copy button */}
                  {!msg.isStreaming && msg.explanation && (
                    <button
                      onClick={() => handleCopy(msg.id, msg.explanation || msg.content)}
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
          Code streams into the editor. Shift+Enter for new line.
        </p>
      </div>
    </div>
  );
}
