// ============================================================
// SimpleBuild Pro — Admin Dashboard
// Platform overview: users, projects, deployments, system health
// ============================================================

'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { toast } from '@/components/ui/toast';
import { Button } from '@/components/ui/button';
import {
  Users, FolderKanban, Rocket, Building2, Activity,
  Server, Shield, Clock, BarChart3, RefreshCw, Loader2,
  ChevronLeft, ChevronRight, Database, Cpu, MemoryStick,
} from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface AdminOverview {
  totals: { users: number; projects: number; deployments: number; organizations: number };
  last30Days: { newUsers: number; deployments: number };
  planDistribution: Record<string, number>;
  aiTokensThisMonth: number;
  infrastructure: {
    rateLimiter: { backend: string; connected: boolean; latencyMs?: number };
  };
}

interface PaginatedList<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export default function AdminDashboardPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [userList, setUserList] = useState<PaginatedList<any> | null>(null);
  const [projectList, setProjectList] = useState<PaginatedList<any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'projects' | 'deployments' | 'health'>('overview');
  const [userPage, setUserPage] = useState(1);
  const [projectPage, setProjectPage] = useState(1);

  // Check admin access
  useEffect(() => {
    if (user && user.plan !== 'enterprise' && user.plan !== 'business') {
      toast('error', 'Access Denied', 'Admin dashboard requires Business or Enterprise plan.');
      router.push('/dashboard');
    }
  }, [user, router]);

  // Fetch admin data
  const fetchData = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('sbp_refresh_token');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };

      const [overviewRes, usersRes, projectsRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/admin/overview`, { headers }),
        fetch(`${API_BASE}/api/v1/admin/users?page=${userPage}&pageSize=20`, { headers }),
        fetch(`${API_BASE}/api/v1/admin/projects?page=${projectPage}&pageSize=20`, { headers }),
      ]);

      if (overviewRes.ok) {
        const data = await overviewRes.json();
        setOverview(data.data);
      }
      if (usersRes.ok) {
        const data = await usersRes.json();
        setUserList(data.data);
      }
      if (projectsRes.ok) {
        const data = await projectsRes.json();
        setProjectList(data.data);
      }
    } catch (err: any) {
      toast('error', 'Failed to load admin data', err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [userPage, projectPage]);

  if (loading && !overview) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="animate-spin text-brand-600" size={32} />
      </div>
    );
  }

  const tabs = [
    { id: 'overview' as const, label: 'Overview', icon: <BarChart3 size={16} /> },
    { id: 'users' as const, label: 'Users', icon: <Users size={16} /> },
    { id: 'projects' as const, label: 'Projects', icon: <FolderKanban size={16} /> },
    { id: 'health' as const, label: 'System Health', icon: <Activity size={16} /> },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <div className="bg-white border-b border-slate-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="text-brand-600" size={24} />
            <div>
              <h1 className="text-xl font-bold text-slate-900">Admin Dashboard</h1>
              <p className="text-sm text-slate-500">Platform management & monitoring</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={fetchData} icon={<RefreshCw size={14} />}>
              Refresh
            </Button>
            <Button size="sm" variant="ghost" onClick={() => router.push('/dashboard')}>
              Back to Dashboard
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-6">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white rounded-lg border border-slate-200 p-1 w-fit">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {tab.icon}
              {tab.label}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && overview && (
          <div className="space-y-6">
            {/* Stats Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              <StatCard icon={<Users size={20} />} label="Total Users" value={overview.totals.users} delta={`+${overview.last30Days.newUsers} this month`} color="blue" />
              <StatCard icon={<FolderKanban size={20} />} label="Total Projects" value={overview.totals.projects} color="green" />
              <StatCard icon={<Rocket size={20} />} label="Deployments" value={overview.totals.deployments} delta={`+${overview.last30Days.deployments} this month`} color="purple" />
              <StatCard icon={<Building2 size={20} />} label="Organizations" value={overview.totals.organizations} color="orange" />
            </div>

            {/* Plan Distribution */}
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-900 mb-4">Plan Distribution</h3>
              <div className="grid grid-cols-4 gap-4">
                {Object.entries(overview.planDistribution).map(([plan, count]) => (
                  <div key={plan} className="text-center p-4 bg-slate-50 rounded-lg">
                    <p className="text-2xl font-bold text-slate-900">{count}</p>
                    <p className="text-sm text-slate-500 capitalize">{plan}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* AI Usage */}
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-900 mb-2">AI Token Usage (This Month)</h3>
              <p className="text-3xl font-bold text-brand-600">{overview.aiTokensThisMonth.toLocaleString()}</p>
            </div>
          </div>
        )}

        {/* Users Tab */}
        {activeTab === 'users' && userList && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="font-semibold text-slate-900">Users ({userList.total})</h3>
            </div>
            <table className="w-full">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-6 py-3 text-left">Email</th>
                  <th className="px-6 py-3 text-left">Name</th>
                  <th className="px-6 py-3 text-left">Plan</th>
                  <th className="px-6 py-3 text-left">Verified</th>
                  <th className="px-6 py-3 text-left">Last Login</th>
                  <th className="px-6 py-3 text-left">Joined</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {userList.items.map((u: any) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 text-sm">{u.email}</td>
                    <td className="px-6 py-3 text-sm">{u.name}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        u.plan === 'enterprise' ? 'bg-purple-100 text-purple-700' :
                        u.plan === 'business' ? 'bg-blue-100 text-blue-700' :
                        u.plan === 'pro' ? 'bg-green-100 text-green-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>{u.plan}</span>
                    </td>
                    <td className="px-6 py-3 text-sm">{u.emailVerified ? 'Yes' : 'No'}</td>
                    <td className="px-6 py-3 text-sm text-slate-500">
                      {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never'}
                    </td>
                    <td className="px-6 py-3 text-sm text-slate-500">
                      {new Date(u.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={userList.page} hasMore={userList.hasMore} onPage={setUserPage} />
          </div>
        )}

        {/* Projects Tab */}
        {activeTab === 'projects' && projectList && (
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-200">
              <h3 className="font-semibold text-slate-900">Projects ({projectList.total})</h3>
            </div>
            <table className="w-full">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="px-6 py-3 text-left">Name</th>
                  <th className="px-6 py-3 text-left">Slug</th>
                  <th className="px-6 py-3 text-left">Status</th>
                  <th className="px-6 py-3 text-left">Last Deployed</th>
                  <th className="px-6 py-3 text-left">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {projectList.items.map((p: any) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-6 py-3 text-sm font-medium">{p.name}</td>
                    <td className="px-6 py-3 text-sm text-slate-500">{p.slug}</td>
                    <td className="px-6 py-3">
                      <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                        p.status === 'published' ? 'bg-green-100 text-green-700' :
                        p.status === 'archived' ? 'bg-slate-100 text-slate-600' :
                        'bg-yellow-100 text-yellow-700'
                      }`}>{p.status}</span>
                    </td>
                    <td className="px-6 py-3 text-sm text-slate-500">
                      {p.lastDeployedAt ? new Date(p.lastDeployedAt).toLocaleDateString() : '-'}
                    </td>
                    <td className="px-6 py-3 text-sm text-slate-500">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Pagination page={projectList.page} hasMore={projectList.hasMore} onPage={setProjectPage} />
          </div>
        )}

        {/* System Health Tab */}
        {activeTab === 'health' && overview && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Database size={18} />
                Rate Limiter
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-slate-600">Backend</span>
                  <span className="text-sm font-medium capitalize">{overview.infrastructure.rateLimiter.backend}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-600">Status</span>
                  <span className={`text-sm font-medium ${overview.infrastructure.rateLimiter.connected ? 'text-green-600' : 'text-yellow-600'}`}>
                    {overview.infrastructure.rateLimiter.connected ? 'Connected' : 'Disconnected (using fallback)'}
                  </span>
                </div>
                {overview.infrastructure.rateLimiter.latencyMs !== undefined && (
                  <div className="flex justify-between">
                    <span className="text-sm text-slate-600">Latency</span>
                    <span className="text-sm font-medium">{overview.infrastructure.rateLimiter.latencyMs}ms</span>
                  </div>
                )}
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6">
              <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <Server size={18} />
                Infrastructure
              </h3>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-slate-600">Platform</span>
                  <span className="text-sm font-medium">Google Cloud Run</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-600">Database</span>
                  <span className="text-sm font-medium">Cloud SQL PostgreSQL 16</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-600">Storage</span>
                  <span className="text-sm font-medium">Google Cloud Storage</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-sm text-slate-600">CDN</span>
                  <span className="text-sm font-medium">Cloud CDN + Global LB</span>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Reusable Components ──────────────────────────────────────

function StatCard({ icon, label, value, delta, color }: {
  icon: React.ReactNode;
  label: string;
  value: number;
  delta?: string;
  color: 'blue' | 'green' | 'purple' | 'orange';
}) {
  const colorMap = {
    blue: 'bg-blue-50 text-blue-600',
    green: 'bg-green-50 text-green-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center gap-3 mb-3">
        <div className={`p-2 rounded-lg ${colorMap[color]}`}>{icon}</div>
        <span className="text-sm text-slate-500">{label}</span>
      </div>
      <p className="text-3xl font-bold text-slate-900">{value.toLocaleString()}</p>
      {delta && <p className="text-xs text-slate-500 mt-1">{delta}</p>}
    </div>
  );
}

function Pagination({ page, hasMore, onPage }: { page: number; hasMore: boolean; onPage: (p: number) => void }) {
  return (
    <div className="flex items-center justify-between px-6 py-3 border-t border-slate-100">
      <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} icon={<ChevronLeft size={14} />}>
        Previous
      </Button>
      <span className="text-sm text-slate-500">Page {page}</span>
      <Button size="sm" variant="ghost" disabled={!hasMore} onClick={() => onPage(page + 1)} icon={<ChevronRight size={14} />}>
        Next
      </Button>
    </div>
  );
}
