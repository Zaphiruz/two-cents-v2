import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { Toaster } from '@/components/ui/toaster';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    request: requestMock,
  };
});

import NewFeedbackPage from './NewFeedbackPage';

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function LocationSpy({ onLocation }: { onLocation: (p: string) => void }) {
  const loc = useLocation();
  onLocation(loc.pathname);
  return null;
}

function renderPage(onLocation: (p: string) => void = () => {}) {
  const client = makeClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/feedback/new']}>
        <Routes>
          <Route path="/feedback/new" element={<NewFeedbackPage />} />
          <Route
            path="/feedback"
            element={<div data-testid="list-page">list</div>}
          />
        </Routes>
        <LocationSpy onLocation={onLocation} />
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>,
  );
}

describe('NewFeedbackPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('disables Submit when title or body is empty/whitespace', async () => {
    const user = userEvent.setup();
    renderPage();

    const submit = screen.getByRole('button', { name: /^submit$/i });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/^title$/i), 'A title');
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText(/^body$/i), 'Some body content');
    expect(submit).toBeEnabled();

    // whitespace-only body re-disables
    await user.clear(screen.getByLabelText(/^body$/i));
    await user.type(screen.getByLabelText(/^body$/i), '   ');
    expect(submit).toBeDisabled();
  });

  it('submits POST /api/feedback and navigates to /feedback on success', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValueOnce({ submission: { id: 7 } });

    const locations: string[] = [];
    renderPage((p) => {
      locations.push(p);
    });

    await user.type(screen.getByLabelText(/^title$/i), 'Bug report');
    await user.type(screen.getByLabelText(/^category$/i), 'bug');
    await user.type(screen.getByLabelText(/^body$/i), 'Something is broken.');

    await user.click(screen.getByRole('button', { name: /^submit$/i }));

    await vi.waitFor(() => {
      expect(requestMock).toHaveBeenCalledTimes(1);
    });

    const call = requestMock.mock.calls[0]!;
    expect(call[0]).toBe('/api/feedback');
    const options = call[1] as { method: string; body: Record<string, unknown> };
    expect(options.method).toBe('POST');
    expect(options.body).toEqual({
      title: 'Bug report',
      body: 'Something is broken.',
      category: 'bug',
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId('list-page')).toBeInTheDocument();
    });
    expect(locations.at(-1)).toBe('/feedback');
  });

  it('shows rate-limit toast on 429', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/lib/api');
    requestMock.mockRejectedValueOnce(
      new ApiError(429, 'rate_limited', {
        error: 'rate_limited',
        resetInSeconds: 42,
      }),
    );

    renderPage();

    await user.type(screen.getByLabelText(/^title$/i), 'X');
    await user.type(screen.getByLabelText(/^body$/i), 'Y');
    await user.click(screen.getByRole('button', { name: /^submit$/i }));

    await vi.waitFor(() => {
      expect(
        screen.getByText(/you can submit again in 42 seconds/i),
      ).toBeInTheDocument();
    });
  });
});
