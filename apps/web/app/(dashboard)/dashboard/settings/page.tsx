// ============================================================
// SimpleBuild Pro — Settings Page
// Profile, Billing, Plan management
// ============================================================

'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useAuthStore } from '@/lib/store';
import { authApi, billingApi, clearTokens, setTokens } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import {
  User,
  CreditCard,
  Shield,
  ArrowLeft,
  Check,
  ExternalLink,
  Loader2,
  Smartphone,
  Copy,
  ShieldCheck,
  ShieldOff,
  KeyRound,
  AlertTriangle,
  Plug2,
} from 'lucide-react';
import clsx from 'clsx';

type Tab = 'profile' | 'billing' | 'security' | 'integrations';

const PLAN_FEATURES: Record<string, string[]> = {
  free: ['3 projects', '50 AI messages/mo', '100 MB storage', '10 deploys/mo'],
  pro: [
    '25 projects',
    '500 AI messages/mo',
    '5 GB storage',
    'Unlimited deploys',
    '3 custom domains',
    'Priority support',
  ],
  business: [
    'Unlimited projects',
    '2,000 AI messages/mo',
    '25 GB storage',
    'Unlimited deploys',
    '10 custom domains',
    'Team collaboration',
  ],
  enterprise: [
    'Unlimited everything',
    'Custom AI limits',
    '500 GB storage',
    'Dedicated support',
    'SSO / SAML',
    'SLA guarantee',
  ],
};

function SettingsContent() {
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
      billingApi
        .getSubscription()
        .then((data) => setSubscription(data))
        .catch(() => {})
        .finally(() => setBillingLoading(false));
    }
  }, [activeTab]);

  const handleUpdateProfile = async () => {
    setSaving(true);
    try {
      const updated = await authApi.updateProfile({
        name: name.trim(),
        avatarUrl: avatarUrl.trim() || null,
      });
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
    try {
      await authApi.logout();
    } catch {
      /* ignore */
    }
    clearTokens();
    storeLogout();
    router.push('/login');
  };

  const tabs = [
    { id: 'profile' as Tab, label: 'Profile', icon: User },
    { id: 'billing' as Tab, label: 'Billing', icon: CreditCard },
    { id: 'security' as Tab, label: 'Security', icon: Shield },
    { id: 'integrations' as Tab, label: 'Integrations', icon: Plug2 },
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
            {/* Profile Tab */}
            {activeTab === 'profile' && (
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <h2 className="text-lg font-bold text-slate-900 mb-6">Profile</h2>

                <div className="space-y-5">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Full Name
                    </label>
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
                    <label className="block text-sm font-medium text-slate-700 mb-1">
                      Avatar URL (optional)
                    </label>
                    <input
                      type="url"
                      value={avatarUrl}
                      onChange={(e) => setAvatarUrl(e.target.value)}
                      placeholder="https://example.com/avatar.jpg"
                      className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                    />
                  </div>

                  <div className="pt-2 flex justify-between items-center">
                    <Button onClick={handleUpdateProfile} loading={saving}>
                      Save Changes
                    </Button>
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

            {/* Billing Tab */}
            {activeTab === 'billing' && (
              <div className="space-y-6">
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
                            Renews{' '}
                            {new Date(
                              subscription.subscription.currentPeriodEnd,
                            ).toLocaleDateString()}
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

                <div className="grid md:grid-cols-3 gap-4">
                  {(['free', 'pro', 'business'] as const).map((plan) => {
                    const isCurrent = (user?.plan || 'free') === plan;
                    return (
                      <div
                        key={plan}
                        className={clsx(
                          'rounded-xl border p-5',
                          isCurrent
                            ? 'border-brand-500 bg-brand-50/50'
                            : 'border-slate-200 bg-white',
                        )}
                      >
                        <h3 className="text-base font-bold text-slate-900 capitalize mb-1">
                          {plan}
                        </h3>
                        <p className="text-2xl font-extrabold text-slate-900 mb-4">
                          {plan === 'free' ? '$0' : plan === 'pro' ? '$19' : '$49'}
                          <span className="text-sm font-normal text-slate-500">/mo</span>
                        </p>
                        <ul className="space-y-2 mb-5">
                          {PLAN_FEATURES[plan].map((feature) => (
                            <li
                              key={feature}
                              className="flex items-center gap-2 text-xs text-slate-600"
                            >
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

            {/* Integrations Tab */}
            {activeTab === 'integrations' && (
              <div className="bg-white rounded-xl border border-slate-200 p-6">
                <h2 className="text-lg font-bold text-slate-900 mb-2">Integrations</h2>
                <p className="text-sm text-slate-500 mb-5">
                  Connect GitHub, Cloudflare, Vercel, Netlify, and Supabase to deploy and manage
                  your projects.
                </p>
                <Button
                  onClick={() => router.push('/dashboard/settings/integrations')}
                  icon={<Plug2 size={14} />}
                >
                  Manage Integrations
                </Button>
              </div>
            )}

            {/* Security Tab */}
            {activeTab === 'security' && (
              <div className="space-y-6">
                <div className="bg-white rounded-xl border border-slate-200 p-6">
                  <h2 className="text-lg font-bold text-slate-900 mb-6">Change Password</h2>

                  <div className="space-y-4 max-w-md">
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Current Password
                      </label>
                      <input
                        type="password"
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        New Password
                      </label>
                      <input
                        type="password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
                        placeholder="Min. 8 characters"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-700 mb-1">
                        Confirm New Password
                      </label>
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

                <MfaSection />
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="animate-pulse text-slate-400">Loading settings...</div>
        </div>
      }
    >
      <SettingsContent />
    </Suspense>
  );
}

// ─── MFA / Two-Factor Authentication Section ─────────────────
const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

function MfaSection() {
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaLoading, setMfaLoading] = useState(true);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [recoveryCodesRemaining, setRecoveryCodesRemaining] = useState(0);

  // Setup flow
  const [setupStep, setSetupStep] = useState<'idle' | 'qr' | 'verify' | 'done'>('idle');
  const [secret, setSecret] = useState('');
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyError, setVerifyError] = useState('');
  const [verifying, setVerifying] = useState(false);

  // Disable flow
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disabling, setDisabling] = useState(false);

  // Fetch MFA status
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/v1/mfa/status`, {
          headers: { Authorization: `Bearer ${localStorage.getItem('sbp_access_token')}` },
        });
        if (res.ok) {
          const data = await res.json();
          setMfaEnabled(data.data.enabled);
          setRecoveryCodesRemaining(data.data.recoveryCodesRemaining || 0);
        }
      } catch {
        /* ignore */
      } finally {
        setMfaLoading(false);
      }
    };
    fetchStatus();
  }, []);

  const handleStartSetup = async () => {
    setSetupStep('qr');
    try {
      const res = await fetch(`${API_BASE}/api/v1/mfa/setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('sbp_access_token')}`,
        },
      });
      const data = await res.json();
      if (res.ok) {
        setSecret(data.data.secret);
        setQrCodeUrl(data.data.qrCodeUrl);
      } else {
        toast('error', 'MFA setup failed', data.error?.message);
        setSetupStep('idle');
      }
    } catch (err: any) {
      toast('error', 'MFA setup failed', err.message);
      setSetupStep('idle');
    }
  };

  const handleVerifySetup = async () => {
    if (verifyCode.length !== 6 || !/^\d{6}$/.test(verifyCode)) {
      setVerifyError('Enter a valid 6-digit code.');
      return;
    }
    setVerifying(true);
    setVerifyError('');
    try {
      const res = await fetch(`${API_BASE}/api/v1/mfa/verify-setup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('sbp_access_token')}`,
        },
        body: JSON.stringify({ token: verifyCode }),
      });
      const data = await res.json();
      if (res.ok) {
        setMfaEnabled(true);
        setRecoveryCodes(data.data.recoveryCodes || []);
        setRecoveryCodesRemaining(data.data.recoveryCodes?.length || 0);
        setSetupStep('done');
        toast('success', 'MFA enabled', 'Save your recovery codes!');
      } else {
        setVerifyError(data.error?.message || 'Invalid code.');
      }
    } catch (err: any) {
      setVerifyError(err.message);
    } finally {
      setVerifying(false);
    }
  };

  const handleDisableMfa = async () => {
    setDisabling(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/mfa/disable`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('sbp_access_token')}`,
        },
        body: JSON.stringify({ password: disablePassword }),
      });
      const data = await res.json();
      if (res.ok) {
        setMfaEnabled(false);
        setDisableOpen(false);
        setDisablePassword('');
        setSetupStep('idle');
        setRecoveryCodes([]);
        toast('success', 'MFA disabled');
      } else {
        toast('error', 'Failed to disable MFA', data.error?.message);
      }
    } catch (err: any) {
      toast('error', 'Failed to disable MFA', err.message);
    } finally {
      setDisabling(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast('success', 'Copied to clipboard');
  };

  if (mfaLoading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6">
        <div className="flex items-center gap-2 text-slate-500">
          <Loader2 size={16} className="animate-spin" />
          <span className="text-sm">Loading security settings...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div
            className={clsx(
              'p-2 rounded-lg',
              mfaEnabled ? 'bg-green-50 text-green-600' : 'bg-slate-100 text-slate-500',
            )}
          >
            <Smartphone size={18} />
          </div>
          <div>
            <h2 className="text-lg font-bold text-slate-900">Two-Factor Authentication</h2>
            <p className="text-sm text-slate-500">
              {mfaEnabled
                ? 'Your account is protected with TOTP-based 2FA.'
                : 'Add an extra layer of security to your account.'}
            </p>
          </div>
        </div>
        <span
          className={clsx(
            'text-xs font-semibold px-2.5 py-1 rounded-full',
            mfaEnabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600',
          )}
        >
          {mfaEnabled ? 'Enabled' : 'Disabled'}
        </span>
      </div>

      {mfaEnabled && setupStep !== 'done' && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 p-3 bg-green-50 border border-green-200 rounded-lg">
            <ShieldCheck size={16} className="text-green-600 shrink-0" />
            <p className="text-sm text-green-700">
              Two-factor authentication is active.{' '}
              {recoveryCodesRemaining > 0 && (
                <span className="font-medium">
                  {recoveryCodesRemaining} recovery codes remaining.
                </span>
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setDisableOpen(true)}
            icon={<ShieldOff size={14} />}
            className="text-red-600 border-red-200 hover:bg-red-50"
          >
            Disable 2FA
          </Button>

          {disableOpen && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg space-y-3">
              <div className="flex items-start gap-2">
                <AlertTriangle size={16} className="text-red-500 mt-0.5 shrink-0" />
                <p className="text-sm text-red-700">
                  Disabling 2FA will remove the extra security layer. Enter your password to
                  confirm.
                </p>
              </div>
              <input
                type="password"
                value={disablePassword}
                onChange={(e) => setDisablePassword(e.target.value)}
                placeholder="Enter your password"
                className="w-full px-3 py-2 border border-red-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-400"
              />
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="danger"
                  onClick={handleDisableMfa}
                  loading={disabling}
                  disabled={!disablePassword}
                >
                  Confirm Disable
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setDisableOpen(false);
                    setDisablePassword('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {!mfaEnabled && setupStep === 'idle' && (
        <div className="space-y-4">
          <div className="p-4 bg-slate-50 rounded-lg">
            <h3 className="text-sm font-semibold text-slate-800 mb-2">How it works</h3>
            <ol className="text-xs text-slate-600 space-y-1.5 list-decimal list-inside">
              <li>Install an authenticator app (Google Authenticator, Authy, 1Password).</li>
              <li>Scan the QR code or enter the secret key manually.</li>
              <li>Enter the 6-digit code from your app to verify.</li>
              <li>Save your recovery codes in a safe place.</li>
            </ol>
          </div>
          <Button onClick={handleStartSetup} icon={<KeyRound size={14} />}>
            Set Up Two-Factor Authentication
          </Button>
        </div>
      )}

      {setupStep === 'qr' && (
        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-slate-800 mb-3">
              Step 1: Scan the QR code with your authenticator app
            </h3>
            <div className="flex items-start gap-6">
              {qrCodeUrl ? (
                <img
                  src={qrCodeUrl}
                  alt="MFA QR Code"
                  className="w-48 h-48 rounded-lg border border-slate-200"
                />
              ) : (
                <div className="w-48 h-48 rounded-lg border border-slate-200 bg-slate-50 flex items-center justify-center">
                  <Loader2 size={24} className="animate-spin text-slate-400" />
                </div>
              )}
              <div className="flex-1 space-y-3">
                <p className="text-xs text-slate-500">
                  Can&apos;t scan? Enter this secret key manually:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-slate-100 rounded-lg text-sm font-mono text-slate-800 break-all select-all">
                    {secret}
                  </code>
                  <button
                    onClick={() => copyToClipboard(secret)}
                    className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                    title="Copy secret"
                  >
                    <Copy size={14} />
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="max-w-xs">
            <h3 className="text-sm font-semibold text-slate-800 mb-2">
              Step 2: Enter the 6-digit code
            </h3>
            <input
              type="text"
              value={verifyCode}
              onChange={(e) => {
                const val = e.target.value.replace(/\D/g, '').slice(0, 6);
                setVerifyCode(val);
                setVerifyError('');
              }}
              placeholder="000000"
              maxLength={6}
              className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm font-mono text-center text-lg tracking-[0.3em] focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleVerifySetup()}
            />
            {verifyError && <p className="text-xs text-red-600 mt-1">{verifyError}</p>}
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleVerifySetup}
              loading={verifying}
              disabled={verifyCode.length !== 6}
            >
              Verify & Enable
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                setSetupStep('idle');
                setVerifyCode('');
                setVerifyError('');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {setupStep === 'done' && recoveryCodes.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <AlertTriangle size={16} className="text-amber-600 mt-0.5 shrink-0" />
            <div className="text-sm text-amber-700">
              <p className="font-semibold">Save your recovery codes!</p>
              <p className="text-xs mt-1">
                If you lose access to your authenticator app, use these codes to log in. Each code
                can only be used once. Store them in a secure location.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 p-4 bg-slate-50 border border-slate-200 rounded-lg">
            {recoveryCodes.map((code, i) => (
              <div
                key={i}
                className="font-mono text-sm text-slate-800 bg-white px-3 py-1.5 rounded border border-slate-200 text-center"
              >
                {code}
              </div>
            ))}
          </div>

          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              icon={<Copy size={13} />}
              onClick={() => copyToClipboard(recoveryCodes.join('\n'))}
            >
              Copy All Codes
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setSetupStep('idle');
                setRecoveryCodes([]);
              }}
            >
              I&apos;ve Saved My Codes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
