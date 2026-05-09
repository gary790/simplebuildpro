// ============================================================
// SimpleBuild Pro — Editor Workspace (Redesigned Layout)
// Left: AI Chat (always visible, white)
// Right: Tabbed panel (Preview, Code, Explorer, Visual, Build, Deploy, Ship)
// ============================================================

'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useEditorStore, useAuthStore, useChatStore } from '@/lib/store';
import { projectsApi, filesApi, buildApi, deployApi } from '@/lib/api-client';
import * as wc from '@/lib/webcontainer';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { FileTree } from '@/components/editor/file-tree';
import { CodeEditor } from '@/components/editor/code-editor';
import { TabBar } from '@/components/editor/tab-bar';
import { PreviewPanel } from '@/components/editor/preview-panel';
import { AiChat } from '@/components/editor/ai-chat';
import { StudioBuilder } from '@/components/editor/studio-builder';
import { ShipPanel } from '@/components/editor/ship-panel';
import {
  ArrowLeft, Save, Loader2,
  FilePlus, FolderPlus, MoreVertical,
  Package, Rocket, Ship, Eye, Code, Layout,
  FolderTree, Paintbrush, Terminal, Settings,
  History, Globe, Download, GripVertical,
} from 'lucide-react';
import { Dropdown, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown';
import clsx from 'clsx';

// ─── Tab definitions for the right panel ──────────────────────
type RightTab = 'preview' | 'code' | 'explorer' | 'visual' | 'build' | 'deploy' | 'ship';

interface TabDef {
  id: RightTab;
  label: string;
  icon: React.ReactNode;
}

const RIGHT_TABS: TabDef[] = [
  { id: 'preview',  label: 'Preview',  icon: <Eye size={13} /> },
  { id: 'code',     label: 'Code',     icon: <Code size={13} /> },
  { id: 'explorer', label: 'Explorer', icon: <FolderTree size={13} /> },
  { id: 'visual',   label: 'Visual',   icon: <Paintbrush size={13} /> },
  { id: 'build',    label: 'Build',    icon: <Package size={13} /> },
  { id: 'deploy',   label: 'Deploy',   icon: <Rocket size={13} /> },
  { id: 'ship',     label: 'Ship',     icon: <Ship size={13} /> },
];

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const user = useAuthStore((s) => s.user);

  const {
    project, setProject, files, setFiles, activeFile,
    openTabs, openTab, setActiveFile, updateFile, deleteFile, renameFile,
    buildStatus, setBuildStatus, deployStatus, setDeployStatus, setLastDeployUrl,
    previewSession,
    assets, setAssets,
    terminalLogs, addTerminalLog, clearTerminalLogs,
    sandboxUrl, setSandboxUrl, sandboxStatus, setSandboxStatus,
    webcontainerReady, setWebcontainerReady,
    webcontainerUrl, setWebcontainerUrl,
  } = useEditorStore();

  const { clearMessages: clearChat } = useChatStore();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<RightTab>('preview');
  const [chatWidth, setChatWidth] = useState(420);
  const [isResizing, setIsResizing] = useState(false);

  // Modal states
  const [createFileOpen, setCreateFileOpen] = useState(false);
  const [createFileParent, setCreateFileParent] = useState('');
  const [newFileName, setNewFileName] = useState('');
  const [isFolder, setIsFolder] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renamePath, setRenamePath] = useState('');
  const [renameNewName, setRenameNewName] = useState('');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deletePath, setDeletePath] = useState('');

  // ─── Resize handler for chat panel ─────────────────────
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);

    const startX = e.clientX;
    const startWidth = chatWidth;

    const handleMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - startX;
      const newWidth = Math.max(320, Math.min(700, startWidth + delta));
      setChatWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [chatWidth]);

  // ─── Load project + start sandbox ──────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const data = await projectsApi.get(projectId);
        setProject(data as any);

        const fileMap = new Map<string, string>();
        if ((data as any).files) {
          for (const f of (data as any).files) {
            fileMap.set(f.path, f.content || '');
          }
        }
        setFiles(fileMap);

        if ((data as any).assets) {
          setAssets((data as any).assets);
        }

        // Auto-open first HTML file
        const paths = Array.from(fileMap.keys());
        const indexFile = paths.find(
          (p) => p === 'index.html' || p === 'index.htm' || p.endsWith('/index.html'),
        ) || paths[0];
        if (indexFile) {
          openTab(indexFile);
          setActiveFile(indexFile);
        }

        // Set sandbox to idle immediately — blob preview can render now
        setSandboxStatus('idle');

        // ─── Boot WebContainer in background (non-blocking) ──
        // This runs separately and will upgrade the preview if it succeeds.
        // If it fails, blob preview continues working fine.
        if (wc.isSupported()) {
          // Don't await — let it run in background
          (async () => {
            try {
              setSandboxStatus('creating');
              await wc.boot();
              await wc.mountFiles(fileMap);
              setWebcontainerReady(true);
              setSandboxStatus('running');
              console.log('[Editor] WebContainer booted, files mounted');

              const devUrl = await wc.startDevServer((output) => {
                addTerminalLog(output.replace(/\n$/, ''));
              });
              if (devUrl) {
                setWebcontainerUrl(devUrl);
                console.log('[Editor] Dev server ready:', devUrl);
              }
            } catch (wcErr: any) {
              console.warn('[Editor] WebContainer failed:', wcErr.message);
              setSandboxStatus('idle');
              // No problem — blob preview handles it
            }
          })();
        }
      } catch (err: any) {
        toast('error', 'Failed to load project', err.message);
        router.push('/dashboard');
      } finally {
        setLoading(false);
      }
    };

    load();
    clearChat();

    return () => {
      wc.teardown();
      setProject(null);
      setFiles(new Map());
      setSandboxUrl(null);
      setWebcontainerUrl(null);
      setWebcontainerReady(false);
      setSandboxStatus('idle');
    };
  }, [projectId]);

  // ─── Save file ─────────────────────────────────────────
  const handleSave = useCallback(async (path?: string, content?: string) => {
    const filePath = path || activeFile;
    if (!filePath || !project?.id) return;
    const fileContent = content ?? files.get(filePath) ?? '';

    setSaving(true);
    try {
      await filesApi.upsert(project.id, { path: filePath, content: fileContent });
      useEditorStore.getState().markTabDirty(filePath, false);
      toast('success', 'Saved', filePath);
    } catch (err: any) {
      toast('error', 'Save failed', err.message);
    } finally {
      setSaving(false);
    }
  }, [activeFile, project?.id, files]);

  // ─── Save all dirty files ─────────────────────────────
  const handleSaveAll = useCallback(async () => {
    if (!project?.id) return;
    const dirtyTabs = openTabs.filter((t) => t.isDirty);
    if (dirtyTabs.length === 0) {
      toast('info', 'Nothing to save');
      return;
    }

    setSaving(true);
    try {
      const fileMap: Record<string, string> = {};
      for (const tab of dirtyTabs) {
        fileMap[tab.path] = files.get(tab.path) || '';
      }
      await filesApi.bulkUpsert(project.id, fileMap);
      for (const tab of dirtyTabs) {
        useEditorStore.getState().markTabDirty(tab.path, false);
      }
      toast('success', `Saved ${dirtyTabs.length} file${dirtyTabs.length > 1 ? 's' : ''}`);
    } catch (err: any) {
      toast('error', 'Save failed', err.message);
    } finally {
      setSaving(false);
    }
  }, [project?.id, openTabs, files]);

  // ─── Build ─────────────────────────────────────────────
  const handleBuild = useCallback(async () => {
    if (!project?.id) return;
    setBuildStatus('building');
    addTerminalLog(`[${new Date().toLocaleTimeString()}] Starting build...`);

    try {
      await handleSaveAll();
      const result = await buildApi.build({ projectId: project.id });
      setBuildStatus('success');
      addTerminalLog(`[${new Date().toLocaleTimeString()}] Build successful — v${result.versionNumber}`);
      addTerminalLog(`  Files: ${result.files.length}, Size: ${(result.totalSizeBytes / 1024).toFixed(1)} KB, Duration: ${result.durationMs}ms`);

      if (result.warnings.length > 0) {
        for (const w of result.warnings) {
          addTerminalLog(`  [warn] ${w.file}: ${w.message}`);
        }
      }

      toast('success', 'Build successful', `Version ${result.versionNumber} — ${result.files.length} files`);
      return result;
    } catch (err: any) {
      setBuildStatus('error');
      addTerminalLog(`[${new Date().toLocaleTimeString()}] Build failed: ${err.message}`);
      toast('error', 'Build failed', err.message);
      return null;
    }
  }, [project?.id, handleSaveAll, setBuildStatus, addTerminalLog]);

  // ─── Deploy ────────────────────────────────────────────
  const handleDeploy = useCallback(async () => {
    if (!project?.id) return;
    setDeployStatus('deploying');
    addTerminalLog(`[${new Date().toLocaleTimeString()}] Starting deploy...`);

    try {
      const buildResult = await handleBuild();
      if (!buildResult) {
        setDeployStatus('error');
        return;
      }

      const deployment = await deployApi.deploy({
        projectId: project.id,
        versionId: buildResult.versionId,
      });

      setDeployStatus('live');
      setLastDeployUrl((deployment as any).url || (deployment as any).deployUrl);
      addTerminalLog(`[${new Date().toLocaleTimeString()}] Deployed! URL: ${(deployment as any).url || (deployment as any).deployUrl}`);
      toast('success', 'Deployed!', `Live at ${(deployment as any).url || (deployment as any).deployUrl}`);
    } catch (err: any) {
      setDeployStatus('error');
      addTerminalLog(`[${new Date().toLocaleTimeString()}] Deploy failed: ${err.message}`);
      toast('error', 'Deploy failed', err.message);
    }
  }, [project?.id, handleBuild, setDeployStatus, setLastDeployUrl, addTerminalLog]);

  // ─── Visual Builder: Insert HTML ──────────────────────
  const handleInsertHtml = useCallback((html: string) => {
    if (!activeFile) return;
    const currentContent = files.get(activeFile) || '';
    const bodyCloseIndex = currentContent.toLowerCase().lastIndexOf('</body>');
    let newContent: string;
    if (bodyCloseIndex >= 0) {
      newContent = currentContent.slice(0, bodyCloseIndex) + '\n' + html + '\n' + currentContent.slice(bodyCloseIndex);
    } else {
      newContent = currentContent + '\n' + html;
    }
    updateFile(activeFile, newContent);
    toast('success', 'Component inserted');
  }, [activeFile, files, updateFile]);

  // ─── Create file/folder ────────────────────────────────
  const handleCreateFile = useCallback(async () => {
    if (!project?.id || !newFileName.trim()) return;
    const fullPath = createFileParent ? `${createFileParent}/${newFileName.trim()}` : newFileName.trim();

    if (isFolder) {
      const placeholderPath = `${fullPath}/.gitkeep`;
      updateFile(placeholderPath, '');
      try {
        await filesApi.upsert(project.id, { path: placeholderPath, content: '' });
      } catch { /* ignore */ }
    } else {
      updateFile(fullPath, '');
      openTab(fullPath);
      setActiveFile(fullPath);
      try {
        await filesApi.upsert(project.id, { path: fullPath, content: '' });
      } catch { /* ignore */ }
    }

    setCreateFileOpen(false);
    setNewFileName('');
    toast('success', `Created ${isFolder ? 'folder' : 'file'}`, fullPath);
  }, [project?.id, newFileName, createFileParent, isFolder, updateFile, openTab, setActiveFile]);

  // ─── Rename file ───────────────────────────────────────
  const handleRename = useCallback(async () => {
    if (!project?.id || !renameNewName.trim()) return;
    const dir = renamePath.includes('/') ? renamePath.substring(0, renamePath.lastIndexOf('/')) : '';
    const newPath = dir ? `${dir}/${renameNewName.trim()}` : renameNewName.trim();

    try {
      await filesApi.rename(project.id, renamePath, newPath);
      renameFile(renamePath, newPath);
      setRenameOpen(false);
      toast('success', 'Renamed', `${renamePath} -> ${newPath}`);
    } catch (err: any) {
      toast('error', 'Rename failed', err.message);
    }
  }, [project?.id, renamePath, renameNewName, renameFile]);

  // ─── Delete file ───────────────────────────────────────
  const handleDelete = useCallback(async () => {
    if (!project?.id || !deletePath) return;
    try {
      await filesApi.delete(project.id, deletePath);
      deleteFile(deletePath);
      setDeleteOpen(false);
      toast('success', 'Deleted', deletePath);
    } catch (err: any) {
      toast('error', 'Delete failed', err.message);
    }
  }, [project?.id, deletePath, deleteFile]);

  // ─── Keyboard shortcuts ────────────────────────────────
  useEffect(() => {
    const handleKeyboard = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (e.shiftKey) {
          handleSaveAll();
        } else {
          handleSave();
        }
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        handleBuild();
      }
    };
    window.addEventListener('keydown', handleKeyboard);
    return () => window.removeEventListener('keydown', handleKeyboard);
  }, [handleSave, handleSaveAll, handleBuild]);

  // ─── Loading state ─────────────────────────────────────
  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={28} className="animate-spin text-brand-600" />
          <span className="text-sm text-slate-500">Loading project...</span>
        </div>
      </div>
    );
  }

  const isHtmlFile = activeFile?.endsWith('.html') || activeFile?.endsWith('.htm');

  // ─── Render right-panel tab content ─────────────────────
  const renderTabContent = () => {
    switch (activeTab) {
      case 'preview':
        return <PreviewPanel />;

      case 'code':
        return (
          <div className="flex flex-col flex-1 h-full overflow-hidden">
            <TabBar />
            <div className="flex-1 overflow-hidden">
              <CodeEditor onSave={handleSave} />
            </div>
          </div>
        );

      case 'explorer':
        return (
          <div className="flex flex-col flex-1 h-full overflow-hidden bg-[#252526]">
            {/* Explorer header */}
            <div className="flex items-center justify-between px-3 h-10 border-b border-[#1E1E1E] shrink-0">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Files</span>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => {
                    setCreateFileParent('');
                    setIsFolder(false);
                    setNewFileName('');
                    setCreateFileOpen(true);
                  }}
                  className="p-1.5 rounded text-slate-500 hover:text-slate-300 hover:bg-white/10 transition-colors"
                  title="New File"
                >
                  <FilePlus size={13} />
                </button>
                <button
                  onClick={() => {
                    setCreateFileParent('');
                    setIsFolder(true);
                    setNewFileName('');
                    setCreateFileOpen(true);
                  }}
                  className="p-1.5 rounded text-slate-500 hover:text-slate-300 hover:bg-white/10 transition-colors"
                  title="New Folder"
                >
                  <FolderPlus size={13} />
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto dark-scroll text-slate-300">
              <FileTree
                onCreateFile={(parent) => {
                  setCreateFileParent(parent);
                  setIsFolder(false);
                  setNewFileName('');
                  setCreateFileOpen(true);
                }}
                onCreateFolder={(parent) => {
                  setCreateFileParent(parent);
                  setIsFolder(true);
                  setNewFileName('');
                  setCreateFileOpen(true);
                }}
                onRename={(path) => {
                  setRenamePath(path);
                  setRenameNewName(path.split('/').pop() || '');
                  setRenameOpen(true);
                }}
                onDelete={(path) => {
                  setDeletePath(path);
                  setDeleteOpen(true);
                }}
              />
            </div>
          </div>
        );

      case 'visual':
        if (!isHtmlFile) {
          return (
            <div className="flex flex-col items-center justify-center h-full bg-[#1E1E1E] text-center px-8">
              <Paintbrush size={32} className="text-slate-500 mb-3" />
              <p className="text-sm text-slate-400 mb-1">Visual Builder</p>
              <p className="text-xs text-slate-500">Open an HTML file first, then switch to Visual mode to drag & drop components.</p>
            </div>
          );
        }
        return (
          <StudioBuilder
            onInsertHtml={handleInsertHtml}
            onSwitchToCode={() => setActiveTab('code')}
          />
        );

      case 'build':
        return (
          <div className="flex flex-col h-full bg-[#1E1E1E]">
            {/* Build header */}
            <div className="flex items-center justify-between px-4 h-12 border-b border-[#2D2D2D] shrink-0">
              <span className="text-sm font-semibold text-slate-300">Build</span>
              <Button
                size="xs"
                onClick={handleBuild}
                loading={buildStatus === 'building'}
                icon={<Package size={13} />}
              >
                Run Build
              </Button>
            </div>
            {/* Build status */}
            <div className="px-4 py-3 border-b border-[#2D2D2D]">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-500">Status:</span>
                <span className={clsx(
                  'text-xs font-medium px-2 py-0.5 rounded-full',
                  buildStatus === 'idle' && 'bg-slate-700 text-slate-400',
                  buildStatus === 'building' && 'bg-amber-900/50 text-amber-400',
                  buildStatus === 'success' && 'bg-green-900/50 text-green-400',
                  buildStatus === 'error' && 'bg-red-900/50 text-red-400',
                )}>
                  {buildStatus === 'idle' ? 'Ready' : buildStatus}
                </span>
              </div>
            </div>
            {/* Build logs */}
            <div className="flex-1 overflow-y-auto p-3 font-mono text-xs text-slate-400 dark-scroll">
              {terminalLogs.length === 0 ? (
                <p className="text-slate-600">No build output yet. Click "Run Build" to start.</p>
              ) : (
                terminalLogs.map((log, i) => (
                  <div key={i} className="whitespace-pre-wrap leading-relaxed">{log}</div>
                ))
              )}
            </div>
            <div className="px-3 py-2 border-t border-[#2D2D2D] shrink-0">
              <button
                onClick={clearTerminalLogs}
                className="text-2xs text-slate-500 hover:text-slate-300 transition-colors"
              >
                Clear logs
              </button>
            </div>
          </div>
        );

      case 'deploy':
        return (
          <div className="flex flex-col h-full bg-[#1E1E1E]">
            {/* Deploy header */}
            <div className="flex items-center justify-between px-4 h-12 border-b border-[#2D2D2D] shrink-0">
              <span className="text-sm font-semibold text-slate-300">Deploy</span>
              <Button
                size="xs"
                onClick={handleDeploy}
                loading={deployStatus === 'deploying'}
                icon={<Rocket size={13} />}
              >
                Deploy Now
              </Button>
            </div>
            {/* Deploy status */}
            <div className="px-4 py-3 border-b border-[#2D2D2D]">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-xs text-slate-500">Status:</span>
                <span className={clsx(
                  'text-xs font-medium px-2 py-0.5 rounded-full',
                  deployStatus === 'idle' && 'bg-slate-700 text-slate-400',
                  deployStatus === 'deploying' && 'bg-amber-900/50 text-amber-400',
                  deployStatus === 'live' && 'bg-green-900/50 text-green-400',
                  deployStatus === 'error' && 'bg-red-900/50 text-red-400',
                )}>
                  {deployStatus === 'idle' ? 'Not deployed' : deployStatus}
                </span>
              </div>
              {useEditorStore.getState().lastDeployUrl && (
                <a
                  href={useEditorStore.getState().lastDeployUrl!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand-400 hover:text-brand-300 underline break-all"
                >
                  {useEditorStore.getState().lastDeployUrl}
                </a>
              )}
            </div>
            {/* Deploy info */}
            <div className="flex-1 overflow-y-auto p-4">
              <div className="space-y-3 text-xs text-slate-500">
                <p>Deploy will automatically:</p>
                <ul className="space-y-1.5 ml-3">
                  <li className="flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-slate-500" />
                    Save all unsaved files
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-slate-500" />
                    Build your project
                  </li>
                  <li className="flex items-center gap-2">
                    <span className="w-1 h-1 rounded-full bg-slate-500" />
                    Deploy to your configured hosting
                  </li>
                </ul>
                <p className="text-slate-600 pt-2">
                  Use the <strong className="text-slate-400">Ship</strong> tab for advanced deployment options (GitHub, Cloudflare, Vercel, etc.)
                </p>
              </div>
            </div>
          </div>
        );

      case 'ship':
        return <ShipPanel onClose={() => setActiveTab('preview')} inline />;

      default:
        return null;
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#1E1E1E]">
      {/* ─── Top Bar ──────────────────────────────────────── */}
      <header className="flex items-center justify-between px-3 h-11 bg-[#252526] border-b border-[#1E1E1E] shrink-0 z-10">
        {/* Left: Back + Project Name */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push('/dashboard')}
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
            title="Back to Dashboard"
          >
            <ArrowLeft size={16} />
          </button>
          <span className="text-sm font-semibold text-slate-300 truncate max-w-[200px]">
            {project?.name || 'Untitled'}
          </span>
          {saving && (
            <span className="text-2xs text-slate-500 flex items-center gap-1">
              <Loader2 size={10} className="animate-spin" /> Saving...
            </span>
          )}
        </div>

        {/* Right: Quick actions */}
        <div className="flex items-center gap-1.5">
          <Button
            size="xs"
            variant="ghost"
            onClick={() => handleSave()}
            className="text-slate-400 hover:text-white"
            icon={<Save size={13} />}
          >
            Save
          </Button>

          <div className="w-px h-5 bg-white/10 mx-0.5" />

          <Dropdown
            trigger={
              <button className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
                <MoreVertical size={14} />
              </button>
            }
          >
            <DropdownItem icon={<History size={14} />} onClick={() => toast('info', 'Version history coming soon')}>
              Version History
            </DropdownItem>
            <DropdownItem icon={<Globe size={14} />} onClick={() => setActiveTab('ship')}>
              Custom Domains
            </DropdownItem>
            <DropdownItem icon={<Settings size={14} />} onClick={() => setActiveTab('ship')}>
              Project Settings
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem icon={<Download size={14} />} onClick={() => setActiveTab('ship')}>
              Export Project
            </DropdownItem>
          </Dropdown>
        </div>
      </header>

      {/* ─── Main Content: Chat Left | Tabbed Right ─────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* ── Left Panel: AI Chat (always visible, white) ── */}
        <aside
          className="shrink-0 flex flex-col overflow-hidden"
          style={{ width: chatWidth }}
        >
          <AiChat />
        </aside>

        {/* ── Resize Handle ── */}
        <div
          className={clsx(
            'w-1 shrink-0 cursor-col-resize transition-colors group flex items-center justify-center',
            isResizing ? 'bg-brand-500' : 'bg-[#1E1E1E] hover:bg-brand-500/50',
          )}
          onMouseDown={handleMouseDown}
        >
          <div className="w-0.5 h-8 rounded-full bg-slate-600 group-hover:bg-brand-400 transition-colors" />
        </div>

        {/* ── Right Panel: Tab Bar + Content ── */}
        <main className="flex flex-col flex-1 min-w-0 overflow-hidden">
          {/* Tab bar */}
          <nav className="flex items-center bg-[#252526] border-b border-[#1E1E1E] shrink-0 overflow-x-auto no-scrollbar">
            {RIGHT_TABS.map((tab) => {
              const isActive = activeTab === tab.id;

              // Show status indicators on certain tabs
              let statusDot = null;
              if (tab.id === 'build' && buildStatus === 'building') {
                statusDot = <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />;
              } else if (tab.id === 'build' && buildStatus === 'success') {
                statusDot = <span className="w-1.5 h-1.5 rounded-full bg-green-400" />;
              } else if (tab.id === 'build' && buildStatus === 'error') {
                statusDot = <span className="w-1.5 h-1.5 rounded-full bg-red-400" />;
              } else if (tab.id === 'deploy' && deployStatus === 'deploying') {
                statusDot = <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />;
              } else if (tab.id === 'deploy' && deployStatus === 'live') {
                statusDot = <span className="w-1.5 h-1.5 rounded-full bg-green-400" />;
              } else if (tab.id === 'deploy' && deployStatus === 'error') {
                statusDot = <span className="w-1.5 h-1.5 rounded-full bg-red-400" />;
              }

              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={clsx(
                    'flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium transition-colors border-b-2 whitespace-nowrap',
                    isActive
                      ? 'text-white border-brand-500 bg-[#1E1E1E]'
                      : 'text-slate-500 border-transparent hover:text-slate-300 hover:bg-[#2D2D2D]',
                  )}
                >
                  {tab.icon}
                  {tab.label}
                  {statusDot}
                </button>
              );
            })}
          </nav>

          {/* Tab content */}
          <div className="flex-1 overflow-hidden">
            {renderTabContent()}
          </div>
        </main>
      </div>

      {/* ─── Status Bar ──────────────────────────────────── */}
      <footer className="flex items-center justify-between px-3 h-6 bg-brand-600 text-white text-2xs shrink-0">
        <div className="flex items-center gap-3">
          <span>{files.size} file{files.size !== 1 ? 's' : ''}</span>
          {activeFile && (
            <span className="text-white/70">{activeFile}</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* WebContainer / Runtime status */}
          <span className={clsx(
            webcontainerReady ? 'text-green-200' :
            sandboxStatus === 'creating' ? 'text-amber-200' :
            sandboxStatus === 'error' ? 'text-red-200' :
            'text-white/50',
          )}>
            {webcontainerReady && '⚡ Instant'}
            {!webcontainerReady && sandboxStatus === 'creating' && '◌ Booting...'}
            {!webcontainerReady && sandboxStatus === 'error' && '✕ Runtime err'}
            {!webcontainerReady && sandboxStatus === 'idle' && '○ Local'}
          </span>
          {buildStatus !== 'idle' && (
            <span className={clsx(
              buildStatus === 'building' ? 'text-white/80' :
              buildStatus === 'success' ? 'text-green-200' :
              'text-red-200',
            )}>
              Build: {buildStatus}
            </span>
          )}
          {deployStatus !== 'idle' && (
            <span className={clsx(
              deployStatus === 'deploying' ? 'text-white/80' :
              deployStatus === 'live' ? 'text-green-200' :
              'text-red-200',
            )}>
              Deploy: {deployStatus}
            </span>
          )}
          <span className="text-white/60">{user?.plan || 'free'} plan</span>
        </div>
      </footer>

      {/* ─── Create File/Folder Modal ─────────────────────── */}
      <Modal
        open={createFileOpen}
        onClose={() => setCreateFileOpen(false)}
        title={isFolder ? 'New Folder' : 'New File'}
        size="sm"
      >
        <div className="space-y-3">
          {createFileParent && (
            <p className="text-xs text-slate-500">
              In: <code className="bg-slate-100 px-1 py-0.5 rounded">{createFileParent}/</code>
            </p>
          )}
          <input
            type="text"
            value={newFileName}
            onChange={(e) => setNewFileName(e.target.value)}
            placeholder={isFolder ? 'folder-name' : 'filename.html'}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleCreateFile()}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setCreateFileOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleCreateFile} disabled={!newFileName.trim()}>Create</Button>
          </div>
        </div>
      </Modal>

      {/* ─── Rename Modal ────────────────────────────────── */}
      <Modal open={renameOpen} onClose={() => setRenameOpen(false)} title="Rename" size="sm">
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Renaming: <code className="bg-slate-100 px-1 py-0.5 rounded">{renamePath}</code>
          </p>
          <input
            type="text"
            value={renameNewName}
            onChange={(e) => setRenameNewName(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            autoFocus
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
          />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setRenameOpen(false)}>Cancel</Button>
            <Button size="sm" onClick={handleRename} disabled={!renameNewName.trim()}>Rename</Button>
          </div>
        </div>
      </Modal>

      {/* ─── Delete Modal ────────────────────────────────── */}
      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Delete File"
        description={`Are you sure you want to delete "${deletePath}"? This cannot be undone.`}
        size="sm"
      >
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setDeleteOpen(false)}>Cancel</Button>
          <Button variant="danger" size="sm" onClick={handleDelete}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}
