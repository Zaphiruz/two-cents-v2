import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import RequestDetailPage from './RequestDetailPage';
import { ApiError, request } from '@/lib/api';
import { useUser, type AuthState } from '@/lib/auth';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    request: vi.fn(),
  };
});

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return {
    ...actual,
    useUser: vi.fn(),
  };
});

vi.mock('@/components/request/ApproverAction', () => ({
  ApproverAction: () => <div data-testid="approver-action" />,
  default: () => <div data-testid="approver-action" />,
}));

vi.mock('@/components/request/Comments', () => ({
  Comments: ({ comments }: { comments: Array<{ id: number; body: string }> }) => (
    <div data-testid="comments">
      {comments.map((c) => (
        <div key={c.id}>{c.body}</div>
      ))}
    </div>
  ),
  default: ({ comments }: { comments: Array<{ id: number; body: string }> }) => (
    <div data-testid="comments">
      {comments.map((c) => (
        <div key={c.id}>{c.body}</div>
      ))}
    </div>
  ),
}));

const mockedRequest = vi.mocked(request);
const mockedUseUser = vi.mocked(useUser);

function setUser(id: number, name = 'Tester') {
  const state: AuthState = {
    user: { id, name, isAdmin: false },
    isLoading: false,
    error: null,
  };
  mockedUseUser.mockReturnValue(state);
}

function renderAt(path: string) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/requests/:id" element={<RequestDetailPage />} />
          <Route path="/" element={<div>Queue Home</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function buildDetail(overrides: Partial<{
  status: string;
  buyerUserId: number;
  appealsRemaining: number;
  comments: Array<{ id: number; body: string; createdAt: string; author: { id: number; name: string } }>;
}> = {}) {
  return {
    appealsRemaining: overrides.appealsRemaining ?? 0,
    request: {
      id: 42,
      title: 'Cordless drill',
      description: 'Need it for the deck project.',
      status: overrides.status ?? 'pending',
      currency: 'USD',
      createdAt: new Date(Date.now() - 60_000).toISOString(),
      statusExpiresAt: null,
      items: [
        {
          id: 1,
          title: 'Drill',
          url: 'https://example.com/drill',
          priceCents: 12345,
          notes: null,
          position: 0,
        },
      ],
      reviews: [],
      comments: overrides.comments ?? [
        {
          id: 100,
          body: 'Looks good',
          createdAt: new Date(Date.now() - 30_000).toISOString(),
          author: { id: 9, name: 'Bob' },
        },
      ],
      buyer: {
        id: 7,
        householdId: 1,
        user: { id: overrides.buyerUserId ?? 99, name: 'Alice Buyer' },
      },
    },
  };
}

describe('RequestDetailPage', () => {
  beforeEach(() => {
    mockedRequest.mockReset();
    mockedUseUser.mockReset();
  });

  it('renders title, status badge, items, and comments for the buyer with Edit + Cancel', async () => {
    setUser(99, 'Alice Buyer');
    mockedRequest.mockResolvedValueOnce(buildDetail({ status: 'pending', buyerUserId: 99 }));

    renderAt('/requests/42');

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Cordless drill' })).toBeInTheDocument(),
    );
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByText('Drill')).toBeInTheDocument();
    expect(screen.getAllByText(/\$123\.45/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Total:/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByTestId('comments')).toBeInTheDocument();
    expect(screen.getByText('Looks good')).toBeInTheDocument();
    // Approver UI should NOT show (buyer is current user)
    expect(screen.queryByTestId('approver-action')).not.toBeInTheDocument();
  });

  it('shows ApproverAction for a non-buyer approver on a pending request', async () => {
    setUser(7, 'Carol Approver');
    mockedRequest.mockResolvedValueOnce(buildDetail({ status: 'pending', buyerUserId: 99 }));

    renderAt('/requests/42');

    await waitFor(() =>
      expect(screen.getByTestId('approver-action')).toBeInTheDocument(),
    );
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();
  });

  it('renders not-found state on 404', async () => {
    setUser(1);
    mockedRequest.mockRejectedValueOnce(new ApiError(404, 'not_found', { error: 'not_found' }));

    renderAt('/requests/42');

    await waitFor(() =>
      expect(screen.getByText('Request not found.')).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: /back to queue/i })).toHaveAttribute('href', '/');
  });
});
