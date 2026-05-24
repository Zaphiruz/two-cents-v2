import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/toaster';

const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(),
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: requestMock,
  };
});

import HouseholdPage from './HouseholdPage';

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderPage() {
  const client = makeClient();
  return render(
    <QueryClientProvider client={client}>
      <HouseholdPage />
      <Toaster />
    </QueryClientProvider>,
  );
}

const populated = {
  household: {
    id: 1,
    name: 'The Burrow',
    appealQuotaCount: 3,
    appealQuotaPeriod: 'month',
    members: [
      {
        id: 10,
        approvalMode: 'any',
        joinedAt: new Date(Date.now() - 86_400_000 * 7).toISOString(),
        user: { id: 100, name: 'Alice' },
      },
      {
        id: 11,
        approvalMode: 'all',
        joinedAt: new Date(Date.now() - 86_400_000 * 2).toISOString(),
        user: { id: 101, name: 'Bob' },
      },
    ],
  },
  myApprovers: [
    {
      id: 11,
      approvalMode: 'all',
      joinedAt: new Date(Date.now() - 86_400_000 * 2).toISOString(),
      user: { id: 101, name: 'Bob' },
    },
  ],
  myBuyers: [
    {
      id: 10,
      approvalMode: 'any',
      joinedAt: new Date(Date.now() - 86_400_000 * 7).toISOString(),
      user: { id: 100, name: 'Alice' },
    },
  ],
};

describe('HouseholdPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('renders the no-household empty state', async () => {
    requestMock.mockResolvedValueOnce({ household: null });
    renderPage();

    expect(
      await screen.findByText(/not part of a household yet/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText(/authentik username/i),
    ).not.toBeInTheDocument();
  });

  it('renders household name, members, approvers, and buyers', async () => {
    requestMock.mockResolvedValueOnce(populated);
    renderPage();

    expect(
      await screen.findByRole('heading', { name: /the burrow/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/3 per month/i)).toBeInTheDocument();
    // Members appear in the overview list
    expect(screen.getAllByText(/alice/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/bob/i).length).toBeGreaterThan(0);

    // My approvers card contains Bob (and not Alice)
    const approversTitle = screen.getByText(/my approvers/i);
    const approversCard = approversTitle.closest('[data-slot="card"], .rounded-xl, div');
    // Walk up to find a container containing the member list
    let approversRoot: HTMLElement | null = approversTitle.parentElement;
    while (approversRoot && !approversRoot.textContent?.match(/bob/i)) {
      approversRoot = approversRoot.parentElement;
    }
    expect(approversRoot?.textContent ?? approversCard?.textContent ?? '').toMatch(/bob/i);

    const buyersTitle = screen.getByText(/my buyers/i);
    let buyersRoot: HTMLElement | null = buyersTitle.parentElement;
    while (buyersRoot && !buyersRoot.textContent?.match(/alice/i)) {
      buyersRoot = buyersRoot.parentElement;
    }
    expect(buyersRoot?.textContent ?? '').toMatch(/alice/i);
  });

  it('submits the invite, calls POST /api/household/invite, and clears the input', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValueOnce(populated); // initial GET
    requestMock.mockResolvedValueOnce({ pending: { id: 42 } }); // POST
    requestMock.mockResolvedValueOnce(populated); // refetch after invalidate

    renderPage();

    const input = (await screen.findByLabelText(
      /authentik username/i,
    )) as HTMLInputElement;
    await user.type(input, 'charlie');
    await user.click(screen.getByRole('button', { name: /^invite$/i }));

    await vi.waitFor(() => {
      const postCall = requestMock.mock.calls.find(
        (c) => c[0] === '/api/household/invite',
      );
      expect(postCall).toBeDefined();
      expect(postCall![1]).toMatchObject({
        method: 'POST',
        body: { authentikUsername: 'charlie' },
      });
    });

    await vi.waitFor(() => {
      expect(input.value).toBe('');
    });
  });

  it('shows a destructive toast on 409 from invite', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/lib/api');
    requestMock.mockResolvedValueOnce(populated); // initial GET
    requestMock.mockRejectedValueOnce(
      new ApiError(409, 'Conflict', { error: 'duplicate' }),
    );

    renderPage();

    const input = await screen.findByLabelText(/authentik username/i);
    await user.type(input, 'charlie');
    await user.click(screen.getByRole('button', { name: /^invite$/i }));

    await vi.waitFor(() => {
      expect(
        screen.getByText(/already has a pending invite/i),
      ).toBeInTheDocument();
    });
  });
});
