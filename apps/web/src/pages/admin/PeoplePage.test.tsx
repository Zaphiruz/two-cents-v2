import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PeoplePage from './PeoplePage';

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
        <PeoplePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => requestMock.mockReset());

describe('PeoplePage', () => {
  it('renders fetched users in a table', async () => {
    requestMock.mockResolvedValueOnce({
      users: [
        { id: 1, name: 'Alice', isAdmin: false, householdName: 'Casa', createdAt: '2026-01-01' },
        { id: 2, name: 'Bob', isAdmin: true, householdName: null, createdAt: '2026-01-02' },
      ],
      nextCursor: null,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    expect(screen.getByText('Bob')).toBeInTheDocument();
    expect(screen.getByText('Casa')).toBeInTheDocument();
  });

  it('opens detail drawer with second fetch when a row is clicked', async () => {
    requestMock
      .mockResolvedValueOnce({
        users: [{ id: 1, name: 'Alice', isAdmin: false, householdName: null, createdAt: '2026-01-01' }],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        user: { id: 1, name: 'Alice', oidcSubject: 'a', isAdmin: false, createdAt: '2026-01-01' },
        household: null,
        requests: [],
        comments: [],
        pushSubscriptions: [],
        notificationLogs: [],
      });
    renderPage();
    await waitFor(() => expect(screen.getByText('Alice')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Alice'));
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/api/admin/users/1/detail');
    });
  });

  it('filters by name via the search input', async () => {
    requestMock.mockResolvedValue({ users: [], nextCursor: null });
    renderPage();
    const input = screen.getByPlaceholderText(/search/i);
    fireEvent.change(input, { target: { value: 'gladis' } });
    await waitFor(() => {
      expect(requestMock).toHaveBeenLastCalledWith(
        expect.stringContaining('q=gladis'),
      );
    });
  });
});
