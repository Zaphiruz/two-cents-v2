import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminAppealsPage from './AdminAppealsPage';

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
        <AdminAppealsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => requestMock.mockReset());

describe('AdminAppealsPage', () => {
  it('renders cross-household appeals', async () => {
    requestMock.mockResolvedValueOnce({
      appeals: [
        {
          id: 5,
          status: 'pending',
          periodKey: '2026-05',
          requestId: 100,
          requestTitle: 'A buy',
          householdId: 1,
          householdName: 'Casa',
          buyerName: 'Alice',
          createdAt: '2026-05-01',
          resolvedAt: null,
        },
      ],
      nextCursor: null,
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('A buy')).toBeInTheDocument());
    expect(screen.getByText('Casa')).toBeInTheDocument();
    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });

  it('opens resolve dialog and submits decision', async () => {
    requestMock
      .mockResolvedValueOnce({
        appeals: [
          {
            id: 5, status: 'pending', periodKey: '2026-05',
            requestId: 100, requestTitle: 'A buy',
            householdId: 1, householdName: 'Casa', buyerName: 'Alice',
            createdAt: '2026-05-01', resolvedAt: null,
          },
        ],
        nextCursor: null,
      })
      .mockResolvedValueOnce({
        appeal: { id: 5, status: 'overturned' },
      });
    renderPage();
    await waitFor(() => expect(screen.getByText('A buy')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /resolve/i }));
    fireEvent.click(screen.getByRole('button', { name: /overturn/i }));
    await waitFor(() => {
      const call = requestMock.mock.calls.find(
        (c) => typeof c[0] === 'string' && c[0] === '/api/admin/appeals/5/resolve',
      );
      expect(call).toBeDefined();
      expect(call?.[1]?.body).toEqual({ decision: 'overturn' });
    });
  });
});
