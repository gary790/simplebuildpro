// ============================================================
// SimpleBuild Pro — AI Chat Panel (Phase 3: Single-Pass Speed)
// ONE AI call. Files stream in real-time. Written to WebContainer
// instantly. User sees: brief text + compact file chips. That's it.
// + button for attaching images/files.
// ============================================================

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useEditorStore, useChatStore } from '@/lib/store';
import { aiApi, assetsApi, type AIStreamEvent } from '@/lib/api-client';
import * as wc from '@/lib/webcontainer';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import {
  Send,
  Bot,
  User,
  Loader2,
  Sparkles,
  Copy,
  Check,
  RotateCcw,
  FileCode,
  ArrowRight,
  Plus,
  Paperclip,
  X,
  Image as ImageIcon,
  File as FileIcon,
} from 'lucide-react';
import clsx from 'clsx';

// ─── Chat Message Types ──────────────────────────────────────
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  filesWritten?: string[];
  shellCommands?: string[];
  currentFile?: string | null; // file currently being streamed
  attachments?: { filename: string; mimeType: string; url: string }[];
}

// ─── Attachment preview (before sending) ─────────────────────
interface PendingAttachment {
  file: File;
  previewUrl?: string;
}

// ─── File Chip (clickable, opens in editor) ──────────────────
function FileChip({ path }: { path: string }) {
  const { openTab, setActiveFile } = useEditorStore.getState();

  return (
    <button
      onClick={() => {
        openTab(path);
        setActiveFile(path);
      }}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-slate-100 hover:bg-brand-50 hover:text-brand-700 rounded text-2xs text-slate-600 font-mono transition-colors"
    >
      <FileCode size={9} className="text-brand-500" />
      {path}
    </button>
  );
}

// ─── Writing Indicator (shows during file streaming) ─────────
function WritingIndicator({
  currentFile,
  filesWritten,
}: {
  currentFile: string | null;
  filesWritten: string[];
}) {
  if (!currentFile && filesWritten.length === 0) return null;

  return (
    <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-slate-100 text-xs text-slate-600">
      <Loader2 size={12} className="animate-spin text-brand-500 shrink-0" />
      <span className="truncate">
        {currentFile
          ? `Writing ${currentFile}...`
          : `Done — ${filesWritten.length} file${filesWritten.length !== 1 ? 's' : ''}`}
      </span>
      {filesWritten.length > 0 && currentFile && (
        <span className="ml-auto text-2xs text-slate-400 shrink-0">{filesWritten.length} done</span>
      )}
    </div>
  );
}

export function AiChat() {
  const { project, updateFile, openTab, setActiveFile, setStreamingFile } = useEditorStore();
  const { conversationId, isLoading, setConversationId, setLoading } = useChatStore();

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [pendingAttachments, setPendingAttachments] = useState<PendingAttachment[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Load conversation history from DB on mount ─────────
  useEffect(() => {
    if (!project?.id || historyLoaded) return;

    const loadHistory = async () => {
      try {
        const conversations = await aiApi.getConversations(project.id);
        if (conversations && conversations.length > 0) {
          const latestConv = conversations[0];
          setConversationId(latestConv.id);

          const convData = await aiApi.getMessages(project.id, latestConv.id);
          if (convData?.messages && convData.messages.length > 0) {
            const loadedMessages: ChatMessage[] = convData.messages.map((m: any) => ({
              id: m.id,
              role: m.role as 'user' | 'assistant',
              content: m.content || '',
              timestamp: m.createdAt || new Date().toISOString(),
              isStreaming: false,
              filesWritten: m.appliedFiles ? [] : undefined,
              attachments: m.attachments || undefined,
            }));
            setMessages(loadedMessages);
          }
        }
      } catch (err: any) {
        console.warn('[AiChat] Failed to load history:', err.message);
      } finally {
        setHistoryLoaded(true);
      }
    };

    loadHistory();
  }, [project?.id, historyLoaded, setConversationId]);

  // Auto-scroll to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 100);
  }, []);

  // ─── Handle file attachment ────────────────────────────
  const handleAttachFiles = useCallback((fileList: FileList | null) => {
    if (!fileList) return;
    const newAttachments: PendingAttachment[] = [];
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const att: PendingAttachment = { file };
      if (file.type.startsWith('image/')) {
        att.previewUrl = URL.createObjectURL(file);
      }
      newAttachments.push(att);
    }
    setPendingAttachments((prev) => [...prev, ...newAttachments]);
  }, []);

  const removeAttachment = useCallback((index: number) => {
    setPendingAttachments((prev) => {
      const next = [...prev];
      if (next[index]?.previewUrl) {
        URL.revokeObjectURL(next[index].previewUrl!);
      }
      next.splice(index, 1);
      return next;
    });
  }, []);

  // ─── Upload attachments and get URLs ───────────────────
  const uploadAttachments = useCallback(async (): Promise<
    { filename: string; mimeType: string; url: string }[]
  > => {
    if (!project?.id || pendingAttachments.length === 0) return [];

    const uploaded: { filename: string; mimeType: string; url: string }[] = [];
    for (const att of pendingAttachments) {
      try {
        const asset = await assetsApi.upload(project.id, att.file);
        uploaded.push({
          filename: att.file.name,
          mimeType: att.file.type,
          url: asset.cdnUrl,
        });
      } catch (err: any) {
        console.warn('[AiChat] Failed to upload attachment:', err.message);
        toast('error', 'Upload failed', `Could not upload ${att.file.name}`);
      }
    }
    return uploaded;
  }, [project?.id, pendingAttachments]);

  // ─── Send message ──────────────────────────────────────
  const handleSend = useCallback(async () => {
    if (!input.trim() || !project?.id || isLoading) return;

    const userMsg = input.trim();
    setInput('');
    setLoading(true);

    // Upload any pending attachments first
    const attachments = await uploadAttachments();
    setPendingAttachments([]);

    const userMsgId = `user-${Date.now()}`;
    const assistantMsgId = `assistant-${Date.now()}`;

    setMessages((prev) => [
      ...prev,
      {
        id: userMsgId,
        role: 'user',
        content: userMsg,
        timestamp: new Date().toISOString(),
        attachments: attachments.length > 0 ? attachments : undefined,
      },
      {
        id: assistantMsgId,
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
        isStreaming: true,
        filesWritten: [],
        shellCommands: [],
        currentFile: null,
      },
    ]);

    // Track file content accumulation for WebContainer writes
    let currentFilePath: string | null = null;
    let currentFileContent = '';

    try {
      await aiApi.streamMessage(
        {
          projectId: project.id,
          conversationId: conversationId || undefined,
          message: userMsg,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
        (event: AIStreamEvent) => {
          switch (event.type) {
            case 'stream_start':
              if (event.conversationId) setConversationId(event.conversationId);
              break;

            case 'text':
              if (event.token) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, content: (m.content || '') + event.token }
                      : m,
                  ),
                );
              }
              break;

            case 'file_start':
              if (event.path) {
                currentFilePath = event.path;
                currentFileContent = '';
                setStreamingFile(event.path);
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId ? { ...m, currentFile: event.path } : m,
                  ),
                );
              }
              break;

            case 'file_content':
              if (event.content && currentFilePath) {
                currentFileContent += event.content;
              }
              break;

            case 'file_end':
              if (event.path) {
                // Write to editor store
                updateFile(event.path, currentFileContent);

                // Write to WebContainer (fire-and-forget)
                if (wc.getInstance()) {
                  wc.writeFile(event.path, currentFileContent).catch((err) => {
                    console.warn('[AiChat] WebContainer write failed:', err);
                  });
                }

                // Update message state
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? {
                          ...m,
                          filesWritten: [...(m.filesWritten || []), event.path!],
                          currentFile: null,
                        }
                      : m,
                  ),
                );

                currentFilePath = null;
                currentFileContent = '';
                setStreamingFile(null);
              }
              break;

            case 'shell_command':
              if (event.command) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantMsgId
                      ? { ...m, shellCommands: [...(m.shellCommands || []), event.command!] }
                      : m,
                  ),
                );

                // Run in WebContainer (fire-and-forget)
                if (wc.getInstance()) {
                  const parts = event.command.split(' ');
                  wc.runCommand(parts[0], parts.slice(1)).catch((err) => {
                    console.warn('[AiChat] WebContainer command failed:', err);
                  });
                }
              }
              break;

            case 'stream_end':
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, isStreaming: false, currentFile: null } : m,
                ),
              );
              setLoading(false);
              setStreamingFile(null);
              if (event.conversationId) setConversationId(event.conversationId);

              // Open first created file in editor
              if (event.filesChanged && event.filesChanged.length > 0) {
                const htmlFile = event.filesChanged.find((p) => p.endsWith('.html'));
                const firstFile = htmlFile || event.filesChanged[0];
                openTab(firstFile);
                setActiveFile(firstFile);
              }
              break;

            case 'error':
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        isStreaming: false,
                        content: `Error: ${event.message}`,
                        currentFile: null,
                      }
                    : m,
                ),
              );
              setLoading(false);
              setStreamingFile(null);
              toast('error', 'AI Error', event.message || 'Something went wrong');
              break;
          }
        },
      );
    } catch (err: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId
            ? { ...m, isStreaming: false, content: `Error: ${err.message}`, currentFile: null }
            : m,
        ),
      );
      setLoading(false);
      setStreamingFile(null);
      toast('error', 'AI Error', err.message);
    }
  }, [
    input,
    project?.id,
    conversationId,
    isLoading,
    updateFile,
    openTab,
    setActiveFile,
    setConversationId,
    setLoading,
    setStreamingFile,
    uploadAttachments,
  ]);

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
    setHistoryLoaded(true); // Don't re-load history after clearing
  };

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="flex items-center justify-between px-4 h-12 border-b border-slate-200 bg-slate-50 shrink-0">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-brand-600" />
          <span className="text-sm font-semibold text-slate-700">AI Assistant</span>
          {useEditorStore.getState().webcontainerReady && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-2xs bg-green-100 text-green-700 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 mr-1 animate-pulse" />
              Ready
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
              Describe what you want to build. Files appear instantly.
            </p>
            <div className="mt-4 space-y-1.5">
              {[
                'Build a landing page for my SaaS',
                'Create a portfolio with dark mode',
                'Make a pricing page with Stripe checkout',
                'Build a dashboard with charts',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => {
                    setInput(suggestion);
                    inputRef.current?.focus();
                  }}
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
          <div
            key={msg.id}
            className={clsx('flex gap-2.5', msg.role === 'user' ? 'justify-end' : 'justify-start')}
          >
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
                  {/* AI's brief text response */}
                  {msg.content && (
                    <div className="whitespace-pre-wrap break-words text-xs">{msg.content}</div>
                  )}

                  {/* Writing indicator (during streaming) */}
                  {msg.isStreaming &&
                    (msg.currentFile || (msg.filesWritten && msg.filesWritten.length > 0)) && (
                      <WritingIndicator
                        currentFile={msg.currentFile || null}
                        filesWritten={msg.filesWritten || []}
                      />
                    )}

                  {/* Files written — compact chips (after done) */}
                  {!msg.isStreaming && msg.filesWritten && msg.filesWritten.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-0.5">
                      {msg.filesWritten.map((f) => (
                        <FileChip key={f} path={f} />
                      ))}
                    </div>
                  )}

                  {/* Shell commands (compact display) */}
                  {!msg.isStreaming && msg.shellCommands && msg.shellCommands.length > 0 && (
                    <div className="text-2xs text-slate-400 font-mono">
                      {msg.shellCommands.map((cmd, i) => (
                        <div key={i} className="truncate">
                          $ {cmd}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Initial thinking state */}
                  {msg.isStreaming &&
                    !msg.content &&
                    (!msg.filesWritten || msg.filesWritten.length === 0) &&
                    !msg.currentFile && (
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
                <div>
                  <div className="whitespace-pre-wrap break-words">{msg.content}</div>
                  {/* Show attachment thumbnails on user messages */}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {msg.attachments.map((att, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-white/20 rounded text-2xs"
                        >
                          {att.mimeType.startsWith('image/') ? (
                            <ImageIcon size={9} />
                          ) : (
                            <FileIcon size={9} />
                          )}
                          {att.filename}
                        </span>
                      ))}
                    </div>
                  )}
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

      {/* Pending Attachments Preview */}
      {pendingAttachments.length > 0 && (
        <div className="px-3 pt-2 flex flex-wrap gap-2 bg-white border-t border-slate-100">
          {pendingAttachments.map((att, idx) => (
            <div key={idx} className="relative group">
              {att.previewUrl ? (
                <img
                  src={att.previewUrl}
                  alt={att.file.name}
                  className="w-12 h-12 rounded-lg object-cover border border-slate-200"
                />
              ) : (
                <div className="w-12 h-12 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center">
                  <FileIcon size={14} className="text-slate-400" />
                </div>
              )}
              <button
                onClick={() => removeAttachment(idx)}
                className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X size={8} />
              </button>
              <p className="text-2xs text-slate-400 truncate max-w-[48px] mt-0.5 text-center">
                {att.file.name}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="border-t border-slate-200 p-3 bg-white shrink-0">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,.pdf,.doc,.docx,.txt,.json,.csv"
          className="hidden"
          onChange={(e) => handleAttachFiles(e.target.files)}
        />

        <div className="flex items-end gap-2">
          {/* + Attachment button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-brand-600 hover:bg-brand-50 transition-colors"
            title="Attach files"
          >
            <Plus size={16} />
          </button>

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
          Shift+Enter for new line · Click + to attach files
        </p>
      </div>
    </div>
  );
}
