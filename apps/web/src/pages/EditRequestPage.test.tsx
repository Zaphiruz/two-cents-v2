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

import EditRequestPage from './EditRequestPage';

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
  id = '42',
  onLocation: (p: string) => void = () => {},
) {
  const client = makeClient();
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[`/requests/${id}/edit`]}>
        <Routes>
          <Route path="/requests/:id/edit" element={<EditRequestPage />} />
          <Route
            path="/requests/:id"
            element={<div data-testid="detail-page">detail</div>}
          />
          <Route path="/queue" element={<div>queue</div>} />
        </Routes>
        <LocationSpy onLocation={onLocation} />
      </MemoryRouter>
      <Toaster />
    </QueryClientProvider>,
  );
}

function mockRequestResponse(overrides: Partial<{ items: unknown[] }> = {}) {
  return {
    request: {
      id: 42,
      title: 'Existing bundle',
      description: 'desc text',
      buyerSeriousness: 'really_want',
      currency: 'USD',
      items: overrides.items ?? [
        {
          id: 1,
          title: 'Existing item',
          url: 'https://example.com/a',
          priceCents: 1234,
          notes: 'note',
        },
        {
          id: 2,
          title: 'Second item',
          url: 'https://example.com/b',
          priceCents: 500,
          notes: '',
        },
      ],
    },
  };
}

describe('EditRequestPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('renders the form populated with existing values', async () => {
    requestMock.mockResolvedValueOnce(mockRequestResponse());

    renderPage();

    expect(
      await screen.findByRole('heading', { name: /edit request/i }),
    ).toBeInTheDocument();

    const title = await screen.findByLabelText(/^title$/i);
    expect(title).toHaveValue('Existing bundle');

    // Two items present
    expect(screen.getByTestId('item-row-0')).toBeInTheDocument();
    expect(screen.getByTestId('item-row-1')).toBeInTheDocument();
  });

  it('submits PATCH with bundleChanges + itemsPayload and navigates', async () => {
    const user = userEvent.setup();
    requestMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (!options || !options.method || options.method === 'GET') {
        return Promise.resolve(mockRequestResponse());
      }
      return Promise.resolve({ requestId: 42, wasMeaningful: false });
    });

    const locations: string[] = [];
    renderPage('42', (p) => {
      locations.push(p);
    });

    const title = await screen.findByLabelText(/^title$/i);
    await user.clear(title);
    await user.type(title, 'Updated bundle');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await vi.waitFor(() => {
      const patchCalls = requestMock.mock.calls.filter(
        (c) => (c[1] as { method?: string } | undefined)?.method === 'PATCH',
      );
      expect(patchCalls.length).toBe(1);
    });

    const patchCall = requestMock.mock.calls.find(
      (c) => (c[1] as { method?: string } | undefined)?.method === 'PATCH',
    )!;
    const call = patchCall;
    const path = call[0] as string;
    const options = call[1] as {
      method: string;
      body: {
        bundleChanges: Record<string, unknown>;
        itemsPayload: Array<Record<string, unknown>>;
      };
    };
    expect(path).toBe('/api/requests/42');
    expect(options.method).toBe('PATCH');
    expect(options.body.bundleChanges).toMatchObject({
      title: 'Updated bundle',
      description: 'desc text',
      buyerSeriousness: 'really_want',
    });
    expect(options.body.itemsPayload).toHaveLength(2);
    expect(options.body.itemsPayload[0]).toMatchObject({
      id: 1,
      title: 'Existing item',
      url: 'https://example.com/a',
      priceCents: 1234,
    });
    expect(options.body.itemsPayload[1]).toMatchObject({
      id: 2,
      priceCents: 500,
    });

    await vi.waitFor(() => {
      expect(screen.getByTestId('detail-page')).toBeInTheDocument();
    });
    expect(locations.at(-1)).toBe('/requests/42');
  });

  it('renders "Request not found." on 404', async () => {
    const { ApiError } = await import('@/lib/api');
    requestMock.mockRejectedValueOnce(
      new ApiError(404, 'Not found', { error: 'not_found' }),
    );

    renderPage();

    expect(
      await screen.findByText(/request not found\./i),
    ).toBeInTheDocument();
  });
});
