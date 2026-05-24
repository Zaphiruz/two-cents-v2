import * as React from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type NotificationPreferenceInput } from '@two-cents/shared';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { ApiError, request } from '@/lib/api';
import { urlBase64ToUint8Array } from '@/lib/push';

type PushStatus =
  | 'unsupported'
  | 'denied'
  | 'unsubscribed'
  | 'subscribed';

interface NotificationPreference {
  eventType: string;
  enabled: boolean;
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
}

interface PreferencesResponse {
  preferences: NotificationPreference[];
}

const EVENT_LABELS: Record<string, string> = {
  request_pending: 'New request awaiting approval',
  approval: 'Request approved',
  delay: 'Request delayed',
  denial: 'Request denied',
  comment: 'New comment on a request',
  reconfirm_due: 'Reconfirmation due',
  approval_expiring: 'Approval expiring soon',
  stale_pending: 'Stale pending request',
  need_rated_reminder: 'Need-rating reminder',
  appeal_filed: 'Appeal filed',
  appeal_resolved: 'Appeal resolved',
};

interface Group {
  title: string;
  eventTypes: string[];
}

const GROUPS: Group[] = [
  {
    title: 'Requests',
    eventTypes: [
      'request_pending',
      'approval',
      'delay',
      'denial',
      'reconfirm_due',
      'approval_expiring',
      'stale_pending',
      'need_rated_reminder',
    ],
  },
  { title: 'Comments', eventTypes: ['comment'] },
  { title: 'Appeals', eventTypes: ['appeal_filed', 'appeal_resolved'] },
];

const ALL_EVENT_TYPES = GROUPS.flatMap((g) => g.eventTypes);

const QUERY_KEY = ['notifications', 'preferences'] as const;

function isHHMM(value: string): boolean {
  return /^\d{2}:\d{2}$/.test(value);
}

export default function NotificationSettingsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => request<PreferencesResponse>('/api/notifications/preferences'),
  });

  const [enabledMap, setEnabledMap] = React.useState<Record<string, boolean>>({});
  const [quietStart, setQuietStart] = React.useState<string>('');
  const [quietEnd, setQuietEnd] = React.useState<string>('');
  const [initialized, setInitialized] = React.useState(false);

  React.useEffect(() => {
    if (!query.data || initialized) return;
    const map: Record<string, boolean> = {};
    const byType = new Map(
      query.data.preferences.map((p) => [p.eventType, p] as const),
    );
    for (const type of ALL_EVENT_TYPES) {
      const existing = byType.get(type);
      map[type] = existing ? existing.enabled : true;
    }
    // Seed quiet hours from the first preference that has them set.
    const withQuiet = query.data.preferences.find(
      (p) => p.quietHoursStart && p.quietHoursEnd,
    );
    if (withQuiet) {
      setQuietStart(withQuiet.quietHoursStart ?? '');
      setQuietEnd(withQuiet.quietHoursEnd ?? '');
    }
    setEnabledMap(map);
    setInitialized(true);
  }, [query.data, initialized]);

  const mutation = useMutation({
    mutationFn: (body: { preferences: NotificationPreferenceInput[] }) =>
      request<PreferencesResponse>('/api/notifications/preferences', {
        method: 'PUT',
        body,
      }),
    onSuccess: () => {
      toast({ title: 'Preferences saved.' });
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (err: unknown) => {
      let description = 'Something went wrong';
      if (err instanceof ApiError) {
        const body = err.body as { message?: unknown } | null;
        if (body && typeof body.message === 'string') {
          description = body.message;
        } else {
          description = err.message;
        }
      } else if (err instanceof Error) {
        description = err.message;
      }
      toast({
        title: 'Could not save preferences',
        description,
        variant: 'destructive',
      });
    },
  });

  function handleToggle(eventType: string, next: boolean) {
    setEnabledMap((prev) => ({ ...prev, [eventType]: next }));
  }

  // ---------- Push notifications ----------
  const [pushStatus, setPushStatus] = React.useState<PushStatus>('unsubscribed');
  const [pushBusy, setPushBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    async function init() {
      if (
        typeof navigator === 'undefined' ||
        typeof window === 'undefined' ||
        !('serviceWorker' in navigator) ||
        !('PushManager' in window)
      ) {
        if (!cancelled) setPushStatus('unsupported');
        return;
      }
      if (
        typeof Notification !== 'undefined' &&
        Notification.permission === 'denied'
      ) {
        if (!cancelled) setPushStatus('denied');
        return;
      }
      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (cancelled) return;
        setPushStatus(existing ? 'subscribed' : 'unsubscribed');
      } catch {
        if (!cancelled) setPushStatus('unsupported');
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, []);

  function describePushError(err: unknown): string {
    if (err instanceof ApiError) {
      const body = err.body as { message?: unknown } | null;
      if (body && typeof body.message === 'string') return body.message;
      return err.message;
    }
    if (err instanceof Error) return err.message;
    return 'Something went wrong';
  }

  async function handleEnablePush() {
    setPushBusy(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') {
        setPushStatus(permission === 'denied' ? 'denied' : 'unsubscribed');
        return;
      }
      const { publicKey } = await request<{ publicKey: string }>(
        '/api/push/vapid',
      );
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource,
      });
      const json = sub.toJSON() as {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
      const endpoint = json.endpoint ?? sub.endpoint;
      const p256dh = json.keys?.p256dh ?? '';
      const auth = json.keys?.auth ?? '';
      await request('/api/push/subscribe', {
        method: 'POST',
        body: { endpoint, keys: { p256dh, auth } },
      });
      setPushStatus('subscribed');
      toast({ title: 'Push notifications enabled.' });
    } catch (err) {
      toast({
        title: 'Could not enable push notifications',
        description: describePushError(err),
        variant: 'destructive',
      });
    } finally {
      setPushBusy(false);
    }
  }

  async function handleDisablePush() {
    setPushBusy(true);
    try {
      const registration = await navigator.serviceWorker.ready;
      const sub = await registration.pushManager.getSubscription();
      if (!sub) {
        setPushStatus('unsubscribed');
        return;
      }
      await request('/api/push/unsubscribe', {
        method: 'POST',
        body: { endpoint: sub.endpoint },
      });
      await sub.unsubscribe();
      setPushStatus('unsubscribed');
      toast({ title: 'Push notifications disabled.' });
    } catch (err) {
      toast({
        title: 'Could not disable push notifications',
        description: describePushError(err),
        variant: 'destructive',
      });
    } finally {
      setPushBusy(false);
    }
  }

  function handleSave() {
    const validQuiet =
      quietStart.length > 0 &&
      quietEnd.length > 0 &&
      isHHMM(quietStart) &&
      isHHMM(quietEnd);
    const quietHoursStart = validQuiet ? quietStart : null;
    const quietHoursEnd = validQuiet ? quietEnd : null;

    const preferences: NotificationPreferenceInput[] = ALL_EVENT_TYPES.map(
      (eventType) => ({
        eventType,
        enabled: enabledMap[eventType] ?? true,
        quietHoursStart,
        quietHoursEnd,
      }),
    );
    mutation.mutate({ preferences });
  }

  if (query.isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Loading notification settings…
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="p-6 text-sm text-destructive">
        Could not load notification settings.
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Notification settings</h1>
        <p className="text-sm text-muted-foreground">
          Choose which notifications you want to receive and when.
        </p>
      </div>

      {GROUPS.map((group) => (
        <Card key={group.title}>
          <CardHeader>
            <CardTitle>{group.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {group.eventTypes.map((eventType, idx) => {
              const label = EVENT_LABELS[eventType] ?? eventType;
              const checked = enabledMap[eventType] ?? true;
              const inputId = `pref-${eventType}`;
              return (
                <React.Fragment key={eventType}>
                  {idx > 0 ? <Separator /> : null}
                  <div className="flex items-center justify-between gap-4">
                    <Label htmlFor={inputId} className="flex-1 cursor-pointer">
                      {label}
                    </Label>
                    <input
                      id={inputId}
                      type="checkbox"
                      role="switch"
                      aria-label={label}
                      checked={checked}
                      onChange={(e) =>
                        handleToggle(eventType, e.target.checked)
                      }
                      className="h-4 w-4 cursor-pointer"
                    />
                  </div>
                </React.Fragment>
              );
            })}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle>Quiet hours</CardTitle>
          <CardDescription>
            During quiet hours, notifications will be suppressed. Leave both
            fields blank to disable quiet hours.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="quiet-start">Quiet hours start</Label>
            <Input
              id="quiet-start"
              type="time"
              value={quietStart}
              onChange={(e) => setQuietStart(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="quiet-end">Quiet hours end</Label>
            <Input
              id="quiet-end"
              type="time"
              value={quietEnd}
              onChange={(e) => setQuietEnd(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Push notifications</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {pushStatus === 'unsupported'
              ? "Your browser doesn't support push notifications."
              : pushStatus === 'denied'
                ? 'Push notifications are blocked. Allow them in your browser settings.'
                : pushStatus === 'subscribed'
                  ? 'Push notifications are enabled on this device.'
                  : 'Get push notifications on this device.'}
          </p>
          {pushStatus === 'unsubscribed' ? (
            <Button
              type="button"
              onClick={handleEnablePush}
              disabled={pushBusy}
            >
              {pushBusy ? 'Enabling…' : 'Enable push'}
            </Button>
          ) : null}
          {pushStatus === 'subscribed' ? (
            <Button
              type="button"
              variant="outline"
              onClick={handleDisablePush}
              disabled={pushBusy}
            >
              {pushBusy ? 'Disabling…' : 'Disable push'}
            </Button>
          ) : null}
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={handleSave} disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  );
}
