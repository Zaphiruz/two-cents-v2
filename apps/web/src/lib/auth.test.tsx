import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useUser } from './auth';

function Probe() {
  const { user, isLoading } = useUser();
  if (isLoading) return <div>loading</div>;
  if (!user) return <div>anon</div>;
  return <div>user:{user.name}:{user.isAdmin ? 'admin' : 'plain'}</div>;
}

function renderWithProviders() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('AuthProvider / useUser', () => {
  const fetchSpy = vi.spyOn(globalThis, 'fetch');

  beforeEach(() => {
    fetchSpy.mockReset();
  });

  afterEach(() => {
    fetchSpy.mockReset();
  });

  it('returns the user when /api/auth/me succeeds', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ id: 1, name: 'Alice', isAdmin: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderWithProviders();

    await waitFor(() =>
      expect(screen.getByText('user:Alice:admin')).toBeInTheDocument(),
    );

    expect(fetchSpy).toHaveBeenCalledWith(
      '/api/auth/me',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('exposes null user on 401 without throwing', async () => {
    fetchSpy.mockResolvedValue(
      new Response(JSON.stringify({ error: 'not_authenticated' }), {
        status: 401,
        headers: { 'content-type': 'application/json' },
      }),
    );

    renderWithProviders();

    await waitFor(() => expect(screen.getByText('anon')).toBeInTheDocument());
  });
});
