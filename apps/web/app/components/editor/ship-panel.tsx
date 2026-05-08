// ============================================================
// SimpleBuild Pro — Ship Panel
// One place to push to GitHub, deploy to Cloudflare, download zip
// ============================================================

'use client';

import { useState, useCallback, useEffect } from 'react';
import { useEditorStore } from '@/lib/store';
import { projectsApi } from '@/lib/api-client';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import clsx from 'clsx';
import {
  X, Github, Cloud, Download, ExternalLink,
  Check, AlertCircle, Loader2, FolderArchive,
  GitBranch, RefreshCw, Link2, Unplug,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────
interface IntegrationSettings {
  github?: {
    connected: boolean;
    repo?: string;
    owner?: string;
    branch?: string;
    lastPush?: string;
  };
  cloudflare?: {
    connected: boolean;
    projectName?: string;
    accountId?: string;
    lastDeploy?: string;
    liveUrl?: string;
  };
}

type Tab = 'github' | 'cloudflare' | 'download';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'github', label: 'GitHub', icon: <Github size={14} /> },
  { id: 'cloudflare', label: 'Cloudflare', icon: <Cloud size={14} /> },
  { id: 'download', label: 'Download', icon: <Download size={14} /> },
];

interface ShipPanelProps {
  onClose: () => void;
}

export function ShipPanel({ onClose }: ShipPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('github');
  const [settings, setSettings] = useState<IntegrationSettings>({});
  const [loading, setLoading] = useState(true);

  const project = useEditorStore((s) => s.project);

  // Load settings on mount
  useEffect(() => {
    if (!project?.id) return;
    loadSettings();
  }, [project?.id]);

  const loadSettings = async () => {
    if (!project?.id) return;
    setLoading(true);
    try {
      const data = await projectsApi.getIntegrations(project.id);
      setSettings(data);
    } catch {
      // No settings yet — that's fine
      setSettings({});
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-full max-w-2xl bg-[#1E1E1E] rounded-2xl shadow-2xl border border-white/10 overflow-hidden animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-600/20 flex items-center justify-center">
              <FolderArchive size={16} className="text-brand-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Ship It</h2>
              <p className="text-xs text-slate-400">Push, deploy, or download your project</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-white/10 px-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px',
                activeTab === tab.id
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-white/20',
              )}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-6 min-h-[320px]">
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 size={24} className="animate-spin text-slate-400" />
            </div>
          ) : (
            <>
              {activeTab === 'github' && (
                <GitHubTab
                  projectId={project?.id || ''}
                  settings={settings.github}
                  onRefresh={loadSettings}
                />
              )}
              {activeTab === 'cloudflare' && (
                <CloudflareTab
                  projectId={project?.id || ''}
                  settings={settings.cloudflare}
                  onRefresh={loadSettings}
                />
              )}
              {activeTab === 'download' && (
                <DownloadTab projectId={project?.id || ''} />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── GitHub Tab ─────────────────────────────────────────────
function GitHubTab({
  projectId,
  settings,
  onRefresh,
}: {
  projectId: string;
  settings?: IntegrationSettings['github'];
  onRefresh: () => void;
}) {
  const [repo, setRepo] = useState(settings?.repo || '');
  const [owner, setOwner] = useState(settings?.owner || '');
  const [branch, setBranch] = useState(settings?.branch || 'main');
  const [pushing, setPushing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [commitMsg, setCommitMsg] = useState('');

  const handleSaveConnection = async () => {
    if (!owner.trim() || !repo.trim()) {
      toast('error', 'Enter both owner and repo name');
      return;
    }
    setSaving(true);
    try {
      await projectsApi.saveIntegrations(projectId, {
        github: { owner: owner.trim(), repo: repo.trim(), branch: branch.trim() || 'main', connected: true },
      });
      toast('success', 'GitHub connection saved');
      onRefresh();
    } catch (err: any) {
      toast('error', 'Failed to save', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handlePush = async () => {
    if (!owner || !repo) {
      toast('error', 'Connect a repo first');
      return;
    }
    setPushing(true);
    try {
      const result = await projectsApi.pushToGithub(projectId, {
        owner,
        repo,
        branch: branch || 'main',
        commitMessage: commitMsg || `Update from SimpleBuild Pro Studio`,
      });
      toast('success', 'Pushed to GitHub!', `${(result as any).filesCount || ''} files → ${owner}/${repo}`);
      setCommitMsg('');
      onRefresh();
    } catch (err: any) {
      toast('error', 'Push failed', err.message);
    } finally {
      setPushing(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await projectsApi.saveIntegrations(projectId, { github: { connected: false } });
      setRepo('');
      setOwner('');
      setBranch('main');
      toast('success', 'GitHub disconnected');
      onRefresh();
    } catch (err: any) {
      toast('error', 'Failed', err.message);
    }
  };

  if (settings?.connected) {
    return (
      <div className="space-y-5">
        {/* Connected state */}
        <div className="flex items-start justify-between p-4 rounded-xl bg-green-500/10 border border-green-500/20">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
              <Check size={14} className="text-green-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-green-300">Connected to GitHub</p>
              <a
                href={`https://github.com/${settings.owner}/${settings.repo}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-green-400/70 hover:text-green-300 flex items-center gap-1"
              >
                {settings.owner}/{settings.repo}
                <ExternalLink size={10} />
              </a>
            </div>
          </div>
          <button
            onClick={handleDisconnect}
            className="p-1.5 rounded-md text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Disconnect"
          >
            <Unplug size={14} />
          </button>
        </div>

        {/* Branch info */}
        <div className="flex items-center gap-2 text-xs text-slate-400">
          <GitBranch size={12} />
          <span>Branch: <code className="bg-white/5 px-1.5 py-0.5 rounded text-slate-300">{settings.branch || 'main'}</code></span>
          {settings.lastPush && (
            <span className="ml-auto">Last push: {new Date(settings.lastPush).toLocaleDateString()}</span>
          )}
        </div>

        {/* Push form */}
        <div className="space-y-3">
          <label className="block text-xs font-medium text-slate-300">Commit message (optional)</label>
          <input
            type="text"
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            placeholder="Update from SimpleBuild Pro Studio"
            className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50 focus:border-brand-500/50"
          />
          <Button
            onClick={handlePush}
            loading={pushing}
            icon={<Github size={14} />}
            className="w-full"
          >
            Push to GitHub
          </Button>
        </div>
      </div>
    );
  }

  // Disconnected state — setup form
  return (
    <div className="space-y-5">
      <div className="p-4 rounded-xl bg-slate-500/10 border border-white/10">
        <p className="text-sm text-slate-300 mb-1">Connect a GitHub repository</p>
        <p className="text-xs text-slate-500">Push your project files to any GitHub repo you have access to.</p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Owner / Org</label>
          <input
            type="text"
            value={owner}
            onChange={(e) => setOwner(e.target.value)}
            placeholder="gary790"
            className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Repository</label>
          <input
            type="text"
            value={repo}
            onChange={(e) => setRepo(e.target.value)}
            placeholder="my-website"
            className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
          />
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">Branch</label>
        <input
          type="text"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="main"
          className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
        />
      </div>

      <Button
        onClick={handleSaveConnection}
        loading={saving}
        icon={<Link2 size={14} />}
        className="w-full"
      >
        Connect Repository
      </Button>
    </div>
  );
}

// ─── Cloudflare Tab ─────────────────────────────────────────
function CloudflareTab({
  projectId,
  settings,
  onRefresh,
}: {
  projectId: string;
  settings?: IntegrationSettings['cloudflare'];
  onRefresh: () => void;
}) {
  const [projectName, setProjectName] = useState(settings?.projectName || '');
  const [accountId, setAccountId] = useState(settings?.accountId || '');
  const [deploying, setDeploying] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSaveConnection = async () => {
    if (!projectName.trim()) {
      toast('error', 'Enter a Cloudflare Pages project name');
      return;
    }
    setSaving(true);
    try {
      await projectsApi.saveIntegrations(projectId, {
        cloudflare: {
          projectName: projectName.trim(),
          accountId: accountId.trim() || undefined,
          connected: true,
        },
      });
      toast('success', 'Cloudflare connection saved');
      onRefresh();
    } catch (err: any) {
      toast('error', 'Failed to save', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDeploy = async () => {
    setDeploying(true);
    try {
      const result = await projectsApi.deployToCloudflare(projectId);
      toast('success', 'Deployed to Cloudflare!', (result as any).url || '');
      onRefresh();
    } catch (err: any) {
      toast('error', 'Deploy failed', err.message);
    } finally {
      setDeploying(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await projectsApi.saveIntegrations(projectId, { cloudflare: { connected: false } });
      setProjectName('');
      setAccountId('');
      toast('success', 'Cloudflare disconnected');
      onRefresh();
    } catch (err: any) {
      toast('error', 'Failed', err.message);
    }
  };

  if (settings?.connected) {
    return (
      <div className="space-y-5">
        {/* Connected state */}
        <div className="flex items-start justify-between p-4 rounded-xl bg-orange-500/10 border border-orange-500/20">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-orange-500/20 flex items-center justify-center">
              <Cloud size={14} className="text-orange-400" />
            </div>
            <div>
              <p className="text-sm font-medium text-orange-300">Connected to Cloudflare Pages</p>
              <p className="text-xs text-orange-400/70">Project: {settings.projectName}</p>
            </div>
          </div>
          <button
            onClick={handleDisconnect}
            className="p-1.5 rounded-md text-slate-400 hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Disconnect"
          >
            <Unplug size={14} />
          </button>
        </div>

        {settings.liveUrl && (
          <a
            href={settings.liveUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300"
          >
            <ExternalLink size={12} />
            {settings.liveUrl}
          </a>
        )}

        {settings.lastDeploy && (
          <p className="text-xs text-slate-500">Last deploy: {new Date(settings.lastDeploy).toLocaleString()}</p>
        )}

        <Button
          onClick={handleDeploy}
          loading={deploying}
          icon={<Cloud size={14} />}
          className="w-full"
        >
          Deploy to Cloudflare Pages
        </Button>

        <p className="text-2xs text-slate-500 text-center">
          Deploys current project files to {settings.projectName}.pages.dev
        </p>
      </div>
    );
  }

  // Setup form
  return (
    <div className="space-y-5">
      <div className="p-4 rounded-xl bg-slate-500/10 border border-white/10">
        <p className="text-sm text-slate-300 mb-1">Connect to Cloudflare Pages</p>
        <p className="text-xs text-slate-500">Deploy your project to Cloudflare's global edge network with one click.</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">Pages Project Name</label>
        <input
          type="text"
          value={projectName}
          onChange={(e) => setProjectName(e.target.value)}
          placeholder="my-website"
          className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
        />
        <p className="text-2xs text-slate-500 mt-1">Will be deployed to <code>{projectName || 'my-website'}.pages.dev</code></p>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">Account ID (optional)</label>
        <input
          type="text"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
          placeholder="Your Cloudflare Account ID"
          className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
        />
        <p className="text-2xs text-slate-500 mt-1">Found in Cloudflare Dashboard → Overview → right sidebar</p>
      </div>

      <Button
        onClick={handleSaveConnection}
        loading={saving}
        icon={<Link2 size={14} />}
        className="w-full"
      >
        Connect to Cloudflare
      </Button>
    </div>
  );
}

// ─── Download Tab ───────────────────────────────────────────
function DownloadTab({ projectId }: { projectId: string }) {
  const [downloading, setDownloading] = useState(false);
  const files = useEditorStore((s) => s.files);

  const handleDownloadZip = async () => {
    setDownloading(true);
    try {
      const result = await projectsApi.exportZip(projectId) as any;

      if (result.format === 'json-files' && result.files) {
        // Client-side zip generation using JSZip
        const JSZip = (await import('jszip')).default;
        const zip = new JSZip();

        for (const file of result.files) {
          zip.file(file.path, file.content || '');
        }

        const blob = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${project?.name || 'project'}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        toast('success', 'Download started', `${result.filesCount} files`);
      } else if (result.downloadUrl) {
        window.open(result.downloadUrl, '_blank');
        toast('success', 'Download started');
      } else {
        toast('error', 'No download URL returned');
      }
    } catch (err: any) {
      toast('error', 'Export failed', err.message);
    } finally {
      setDownloading(false);
    }
  };

  const handleClientDownload = () => {
    const fileEntries = Array.from(files.entries());
    if (fileEntries.length === 0) {
      toast('error', 'No files to download');
      return;
    }
    // Always use the API export which returns file contents for client-side zip
    handleDownloadZip();
  };

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-xl bg-slate-500/10 border border-white/10">
        <p className="text-sm text-slate-300 mb-1">Download your project</p>
        <p className="text-xs text-slate-500">Get a .zip file with all your project files — ready to open anywhere.</p>
      </div>

      {/* File summary */}
      <div className="p-4 rounded-xl bg-white/5 border border-white/5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-slate-300">Project files</span>
          <span className="text-xs text-slate-500">{files.size} file{files.size !== 1 ? 's' : ''}</span>
        </div>
        <div className="space-y-1 max-h-32 overflow-y-auto dark-scroll">
          {Array.from(files.keys()).map((path) => (
            <div key={path} className="flex items-center gap-2 text-xs text-slate-400">
              <span className="w-1.5 h-1.5 rounded-full bg-slate-600" />
              {path}
            </div>
          ))}
        </div>
      </div>

      <Button
        onClick={handleClientDownload}
        loading={downloading}
        icon={<FolderArchive size={14} />}
        className="w-full"
      >
        Download as .zip
      </Button>

      <p className="text-2xs text-slate-500 text-center">
        Includes all project files in their original folder structure
      </p>
    </div>
  );
}
