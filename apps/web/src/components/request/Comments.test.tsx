import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Comments, type CommentItem } from './Comments';

vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    request: vi.fn(),
  };
});

import { request } from '@/lib/api';

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const sample: CommentItem[] = [
  {
    id: 1,
    body: 'First!',
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    author: { id: 10, name: 'Alice' },
  },
  {
    id: 2,
    body: 'Second comment\nwith newline',
    createdAt: new Date(Date.now() - 30_000).toISOString(),
    author: { id: 11, name: 'Bob' },
  },
];

describe('Comments', () => {
  beforeEach(() => {
    vi.mocked(request).mockReset();
  });

  it('renders existing comments with author name and body', () => {
    renderWithClient(<Comments requestId={42} comments={sample} />);
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('First!')).toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText(/Second comment/)).toBeInTheDocument();
  });

  it('shows empty state when no comments', () => {
    renderWithClient(<Comments requestId={42} comments={[]} />);
    expect(screen.getByText('No comments yet.')).toBeInTheDocument();
  });

  it('submits the form and calls request with right path/body', async () => {
    const user = userEvent.setup();
    vi.mocked(request).mockResolvedValue({
      id: 99,
      body: 'Hello world',
      createdAt: new Date().toISOString(),
      author: { id: 1, name: 'Me' },
    } satisfies CommentItem);

    renderWithClient(<Comments requestId={42} comments={[]} />);

    const textarea = screen.getByLabelText(/add a comment/i);
    await user.type(textarea, 'Hello world');
    await user.click(screen.getByRole('button', { name: /post comment/i }));

    await waitFor(() => {
      expect(request).toHaveBeenCalledWith('/api/requests/42/comments', {
        method: 'POST',
        body: { body: 'Hello world' },
      });
    });

    await waitFor(() => {
      expect((textarea as HTMLTextAreaElement).value).toBe('');
    });
  });
});
