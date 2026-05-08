// ============================================================
// SimpleBuild Pro — Settings > Integrations Page
// Manage connected accounts: GitHub, Cloudflare, Vercel, Netlify, Supabase
// ============================================================

'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { getAccessToken } from '@/lib/api-client';
import {
  ArrowLeft, Github, Cloud, Triangle, Globe2, Database,
  Check, Loader2, ExternalLink, Unplug, Link2, RefreshCw,
  Shield, Clock, AlertCircle,
} from 'lucide-react';
import clsx from 'clsx';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface Connection {
  id: string;
  provider: string;
  displayName: string;
  accountId: string | null;
  connectedAt: string;
  hasToken: boolean;
  metadata?: Record<string, any>;
}

const PROVIDERS = [
  {
    id: 'github_repo',
    name: 'GitHub',
    description: 'Push project files to any repo. OAuth with repo scope.',
    icon: Github,
    color: 'text-white',
    bg: 'bg-[#24292e]',
    connectType: 'oauth' as const,
  },
  {
    id: 'cloudflare',
    name: 'Cloudflare Pages',
    description: 'Deploy to Cloudflare\'s global edge network.',
    icon: Cloud,
    color: 'text-orange-500',
    bg: 'bg-orange-50',
    connectType: 'token' as const,
  },
  {
    id: 'vercel',
    name: 'Vercel',
    description: 'Deploy to Vercel\'s edge platform with one click.',
    icon: Triangle,
    color: 'text-black',
    bg: 'bg-slate-100',
    connectType: 'oauth' as const,
  },
  {
    id: 'netlify',
    name: 'Netlify',
    description: 'Deploy static sites and serverless functions.',
    icon: Globe2,
    color: 'text-teal-600',
    bg: 'bg-teal-50',
    connectType: 'oauth' as const,
  },
  {
    id: 'supabase',
    name: 'Supabase',
    description: 'Backend-as-a-service: Postgres, Auth, Storage, Realtime.',
    icon: Database,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    connectType: 'token' as const,
  },
];

async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
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

export default function IntegrationsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [connections, setConnections] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);

  // Cloudflare token form
  const [cfToken, setCfToken] = useState('');
  const [cfAccountId, setCfAccountId] = useState('');
  const [cfConnecting, setCfConnecting] = useState(false);
  const [showCfForm, setShowCfForm] = useState(false);

  // Supabase form
  const [sbUrl, setSbUrl] = useState('');
  const [sbAnonKey, setSbAnonKey] = useState('');
  const [sbServiceKey, setSbServiceKey] = useState('');
  const [sbConnecting, setSbConnecting] = useState(false);
  const [showSbForm, setShowSbForm] = useState(false);

  useEffect(() => {
    loadConnections();
  }, []);

  // Handle OAuth callback redirects
  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');
    if (connected) {
      toast('success', `${connected} connected successfully!`);
      loadConnections();
    }
    if (error) {
      toast('error', 'Connection failed', error.replace(/_/g, ' '));
    }
  }, [searchParams]);

  const loadConnections = async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Connection[]>('/api/v1/projects/connections');
      setConnections(data || []);
    } catch {
      // No connections yet
    } finally {
      setLoading(false);
    }
  };

  const getConnection = (provider: string) => connections.find(c => c.provider === provider);

  const handleOAuthConnect = (provider: string) => {
    // Map provider IDs to endpoint paths
    const providerMap: Record<string, string> = {
      github_repo: 'github',
      vercel: 'vercel',
      netlify: 'netlify',
    };
    const path = providerMap[provider] || provider;
    window.location.href = `${API_BASE}/api/v1/projects/connect/${path}`;
  };

  const handleDisconnect = async (provider: string) => {
    try {
      await apiFetch(`/api/v1/projects/connections/${provider}`, { method: 'DELETE' });
      toast('success', 'Disconnected');
      loadConnections();
    } catch (err: any) {
      toast('error', 'Failed to disconnect', err.message);
    }
  };

  const handleCloudflareConnect = async () => {
    if (!cfToken.trim()) {
      toast('error', 'Paste your Cloudflare API token');
      return;
    }
    setCfConnecting(true);
    try {
      await apiFetch('/api/v1/projects/connect/cloudflare', {
        method: 'POST',
        body: JSON.stringify({ apiToken: cfToken.trim(), accountId: cfAccountId.trim() || undefined }),
      });
      toast('success', 'Cloudflare connected!');
      setCfToken('');
      setCfAccountId('');
      setShowCfForm(false);
      loadConnections();
    } catch (err: any) {
      toast('error', 'Connection failed', err.message);
    } finally {
      setCfConnecting(false);
    }
  };

  const handleSupabaseConnect = async () => {
    if (!sbUrl.trim() || !sbAnonKey.trim()) {
      toast('error', 'Enter project URL and anon key');
      return;
    }
    setSbConnecting(true);
    try {
      await apiFetch('/api/v1/projects/connect/supabase', {
        method: 'POST',
        body: JSON.stringify({
          projectUrl: sbUrl.trim(),
          anonKey: sbAnonKey.trim(),
          serviceRoleKey: sbServiceKey.trim() || undefined,
        }),
      });
      toast('success', 'Supabase connected!');
      setSbUrl('');
      setSbAnonKey('');
      setSbServiceKey('');
      setShowSbForm(false);
      loadConnections();
    } catch (err: any) {
      toast('error', 'Connection failed', err.message);
    } finally {
      setSbConnecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Bar */}
      <nav className="sticky top-0 z-40 bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 flex items-center h-14 gap-4">
          <button
            onClick={() => router.push('/dashboard/settings')}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <h1 className="text-base font-bold text-slate-900">Integrations</h1>
          <span className="text-xs text-slate-500">Connected accounts &amp; services</span>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {/* Info banner */}
        <div className="mb-8 p-4 rounded-xl bg-blue-50 border border-blue-100 flex items-start gap-3">
          <Shield size={16} className="text-blue-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm text-blue-800 font-medium">Your credentials are encrypted</p>
            <p className="text-xs text-blue-600 mt-0.5">
              All tokens and API keys are encrypted with AES-256-GCM before storage.
              OAuth connections use short-lived tokens with minimal scopes.
              You can disconnect at any time.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 size={24} className="animate-spin text-slate-400" />
          </div>
        ) : (
          <div className="space-y-4">
            {PROVIDERS.map((provider) => {
              const conn = getConnection(provider.id);
              const Icon = provider.icon;

              return (
                <div
                  key={provider.id}
                  className="bg-white rounded-xl border border-slate-200 p-5 hover:shadow-sm transition-shadow"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={clsx('w-10 h-10 rounded-xl flex items-center justify-center', provider.bg)}>
                        <Icon size={18} className={provider.color} />
                      </div>
                      <div>
                        <h3 className="text-sm font-semibold text-slate-900">{provider.name}</h3>
                        <p className="text-xs text-slate-500 mt-0.5">{provider.description}</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      {conn ? (
                        <>
                          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-green-50 border border-green-200">
                            <Check size={12} className="text-green-600" />
                            <span className="text-xs font-medium text-green-700">
                              {conn.displayName}
                            </span>
                          </div>
                          <button
                            onClick={() => handleDisconnect(provider.id)}
                            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs text-slate-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                          >
                            <Unplug size={12} />
                            Disconnect
                          </button>
                        </>
                      ) : (
                        <>
                          {provider.connectType === 'oauth' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleOAuthConnect(provider.id)}
                              icon={<Link2 size={13} />}
                            >
                              Connect
                            </Button>
                          )}
                          {provider.id === 'cloudflare' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setShowCfForm(!showCfForm)}
                              icon={<Link2 size={13} />}
                            >
                              {showCfForm ? 'Cancel' : 'Connect'}
                            </Button>
                          )}
                          {provider.id === 'supabase' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setShowSbForm(!showSbForm)}
                              icon={<Link2 size={13} />}
                            >
                              {showSbForm ? 'Cancel' : 'Connect'}
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Connection details */}
                  {conn && (
                    <div className="mt-3 pl-14 flex items-center gap-4 text-xs text-slate-500">
                      <span className="flex items-center gap-1">
                        <Clock size={11} />
                        Connected {new Date(conn.connectedAt).toLocaleDateString()}
                      </span>
                      {conn.accountId && (
                        <span className="flex items-center gap-1">
                          ID: {conn.accountId.slice(0, 12)}...
                        </span>
                      )}
                    </div>
                  )}

                  {/* Cloudflare token form */}
                  {provider.id === 'cloudflare' && showCfForm && !conn && (
                    <div className="mt-4 pl-14 space-y-3">
                      <div className="p-3 rounded-lg bg-orange-50 border border-orange-100">
                        <p className="text-xs text-orange-700 font-medium mb-1">Create a scoped API token:</p>
                        <ol className="text-xs text-orange-600 list-decimal list-inside space-y-0.5">
                          <li>Go to <a href="https://dash.cloudflare.com/profile/api-tokens" target="_blank" rel="noopener noreferrer" className="underline hover:text-orange-800">Cloudflare API Tokens</a></li>
                          <li>Click "Create Token" → use <strong>"Edit Cloudflare Pages"</strong> template</li>
                          <li>Set account scope → Create token → Paste below</li>
                        </ol>
                      </div>
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={cfToken}
                          onChange={(e) => setCfToken(e.target.value)}
                          placeholder="API Token"
                          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        />
                        <input
                          type="text"
                          value={cfAccountId}
                          onChange={(e) => setCfAccountId(e.target.value)}
                          placeholder="Account ID (optional)"
                          className="w-48 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        />
                      </div>
                      <Button size="sm" onClick={handleCloudflareConnect} loading={cfConnecting}>
                        Verify &amp; Connect
                      </Button>
                    </div>
                  )}

                  {/* Supabase form */}
                  {provider.id === 'supabase' && showSbForm && !conn && (
                    <div className="mt-4 pl-14 space-y-3">
                      <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-100">
                        <p className="text-xs text-emerald-700 font-medium mb-1">Find your keys:</p>
                        <p className="text-xs text-emerald-600">
                          Go to your Supabase project → Settings → API. Copy the Project URL and anon key.
                        </p>
                      </div>
                      <input
                        type="url"
                        value={sbUrl}
                        onChange={(e) => setSbUrl(e.target.value)}
                        placeholder="https://abc123.supabase.co"
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                      <div className="flex gap-2">
                        <input
                          type="password"
                          value={sbAnonKey}
                          onChange={(e) => setSbAnonKey(e.target.value)}
                          placeholder="anon / public key"
                          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        />
                        <input
                          type="password"
                          value={sbServiceKey}
                          onChange={(e) => setSbServiceKey(e.target.value)}
                          placeholder="service_role key (optional)"
                          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                        />
                      </div>
                      <Button size="sm" onClick={handleSupabaseConnect} loading={sbConnecting}>
                        Connect Supabase
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* FAQ */}
        <div className="mt-10 p-5 rounded-xl bg-white border border-slate-200">
          <h3 className="text-sm font-semibold text-slate-900 mb-3">How it works</h3>
          <div className="space-y-3 text-xs text-slate-600">
            <div className="flex items-start gap-2">
              <span className="font-bold text-brand-600 shrink-0">1.</span>
              <p><strong>Connect once</strong> — Link your accounts here (Settings → Integrations). This is account-level; all your projects can use these connections.</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-bold text-brand-600 shrink-0">2.</span>
              <p><strong>Ship from the editor</strong> — Open any project, click the <strong>Ship</strong> button in the toolbar. Pick a repo/service and deploy with one click.</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="font-bold text-brand-600 shrink-0">3.</span>
              <p><strong>Download anytime</strong> — Every project can be exported as a .zip from the Ship panel. No connection required.</p>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
