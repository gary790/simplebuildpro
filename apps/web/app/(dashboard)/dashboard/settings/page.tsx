// ============================================================
// SimpleBuild Pro — Settings Page
// Profile, Billing, Plan management
// ============================================================

'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/lib/store';
import { authApi, billingApi, clearTokens, setTokens } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import {
  User, CreditCard, Shield, ArrowLeft, Check, ExternalLink, Loader2,
} from 'lucide-react';
import clsx from 'clsx';

type Tab = 'profile' | 'billing' | 'security';

const PLAN_FEATURES: Record<string, string[]> = {
  free: ['3 projects', '50 AI messages/mo', '100 MB storage', '10 deploys/mo'],
  pro: ['25 projects', '500 AI messages/mo', '5 GB storage', 'Unlimited deploys', '3 custom domains', 'Priority support'],
  business: ['Unlimited projects', '2,000 AI messages/mo', '25 GB storage', 'Unlimited deploys', '10 custom domains', 'Team collaboration'],
  enterprise: ['Unlimited everything', 'Custom AI limits', '500 GB storage', 'Dedicated support', 'SSO / SAML', 'SLA guarantee'],
};

export default function SettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, setUser, logout: storeLogout } = useAuthStore();

  const [activeTab, setActiveTab] = useState<Tab>((searchParams.get('tab') as Tab) || 'profile');
  const [saving, setSaving] = useState(false);

  // Profile form
  const [name, setName] = useState(user?.name || '');
  const [avatarUrl, setAvatarUrl] = useState((user as any)?.avatarUrl || '');

  // Password form
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Billing
  const [subscription, setSubscription] = useState<any>(null);
  const [billingLoading, setBillingLoading] = useState(false);

  useEffect(() => {
    if (activeTab === 'billing') {
      setBillingLoading(true);
      billingApi.getSubscription()
        .then((data) => setSubscription(data))
        .catch(() => {})
        .finally(() => setBillingLoading(false));
    }
  }, [activeTab]);

  const handleUpdateProfile = async () => {
    setSaving(true);
    try {
      const updated = await authApi.updateProfile({ name: name.trim(), avatarUrl: avatarUrl.trim() || null });
      setUser(updated as any);
      toast('success', 'Profile updated');
    } catch (err: any) {
      toast('error', 'Update failed', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (newPassword !== confirmPassword) {
      toast('error', 'Passwords do not match');
      return;
    }
    if (newPassword.length < 8) {
      toast('error', 'Password must be at least 8 characters');
      return;
    }

    setSaving(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      toast('success', 'Password changed', 'You will need to log in again.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err: any) {
      toast('error', 'Change failed', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpgrade = async (plan: 'pro' | 'business') => {
    try {
      const { checkoutUrl } = await billingApi.createCheckout({ plan, interval: 'monthly' });
      window.location.href = checkoutUrl;
    } catch (err: any) {
      toast('error', 'Checkout failed', err.message);
    }
  };

  const handleManageBilling = async () => {
    try {
      const { portalUrl } = await billingApi.getPortal();
      window.location.href = portalUrl;
    } catch (err: any) {
      toast('error', 'Portal error', err.message);
    }
  };

  const handleLogout = async () => {
    try { await authApi.logout(); } catch { /* ignore */ }
    clearTokens();
    storeLogout();
    router.push('/login');
  };

  const tabs = [
    { id: 'profile' as Tab, label: 'Profile', icon: User },
    { id: 'billing' as Tab, label: 'Billing', icon: CreditCard },
    { id: 'security' as Tab, label: 'Security', icon: Shield },
  ];

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top Bar */}
      <nav className="sticky top-0 z-40 bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 flex items-center h-14 gap-4">
          <button
            onClick={() => router.push('/dashboard')}
            className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
          >
            <ArrowLeft size={16} />
          </button>
          <h1 className="text-base font-bold text-slate-900">Settings</h1>
        </div>
      </nav>

      <main className="max-w-4xl mx-auto px-6 py-8">
        <div className="flex gap-8">
          {/* Sidebar Tabs */}
          <div className="w-48 shrink-0">
            <nav className="space-y-1">
              {tabs.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setActiveTab(id)}
                  className={clsx(
                    'w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg transition-colors text-left',
                    activeTab === id
                      ? 'bg-brand-50 text-brand-700 font-semibold'
                      : 'text-slate-600 hover:bg-slate-100',
                  )}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </nav>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* ─── Profile Tab ───────────────────────────── */}
            {activeTab === 'profile' && (
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <h2 className="text-lg font-bold text-slate-900 mb-6">Profile</h2>

                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                    <input
                      type="email"
                      value={user?.email || ''}
                      disabled
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm bg-slate-50 text-slate-500"
                    />
                    <p className="text-xs text-slate-400 mt-1">Email cannot be changed.</p>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Avatar URL (optional)</label>
                    <input
                      type="url"
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      placeholder="https://example.com/avatar.jpg"
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    />
                  </div>

                  <div className="pt-2 flex justify-between items-center">
                    <Button onClick={handleUpdateProfile} loading={saving}>Save Changes</Button>
                    <button
                      onClick={handleLogout}
                      className="text-sm text-red-600 hover:text-red-700 font-medium"
                    >
                      Log out
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* ─── Billing Tab ───────────────────────────── */}
            {activeTab === 'billing' && (
              <div className="space-y-6">
                {/* Current Plan */}
                <div className="bg-white rounded-xl border border-slate-200 p-6">
                  <h2 className="text-lg font-bold text-slate-900 mb-4">Current Plan</h2>

                  {billingLoading ? (
                    <div className="flex items-center gap-2 text-slate-500">
                      <Loader2 size={16} className="animate-spin" />
                      <span className="text-sm">Loading...</span>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xl font-bold text-slate-900 capitalize">
                          {subscription?.plan || user?.plan || 'Free'}
                        </p>
                        {subscription?.subscription && (
                          <p className="text-sm text-slate-500 mt-1">
                            Renews {new Date(subscription.subscription.currentPeriodEnd).toLocaleDateString()}
                          </p>
                        )}
                      </div>
                      {subscription?.subscription && (
                        <Button variant="outline" size="sm" onClick={handleManageBilling}>
                          <ExternalLink size={13} className="mr-1.5" />
                          Manage Billing
                        </Button>
                      )}
                    </div>
                  )}
                </div>

                {/* Plan Comparison */}
                <div className="grid md:grid-cols-3 gap-4">
                  {(['free', 'pro', 'business'] as const).map((plan) => {
                    const isCurrent = (user?.plan || 'free') === plan;
                    return (
                      <div
                        key={plan}
                        className={clsx(
                          'rounded-xl border p-5',
                          isCurrent ? 'border-brand-500 bg-brand-50/50' : 'border-slate-200 bg-white',
                        )}
                      >
                        <h3 className="text-base font-bold text-slate-900 capitalize mb-1">{plan}</h3>
                        <p className="text-2xl font-extrabold text-slate-900 mb-4">
                          {plan === 'free' ? '$0' : plan === 'pro' ? '$19' : '$49'}
                          <span className="text-sm font-normal text-slate-500">/mo</span>
                        </p>
                        <ul className="space-y-2 mb-5">
                          {PLAN_FEATURES[plan].map((feature) => (
                            <li key={feature} className="flex items-center gap-2 text-xs text-slate-600">
                              <Check size={12} className="text-green-500 shrink-0" />
                              {feature}
                            </li>
                          ))}
                        </ul>
                        {isCurrent ? (
                          <span className="block text-center text-xs font-semibold text-brand-600 bg-brand-100 px-3 py-2 rounded-lg">
                            Current Plan
                          </span>
                        ) : plan !== 'free' ? (
                          <Button
                            size="sm"
                            variant={plan === 'pro' ? 'primary' : 'outline'}
                            className="w-full"
                            onClick={() => handleUpgrade(plan as 'pro' | 'business')}
                          >
                            Upgrade to {plan}
                          </Button>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ─── Security Tab ──────────────────────────── */}
            {activeTab === 'security' && (
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <h2 className="text-lg font-bold text-slate-900 mb-6">Change Password</h2>

                <div className="space-y-4 max-w-md">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Current Password</label>
                    <input
                      type="password"
                      value={currentPassword}
                      onChange={(e) => setCurrentPassword(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
                    <input
                      type="password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                      placeholder="Min. 8 characters"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Confirm New Password</label>
                    <input
                      type="password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    />
                  </div>
                  <div className="pt-2">
                    <Button
                      onClick={handleChangePassword}
                      loading={saving}
                      disabled={!currentPassword || !newPassword || !confirmPassword}
                    >
                      Change Password
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
