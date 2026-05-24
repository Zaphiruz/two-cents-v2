import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { ApiError } from '@/lib/api';
import { Toaster } from '@/components/ui/toaster';

// Hoisted mock for @/lib/api so the component picks up our spy.
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

import { ApproverAction } from './ApproverAction';

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function renderWithProviders(node: ReactNode) {
  const client = makeClient();
  return render(
    <QueryClientProvider client={client}>
      {node}
      <Toaster />
    </QueryClientProvider>,
  );
}

describe('ApproverAction', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('renders the three action buttons and form fields', () => {
    renderWithProviders(<ApproverAction requestId={42} />);
    expect(screen.getByRole('button', { name: /approve/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /delay/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /deny/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/your seriousness/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/delay override/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/notes/i)).toBeInTheDocument();
  });

  it('submits Approve with default seriousness and posts to the act endpoint', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValueOnce({
      id: 42,
      status: 'approved',
      statusExpiresAt: null,
    });

    renderWithProviders(<ApproverAction requestId={42} />);

    await user.click(screen.getByRole('button', { name: /approve/i }));

    await waitFor(() => {
      expect(requestMock).toHaveBeenCalledTimes(1);
    });

    expect(requestMock).toHaveBeenCalledWith('/api/requests/42/act', {
      method: 'POST',
      body: {
        action: 'approve',
        approverSeriousness: 'really_want',
        notes: '',
      },
    });
  });

  it('shows a destructive toast on 409 IllegalTransition', async () => {
    const user = userEvent.setup();
    requestMock.mockRejectedValueOnce(
      new ApiError(409, 'IllegalTransition', { error: 'IllegalTransition' }),
    );

    renderWithProviders(<ApproverAction requestId={7} />);

    await user.click(screen.getByRole('button', { name: /deny/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/this request can no longer be acted on\./i),
      ).toBeInTheDocument();
    });
  });

  it('enables delay override input and shows duration preview when typed', async () => {
    const user = userEvent.setup();
    renderWithProviders(<ApproverAction requestId={1} />);

    const delayInput = screen.getByLabelText(/delay override/i) as HTMLInputElement;
    // Initially disabled because action defaults to 'approve'.
    expect(delayInput).toBeDisabled();

    // Clicking Delay sets the pending action so the input becomes enabled
    // in the next render cycle — but the click also fires the mutation.
    // To test the preview without firing, we mock the request to a pending promise.
    let resolveFn: ((v: unknown) => void) | undefined;
    requestMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFn = resolve;
        }),
    );

    // Type a value first — input still disabled but watchedAction not 'delay' yet.
    // Click delay button: this enables the input via pendingAction state.
    await user.click(screen.getByRole('button', { name: /delay/i }));

    await waitFor(() => {
      expect(delayInput).not.toBeDisabled();
    });

    await user.type(delayInput, '5');

    expect(
      screen.getByText(/delays this request for 5 days\./i),
    ).toBeInTheDocument();

    // Cleanup: resolve the pending mutation
    resolveFn?.({ id: 1, status: 'delayed', statusExpiresAt: null });
  });
});
