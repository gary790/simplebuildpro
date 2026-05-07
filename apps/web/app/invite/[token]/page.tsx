// ============================================================
// SimpleBuild Pro — Invitation Accept Page
// Handles organization invitation acceptance
// ============================================================

'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import { Building2, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export default function InvitePage() {
  const params = useParams();
  const router = useRouter();
  const token = params.token as string;
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  const [status, setStatus] = useState<'loading' | 'ready' | 'accepting' | 'accepted' | 'error'>('loading');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // If not authenticated, redirect to login with return URL
    if (!isAuthenticated) {
      router.push(`/login?redirect=/invite/${token}`);
      return;
    }
    setStatus('ready');
  }, [isAuthenticated, token, router]);

  const handleAccept = async () => {
    setStatus('accepting');
    try {
      const res = await fetch(`${API_BASE}/api/v1/organizations/invitations/${token}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || 'Failed to accept invitation.');
      }

      setStatus('accepted');
      toast('success', 'Invitation accepted!', 'You have joined the organization.');
      setTimeout(() => router.push('/dashboard'), 2000);
    } catch (err: any) {
      setError(err.message);
      setStatus('error');
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="text-2xl font-extrabold text-slate-900 tracking-tight">
            SimpleBuild<span className="text-brand-600">Pro</span>
          </Link>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          {status === 'loading' && (
            <div className="text-center py-8">
              <Loader2 className="mx-auto animate-spin text-brand-600 mb-3" size={32} />
              <p className="text-sm text-slate-500">Loading invitation...</p>
            </div>
          )}

          {status === 'ready' && (
            <div className="text-center space-y-4">
              <div className="w-14 h-14 mx-auto rounded-full bg-brand-50 flex items-center justify-center">
                <Building2 className="text-brand-600" size={28} />
              </div>
              <h2 className="text-lg font-bold text-slate-900">Organization Invitation</h2>
              <p className="text-sm text-slate-500">
                You&apos;ve been invited to join an organization on SimpleBuild Pro.
              </p>
              {user && (
                <p className="text-xs text-slate-400">
                  Signed in as <strong>{user.email}</strong>
                </p>
              )}
              <div className="pt-2">
                <Button onClick={handleAccept} className="w-full">
                  Accept Invitation
                </Button>
              </div>
              <p className="text-xs text-slate-400">
                <Link href="/dashboard" className="text-brand-600 hover:underline">
                  Skip and go to dashboard
                </Link>
              </p>
            </div>
          )}

          {status === 'accepting' && (
            <div className="text-center py-8">
              <Loader2 className="mx-auto animate-spin text-brand-600 mb-3" size={32} />
              <p className="text-sm text-slate-500">Accepting invitation...</p>
            </div>
          )}

          {status === 'accepted' && (
            <div className="text-center space-y-3 py-4">
              <CheckCircle className="mx-auto text-green-500" size={40} />
              <h2 className="text-lg font-bold text-slate-900">Welcome!</h2>
              <p className="text-sm text-slate-500">You&apos;ve successfully joined the organization.</p>
              <p className="text-xs text-slate-400">Redirecting to dashboard...</p>
            </div>
          )}

          {status === 'error' && (
            <div className="text-center space-y-3 py-4">
              <XCircle className="mx-auto text-red-500" size={40} />
              <h2 className="text-lg font-bold text-slate-900">Invitation Error</h2>
              <p className="text-sm text-red-600">{error}</p>
              <div className="pt-2">
                <Button variant="secondary" onClick={() => router.push('/dashboard')}>
                  Go to Dashboard
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
