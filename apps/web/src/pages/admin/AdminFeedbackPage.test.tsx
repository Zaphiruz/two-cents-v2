import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminFeedbackPage from './AdminFeedbackPage';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, request: requestMock };
});

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminFeedbackPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => requestMock.mockReset());

describe('AdminFeedbackPage', () => {
  it('renders feedback rows with linked GH issue numbers', async () => {
    requestMock.mockResolvedValueOnce({
      submissions: [
        {
          id: 1,
          category: 'bug',
          githubIssueNumber: 42,
          githubIssueUrl: 'https://github.com/Zaphiruz/two-cents-v2/issues/42',
          createdAt: '2026-05-01T00:00:00.000Z',
          userId: 100,
          userName: 'Gladis',
        },
      ],
      nextCursor: null,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Gladis')).toBeInTheDocument());
    expect(screen.getByRole('cell', { name: 'bug' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /#42/i }) as HTMLAnchorElement;
    expect(link.href).toBe('https://github.com/Zaphiruz/two-cents-v2/issues/42');
    expect(link.target).toBe('_blank');
  });

  it('shows "—" instead of a link when githubIssueNumber is null', async () => {
    requestMock.mockResolvedValueOnce({
      submissions: [
        {
          id: 2,
          category: '',
          githubIssueNumber: null,
          githubIssueUrl: '',
          createdAt: '2026-05-01T00:00:00.000Z',
          userId: 101,
          userName: 'Anon',
        },
      ],
      nextCursor: null,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Anon')).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: /#/ })).toBeNull();
    expect(screen.getAllByRole('cell', { name: '—' }).length).toBeGreaterThan(0);
  });

  it('updates the request URL when category filter changes', async () => {
    requestMock.mockResolvedValue({ submissions: [], nextCursor: null });
    renderPage();
    // wait for initial fetch
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    const select = screen.getByLabelText(/category/i);
    fireEvent.change(select, { target: { value: 'bug' } });
    await waitFor(() => {
      const last = requestMock.mock.calls[requestMock.mock.calls.length - 1]?.[0];
      expect(last).toEqual(expect.stringContaining('category=bug'));
    });
  });
});
