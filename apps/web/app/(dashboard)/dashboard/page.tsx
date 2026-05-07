// ============================================================
// SimpleBuild Pro — Dashboard Page
// Project list, create dialog, usage overview
// ============================================================

'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { projectsApi, billingApi, authApi, clearTokens } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { toast } from '@/components/ui/toast';
import { Dropdown, DropdownItem, DropdownSeparator } from '@/components/ui/dropdown';
import {
  Plus, FolderOpen, Clock, Globe, Rocket, MoreVertical,
  Trash2, Settings, LogOut, User, CreditCard, BarChart3,
  Search, LayoutGrid, List, ChevronRight,
} from 'lucide-react';

interface ProjectItem {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  templateId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface UsageData {
  plan: string;
  aiTokensUsed: number;
  aiTokensLimit: number;
  deploysUsed: number;
  deploysLimit: number;
  storageUsedBytes: number;
  storageLimitBytes: number;
  projectsCount: number;
  projectsLimit: number;
}

const TEMPLATES = [
  { id: 'blank', name: 'Blank', icon: '📄', desc: 'Start from scratch' },
  { id: 'landing-page', name: 'Landing Page', icon: '🚀', desc: 'Modern landing page' },
  { id: 'portfolio', name: 'Portfolio', icon: '🎨', desc: 'Dark portfolio theme' },
  { id: 'blog', name: 'Blog', icon: '📝', desc: 'Minimal blog layout' },
  { id: 'business', name: 'Business', icon: '💼', desc: 'Professional business site' },
];

export default function DashboardPage() {
  const router = useRouter();
  const { user, logout: storeLogout } = useAuthStore();
  const [projects, setProjects] = useState<ProjectItem[]>([]);
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Create project form
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [newTemplate, setNewTemplate] = useState('blank');
  const [creating, setCreating] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [projRes, usageRes] = await Promise.all([
        projectsApi.list({ pageSize: 50 }),
        billingApi.getUsage().catch(() => null),
      ]);
      setProjects((projRes as any)?.items || (projRes as any)?.data || []);
      if (usageRes) setUsage(usageRes as any);
    } catch (err: any) {
      toast('error', 'Failed to load projects', err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    try {
      const project = await projectsApi.create({
        name: newName.trim(),
        description: newDesc.trim() || undefined,
        templateId: newTemplate !== 'blank' ? newTemplate : undefined,
      });
      toast('success', 'Project created', `"${(project as any).name}" is ready.`);
      setCreateOpen(false);
      setNewName('');
      setNewDesc('');
      setNewTemplate('blank');
      router.push(`/editor/${(project as any).id}`);
    } catch (err: any) {
      toast('error', 'Create failed', err.message);
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await projectsApi.delete(id);
      setProjects((prev) => prev.filter((p) => p.id !== id));
      toast('success', 'Project deleted');
      setDeleteConfirm(null);
    } catch (err: any) {
      toast('error', 'Delete failed', err.message);
    }
  };

  const handleLogout = async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    clearTokens();
    storeLogout();
    router.push('/login');
  };

  const filtered = projects.filter(
    (p) => p.name.toLowerCase().includes(search.toLowerCase()),
  );

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
    return `${(bytes / 1073741824).toFixed(1)} GB`;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* ─── Top Bar ───────────────────────────────────────── */}
      <nav className="sticky top-0 z-40 bg-white border-b border-slate-200">
        <div className="max-w-7xl mx-auto px-6 flex items-center justify-between h-14">
          <Link href="/dashboard" className="text-lg font-extrabold text-slate-900 tracking-tight">
            SimpleBuild<span className="text-brand-600">Pro</span>
          </Link>

          <div className="flex items-center gap-3">
            {usage && (
              <span className="hidden sm:inline text-xs text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full font-medium capitalize">
                {usage.plan} Plan
              </span>
            )}
            <Dropdown
              trigger={
                <button className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-slate-100 transition-colors">
                  <div className="w-7 h-7 rounded-full bg-brand-600 flex items-center justify-center text-white text-xs font-bold">
                    {user?.name?.charAt(0)?.toUpperCase() || 'U'}
                  </div>
                  <span className="hidden sm:inline text-sm font-medium text-slate-700">{user?.name || 'User'}</span>
                </button>
              }
            >
              <DropdownItem icon={<User size={14} />} onClick={() => router.push('/dashboard/settings')}>Profile</DropdownItem>
              <DropdownItem icon={<CreditCard size={14} />} onClick={() => router.push('/dashboard/settings?tab=billing')}>Billing</DropdownItem>
              <DropdownSeparator />
              <DropdownItem icon={<LogOut size={14} />} onClick={handleLogout} danger>Log out</DropdownItem>
            </Dropdown>
          </div>
        </div>
      </nav>

      {/* ─── Main ──────────────────────────────────────────── */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Usage Cards */}
        {usage && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Projects', value: `${usage.projectsCount}`, limit: usage.projectsLimit === -1 ? '∞' : `/${usage.projectsLimit}`, icon: FolderOpen },
              { label: 'AI Messages', value: `${usage.aiTokensUsed}`, limit: `/${usage.aiTokensLimit}`, icon: BarChart3 },
              { label: 'Deploys', value: `${usage.deploysUsed}`, limit: usage.deploysLimit === -1 ? '/∞' : `/${usage.deploysLimit}`, icon: Rocket },
              { label: 'Storage', value: formatBytes(usage.storageUsedBytes), limit: `/ ${formatBytes(usage.storageLimitBytes)}`, icon: Globe },
            ].map(({ label, value, limit, icon: Icon }) => (
              <div key={label} className="bg-white rounded-xl border border-slate-200 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Icon size={14} className="text-slate-400" />
                  <span className="text-xs font-medium text-slate-500">{label}</span>
                </div>
                <p className="text-lg font-bold text-slate-900">
                  {value}<span className="text-sm font-normal text-slate-400">{limit}</span>
                </p>
              </div>
            ))}
          </div>
        )}

        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-xl font-bold text-slate-900">Projects</h1>
          <div className="flex items-center gap-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search projects..."
                className="pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent w-56"
              />
            </div>
            <div className="flex border border-slate-200 rounded-lg overflow-hidden">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 ${viewMode === 'grid' ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <LayoutGrid size={14} />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 ${viewMode === 'list' ? 'bg-slate-100 text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
              >
                <List size={14} />
              </button>
            </div>
            <Button onClick={() => setCreateOpen(true)} icon={<Plus size={14} />} size="sm">
              New Project
            </Button>
          </div>
        </div>

        {/* Loading */}
        {loading && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-white rounded-xl border border-slate-200 p-6">
                <div className="skeleton h-5 w-3/4 mb-3" />
                <div className="skeleton h-3 w-1/2 mb-4" />
                <div className="skeleton h-3 w-full" />
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && filtered.length === 0 && (
          <div className="text-center py-20">
            <div className="inline-flex items-center justify-center w-16 h-16 bg-slate-100 rounded-2xl mb-4">
              <FolderOpen size={28} className="text-slate-400" />
            </div>
            <h3 className="text-base font-semibold text-slate-900 mb-1">
              {search ? 'No matching projects' : 'No projects yet'}
            </h3>
            <p className="text-sm text-slate-500 mb-6">
              {search ? 'Try a different search term.' : 'Create your first project to get started.'}
            </p>
            {!search && (
              <Button onClick={() => setCreateOpen(true)} icon={<Plus size={14} />}>
                Create Project
              </Button>
            )}
          </div>
        )}

        {/* Project Grid */}
        {!loading && filtered.length > 0 && viewMode === 'grid' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map((project) => (
              <div
                key={project.id}
                className="group bg-white rounded-xl border border-slate-200 hover:border-brand-200 hover:shadow-md transition-all cursor-pointer"
                onClick={() => router.push(`/editor/${project.id}`)}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-slate-900 truncate">{project.name}</h3>
                      <p className="text-xs text-slate-400 mt-0.5">/{project.slug}</p>
                    </div>
                    <div onClick={(e) => e.stopPropagation()}>
                      <Dropdown
                        trigger={
                          <button className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-all">
                            <MoreVertical size={14} />
                          </button>
                        }
                      >
                        <DropdownItem icon={<Settings size={14} />} onClick={() => router.push(`/editor/${project.id}`)}>
                          Open Editor
                        </DropdownItem>
                        <DropdownSeparator />
                        <DropdownItem icon={<Trash2 size={14} />} danger onClick={() => setDeleteConfirm(project.id)}>
                          Delete
                        </DropdownItem>
                      </Dropdown>
                    </div>
                  </div>
                  {project.description && (
                    <p className="text-xs text-slate-500 line-clamp-2 mb-3">{project.description}</p>
                  )}
                  <div className="flex items-center gap-3 text-xs text-slate-400">
                    <span className="flex items-center gap-1">
                      <Clock size={10} />
                      {new Date(project.updatedAt).toLocaleDateString()}
                    </span>
                    <span className={`px-1.5 py-0.5 rounded-full text-2xs font-medium ${
                      project.status === 'published' ? 'bg-green-50 text-green-700' :
                      project.status === 'archived' ? 'bg-slate-100 text-slate-500' :
                      'bg-amber-50 text-amber-700'
                    }`}>
                      {project.status}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Project List */}
        {!loading && filtered.length > 0 && viewMode === 'list' && (
          <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100">
            {filtered.map((project) => (
              <div
                key={project.id}
                className="flex items-center justify-between px-5 py-3.5 hover:bg-slate-50 cursor-pointer transition-colors"
                onClick={() => router.push(`/editor/${project.id}`)}
              >
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <FolderOpen size={16} className="text-slate-400 shrink-0" />
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900 truncate">{project.name}</h3>
                    <p className="text-xs text-slate-400">Updated {new Date(project.updatedAt).toLocaleDateString()}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className={`px-2 py-0.5 rounded-full text-2xs font-medium ${
                    project.status === 'published' ? 'bg-green-50 text-green-700' :
                    project.status === 'archived' ? 'bg-slate-100 text-slate-500' :
                    'bg-amber-50 text-amber-700'
                  }`}>
                    {project.status}
                  </span>
                  <ChevronRight size={14} className="text-slate-300" />
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* ─── Create Project Modal ──────────────────────────── */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="New Project" size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Project Name</label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="My Awesome Website"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description (optional)</label>
            <input
              type="text"
              value={newDesc}
              onChange={(e) => setNewDesc(e.target.value)}
              placeholder="A short description of your project"
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-2">Template</label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setNewTemplate(t.id)}
                  className={`p-3 rounded-lg border text-left transition-all ${
                    newTemplate === t.id
                      ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-200'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <span className="text-lg">{t.icon}</span>
                  <p className="text-xs font-semibold text-slate-900 mt-1">{t.name}</p>
                  <p className="text-2xs text-slate-500">{t.desc}</p>
                </button>
              ))}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button onClick={handleCreate} loading={creating} disabled={!newName.trim()}>Create Project</Button>
          </div>
        </div>
      </Modal>

      {/* ─── Delete Confirm Modal ──────────────────────────── */}
      <Modal
        open={!!deleteConfirm}
        onClose={() => setDeleteConfirm(null)}
        title="Delete Project"
        description="This action cannot be undone. All files, assets, deployments, and version history will be permanently deleted."
        size="sm"
      >
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>Cancel</Button>
          <Button variant="danger" onClick={() => deleteConfirm && handleDelete(deleteConfirm)}>Delete Project</Button>
        </div>
      </Modal>
    </div>
  );
}
