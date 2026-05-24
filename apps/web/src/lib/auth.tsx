import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, request } from './api';

export interface AuthUser {
  id: number;
  name: string;
  isAdmin: boolean;
}

export function loginRedirect(): void {
  window.location.href = '/api/auth/login';
}

export async function logout(): Promise<void> {
  try {
    await request('/api/auth/logout', { method: 'POST' });
  } catch {
    // Even if logout fails (network etc.), we still bounce home.
  }
  window.location.href = '/';
}

async function fetchMe(): Promise<AuthUser | null> {
  try {
    return await request<AuthUser>('/api/auth/me');
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      return null;
    }
    throw err;
  }
}

export interface AuthState {
  user: AuthUser | null;
  isLoading: boolean;
  error: Error | null;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const query = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: fetchMe,
    staleTime: 60_000,
    retry: false,
  });

  const value: AuthState = {
    user: query.data ?? null,
    isLoading: query.isLoading,
    error: (query.error as Error | null) ?? null,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useUser(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useUser must be used within an AuthProvider');
  }
  return ctx;
}

export function useAuthInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['auth', 'me'] });
}

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useUser();

  useEffect(() => {
    if (!isLoading && !user) {
      loginRedirect();
    }
  }, [isLoading, user]);

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (!user) {
    return <div className="p-6 text-sm text-muted-foreground">Redirecting to sign in…</div>;
  }

  return <>{children}</>;
}
