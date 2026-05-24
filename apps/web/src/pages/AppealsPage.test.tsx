import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/toaster';

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: requestMock,
  };
});

import AppealsPage from './AppealsPage';

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage(client = makeClient()) {
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/appeals']}>
          <Routes>
            <Route path="/appeals" element={<AppealsPage />} />
            <Route
              path="/requests/:id"
              element={<div data-testid="detail-page">detail</div>}
            />
          </Routes>
        </MemoryRouter>
        <Toaster />
      </QueryClientProvider>,
    ),
  };
}

function buildAppeal(overrides: Partial<{ id: number; buyerName: string; requestId: number; requestTitle: string }> = {}) {
  return {
    id: overrides.id ?? 1,
    justification: 'Please reconsider!',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    buyer: {
      id: 10,
      user: { id: 100, name: overrides.buyerName ?? 'Alice Buyer' },
    },
    request: {
      id: overrides.requestId ?? 42,
      title: overrides.requestTitle ?? 'Cordless drill',
      description: 'For decking.',
      currency: 'USD',
      items: [{ id: 1, title: 'Drill', priceCents: 12345, position: 0 }],
    },
  };
}

describe('AppealsPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('renders pending appeals', async () => {
    requestMock.mockResolvedValueOnce({ appeals: [buildAppeal()] });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('Alice Buyer')).toBeInTheDocument();
    });
    expect(screen.getByRole('link', { name: 'Cordless drill' })).toHaveAttribute(
      'href',
      '/requests/42',
    );
    expect(screen.getByText(/please reconsider/i)).toBeInTheDocument();
  });

  it('renders the empty state', async () => {
    requestMock.mockResolvedValueOnce({ appeals: [] });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText('No pending appeals.')).toBeInTheDocument();
    });
  });

  it('clicking Overturn calls POST /api/appeals/:id/resolve and invalidates queue', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValueOnce({ appeals: [buildAppeal({ id: 7 })] });
    requestMock.mockResolvedValueOnce({ id: 7, status: 'overturned' });
    // Second queue fetch after invalidation
    requestMock.mockResolvedValueOnce({ appeals: [] });

    const { client } = renderPage();
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries');

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Overturn' })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: 'Overturn' }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/api/appeals/7/resolve', {
        method: 'POST',
        body: { decision: 'overturn' },
      });
    });

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ['appeals', 'queue'],
      });
    });
  });
});
