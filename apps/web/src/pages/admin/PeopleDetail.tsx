import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import DetailDrawer from './components/DetailDrawer';

interface DetailResponse {
  user: { id: number; name: string; oidcSubject: string; isAdmin: boolean; createdAt: string };
  household: { id: number; name: string; memberId: number; approvalMode: string; joinedAt: string } | null;
  requests: Array<{ id: number; title: string; status: string; createdAt: string }>;
  comments: Array<{ id: number; requestId: number; body: string; createdAt: string }>;
  pushSubscriptions: Array<{ id: number; endpoint: string; createdAt: string }>;
  notificationLogs: Array<{ id: number; eventKey: string; sentAt: string }>;
}

export default function PeopleDetail({
  userId,
  onClose,
}: {
  userId: number | null;
  onClose: () => void;
}) {
  const open = userId !== null;
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', userId, 'detail'],
    queryFn: () => request<DetailResponse>(`/api/admin/users/${userId}/detail`),
    enabled: open,
  });

  const testPush = useMutation({
    mutationFn: () => request(`/api/admin/users/${userId}/test-push`, { method: 'POST' }),
  });

  const deletePush = useMutation({
    mutationFn: () => request(`/api/admin/users/${userId}/push-subscriptions`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId, 'detail'] });
    },
  });

  const title = data?.user?.name ?? (open ? 'Loading…' : '');

  return (
    <DetailDrawer open={open} onClose={onClose} title={title}>
      {isLoading || !data ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-6 text-sm">
          <section>
            <div className="text-muted-foreground">Profile</div>
            <div className="mt-1">
              <span className="font-medium">{data.user.name}</span>{' '}
              {data.user.isAdmin && <Badge>Admin</Badge>}
            </div>
            <div className="mt-1 truncate text-xs text-muted-foreground">
              oidc: {data.user.oidcSubject}
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Name + admin status are synced from Authentik on each login.
            </p>
          </section>

          <section>
            <div className="mb-1 text-muted-foreground">Household</div>
            {data.household ? (
              <div>
                {data.household.name} <Badge variant="outline">{data.household.approvalMode}</Badge>
              </div>
            ) : (
              <div className="text-muted-foreground">No household</div>
            )}
          </section>

          <section>
            <div className="mb-1 text-muted-foreground">Recent requests ({data.requests.length})</div>
            <ul className="space-y-1">
              {data.requests.map((r) => (
                <li key={r.id}>
                  #{r.id} — {r.title} <Badge variant="outline">{r.status}</Badge>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <div className="mb-1 text-muted-foreground">
              Push subscriptions ({data.pushSubscriptions.length})
            </div>
            <ul className="space-y-1">
              {data.pushSubscriptions.map((s) => (
                <li key={s.id} className="truncate text-xs">{s.endpoint}</li>
              ))}
            </ul>
          </section>

          <section>
            <div className="mb-1 text-muted-foreground">
              Notification log (last {data.notificationLogs.length})
            </div>
            <ul className="space-y-1 text-xs">
              {data.notificationLogs.map((l) => (
                <li key={l.id}>
                  {l.eventKey} — {new Date(l.sentAt).toLocaleString()}
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-wrap gap-2 border-t pt-4">
            <Button size="sm" onClick={() => testPush.mutate()} disabled={testPush.isPending}>
              {testPush.isPending ? 'Sending…' : 'Send test push'}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => deletePush.mutate()}
              disabled={deletePush.isPending || data.pushSubscriptions.length === 0}
            >
              Delete all push subs
            </Button>
          </section>
        </div>
      )}
    </DetailDrawer>
  );
}
