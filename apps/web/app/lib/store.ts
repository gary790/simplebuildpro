// ============================================================
// SimpleBuild Pro — Global State Store
// Zustand for lightweight, performant state management
// ============================================================

import { create } from 'zustand';
import type { User, Project, ProjectFile, ProjectAsset, PreviewSession } from '@simplebuildpro/shared';

// ─── Auth Store ─────────────────────────────────────────────
interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  setUser: (user: User | null) => void;
  setLoading: (loading: boolean) => void;
  logout: () => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  setUser: (user) => set({ user, isAuthenticated: !!user, isLoading: false }),
  setLoading: (isLoading) => set({ isLoading }),
  logout: () => set({ user: null, isAuthenticated: false, isLoading: false }),
}));

// ─── Editor Store ───────────────────────────────────────────
interface EditorTab {
  path: string;
  isDirty: boolean;
}

interface EditorState {
  // Project
  project: (Project & { files: ProjectFile[]; assets: ProjectAsset[] }) | null;
  setProject: (project: EditorState['project']) => void;

  // Files
  files: Map<string, string>; // path → content
  setFiles: (files: Map<string, string>) => void;
  updateFile: (path: string, content: string) => void;
  deleteFile: (path: string) => void;
  renameFile: (oldPath: string, newPath: string) => void;

  // Active file / tabs
  activeFile: string | null;
  setActiveFile: (path: string | null) => void;
  openTabs: EditorTab[];
  openTab: (path: string) => void;
  closeTab: (path: string) => void;
  markTabDirty: (path: string, dirty: boolean) => void;

  // Assets
  assets: ProjectAsset[];
  setAssets: (assets: ProjectAsset[]) => void;
  addAsset: (asset: ProjectAsset) => void;
  removeAsset: (id: string) => void;

  // Preview
  previewSession: PreviewSession | null;
  setPreviewSession: (session: PreviewSession | null) => void;
  previewLoading: boolean;
  setPreviewLoading: (loading: boolean) => void;

  // Panels
  isChatOpen: boolean;
  toggleChat: () => void;
  isTerminalOpen: boolean;
  toggleTerminal: () => void;
  isAssetsOpen: boolean;
  toggleAssets: () => void;

  // Build / Deploy status
  buildStatus: 'idle' | 'building' | 'success' | 'error';
  setBuildStatus: (status: EditorState['buildStatus']) => void;
  deployStatus: 'idle' | 'deploying' | 'live' | 'error';
  setDeployStatus: (status: EditorState['deployStatus']) => void;
  lastDeployUrl: string | null;
  setLastDeployUrl: (url: string | null) => void;

  // Terminal logs
  terminalLogs: string[];
  addTerminalLog: (log: string) => void;
  clearTerminalLogs: () => void;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  // Project
  project: null,
  setProject: (project) => set({ project }),

  // Files
  files: new Map(),
  setFiles: (files) => set({ files: new Map(files) }),
  updateFile: (path, content) => {
    const files = new Map(get().files);
    files.set(path, content);
    set({ files });
    // Mark tab dirty
    const tabs = get().openTabs.map(t =>
      t.path === path ? { ...t, isDirty: true } : t
    );
    set({ openTabs: tabs });
  },
  deleteFile: (path) => {
    const files = new Map(get().files);
    files.delete(path);
    set({ files });
    // Close tab if open
    const tabs = get().openTabs.filter(t => t.path !== path);
    const active = get().activeFile === path ? (tabs[0]?.path || null) : get().activeFile;
    set({ openTabs: tabs, activeFile: active });
  },
  renameFile: (oldPath, newPath) => {
    const files = new Map(get().files);
    const content = files.get(oldPath);
    if (content !== undefined) {
      files.delete(oldPath);
      files.set(newPath, content);
    }
    set({ files });
    // Update tabs
    const tabs = get().openTabs.map(t =>
      t.path === oldPath ? { ...t, path: newPath } : t
    );
    const active = get().activeFile === oldPath ? newPath : get().activeFile;
    set({ openTabs: tabs, activeFile: active });
  },

  // Active file / tabs
  activeFile: null,
  setActiveFile: (path) => {
    if (path) {
      const tabs = get().openTabs;
      if (!tabs.find(t => t.path === path)) {
        set({ openTabs: [...tabs, { path, isDirty: false }] });
      }
    }
    set({ activeFile: path });
  },
  openTabs: [],
  openTab: (path) => {
    const tabs = get().openTabs;
    if (!tabs.find(t => t.path === path)) {
      set({ openTabs: [...tabs, { path, isDirty: false }] });
    }
    set({ activeFile: path });
  },
  closeTab: (path) => {
    const tabs = get().openTabs.filter(t => t.path !== path);
    const active = get().activeFile === path
      ? (tabs[tabs.length - 1]?.path || null)
      : get().activeFile;
    set({ openTabs: tabs, activeFile: active });
  },
  markTabDirty: (path, dirty) => {
    const tabs = get().openTabs.map(t =>
      t.path === path ? { ...t, isDirty: dirty } : t
    );
    set({ openTabs: tabs });
  },

  // Assets
  assets: [],
  setAssets: (assets) => set({ assets }),
  addAsset: (asset) => set({ assets: [asset, ...get().assets] }),
  removeAsset: (id) => set({ assets: get().assets.filter(a => a.id !== id) }),

  // Preview
  previewSession: null,
  setPreviewSession: (session) => set({ previewSession: session }),
  previewLoading: false,
  setPreviewLoading: (loading) => set({ previewLoading: loading }),

  // Panels
  isChatOpen: true,
  toggleChat: () => set({ isChatOpen: !get().isChatOpen }),
  isTerminalOpen: false,
  toggleTerminal: () => set({ isTerminalOpen: !get().isTerminalOpen }),
  isAssetsOpen: false,
  toggleAssets: () => set({ isAssetsOpen: !get().isAssetsOpen }),

  // Build / Deploy
  buildStatus: 'idle',
  setBuildStatus: (buildStatus) => set({ buildStatus }),
  deployStatus: 'idle',
  setDeployStatus: (deployStatus) => set({ deployStatus }),
  lastDeployUrl: null,
  setLastDeployUrl: (url) => set({ lastDeployUrl: url }),

  // Terminal
  terminalLogs: [],
  addTerminalLog: (log) => set({ terminalLogs: [...get().terminalLogs, log] }),
  clearTerminalLogs: () => set({ terminalLogs: [] }),
}));

// ─── Chat Store ─────────────────────────────────────────────
interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
  isStreaming?: boolean;
  appliedFiles?: boolean;
}

interface ChatState {
  conversationId: string | null;
  messages: ChatMessage[];
  isLoading: boolean;
  setConversationId: (id: string | null) => void;
  addMessage: (msg: ChatMessage) => void;
  updateLastMessage: (content: string) => void;
  setStreaming: (id: string, streaming: boolean) => void;
  setLoading: (loading: boolean) => void;
  clearMessages: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversationId: null,
  messages: [],
  isLoading: false,
  setConversationId: (id) => set({ conversationId: id }),
  addMessage: (msg) => set({ messages: [...get().messages, msg] }),
  updateLastMessage: (content) => {
    const messages = [...get().messages];
    const last = messages[messages.length - 1];
    if (last && last.role === 'assistant') {
      messages[messages.length - 1] = { ...last, content };
    }
    set({ messages });
  },
  setStreaming: (id, streaming) => {
    const messages = get().messages.map(m =>
      m.id === id ? { ...m, isStreaming: streaming } : m
    );
    set({ messages });
  },
  setLoading: (isLoading) => set({ isLoading }),
  clearMessages: () => set({ messages: [], conversationId: null }),
}));
