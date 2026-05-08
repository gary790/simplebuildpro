// ============================================================
// SimpleBuild Pro — AI Chat Panel
// Claude-powered AI assistant with streaming support
// ============================================================

'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useEditorStore, useChatStore } from '@/lib/store';
import { aiApi, filesApi } from '@/lib/api-client';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import {
  Send, X, Bot, User, Loader2, Sparkles, Copy, Check,
  RotateCcw, MessageSquare, Trash2,
} from 'lucide-react';
import clsx from 'clsx';

export function AiChat() {
  const { project, files, updateFile, isChatOpen, toggleChat } = useEditorStore();
  const {
    conversationId, messages, isLoading,
    setConversationId, addMessage, updateLastMessage,
    setStreaming, setLoading, clearMessages,
  } = useChatStore();

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
    addMessage({
      id: userMsgId,
      role: 'user',
      content: userMsg,
      timestamp: new Date().toISOString(),
    });

    // Add placeholder assistant message
    const assistantMsgId = `assistant-${Date.now()}`;
    addMessage({
      id: assistantMsgId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      isStreaming: true,
    });

    try {
      // Use streaming API
      await aiApi.streamMessage(
        {
          projectId: project.id,
          conversationId: conversationId || undefined,
          message: userMsg,
        },
        // On token
        (token) => {
          updateLastMessage(
            (useChatStore.getState().messages.find((m) => m.id === assistantMsgId)?.content || '') + token,
          );
        },
        // On complete (with metadata from server)
        (meta) => {
          setStreaming(assistantMsgId, false);
          setLoading(false);

          // Track conversationId for follow-up messages
          if (meta?.conversationId) {
            setConversationId(meta.conversationId);
          }

          // Parse file updates from the response and apply to editor
          const finalContent = useChatStore.getState().messages.find((m) => m.id === assistantMsgId)?.content || '';
          applyFileUpdates(finalContent);
        },
        // On error
        (error) => {
          updateLastMessage('Sorry, I encountered an error. Please try again.');
          setStreaming(assistantMsgId, false);
          setLoading(false);
          toast('error', 'AI Error', error);
        },
      );
    } catch (err: any) {
      updateLastMessage('Sorry, I encountered an error. Please try again.');
      setStreaming(assistantMsgId, false);
      setLoading(false);
      toast('error', 'AI Error', err.message);
    }
  }, [input, project?.id, conversationId, isLoading, addMessage, updateLastMessage, setStreaming, setLoading]);

  // Parse AI response for file update blocks
  // Supports format: ```json {"files": {"index.html": "...", "style.css": "..."}} ```
  const applyFileUpdates = useCallback((content: string) => {
    let applied = 0;
    const appliedPaths: string[] = [];

    // Match the ```json ... ``` block containing {"files": {...}}
    const jsonBlockRegex = /```json\s*([\s\S]*?)```/g;
    let blockMatch;

    while ((blockMatch = jsonBlockRegex.exec(content)) !== null) {
      const jsonStr = blockMatch[1].trim();
      try {
        const parsed = JSON.parse(jsonStr);

        // Handle {"files": {"filename": "content", ...}} format
        if (parsed.files && typeof parsed.files === 'object') {
          for (const [filePath, fileContent] of Object.entries(parsed.files)) {
            if (typeof fileContent === 'string') {
              updateFile(filePath, fileContent);
              appliedPaths.push(filePath);
              applied++;
            }
          }
        }
        // Handle {"file": "path", "content": "..."} format (legacy)
        else if (parsed.file && typeof parsed.content === 'string') {
          updateFile(parsed.file, parsed.content);
          appliedPaths.push(parsed.file);
          applied++;
        }
      } catch {
        // Not valid JSON — skip this block
      }
    }

    if (applied > 0) {
      toast('success', `Applied ${applied} file update${applied > 1 ? 's' : ''}`, 'Changes are reflected in the editor.');

      // Open the first modified file in a tab so the user sees the code immediately
      const { openTab, setActiveFile } = useEditorStore.getState();
      const primaryFile = appliedPaths.find(p => p === 'index.html') || appliedPaths[0];
      if (primaryFile) {
        openTab(primaryFile);
        setActiveFile(primaryFile);
      }
      // Open all other applied files as tabs too
      for (const p of appliedPaths) {
        openTab(p);
      }

      // Server-side already persists files (via streaming route flush)
      // But also persist as backup via bulk upsert
      const filesToSave: Record<string, string> = {};
      const jsonBlock2 = /```json\s*([\s\S]*?)```/g;
      let m2;
      while ((m2 = jsonBlock2.exec(content)) !== null) {
        try {
          const p = JSON.parse(m2[1].trim());
          if (p.files && typeof p.files === 'object') {
            Object.assign(filesToSave, p.files);
          } else if (p.file && typeof p.content === 'string') {
            filesToSave[p.file] = p.content;
          }
        } catch {}
      }
      if (Object.keys(filesToSave).length > 0 && project?.id) {
        filesApi.bulkUpsert(project.id, filesToSave).catch(() => {
          // Silent fail — server-side AI route already persists
        });
      }
    }
  }, [updateFile, project?.id]);

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
            <h3 className="text-sm font-semibold text-slate-900 mb-1">AI Assistant</h3>
            <p className="text-xs text-slate-500 max-w-[260px] leading-relaxed">
              Ask me to generate code, fix bugs, redesign sections, or explain your project files.
            </p>
            <div className="mt-4 space-y-1.5">
              {[
                'Add a contact form to index.html',
                'Make the hero section responsive',
                'Add dark mode toggle',
                'Fix the CSS layout issues',
              ].map((suggestion) => (
                <button
                  key={suggestion}
                  onClick={() => { setInput(suggestion); inputRef.current?.focus(); }}
                  className="block w-full text-left px-3 py-2 text-xs text-slate-600 bg-slate-50 rounded-lg hover:bg-slate-100 transition-colors"
                >
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
                  : 'bg-slate-100 text-slate-800 rounded-bl-sm',
              )}
            >
              {/* Render message with basic markdown-like formatting */}
              <div className="whitespace-pre-wrap break-words">
                {msg.content || (msg.isStreaming ? (
                  <span className="inline-flex items-center gap-1 text-slate-400">
                    <Loader2 size={12} className="animate-spin" /> Thinking...
                  </span>
                ) : '')}
              </div>

              {/* Copy button for assistant messages */}
              {msg.role === 'assistant' && msg.content && !msg.isStreaming && (
                <button
                  onClick={() => handleCopy(msg.id, msg.content)}
                  className="mt-1.5 flex items-center gap-1 text-2xs text-slate-400 hover:text-slate-600 transition-colors"
                >
                  {copiedId === msg.id ? <Check size={10} /> : <Copy size={10} />}
                  {copiedId === msg.id ? 'Copied' : 'Copy'}
                </button>
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
            placeholder="Ask the AI assistant..."
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
          AI sees all project files. Shift+Enter for new line.
        </p>
      </div>
    </div>
  );
}
