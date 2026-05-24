import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import FeedbackPage from './FeedbackPage';
import { request } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  request: vi.fn(),
  ApiError: class ApiError extends Error {
    status: number;
    body: unknown;
    constructor(status: number, message: string, body: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  },
}));

const mockedRequest = vi.mocked(request);

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <FeedbackPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('FeedbackPage', () => {
  beforeEach(() => {
    mockedRequest.mockReset();
  });

  it('shows empty state with submit-feedback CTA', async () => {
    mockedRequest.mockResolvedValue({ submissions: [] });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText(/no feedback submitted yet/i)).toBeInTheDocument(),
    );
    expect(
      screen.getByRole('link', { name: /submit feedback/i }),
    ).toHaveAttribute('href', '/feedback/new');
  });

  it('renders rows with category and GitHub state', async () => {
    mockedRequest.mockResolvedValue({
      submissions: [
        {
          id: 1,
          githubIssueNumber: 42,
          githubIssueUrl: 'https://github.com/o/r/issues/42',
          category: 'bug',
          createdAt: new Date(Date.now() - 60_000).toISOString(),
          githubState: 'open',
          githubStateReason: null,
        },
        {
          id: 2,
          githubIssueNumber: 43,
          githubIssueUrl: 'https://github.com/o/r/issues/43',
          category: 'feature',
          createdAt: new Date(Date.now() - 3_600_000).toISOString(),
          githubState: 'closed',
          githubStateReason: 'completed',
        },
        {
          id: 3,
          githubIssueNumber: null,
          githubIssueUrl: '',
          category: 'question',
          createdAt: new Date(Date.now() - 7_200_000).toISOString(),
          githubState: null,
          githubStateReason: null,
        },
      ],
    });

    renderPage();

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: /^feedback$/i }),
      ).toBeInTheDocument(),
    );

    expect(screen.getByText('bug')).toBeInTheDocument();
    expect(screen.getByText('feature')).toBeInTheDocument();
    expect(screen.getByText('question')).toBeInTheDocument();

    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Not tracked')).toBeInTheDocument();

    const githubLinks = screen.getAllByRole('link', { name: /view on github/i });
    expect(githubLinks).toHaveLength(2);
    expect(githubLinks[0]).toHaveAttribute('target', '_blank');
    expect(githubLinks[0]).toHaveAttribute('rel', 'noopener noreferrer');

    expect(
      screen.getByRole('link', { name: /\+ new feedback/i }),
    ).toHaveAttribute('href', '/feedback/new');
  });
});
