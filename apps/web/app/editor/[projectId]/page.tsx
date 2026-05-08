// ============================================================
// SimpleBuild Pro — Editor Workspace
// Full IDE: file tree, Monaco editor, preview, AI chat
// Integrated with Studio Builder for HTML files
// ============================================================

'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useEditorStore, useAuthStore, useChatStore } from '@/lib/store';
import { projectsApi, filesApi, buildApi, deployApi } from '@/lib/api-client';
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
  ArrowLeft, Save, Play, Rocket, Sparkles, FolderTree,
  Eye, Terminal, Image, Settings, Loader2, ChevronDown,
  FilePlus, FolderPlus, MoreVertical, Package, Globe,
  History, Upload, Download, Layout, Code, Ship,
} from 'lucide-react';
import { Dropdown, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown';
import clsx from 'clsx';

type EditorMode = 'code' | 'visual';

export default function EditorPage() {
  const params = useParams();
  const router = useRouter();
  const projectId = params.projectId as string;
  const user = useAuthStore((s) => s.user);

  const {
    project, setProject, files, setFiles, activeFile,
    openTabs, openTab, setActiveFile, updateFile, deleteFile, renameFile,
    buildStatus, setBuildStatus, deployStatus, setDeployStatus, setLastDeployUrl,
    isChatOpen, toggleChat, previewSession,
    assets, setAssets,
    terminalLogs, addTerminalLog, clearTerminalLogs,
    isTerminalOpen, toggleTerminal,
  } = useEditorStore();

  const { clearMessages: clearChat } = useChatStore();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(260);
  const [editorMode, setEditorMode] = useState<EditorMode>('code');

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
  const [shipOpen, setShipOpen] = useState(false);

  // ─── Load project ──────────────────────────────────────
  useEffect(() => {
    const load = async () => {
      try {
        const data = await projectsApi.get(projectId);
        setProject(data as any);

        // Load files into store
        const fileMap = new Map<string, string>();
        if ((data as any).files) {
          for (const f of (data as any).files) {
            fileMap.set(f.path, f.content || '');
          }
        }
        setFiles(fileMap);

        // Load assets
        if ((data as any).assets) {
          setAssets((data as any).assets);
        }

        // Auto-open first HTML file or index
        const paths = Array.from(fileMap.keys());
        const indexFile = paths.find(
          (p) => p === 'index.html' || p === 'index.htm' || p.endsWith('/index.html'),
        ) || paths[0];
        if (indexFile) {
          openTab(indexFile);
          setActiveFile(indexFile);
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
      setProject(null);
      setFiles(new Map());
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

    // Try to insert before </body> if present
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

  // Check if current file is HTML (for visual builder toggle)
  const isHtmlFile = activeFile?.endsWith('.html') || activeFile?.endsWith('.htm');

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#1E1E1E]">
      {/* ─── Top Bar ──────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 h-12 bg-[#252526] border-b border-[#1E1E1E] shrink-0 z-10">
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

        <div className="flex items-center gap-1.5">
          {/* Editor Mode Toggle (only for HTML files) */}
          {isHtmlFile && (
            <>
              <div className="flex items-center bg-[#3C3C3C] rounded-md p-0.5">
                <button
                  onClick={() => setEditorMode('code')}
                  className={clsx(
                    'flex items-center gap-1 px-2 py-1 rounded text-2xs font-medium transition-colors',
                    editorMode === 'code'
                      ? 'bg-brand-600 text-white'
                      : 'text-slate-400 hover:text-white',
                  )}
                  title="Code Editor"
                >
                  <Code size={11} />
                  Code
                </button>
                <button
                  onClick={() => setEditorMode('visual')}
                  className={clsx(
                    'flex items-center gap-1 px-2 py-1 rounded text-2xs font-medium transition-colors',
                    editorMode === 'visual'
                      ? 'bg-brand-600 text-white'
                      : 'text-slate-400 hover:text-white',
                  )}
                  title="Visual Builder"
                >
                  <Layout size={11} />
                  Visual
                </button>
              </div>
              <div className="w-px h-5 bg-white/10 mx-1" />
            </>
          )}

          {/* Save */}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => handleSave()}
            className="text-slate-400 hover:text-white"
            icon={<Save size={13} />}
          >
            Save
          </Button>

          {/* Build */}
          <Button
            size="xs"
            variant="ghost"
            onClick={handleBuild}
            loading={buildStatus === 'building'}
            className="text-slate-400 hover:text-white"
            icon={<Package size={13} />}
          >
            Build
          </Button>

          {/* Deploy */}
          <Button
            size="xs"
            onClick={handleDeploy}
            loading={deployStatus === 'deploying'}
            icon={<Rocket size={13} />}
          >
            Deploy
          </Button>

          {/* Ship — GitHub, Cloudflare, Download */}
          <Button
            size="xs"
            variant="ghost"
            onClick={() => setShipOpen(true)}
            className="text-slate-400 hover:text-white"
            icon={<Ship size={13} />}
          >
            Ship
          </Button>

          {/* Separator */}
          <div className="w-px h-5 bg-white/10 mx-1" />

          {/* AI Chat Toggle */}
          <button
            onClick={toggleChat}
            className={clsx(
              'p-1.5 rounded-md transition-colors',
              isChatOpen ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white hover:bg-white/10',
            )}
            title="AI Assistant"
          >
            <Sparkles size={14} />
          </button>

          {/* Terminal Toggle */}
          <button
            onClick={toggleTerminal}
            className={clsx(
              'p-1.5 rounded-md transition-colors',
              isTerminalOpen ? 'bg-white/20 text-white' : 'text-slate-400 hover:text-white hover:bg-white/10',
            )}
            title="Terminal"
          >
            <Terminal size={14} />
          </button>

          {/* More */}
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
            <DropdownItem icon={<Globe size={14} />} onClick={() => setShipOpen(true)}>
              Custom Domains
            </DropdownItem>
            <DropdownItem icon={<Settings size={14} />} onClick={() => setShipOpen(true)}>
              Project Settings
            </DropdownItem>
            <DropdownSeparator />
            <DropdownItem icon={<Download size={14} />} onClick={() => setShipOpen(true)}>
              Export Project
            </DropdownItem>
          </Dropdown>
        </div>
      </div>

      {/* ─── Main Content ─────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — File Tree */}
        <div
          className="flex flex-col bg-[#252526] border-r border-[#1E1E1E] shrink-0 overflow-hidden"
          style={{ width: sidebarWidth }}
        >
          <div className="flex items-center justify-between px-3 h-9 border-b border-[#1E1E1E] shrink-0">
            <span className="text-2xs font-semibold text-slate-400 uppercase tracking-wider">Explorer</span>
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => {
                  setCreateFileParent('');
                  setIsFolder(false);
                  setNewFileName('');
                  setCreateFileOpen(true);
                }}
                className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/10 transition-colors"
                title="New File"
              >
                <FilePlus size={12} />
              </button>
              <button
                onClick={() => {
                  setCreateFileParent('');
                  setIsFolder(true);
                  setNewFileName('');
                  setCreateFileOpen(true);
                }}
                className="p-1 rounded text-slate-500 hover:text-slate-300 hover:bg-white/10 transition-colors"
                title="New Folder"
              >
                <FolderPlus size={12} />
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

        {/* Editor + Preview split */}
        <div className="flex flex-1 overflow-hidden">
          {/* Editor Panel — Code or Visual Builder */}
          {editorMode === 'visual' && isHtmlFile ? (
            <StudioBuilder
              onInsertHtml={handleInsertHtml}
              onSwitchToCode={() => setEditorMode('code')}
            />
          ) : (
            <div className="flex flex-col flex-1 min-w-0 overflow-hidden">
              <TabBar />
              <div className="flex-1 overflow-hidden">
                <CodeEditor onSave={handleSave} />
              </div>

              {/* Terminal Panel */}
              {isTerminalOpen && (
                <div className="border-t border-[#1E1E1E] bg-[#1E1E1E] shrink-0" style={{ height: '180px' }}>
                  <div className="flex items-center justify-between px-3 h-7 bg-[#252526] border-b border-[#1E1E1E]">
                    <span className="text-2xs font-semibold text-slate-400 uppercase tracking-wider">Output</span>
                    <button
                      onClick={clearTerminalLogs}
                      className="text-2xs text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      Clear
                    </button>
                  </div>
                  <div className="h-[calc(100%-28px)] overflow-y-auto p-2 font-mono text-xs text-slate-400 dark-scroll">
                    {terminalLogs.length === 0 ? (
                      <p className="text-slate-600">No output yet. Build or deploy to see logs.</p>
                    ) : (
                      terminalLogs.map((log, i) => (
                        <div key={i} className="whitespace-pre-wrap">{log}</div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Preview Panel (only in code mode; visual builder has its own preview) */}
          {editorMode === 'code' && <PreviewPanel />}
        </div>

        {/* AI Chat Panel */}
        {isChatOpen && <AiChat />}
      </div>

      {/* ─── Status Bar ──────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 h-6 bg-brand-600 text-white text-2xs shrink-0">
        <div className="flex items-center gap-3">
          <span>{files.size} file{files.size !== 1 ? 's' : ''}</span>
          {activeFile && (
            <span className="text-white/70">{activeFile}</span>
          )}
          {editorMode === 'visual' && (
            <span className="bg-white/20 px-1.5 py-0.5 rounded text-white/90 font-medium">Studio Builder</span>
          )}
        </div>
        <div className="flex items-center gap-3">
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
      </div>

      {/* ─── Ship Panel ─────────────────────────────────── */}
      {shipOpen && <ShipPanel onClose={() => setShipOpen(false)} />}

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
