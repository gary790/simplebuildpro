// ============================================================
// SimpleBuild Pro — OAuth Callback Page
// Handles redirect from OAuth providers (Google, GitHub)
// Extracts tokens from URL params and stores them
// ============================================================

'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { setTokens, authApi } from '@/lib/api-client';
import { useAuthStore } from '@/lib/store';

function CallbackHandler() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const setUser = useAuthStore((s) => s.setUser);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const accessToken = searchParams.get('access_token');
    const refreshToken = searchParams.get('refresh_token');
    const errorParam = searchParams.get('error');

    if (errorParam) {
      const errorMessages: Record<string, string> = {
        oauth_denied: 'You denied access. Please try again.',
        oauth_token_failed: 'Failed to authenticate with the provider.',
        oauth_no_email: 'Could not retrieve your email address.',
        oauth_failed: 'Authentication failed. Please try again.',
      };
      setError(errorMessages[errorParam] || 'Authentication failed.');
      setTimeout(() => router.push('/login'), 3000);
      return;
    }

    if (!accessToken || !refreshToken) {
      setError('Missing authentication tokens.');
      setTimeout(() => router.push('/login'), 3000);
      return;
    }

    // Store tokens
    setTokens({
      accessToken,
      refreshToken,
      expiresIn: 900,
    });

    // Fetch user profile
    authApi.getMe()
      .then((user) => {
        setUser(user as any);
        router.push('/dashboard');
      })
      .catch((err) => {
        setError('Failed to load your profile. Please try logging in again.');
        setTimeout(() => router.push('/login'), 3000);
      });
  }, [searchParams, router, setUser]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="text-center">
        {error ? (
          <div className="space-y-3">
            <div className="w-12 h-12 mx-auto rounded-full bg-red-100 flex items-center justify-center">
              <svg className="w-6 h-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="text-sm text-red-600 font-medium">{error}</p>
            <p className="text-xs text-slate-500">Redirecting to login...</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="w-8 h-8 mx-auto border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-slate-600">Completing sign in...</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function OAuthCallbackPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 mx-auto border-2 border-brand-600 border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <CallbackHandler />
    </Suspense>
  );
}
