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

import NotificationSettingsPage from './NotificationSettingsPage';

const KNOWN_EVENT_TYPES = [
  'request_pending',
  'approval',
  'delay',
  'denial',
  'reconfirm_due',
  'approval_expiring',
  'stale_pending',
  'need_rated_reminder',
  'comment',
  'appeal_filed',
  'appeal_resolved',
];

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
      <NotificationSettingsPage />
      <Toaster />
    </QueryClientProvider>,
  );
}

describe('NotificationSettingsPage', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('renders default-enabled checkboxes for all known event types when server returns empty preferences', async () => {
    requestMock.mockResolvedValueOnce({ preferences: [] });

    renderPage();

    // Wait for the page to render past the loading state.
    await vi.waitFor(() => {
      expect(
        screen.getByRole('heading', { name: /notification settings/i }),
      ).toBeInTheDocument();
    });

    const switches = await screen.findAllByRole('switch');
    expect(switches).toHaveLength(KNOWN_EVENT_TYPES.length);
    for (const sw of switches) {
      expect(sw).toBeChecked();
    }
  });

  it('toggling a checkbox and saving PUTs the full preferences array with the new value', async () => {
    const user = userEvent.setup();
    requestMock.mockImplementation((path: string, options?: { method?: string }) => {
      const method = options?.method ?? 'GET';
      if (method === 'PUT') return Promise.resolve({ preferences: [] });
      return Promise.resolve({ preferences: [] });
    });

    renderPage();

    // Wait until initialized.
    const commentSwitch = await screen.findByRole('switch', {
      name: /new comment on a request/i,
    });
    expect(commentSwitch).toBeChecked();

    await user.click(commentSwitch);
    expect(commentSwitch).not.toBeChecked();

    await user.click(screen.getByRole('button', { name: /^save$/i }));

    await vi.waitFor(() => {
      const hasPut = requestMock.mock.calls.some(
        (c) => (c[1] as { method?: string } | undefined)?.method === 'PUT',
      );
      expect(hasPut).toBe(true);
    });

    const putCall = requestMock.mock.calls.find(
      (c) => (c[1] as { method?: string } | undefined)?.method === 'PUT',
    )!;
    expect(putCall[0]).toBe('/api/notifications/preferences');
    const opts = putCall[1] as {
      method: string;
      body: {
        preferences: Array<{
          eventType: string;
          enabled: boolean;
          quietHoursStart: string | null;
          quietHoursEnd: string | null;
        }>;
      };
    };
    expect(opts.method).toBe('PUT');
    const prefs = opts.body.preferences;
    expect(prefs).toHaveLength(KNOWN_EVENT_TYPES.length);

    const sentTypes = prefs.map((p) => p.eventType).sort();
    expect(sentTypes).toEqual([...KNOWN_EVENT_TYPES].sort());

    const commentEntry = prefs.find((p) => p.eventType === 'comment')!;
    expect(commentEntry.enabled).toBe(false);
    expect(commentEntry.quietHoursStart).toBeNull();
    expect(commentEntry.quietHoursEnd).toBeNull();

    const approvalEntry = prefs.find((p) => p.eventType === 'approval')!;
    expect(approvalEntry.enabled).toBe(true);
  });
});
