import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HouseholdsPage from './HouseholdsPage';

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
        <HouseholdsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => requestMock.mockReset());

describe('HouseholdsPage', () => {
  it('lists households with member counts', async () => {
    requestMock.mockResolvedValueOnce({
      households: [
        {
          id: 1,
          name: 'Casa',
          appealQuotaCount: 3,
          appealQuotaPeriod: 'monthly',
          memberCount: 4,
          createdAt: '2026-01-01',
        },
      ],
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText(/3 \/ monthly/)).toBeInTheDocument();
  });

  it('opens drawer on row click', async () => {
    requestMock
      .mockResolvedValueOnce({
        households: [{
          id: 1, name: 'Casa', appealQuotaCount: 3, appealQuotaPeriod: 'monthly',
          memberCount: 1, createdAt: '2026-01-01',
        }],
      })
      .mockResolvedValueOnce({
        household: {
          id: 1, name: 'Casa', appealQuotaCount: 3, appealQuotaPeriod: 'monthly',
        },
        members: [],
        buyerApprovers: [],
      });
    renderPage();
    await waitFor(() => expect(screen.getByText('Casa')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Casa'));
    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledWith('/api/admin/households/1/detail');
    });
  });
});
