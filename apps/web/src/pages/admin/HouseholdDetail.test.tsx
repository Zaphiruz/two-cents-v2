import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import HouseholdDetail from './HouseholdDetail';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return { ...actual, request: requestMock };
});

function renderDrawer(householdId: number | null = 1) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <HouseholdDetail householdId={householdId} onClose={() => {}} />
    </QueryClientProvider>,
  );
}

beforeEach(() => requestMock.mockReset());

describe('HouseholdDetail', () => {
  it('shows household name, members, and approver matrix when loaded', async () => {
    requestMock.mockResolvedValue({
      household: { id: 1, name: 'Casa', appealQuotaCount: 3, appealQuotaPeriod: 'monthly' },
      members: [
        { id: 10, userId: 100, userName: 'Alice', approvalMode: 'any', joinedAt: '2026-01-01' },
        { id: 11, userId: 101, userName: 'Bob', approvalMode: 'all', joinedAt: '2026-01-02' },
      ],
      buyerApprovers: [{ id: 50, buyerId: 10, approverId: 11 }],
    });
    renderDrawer(1);
    await waitFor(() => expect(screen.getByDisplayValue('Casa')).toBeInTheDocument());
    expect(screen.getAllByText('Alice').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Bob').length).toBeGreaterThan(0);
    // Matrix toggle for buyerId=10/approverId=11 should be checked
    const checkbox = screen.getByLabelText('Alice→Bob');
    expect(checkbox).toBeChecked();
  });

  it('PATCHes the household when Save is clicked', async () => {
    requestMock
      .mockResolvedValueOnce({
        household: { id: 1, name: 'Casa', appealQuotaCount: 3, appealQuotaPeriod: 'monthly' },
        members: [],
        buyerApprovers: [],
      })
      .mockResolvedValueOnce({
        household: { id: 1, name: 'New Casa', appealQuotaCount: 5, appealQuotaPeriod: 'monthly' },
      });
    renderDrawer(1);
    const nameInput = await screen.findByDisplayValue('Casa');
    fireEvent.change(nameInput, { target: { value: 'New Casa' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => {
      const call = requestMock.mock.calls.find((c) => typeof c[0] === 'string' && c[0].includes('/api/admin/households/1') && c[1]?.method === 'PATCH');
      expect(call).toBeDefined();
      expect(call?.[1]?.body).toMatchObject({ name: 'New Casa' });
    });
  });
});
