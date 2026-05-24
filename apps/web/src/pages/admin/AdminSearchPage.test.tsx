import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminSearchPage from './AdminSearchPage';

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
        <AdminSearchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => requestMock.mockReset());

describe('AdminSearchPage', () => {
  it('does not fetch until the user submits a query', () => {
    renderPage();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('renders search hits across multiple types after submit', async () => {
    requestMock.mockResolvedValueOnce({
      results: [
        {
          type: 'request',
          id: 1,
          primary: 'New blender',
          userName: 'Gladis',
          householdName: 'Casa',
          timestamp: '2026-05-01T00:00:00.000Z',
          raw: { id: 1, title: 'New blender' },
        },
        {
          type: 'consumedJwtJti',
          id: 'jti-abc',
          primary: 'jti-abc',
          userName: null,
          householdName: null,
          timestamp: '2026-05-01T00:00:00.000Z',
          raw: { jti: 'jti-abc' },
        },
      ],
    });
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'blender' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(screen.getByText('New blender')).toBeInTheDocument());
    expect(screen.getByText('jti-abc')).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByText('request')).toBeInTheDocument();
    expect(within(table).getByText('consumedJwtJti')).toBeInTheDocument();
  });

  it('sends type filter when one is selected', async () => {
    requestMock.mockResolvedValue({ results: [] });
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'x' } });
    fireEvent.change(screen.getByLabelText(/type/i), { target: { value: 'comment' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => {
      const last = requestMock.mock.calls[requestMock.mock.calls.length - 1]?.[0];
      expect(last).toEqual(expect.stringContaining('q=x'));
      expect(last).toEqual(expect.stringContaining('type=comment'));
    });
  });

  it('opens a detail drawer with raw JSON when a hit is clicked', async () => {
    requestMock.mockResolvedValueOnce({
      results: [
        {
          type: 'comment',
          id: 99,
          primary: 'a comment',
          userName: 'Alice',
          householdName: 'Casa',
          timestamp: '2026-05-01T00:00:00.000Z',
          raw: { id: 99, body: 'a comment', authorId: 7 },
        },
      ],
    });
    renderPage();
    fireEvent.change(screen.getByPlaceholderText(/search/i), { target: { value: 'comment' } });
    fireEvent.submit(screen.getByRole('search'));
    await waitFor(() => expect(screen.getByText('a comment')).toBeInTheDocument());
    fireEvent.click(screen.getByText('a comment'));
    await waitFor(() => {
      // Drawer renders the raw JSON pretty-printed; look for a distinctive substring
      expect(screen.getByText(/"authorId": 7/)).toBeInTheDocument();
    });
  });
});
