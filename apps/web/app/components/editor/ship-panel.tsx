// ============================================================
// SimpleBuild Pro — Ship Panel v2
// Full integrations: GitHub OAuth, Cloudflare, Vercel, Netlify,
// Supabase, Download, Environment Variables
// ============================================================

'use client';

import { useState, useCallback, useEffect } from 'react';
import { useEditorStore } from '@/lib/store';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import clsx from 'clsx';
import {
  X, Github, Cloud, Download, ExternalLink,
  Check, Loader2, FolderArchive, GitBranch,
  Link2, Unplug, ChevronDown, Plus, Trash2,
  Eye, EyeOff, Key, Database, Triangle, Globe2,
  RefreshCw, Search, Lock, Server, Flame,
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

// ─── Types ──────────────────────────────────────────────────
interface Connection {
  id: string;
  provider: string;
  displayName: string;
  accountId: string | null;
  connectedAt: string;
  metadata?: Record<string, any>;
}

interface ProjectIntegration {
  id: string;
  provider: string;
  connectionId: string | null;
  config: Record<string, any>;
  lastActionAt: string | null;
  lastActionResult: Record<string, any> | null;
}

interface GithubRepo {
  id: number;
  name: string;
  fullName: string;
  owner: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  updatedAt: string;
  htmlUrl: string;
}

interface EnvVar {
  id: string;
  key: string;
  value: string;
  isSecret: boolean;
  description: string | null;
  updatedAt: string;
}

type Tab = 'github' | 'cloudflare' | 'vercel' | 'netlify' | 'aws' | 'gcp' | 'download' | 'env';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'github', label: 'GitHub', icon: <Github size={14} /> },
  { id: 'cloudflare', label: 'Cloudflare', icon: <Cloud size={14} /> },
  { id: 'aws', label: 'AWS', icon: <Server size={14} /> },
  { id: 'gcp', label: 'Google Cloud', icon: <Flame size={14} /> },
  { id: 'vercel', label: 'Vercel', icon: <Triangle size={14} /> },
  { id: 'netlify', label: 'Netlify', icon: <Globe2 size={14} /> },
  { id: 'download', label: 'Download', icon: <Download size={14} /> },
  { id: 'env', label: 'Secrets', icon: <Key size={14} /> },
];

interface ShipPanelProps {
  onClose: () => void;
  inline?: boolean;
}

// ─── Helper: API fetch with auth ────────────────────────────
async function shipFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { getAccessToken } = await import('@/lib/api-client');
  const token = getAccessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  const json = await res.json();
  if (!res.ok || json.success === false) {
    throw new Error(json.error?.message || 'Request failed');
  }
  return json.data as T;
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export function ShipPanel({ onClose, inline = false }: ShipPanelProps) {
  const [activeTab, setActiveTab] = useState<Tab>('github');
  const [connections, setConnections] = useState<Connection[]>([]);
  const [integrations, setIntegrations] = useState<ProjectIntegration[]>([]);
  const [loading, setLoading] = useState(true);

  const project = useEditorStore((s) => s.project);

  useEffect(() => {
    if (!project?.id) return;
    loadData();
  }, [project?.id]);

  const loadData = async () => {
    if (!project?.id) return;
    setLoading(true);
    try {
      const data = await shipFetch<{ integrations: ProjectIntegration[]; connections: Connection[] }>(
        `/api/v1/projects/${project.id}/integrations`
      );
      setConnections(data.connections || []);
      setIntegrations(data.integrations || []);
    } catch {
      // Fresh project — no integrations yet
      try {
        const connData = await shipFetch<Connection[]>('/api/v1/projects/connections');
        setConnections(connData || []);
      } catch { /* ignore */ }
    } finally {
      setLoading(false);
    }
  };

  const getConnection = (provider: string) => connections.find(c => c.provider === provider);
  const getIntegration = (provider: string) => integrations.find(i => i.provider === provider);

  // ─── Inline mode: render directly without overlay ──────────
  const content = (
    <>
      {/* Header */}
      {!inline && (
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-600/20 flex items-center justify-center">
              <FolderArchive size={16} className="text-brand-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">Ship It</h2>
              <p className="text-xs text-slate-400">Connect, deploy, and download your project</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 transition-colors">
            <X size={16} />
          </button>
        </div>
      )}

      {/* Tabs — scrollable */}
      <div className={clsx('flex border-b border-white/10 overflow-x-auto shrink-0', inline ? 'px-3' : 'px-4')}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={clsx(
                'flex items-center gap-1.5 px-3 py-3 text-xs font-medium border-b-2 transition-colors -mb-px whitespace-nowrap',
                activeTab === tab.id
                  ? 'border-brand-500 text-brand-400'
                  : 'border-transparent text-slate-400 hover:text-slate-200 hover:border-white/20',
              )}
            >
              {tab.icon}
              {tab.label}
              {/* Show connected indicator */}
              {(tab.id === 'github' && getConnection('github_repo')) ||
               (tab.id === 'cloudflare' && getConnection('cloudflare')) ||
               (tab.id === 'vercel' && getConnection('vercel')) ||
               (tab.id === 'netlify' && getConnection('netlify')) ||
               (tab.id === 'aws' && getConnection('aws')) ||
               (tab.id === 'gcp' && getConnection('gcp')) ? (
                <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              ) : null}
            </button>
          ))}
        </div>

      {/* Content */}
      <div className={clsx('overflow-y-auto flex-1', inline ? 'p-4' : 'p-6')}>
          {loading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 size={24} className="animate-spin text-slate-400" />
            </div>
          ) : (
            <>
              {activeTab === 'github' && (
                <GitHubTab
                  projectId={project?.id || ''}
                  connection={getConnection('github_repo')}
                  integration={getIntegration('github')}
                  onRefresh={loadData}
                />
              )}
              {activeTab === 'cloudflare' && (
                <CloudflareTab
                  projectId={project?.id || ''}
                  connection={getConnection('cloudflare')}
                  integration={getIntegration('cloudflare')}
                  onRefresh={loadData}
                />
              )}
              {activeTab === 'vercel' && (
                <VercelTab
                  projectId={project?.id || ''}
                  connection={getConnection('vercel')}
                  integration={getIntegration('vercel')}
                  onRefresh={loadData}
                />
              )}
              {activeTab === 'netlify' && (
                <NetlifyTab
                  projectId={project?.id || ''}
                  connection={getConnection('netlify')}
                  integration={getIntegration('netlify')}
                  onRefresh={loadData}
                />
              )}
              {activeTab === 'aws' && (
                <AwsTab
                  projectId={project?.id || ''}
                  connection={getConnection('aws')}
                  integration={getIntegration('aws')}
                  onRefresh={loadData}
                />
              )}
              {activeTab === 'gcp' && (
                <GcpTab
                  projectId={project?.id || ''}
                  connection={getConnection('gcp')}
                  integration={getIntegration('gcp')}
                  onRefresh={loadData}
                />
              )}
              {activeTab === 'download' && <DownloadTab projectId={project?.id || ''} />}
              {activeTab === 'env' && <EnvVarsTab projectId={project?.id || ''} />}
            </>
          )}
      </div>
    </>
  );

  if (inline) {
    return (
      <div className="flex flex-col h-full bg-[#1E1E1E] overflow-hidden">
        {content}
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-3xl bg-[#1E1E1E] rounded-2xl shadow-2xl border border-white/10 overflow-hidden animate-slide-up max-h-[85vh] flex flex-col">
        {content}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// GITHUB TAB — OAuth connect + repo picker + push
// ═══════════════════════════════════════════════════════════════

function GitHubTab({
  projectId,
  connection,
  integration,
  onRefresh,
}: {
  projectId: string;
  connection?: Connection;
  integration?: ProjectIntegration;
  onRefresh: () => void;
}) {
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [selectedRepo, setSelectedRepo] = useState(integration?.config?.repo || '');
  const [branch, setBranch] = useState(integration?.config?.branch || 'main');
  const [commitMsg, setCommitMsg] = useState('');
  const [pushing, setPushing] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showRepoList, setShowRepoList] = useState(false);

  useEffect(() => {
    if (connection) loadRepos();
  }, [connection]);

  const loadRepos = async () => {
    setLoadingRepos(true);
    try {
      const data = await shipFetch<GithubRepo[]>('/api/v1/projects/connect/github/repos');
      setRepos(data);
    } catch (err: any) {
      toast('error', 'Failed to load repos', err.message);
    } finally {
      setLoadingRepos(false);
    }
  };

  const handleConnect = () => {
    // Redirect to OAuth flow
    window.location.href = `${API_BASE}/api/v1/projects/connect/github`;
  };

  const handleDisconnect = async () => {
    try {
      await shipFetch('/api/v1/projects/connections/github_repo', { method: 'DELETE' });
      toast('success', 'GitHub disconnected');
      onRefresh();
    } catch (err: any) {
      toast('error', 'Failed to disconnect', err.message);
    }
  };

  const handlePush = async () => {
    if (!selectedRepo) {
      toast('error', 'Select a repository first');
      return;
    }
    setPushing(true);
    try {
      const result = await shipFetch<{ status: string; commitSha: string; filesCount: number; url: string }>(
        `/api/v1/projects/${projectId}/github/push`,
        {
          method: 'POST',
          body: JSON.stringify({
            repo: selectedRepo,
            branch: branch || 'main',
            commitMessage: commitMsg || 'Update from SimpleBuild Pro Studio',
          }),
        }
      );
      toast('success', 'Pushed to GitHub!', `${result.filesCount} files → ${selectedRepo}`);
      setCommitMsg('');
      onRefresh();
    } catch (err: any) {
      toast('error', 'Push failed', err.message);
    } finally {
      setPushing(false);
    }
  };

  const filteredRepos = repos.filter(r =>
    r.fullName.toLowerCase().includes(searchTerm.toLowerCase()) ||
    r.description?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Not connected — show connect button
  if (!connection) {
    return (
      <div className="space-y-5">
        <div className="p-5 rounded-xl bg-slate-500/10 border border-white/10 text-center">
          <Github size={32} className="mx-auto text-slate-400 mb-3" />
          <p className="text-sm text-slate-300 mb-1">Connect your GitHub account</p>
          <p className="text-xs text-slate-500 mb-4">Push project files to any repository you have access to.</p>
          <Button onClick={handleConnect} icon={<Github size={14} />}>
            Connect GitHub
          </Button>
        </div>
        <div className="p-3 rounded-lg bg-blue-500/5 border border-blue-500/10">
          <p className="text-2xs text-blue-300">
            We'll request <code className="bg-white/5 px-1 rounded">repo</code> scope to push code.
            Your token is encrypted and stored securely. You can disconnect at any time.
          </p>
        </div>
      </div>
    );
  }

  // Connected — show repo picker + push
  return (
    <div className="space-y-5">
      {/* Connected badge */}
      <div className="flex items-center justify-between p-3 rounded-xl bg-green-500/10 border border-green-500/20">
        <div className="flex items-center gap-2">
          <Check size={14} className="text-green-400" />
          <span className="text-sm text-green-300">Connected as <strong>{connection.displayName}</strong></span>
        </div>
        <button onClick={handleDisconnect} className="text-xs text-slate-400 hover:text-red-400 transition-colors flex items-center gap-1">
          <Unplug size={12} /> Disconnect
        </button>
      </div>

      {/* Repo picker */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">Repository</label>
        <div className="relative">
          <button
            onClick={() => setShowRepoList(!showRepoList)}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white hover:border-white/20 transition-colors"
          >
            <span className={selectedRepo ? 'text-white' : 'text-slate-500'}>
              {selectedRepo || 'Select a repository...'}
            </span>
            <ChevronDown size={14} className="text-slate-400" />
          </button>

          {showRepoList && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-[#2D2D2D] border border-white/10 rounded-lg shadow-xl z-10 max-h-60 overflow-hidden flex flex-col">
              <div className="p-2 border-b border-white/5">
                <div className="relative">
                  <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Search repos..."
                    className="w-full pl-7 pr-3 py-1.5 rounded bg-white/5 border border-white/5 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-brand-500/50"
                    autoFocus
                  />
                </div>
              </div>
              <div className="overflow-y-auto max-h-48">
                {loadingRepos ? (
                  <div className="p-4 text-center">
                    <Loader2 size={16} className="animate-spin text-slate-400 mx-auto" />
                  </div>
                ) : filteredRepos.length === 0 ? (
                  <p className="p-3 text-xs text-slate-500 text-center">No repos found</p>
                ) : (
                  filteredRepos.map(repo => (
                    <button
                      key={repo.id}
                      onClick={() => {
                        setSelectedRepo(repo.fullName);
                        setBranch(repo.defaultBranch);
                        setShowRepoList(false);
                      }}
                      className={clsx(
                        'w-full px-3 py-2 text-left hover:bg-white/5 flex items-center justify-between',
                        selectedRepo === repo.fullName && 'bg-brand-500/10',
                      )}
                    >
                      <div>
                        <p className="text-xs text-white">{repo.fullName}</p>
                        {repo.description && <p className="text-2xs text-slate-500 truncate max-w-[280px]">{repo.description}</p>}
                      </div>
                      <div className="flex items-center gap-2">
                        {repo.private && <Lock size={10} className="text-slate-500" />}
                        {selectedRepo === repo.fullName && <Check size={12} className="text-brand-400" />}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Branch */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">Branch</label>
        <div className="flex items-center gap-2">
          <GitBranch size={14} className="text-slate-500" />
          <input
            type="text"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            placeholder="main"
            className="flex-1 px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
          />
        </div>
      </div>

      {/* Commit message */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">Commit message (optional)</label>
        <input
          type="text"
          value={commitMsg}
          onChange={(e) => setCommitMsg(e.target.value)}
          placeholder="Update from SimpleBuild Pro Studio"
          className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
        />
      </div>

      {/* Last push info */}
      {integration?.lastActionResult?.url && (
        <a
          href={integration.lastActionResult.url as string}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300"
        >
          <ExternalLink size={12} />
          {integration.lastActionResult.url as string}
          {integration.lastActionAt && (
            <span className="text-slate-500 ml-auto">{new Date(integration.lastActionAt).toLocaleDateString()}</span>
          )}
        </a>
      )}

      {/* Push button */}
      <Button onClick={handlePush} loading={pushing} icon={<Github size={14} />} className="w-full">
        Push to GitHub
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// CLOUDFLARE TAB — Guided token setup + deploy
// ═══════════════════════════════════════════════════════════════

function CloudflareTab({
  projectId,
  connection,
  integration,
  onRefresh,
}: {
  projectId: string;
  connection?: Connection;
  integration?: ProjectIntegration;
  onRefresh: () => void;
}) {
  const [apiToken, setApiToken] = useState('');
  const [accountId, setAccountId] = useState('');
  const [projectName, setProjectName] = useState(integration?.config?.projectName || '');
  const [connecting, setConnecting] = useState(false);
  const [deploying, setDeploying] = useState(false);

  const handleConnect = async () => {
    if (!apiToken.trim()) {
      toast('error', 'Paste your Cloudflare API token');
      return;
    }
    setConnecting(true);
    try {
      await shipFetch('/api/v1/projects/connect/cloudflare', {
        method: 'POST',
        body: JSON.stringify({ apiToken: apiToken.trim(), accountId: accountId.trim() || undefined }),
      });
      toast('success', 'Cloudflare connected!');
      setApiToken('');
      onRefresh();
    } catch (err: any) {
      toast('error', 'Connection failed', err.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await shipFetch('/api/v1/projects/connections/cloudflare', { method: 'DELETE' });
      toast('success', 'Cloudflare disconnected');
      onRefresh();
    } catch (err: any) {
      toast('error', 'Failed', err.message);
    }
  };

  const handleDeploy = async () => {
    if (!projectName.trim()) {
      toast('error', 'Enter a Pages project name');
      return;
    }
    setDeploying(true);
    try {
      const result = await shipFetch<{ status: string; url: string; filesCount: number }>(
        `/api/v1/projects/${projectId}/cloudflare/deploy`,
        { method: 'POST', body: JSON.stringify({ projectName: projectName.trim() }) }
      );
      toast('success', 'Deployed to Cloudflare!', result.url);
      onRefresh();
    } catch (err: any) {
      toast('error', 'Deploy failed', err.message);
    } finally {
      setDeploying(false);
    }
  };

  if (!connection) {
    return (
      <div className="space-y-5">
        <div className="p-5 rounded-xl bg-slate-500/10 border border-white/10">
          <Cloud size={28} className="text-orange-400 mb-3" />
          <p className="text-sm text-slate-300 mb-1">Connect Cloudflare Pages</p>
          <p className="text-xs text-slate-500 mb-4">Deploy to Cloudflare's global edge network.</p>
        </div>

        {/* Step-by-step guide */}
        <div className="p-4 rounded-xl bg-orange-500/5 border border-orange-500/10 space-y-3">
          <p className="text-xs font-medium text-orange-300">Create a scoped API token:</p>
          <ol className="text-2xs text-slate-400 space-y-1.5 list-decimal list-inside">
            <li>Go to <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">Cloudflare API Tokens page</a></li>
            <li>Click "Create Token"</li>
            <li>Use the <strong>"Edit Cloudflare Pages"</strong> template</li>
            <li>Set account scope to your account</li>
            <li>Create token and paste it below</li>
          </ol>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">API Token</label>
          <input
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
            placeholder="Paste your Cloudflare API token"
            className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
          />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Account ID (optional — auto-detected)</label>
          <input
            type="text"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="Auto-detected from token"
            className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50"
          />
        </div>

        <Button onClick={handleConnect} loading={connecting} icon={<Link2 size={14} />} className="w-full">
          Connect Cloudflare
        </Button>
      </div>
    );
  }

  // Connected — deploy form
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between p-3 rounded-xl bg-orange-500/10 border border-orange-500/20">
        <div className="flex items-center gap-2">
          <Check size={14} className="text-orange-400" />
          <span className="text-sm text-orange-300">Cloudflare connected</span>
          {connection.accountId && <span className="text-2xs text-slate-500">({connection.accountId.slice(0, 8)}...)</span>}
        </div>
        <button onClick={handleDisconnect} className="text-xs text-slate-400 hover:text-red-400 transition-colors flex items-center gap-1">
          <Unplug size={12} /> Disconnect
        </button>
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
        <p className="text-2xs text-slate-500 mt-1">Deploys to <code>{projectName || 'my-website'}.pages.dev</code></p>
      </div>

      {integration?.lastActionResult?.url && (
        <a href={integration.lastActionResult.url as string} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300">
          <ExternalLink size={12} /> {integration.lastActionResult.url as string}
        </a>
      )}

      <Button onClick={handleDeploy} loading={deploying} icon={<Cloud size={14} />} className="w-full">
        Deploy to Cloudflare Pages
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// VERCEL TAB — OAuth connect + deploy
// ═══════════════════════════════════════════════════════════════

function VercelTab({
  projectId,
  connection,
  integration,
  onRefresh,
}: {
  projectId: string;
  connection?: Connection;
  integration?: ProjectIntegration;
  onRefresh: () => void;
}) {
  const [projectName, setProjectName] = useState(integration?.config?.projectName || '');
  const [deploying, setDeploying] = useState(false);

  const handleConnect = () => {
    window.location.href = `${API_BASE}/api/v1/projects/connect/vercel`;
  };

  const handleDisconnect = async () => {
    try {
      await shipFetch('/api/v1/projects/connections/vercel', { method: 'DELETE' });
      toast('success', 'Vercel disconnected');
      onRefresh();
    } catch (err: any) {
      toast('error', 'Failed', err.message);
    }
  };

  const handleDeploy = async () => {
    if (!projectName.trim()) { toast('error', 'Enter a project name'); return; }
    setDeploying(true);
    try {
      const result = await shipFetch<{ status: string; url: string }>(
        `/api/v1/projects/${projectId}/vercel/deploy`,
        { method: 'POST', body: JSON.stringify({ projectName: projectName.trim() }) }
      );
      toast('success', 'Deployed to Vercel!', result.url);
      onRefresh();
    } catch (err: any) {
      toast('error', 'Deploy failed', err.message);
    } finally {
      setDeploying(false);
    }
  };

  if (!connection) {
    return (
      <div className="space-y-5">
        <div className="p-5 rounded-xl bg-slate-500/10 border border-white/10 text-center">
          <Triangle size={28} className="mx-auto text-slate-400 mb-3" />
          <p className="text-sm text-slate-300 mb-1">Connect Vercel</p>
          <p className="text-xs text-slate-500 mb-4">Deploy to Vercel's edge platform with one click.</p>
          <Button onClick={handleConnect} icon={<Triangle size={14} />}>
            Connect Vercel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between p-3 rounded-xl bg-slate-500/10 border border-white/20">
        <div className="flex items-center gap-2">
          <Check size={14} className="text-green-400" />
          <span className="text-sm text-slate-300">Connected as <strong>{connection.displayName}</strong></span>
        </div>
        <button onClick={handleDisconnect} className="text-xs text-slate-400 hover:text-red-400 transition-colors flex items-center gap-1">
          <Unplug size={12} /> Disconnect
        </button>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">Project Name</label>
        <input type="text" value={projectName} onChange={(e) => setProjectName(e.target.value)}
          placeholder="my-website"
          className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50" />
      </div>

      {integration?.lastActionResult?.url && (
        <a href={integration.lastActionResult.url as string} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300">
          <ExternalLink size={12} /> {integration.lastActionResult.url as string}
        </a>
      )}

      <Button onClick={handleDeploy} loading={deploying} icon={<Triangle size={14} />} className="w-full">
        Deploy to Vercel
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// NETLIFY TAB — OAuth connect + deploy
// ═══════════════════════════════════════════════════════════════

function NetlifyTab({
  projectId,
  connection,
  integration,
  onRefresh,
}: {
  projectId: string;
  connection?: Connection;
  integration?: ProjectIntegration;
  onRefresh: () => void;
}) {
  const [siteName, setSiteName] = useState(integration?.config?.siteName || '');
  const [deploying, setDeploying] = useState(false);

  const handleConnect = () => {
    window.location.href = `${API_BASE}/api/v1/projects/connect/netlify`;
  };

  const handleDisconnect = async () => {
    try {
      await shipFetch('/api/v1/projects/connections/netlify', { method: 'DELETE' });
      toast('success', 'Netlify disconnected');
      onRefresh();
    } catch (err: any) {
      toast('error', 'Failed', err.message);
    }
  };

  const handleDeploy = async () => {
    if (!siteName.trim()) { toast('error', 'Enter a site name'); return; }
    setDeploying(true);
    try {
      const result = await shipFetch<{ status: string; url: string }>(
        `/api/v1/projects/${projectId}/netlify/deploy`,
        { method: 'POST', body: JSON.stringify({ siteName: siteName.trim() }) }
      );
      toast('success', 'Deployed to Netlify!', result.url);
      onRefresh();
    } catch (err: any) {
      toast('error', 'Deploy failed', err.message);
    } finally {
      setDeploying(false);
    }
  };

  if (!connection) {
    return (
      <div className="space-y-5">
        <div className="p-5 rounded-xl bg-slate-500/10 border border-white/10 text-center">
          <Globe2 size={28} className="mx-auto text-teal-400 mb-3" />
          <p className="text-sm text-slate-300 mb-1">Connect Netlify</p>
          <p className="text-xs text-slate-500 mb-4">Deploy to Netlify with one click.</p>
          <Button onClick={handleConnect} icon={<Globe2 size={14} />}>
            Connect Netlify
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between p-3 rounded-xl bg-teal-500/10 border border-teal-500/20">
        <div className="flex items-center gap-2">
          <Check size={14} className="text-teal-400" />
          <span className="text-sm text-teal-300">Connected as <strong>{connection.displayName}</strong></span>
        </div>
        <button onClick={handleDisconnect} className="text-xs text-slate-400 hover:text-red-400 transition-colors flex items-center gap-1">
          <Unplug size={12} /> Disconnect
        </button>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">Site Name</label>
        <input type="text" value={siteName} onChange={(e) => setSiteName(e.target.value)}
          placeholder="my-website"
          className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50" />
        <p className="text-2xs text-slate-500 mt-1">Deploys to <code>{siteName || 'my-website'}.netlify.app</code></p>
      </div>

      {integration?.lastActionResult?.url && (
        <a href={integration.lastActionResult.url as string} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300">
          <ExternalLink size={12} /> {integration.lastActionResult.url as string}
        </a>
      )}

      <Button onClick={handleDeploy} loading={deploying} icon={<Globe2 size={14} />} className="w-full">
        Deploy to Netlify
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// AWS TAB — Access Key + S3/CloudFront deploy
// ═══════════════════════════════════════════════════════════════

function AwsTab({
  projectId,
  connection,
  integration,
  onRefresh,
}: {
  projectId: string;
  connection?: Connection;
  integration?: ProjectIntegration;
  onRefresh: () => void;
}) {
  const [accessKeyId, setAccessKeyId] = useState('');
  const [secretAccessKey, setSecretAccessKey] = useState('');
  const [region, setRegion] = useState(integration?.config?.region || 'us-east-1');
  const [connecting, setConnecting] = useState(false);
  const [bucketName, setBucketName] = useState(integration?.config?.bucketName || '');
  const [distributionId, setDistributionId] = useState(integration?.config?.distributionId || '');
  const [deploying, setDeploying] = useState(false);

  const handleConnect = async () => {
    if (!accessKeyId.trim() || !secretAccessKey.trim()) {
      toast('error', 'Enter your Access Key ID and Secret Access Key');
      return;
    }
    setConnecting(true);
    try {
      await shipFetch('/api/v1/projects/connect/aws', {
        method: 'POST',
        body: JSON.stringify({ accessKeyId: accessKeyId.trim(), secretAccessKey: secretAccessKey.trim(), region }),
      });
      toast('success', 'AWS connected!');
      setAccessKeyId('');
      setSecretAccessKey('');
      onRefresh();
    } catch (err: any) {
      toast('error', 'Connection failed', err.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await shipFetch('/api/v1/projects/connections/aws', { method: 'DELETE' });
      toast('success', 'AWS disconnected');
      onRefresh();
    } catch (err: any) {
      toast('error', 'Failed', err.message);
    }
  };

  const handleDeploy = async () => {
    if (!bucketName.trim()) { toast('error', 'Enter an S3 bucket name'); return; }
    setDeploying(true);
    try {
      const result = await shipFetch<{ status: string; url: string; filesCount: number }>(
        `/api/v1/projects/${projectId}/aws/deploy`,
        { method: 'POST', body: JSON.stringify({ bucketName: bucketName.trim(), region, distributionId: distributionId.trim() || undefined }) }
      );
      toast('success', 'Deployed to AWS!', result.url);
      onRefresh();
    } catch (err: any) {
      toast('error', 'Deploy failed', err.message);
    } finally {
      setDeploying(false);
    }
  };

  if (!connection) {
    return (
      <div className="space-y-5">
        <div className="p-5 rounded-xl bg-slate-500/10 border border-white/10">
          <Server size={28} className="text-yellow-500 mb-3" />
          <p className="text-sm text-slate-300 mb-1">Connect AWS</p>
          <p className="text-xs text-slate-500 mb-4">Deploy static sites to S3 + CloudFront.</p>
        </div>

        <div className="p-4 rounded-xl bg-yellow-500/5 border border-yellow-500/10 space-y-3">
          <p className="text-xs font-medium text-yellow-300">Create an IAM Access Key:</p>
          <ol className="text-2xs text-slate-400 space-y-1.5 list-decimal list-inside">
            <li>Go to <a href="https://console.aws.amazon.com/iam/home#/users" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">AWS IAM Users</a></li>
            <li>Select your user → Security credentials → Create access key</li>
            <li>Choose "Application running outside AWS"</li>
            <li>Ensure the user has <strong>AmazonS3FullAccess</strong> and optionally <strong>CloudFrontFullAccess</strong></li>
            <li>Copy the Access Key ID and Secret below</li>
          </ol>
        </div>

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Access Key ID</label>
            <input type="text" value={accessKeyId} onChange={(e) => setAccessKeyId(e.target.value)}
              placeholder="AKIAIOSFODNN7EXAMPLE"
              className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Secret Access Key</label>
            <input type="password" value={secretAccessKey} onChange={(e) => setSecretAccessKey(e.target.value)}
              placeholder="wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"
              className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Region</label>
            <select value={region} onChange={(e) => setRegion(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500/50">
              <option value="us-east-1">US East (N. Virginia)</option>
              <option value="us-west-2">US West (Oregon)</option>
              <option value="eu-west-1">EU (Ireland)</option>
              <option value="eu-central-1">EU (Frankfurt)</option>
              <option value="ap-southeast-1">Asia Pacific (Singapore)</option>
              <option value="ap-northeast-1">Asia Pacific (Tokyo)</option>
            </select>
          </div>
        </div>

        <Button onClick={handleConnect} loading={connecting} icon={<Link2 size={14} />} className="w-full">
          Connect AWS
        </Button>
      </div>
    );
  }

  // Connected — deploy form
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between p-3 rounded-xl bg-yellow-500/10 border border-yellow-500/20">
        <div className="flex items-center gap-2">
          <Check size={14} className="text-yellow-400" />
          <span className="text-sm text-yellow-300">AWS connected</span>
          {connection.accountId && <span className="text-2xs text-slate-500">(Account {connection.accountId})</span>}
        </div>
        <button onClick={handleDisconnect} className="text-xs text-slate-400 hover:text-red-400 transition-colors flex items-center gap-1">
          <Unplug size={12} /> Disconnect
        </button>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">S3 Bucket Name</label>
        <input type="text" value={bucketName} onChange={(e) => setBucketName(e.target.value)}
          placeholder="my-website-bucket"
          className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50" />
        <p className="text-2xs text-slate-500 mt-1">We'll create the bucket if it doesn't exist and configure it for static hosting.</p>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">Region</label>
        <select value={region} onChange={(e) => setRegion(e.target.value)}
          className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white focus:outline-none focus:ring-2 focus:ring-brand-500/50">
          <option value="us-east-1">US East (N. Virginia)</option>
          <option value="us-west-2">US West (Oregon)</option>
          <option value="eu-west-1">EU (Ireland)</option>
          <option value="eu-central-1">EU (Frankfurt)</option>
          <option value="ap-southeast-1">Asia Pacific (Singapore)</option>
          <option value="ap-northeast-1">Asia Pacific (Tokyo)</option>
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1.5">CloudFront Distribution ID (optional)</label>
        <input type="text" value={distributionId} onChange={(e) => setDistributionId(e.target.value)}
          placeholder="E1A2B3C4D5E6F7"
          className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50" />
        <p className="text-2xs text-slate-500 mt-1">If provided, we'll invalidate the CloudFront cache after deploy.</p>
      </div>

      {integration?.lastActionResult?.url && (
        <a href={integration.lastActionResult.url as string} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300">
          <ExternalLink size={12} /> {integration.lastActionResult.url as string}
        </a>
      )}

      <Button onClick={handleDeploy} loading={deploying} icon={<Server size={14} />} className="w-full">
        Deploy to S3
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// GCP TAB — Service Account JSON + Firebase Hosting / Cloud Storage
// ═══════════════════════════════════════════════════════════════

function GcpTab({
  projectId,
  connection,
  integration,
  onRefresh,
}: {
  projectId: string;
  connection?: Connection;
  integration?: ProjectIntegration;
  onRefresh: () => void;
}) {
  const [saKey, setSaKey] = useState('');
  const [gcpProjectId, setGcpProjectId] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [target, setTarget] = useState<'firebase_hosting' | 'cloud_storage'>(integration?.config?.target || 'firebase_hosting');
  const [siteId, setSiteId] = useState(integration?.config?.siteId || '');
  const [bucketName, setBucketName] = useState(integration?.config?.bucketName || '');
  const [deploying, setDeploying] = useState(false);

  const handleConnect = async () => {
    if (!saKey.trim()) {
      toast('error', 'Paste your service account JSON key');
      return;
    }
    setConnecting(true);
    try {
      await shipFetch('/api/v1/projects/connect/gcp', {
        method: 'POST',
        body: JSON.stringify({ serviceAccountKey: saKey.trim(), projectId: gcpProjectId.trim() || undefined }),
      });
      toast('success', 'Google Cloud connected!');
      setSaKey('');
      onRefresh();
    } catch (err: any) {
      toast('error', 'Connection failed', err.message);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      await shipFetch('/api/v1/projects/connections/gcp', { method: 'DELETE' });
      toast('success', 'Google Cloud disconnected');
      onRefresh();
    } catch (err: any) {
      toast('error', 'Failed', err.message);
    }
  };

  const handleDeploy = async () => {
    if (target === 'firebase_hosting' && !siteId.trim() && !connection?.accountId) {
      toast('error', 'Enter a Firebase Hosting site ID');
      return;
    }
    if (target === 'cloud_storage' && !bucketName.trim()) {
      toast('error', 'Enter a Cloud Storage bucket name');
      return;
    }
    setDeploying(true);
    try {
      const result = await shipFetch<{ status: string; url: string; filesCount: number }>(
        `/api/v1/projects/${projectId}/gcp/deploy`,
        {
          method: 'POST',
          body: JSON.stringify({
            target,
            siteId: siteId.trim() || undefined,
            bucketName: bucketName.trim() || undefined,
          }),
        }
      );
      toast('success', 'Deployed to Google Cloud!', result.url);
      onRefresh();
    } catch (err: any) {
      toast('error', 'Deploy failed', err.message);
    } finally {
      setDeploying(false);
    }
  };

  if (!connection) {
    return (
      <div className="space-y-5">
        <div className="p-5 rounded-xl bg-slate-500/10 border border-white/10">
          <Flame size={28} className="text-blue-400 mb-3" />
          <p className="text-sm text-slate-300 mb-1">Connect Google Cloud</p>
          <p className="text-xs text-slate-500 mb-4">Deploy to Firebase Hosting or Google Cloud Storage.</p>
        </div>

        <div className="p-4 rounded-xl bg-blue-500/5 border border-blue-500/10 space-y-3">
          <p className="text-xs font-medium text-blue-300">Create a Service Account Key:</p>
          <ol className="text-2xs text-slate-400 space-y-1.5 list-decimal list-inside">
            <li>Go to <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">GCP Service Accounts</a></li>
            <li>Create a new service account or select an existing one</li>
            <li>Grant roles: <strong>Firebase Hosting Admin</strong> and/or <strong>Storage Admin</strong></li>
            <li>Go to Keys tab → Add key → JSON</li>
            <li>Paste the entire JSON file contents below</li>
          </ol>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Service Account JSON Key</label>
          <textarea value={saKey} onChange={(e) => setSaKey(e.target.value)}
            placeholder='{"type": "service_account", "project_id": "...", ...}'
            rows={4}
            className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50 resize-none" />
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">GCP Project ID (optional — auto-detected from key)</label>
          <input type="text" value={gcpProjectId} onChange={(e) => setGcpProjectId(e.target.value)}
            placeholder="my-project-123"
            className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50" />
        </div>

        <Button onClick={handleConnect} loading={connecting} icon={<Link2 size={14} />} className="w-full">
          Connect Google Cloud
        </Button>
      </div>
    );
  }

  // Connected — deploy form
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between p-3 rounded-xl bg-blue-500/10 border border-blue-500/20">
        <div className="flex items-center gap-2">
          <Check size={14} className="text-blue-400" />
          <span className="text-sm text-blue-300">Google Cloud connected</span>
          {connection.accountId && <span className="text-2xs text-slate-500">({connection.accountId})</span>}
        </div>
        <button onClick={handleDisconnect} className="text-xs text-slate-400 hover:text-red-400 transition-colors flex items-center gap-1">
          <Unplug size={12} /> Disconnect
        </button>
      </div>

      {/* Deploy target selector */}
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-2">Deploy Target</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => setTarget('firebase_hosting')}
            className={clsx(
              'p-3 rounded-lg border text-left transition-colors',
              target === 'firebase_hosting'
                ? 'border-brand-500/50 bg-brand-500/10'
                : 'border-white/10 bg-white/5 hover:border-white/20',
            )}
          >
            <Flame size={16} className={target === 'firebase_hosting' ? 'text-brand-400' : 'text-slate-400'} />
            <p className="text-xs font-medium text-white mt-1">Firebase Hosting</p>
            <p className="text-2xs text-slate-500">Global CDN, SSL, custom domains</p>
          </button>
          <button
            onClick={() => setTarget('cloud_storage')}
            className={clsx(
              'p-3 rounded-lg border text-left transition-colors',
              target === 'cloud_storage'
                ? 'border-brand-500/50 bg-brand-500/10'
                : 'border-white/10 bg-white/5 hover:border-white/20',
            )}
          >
            <Database size={16} className={target === 'cloud_storage' ? 'text-brand-400' : 'text-slate-400'} />
            <p className="text-xs font-medium text-white mt-1">Cloud Storage</p>
            <p className="text-2xs text-slate-500">GCS static website hosting</p>
          </button>
        </div>
      </div>

      {target === 'firebase_hosting' && (
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Firebase Site ID (optional — defaults to project ID)</label>
          <input type="text" value={siteId} onChange={(e) => setSiteId(e.target.value)}
            placeholder={connection.accountId || 'my-project'}
            className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50" />
          <p className="text-2xs text-slate-500 mt-1">Deploys to <code>{siteId || connection.accountId || 'my-project'}.web.app</code></p>
        </div>
      )}

      {target === 'cloud_storage' && (
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1.5">Bucket Name</label>
          <input type="text" value={bucketName} onChange={(e) => setBucketName(e.target.value)}
            placeholder={`${connection.accountId}-website`}
            className="w-full px-3 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/50" />
          <p className="text-2xs text-slate-500 mt-1">Bucket will be created if it doesn't exist. Configured for static website hosting.</p>
        </div>
      )}

      {integration?.lastActionResult?.url && (
        <a href={integration.lastActionResult.url as string} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-2 text-xs text-blue-400 hover:text-blue-300">
          <ExternalLink size={12} /> {integration.lastActionResult.url as string}
        </a>
      )}

      <Button onClick={handleDeploy} loading={deploying} icon={<Flame size={14} />} className="w-full">
        Deploy to {target === 'firebase_hosting' ? 'Firebase Hosting' : 'Cloud Storage'}
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// DOWNLOAD TAB
// ═══════════════════════════════════════════════════════════════

function DownloadTab({ projectId }: { projectId: string }) {
  const [downloading, setDownloading] = useState(false);
  const files = useEditorStore((s) => s.files);
  const project = useEditorStore((s) => s.project);

  const handleDownload = async () => {
    setDownloading(true);
    try {
      const result = await shipFetch<{ format: string; filesCount: number; files: { path: string; content: string }[] }>(
        `/api/v1/projects/${projectId}/export`,
        { method: 'POST' }
      );

      if (result.format === 'json-files' && result.files) {
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
      }
    } catch (err: any) {
      toast('error', 'Export failed', err.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-xl bg-slate-500/10 border border-white/10">
        <p className="text-sm text-slate-300 mb-1">Download your project</p>
        <p className="text-xs text-slate-500">Get a .zip file with all your project files.</p>
      </div>

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

      <Button onClick={handleDownload} loading={downloading} icon={<FolderArchive size={14} />} className="w-full">
        Download as .zip
      </Button>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// ENV VARS TAB — Secrets manager
// ═══════════════════════════════════════════════════════════════

function EnvVarsTab({ projectId }: { projectId: string }) {
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [loading, setLoading] = useState(true);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [isSecret, setIsSecret] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showValues, setShowValues] = useState<Set<string>>(new Set());

  useEffect(() => {
    loadVars();
  }, [projectId]);

  const loadVars = async () => {
    setLoading(true);
    try {
      const data = await shipFetch<EnvVar[]>(`/api/v1/projects/${projectId}/env`);
      setVars(data);
    } catch { /* empty */ } finally {
      setLoading(false);
    }
  };

  const handleAdd = async () => {
    if (!newKey.trim() || !newValue.trim()) {
      toast('error', 'Enter a key and value');
      return;
    }
    setSaving(true);
    try {
      await shipFetch(`/api/v1/projects/${projectId}/env`, {
        method: 'POST',
        body: JSON.stringify({ key: newKey.trim(), value: newValue.trim(), isSecret, description: newDesc.trim() || undefined }),
      });
      toast('success', `${newKey} saved`);
      setNewKey('');
      setNewValue('');
      setNewDesc('');
      loadVars();
    } catch (err: any) {
      toast('error', 'Failed to save', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (key: string) => {
    try {
      await shipFetch(`/api/v1/projects/${projectId}/env/${key}`, { method: 'DELETE' });
      toast('success', `${key} deleted`);
      loadVars();
    } catch (err: any) {
      toast('error', 'Failed', err.message);
    }
  };

  const toggleShow = (id: string) => {
    setShowValues(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-5">
      <div className="p-4 rounded-xl bg-slate-500/10 border border-white/10">
        <p className="text-sm text-slate-300 mb-1">Environment Variables & Secrets</p>
        <p className="text-xs text-slate-500">Store API keys (Stripe, Resend, etc.) for your project. Secrets are encrypted at rest.</p>
      </div>

      {/* Existing vars */}
      {loading ? (
        <Loader2 size={16} className="animate-spin text-slate-400 mx-auto" />
      ) : vars.length > 0 ? (
        <div className="space-y-2">
          {vars.map(v => (
            <div key={v.id} className="flex items-center gap-2 p-2.5 rounded-lg bg-white/5 border border-white/5">
              <Key size={12} className="text-slate-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-mono text-slate-300">{v.key}</p>
                <p className="text-2xs text-slate-500 truncate">
                  {showValues.has(v.id) ? v.value : '••••••••'}
                </p>
              </div>
              <button onClick={() => toggleShow(v.id)} className="p-1 text-slate-500 hover:text-slate-300">
                {showValues.has(v.id) ? <EyeOff size={12} /> : <Eye size={12} />}
              </button>
              <button onClick={() => handleDelete(v.key)} className="p-1 text-slate-500 hover:text-red-400">
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-slate-500 text-center py-4">No environment variables set yet.</p>
      )}

      {/* Add new */}
      <div className="p-4 rounded-xl bg-white/5 border border-white/5 space-y-3">
        <p className="text-xs font-medium text-slate-300">Add variable</p>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            value={newKey}
            onChange={(e) => setNewKey(e.target.value.toUpperCase())}
            placeholder="STRIPE_SECRET_KEY"
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
          />
          <input
            type={isSecret ? 'password' : 'text'}
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="sk_live_..."
            className="px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
          />
        </div>
        <input
          type="text"
          value={newDesc}
          onChange={(e) => setNewDesc(e.target.value)}
          placeholder="Description (optional)"
          className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500/50"
        />
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input type="checkbox" checked={isSecret} onChange={(e) => setIsSecret(e.target.checked)}
              className="rounded border-slate-600" />
            Encrypt value (secret)
          </label>
          <Button size="xs" onClick={handleAdd} loading={saving} icon={<Plus size={12} />}>
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
