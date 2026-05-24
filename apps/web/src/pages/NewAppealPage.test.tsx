import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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

import NewAppealPage from './NewAppealPage';

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

function LocationSpy({ onLocation }: { onLocation: (path: string) => void }) {
  const loc = useLocation();
  onLocation(loc.pathname);
  return null;
}

function renderPage(
  requestId = 42,
  onLocation: (p: string) => void = () => {},
) {
  return render(
    <QueryClientProvider client={makeClient()}>
      <MemoryRouter initialEntries={[`/appeals/new/${requestId}`]}>
        <Routes>
          <Route path="/appeals/new/:requestId" element={<NewAppealPage />} />
          <Route
            path="/requests/:id"
            element={<div data-testid="detail-page">detail</div>}
          />
        </Routes>
        <LocationSpy onLocation={onLocation} />
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>,
  );
}

describe('NewAppealPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('submits POST /api/appeals and navigates to /requests/:requestId', async () => {
    const user = userEvent.setup();
    // First: context fetch (GET /api/requests/42) -> resolve with a request body
    requestMock.mockResolvedValueOnce({
      request: {
        id: 42,
        title: 'Cordless drill',
        status: 'denied',
        reviews: [],
      },
    });
    // Second: POST /api/appeals
    requestMock.mockResolvedValueOnce({ id: 5 });

    const locations: string[] = [];
    renderPage(42, (p) => {
      locations.push(p);
    });

    const textarea = screen.getByLabelText(/justification/i);
    await user.type(textarea, 'I really need this for work.');

    await user.click(screen.getByRole('button', { name: /file appeal/i }));

    await vi.waitFor(() => {
      const postCall = requestMock.mock.calls.find(
        (c) => c[0] === '/api/appeals',
      );
      expect(postCall).toBeDefined();
      expect(postCall![1]).toEqual({
        method: 'POST',
        body: { requestId: 42, justification: 'I really need this for work.' },
      });
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId('detail-page')).toBeInTheDocument();
    });
    expect(locations.at(-1)).toBe('/requests/42');
  });

  it('shows quota toast on 422', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/lib/api');
    // context fetch resolves
    requestMock.mockResolvedValueOnce({
      request: {
        id: 42,
        title: 'Cordless drill',
        status: 'denied',
        reviews: [],
      },
    });
    // POST rejects 422
    requestMock.mockRejectedValueOnce(
      new ApiError(422, 'Quota exceeded', { error: 'quota_exceeded' }),
    );

    renderPage();

    await user.type(
      screen.getByLabelText(/justification/i),
      'Please reconsider',
    );
    await user.click(screen.getByRole('button', { name: /file appeal/i }));

    await vi.waitFor(() => {
      expect(
        screen.getByText(/used all your appeals/i),
      ).toBeInTheDocument();
    });
  });
});
