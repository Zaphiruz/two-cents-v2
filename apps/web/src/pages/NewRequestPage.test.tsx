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

import NewRequestPage from './NewRequestPage';

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

function renderPage(onLocation: (p: string) => void = () => {}) {
  const client = makeClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/requests/new']}>
        <Routes>
          <Route path="/requests/new" element={<NewRequestPage />} />
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

describe('NewRequestPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('renders the form heading', () => {
    renderPage();
    expect(
      screen.getByRole('heading', { name: /new request/i }),
    ).toBeInTheDocument();
  });

  it('submits POST /api/requests and navigates to /requests/:id', async () => {
    const user = userEvent.setup();
    requestMock.mockResolvedValueOnce({ id: 99 });

    const locations: string[] = [];
    renderPage((p) => {
      locations.push(p);
    });

    await user.type(screen.getByLabelText(/^title$/i), 'Bundle A');
    await user.type(screen.getByLabelText(/^item title$/i), 'Widget');
    await user.type(
      screen.getByLabelText(/^url$/i),
      'https://example.com/widget',
    );
    const price = screen.getByLabelText(/^price$/i);
    await user.clear(price);
    await user.type(price, '9.99');

    await user.click(screen.getByRole('button', { name: /create request/i }));

    await vi.waitFor(() => {
      expect(requestMock).toHaveBeenCalledTimes(1);
    });

    const call = requestMock.mock.calls[0]!;
    const path = call[0] as string;
    const options = call[1] as { method: string; body: { items: { id?: number }[] } & Record<string, unknown> };
    expect(path).toBe('/api/requests');
    expect(options.method).toBe('POST');
    expect(options.body).toMatchObject({
      title: 'Bundle A',
      currency: 'USD',
      buyerSeriousness: 'really_want',
      items: [
        {
          title: 'Widget',
          url: 'https://example.com/widget',
          priceCents: 999,
        },
      ],
    });
    expect(options.body.items[0]!.id).toBeUndefined();

    await vi.waitFor(() => {
      expect(screen.getByTestId('detail-page')).toBeInTheDocument();
    });
    expect(locations.at(-1)).toBe('/requests/99');
  });

  it('shows a destructive toast on API error', async () => {
    const user = userEvent.setup();
    const { ApiError } = await import('@/lib/api');
    requestMock.mockRejectedValueOnce(
      new ApiError(400, 'Bad request', { message: 'title is required' }),
    );

    renderPage();

    await user.type(screen.getByLabelText(/^title$/i), 'X');
    await user.type(screen.getByLabelText(/^item title$/i), 'Y');
    await user.type(screen.getByLabelText(/^url$/i), 'https://example.com');

    await user.click(screen.getByRole('button', { name: /create request/i }));

    await vi.waitFor(() => {
      expect(screen.getByText(/title is required/i)).toBeInTheDocument();
    });
  });
});
