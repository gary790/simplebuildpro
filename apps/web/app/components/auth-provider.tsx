// ============================================================
// SimpleBuild Pro — Auth Provider
// Handles session restoration on app load
// ============================================================

'use client';

import { useEffect, type ReactNode } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useAuthStore } from '@/lib/store';
import { authApi, setTokens, loadStoredRefreshToken } from '@/lib/api-client';

const PUBLIC_PATHS = ['/', '/login', '/signup', '/pricing'];

export function AuthProvider({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, setUser, setLoading } = useAuthStore();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    const restore = async () => {
      const stored = loadStoredRefreshToken();
      if (!stored) {
        setLoading(false);
        return;
      }

      try {
        // Try refreshing the access token
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080'}/api/v1/auth/refresh`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: stored }),
          },
        );

        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data?.tokens) {
            setTokens(json.data.tokens);
            // Fetch user profile
            const user = await authApi.getMe();
            setUser(user as any);
            return;
          }
        }
      } catch {
        // Silent fail — user will be redirected to login
      }

      setLoading(false);
    };

    restore();
  }, [setUser, setLoading]);

  // Redirect unauthenticated users away from protected pages
  useEffect(() => {
    if (isLoading) return;

    const isPublic = PUBLIC_PATHS.some(
      (p) => pathname === p || (p !== '/' && pathname.startsWith(p)),
    );

    if (!isAuthenticated && !isPublic) {
      router.replace('/login');
    }
  }, [isAuthenticated, isLoading, pathname, router]);

  // Show a minimal loader while checking auth
  if (isLoading && !PUBLIC_PATHS.includes(pathname)) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-8 w-8 text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="text-sm text-slate-500">Loading...</span>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
