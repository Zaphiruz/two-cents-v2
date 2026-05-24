import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import QueuePage from './QueuePage';
import { request } from '@/lib/api';

vi.mock('@/lib/api', () => ({
  request: vi.fn(),
}));

const mockedRequest = vi.mocked(request);

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <QueuePage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('QueuePage', () => {
  beforeEach(() => {
    mockedRequest.mockReset();
  });

  it('shows loading state initially', () => {
    mockedRequest.mockReturnValue(new Promise(() => {}));
    renderPage();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('renders incoming + myActive rows with buyer name, status badge, and totals', async () => {
    mockedRequest.mockResolvedValue({
      incoming: [
        {
          id: 1,
          title: 'Cordless drill',
          description: '',
          buyerSeriousness: 'need',
          status: 'pending',
          currency: 'USD',
          createdAt: new Date(Date.now() - 60_000).toISOString(),
          items: [
            { id: 11, title: 'Drill', priceCents: 12345, position: 0 },
            { id: 12, title: 'Bits', priceCents: 5500, position: 1 },
          ],
          buyer: { id: 2, user: { id: 99, name: 'Alice Buyer' } },
        },
      ],
      myActive: [
        {
          id: 5,
          title: 'New tent',
          description: '',
          buyerSeriousness: 'really_want',
          status: 'approved',
          currency: 'USD',
          createdAt: new Date(Date.now() - 3_600_000).toISOString(),
          items: [{ id: 51, title: 'Tent', priceCents: 20000, position: 0 }],
        },
      ],
    });

    renderPage();

    await waitFor(() =>
      expect(screen.getByText('Requests')).toBeInTheDocument(),
    );

    // Incoming
    expect(screen.getByText('Cordless drill')).toBeInTheDocument();
    expect(screen.getByText(/Alice Buyer/)).toBeInTheDocument();
    expect(screen.getByText(/Review/)).toBeInTheDocument();
    // total $178.45
    expect(screen.getByText(/\$178\.45/)).toBeInTheDocument();

    // My active
    expect(screen.getByText('New tent')).toBeInTheDocument();
    // "Approved" appears as both the status group header and the badge label
    expect(screen.getAllByText('Approved').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/\$200\.00/)).toBeInTheDocument();
  });

  it('shows empty-both CTA when both lists are empty', async () => {
    mockedRequest.mockResolvedValue({ incoming: [], myActive: [] });
    renderPage();
    await waitFor(() =>
      expect(screen.getByText('No requests yet.')).toBeInTheDocument(),
    );
    expect(screen.getByRole('link', { name: /new request/i })).toHaveAttribute(
      'href',
      '/requests/new',
    );
  });
});
