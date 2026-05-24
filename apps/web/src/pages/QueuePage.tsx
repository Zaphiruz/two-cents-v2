import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  StatusBadge,
  STATUS_LABEL,
  type RequestStatus,
} from '@/components/ui/StatusBadge';
import { useToast } from '@/components/ui/use-toast';
import { request } from '@/lib/api';
import { formatCurrency, formatRelative } from '@/lib/format';

interface QueueItem {
  id: number;
  title: string;
  priceCents: number;
  position: number;
}

interface QueueRequest {
  id: number;
  title: string;
  description: string;
  buyerSeriousness: 'need' | 'really_want' | 'nice_to_have';
  status: RequestStatus;
  currency: string;
  createdAt: string;
  items: QueueItem[];
  buyer?: { id: number; user: { id: number; name: string } };
}

interface QueueResponse {
  incoming: QueueRequest[];
  myActive: QueueRequest[];
}

const STATUS_ORDER: RequestStatus[] = [
  'pending',
  'delayed',
  'awaiting_reconfirm',
  'approved',
  'denied',
];

function sumPriceCents(items: QueueItem[]): number {
  return items.reduce((acc, it) => acc + (it.priceCents ?? 0), 0);
}

function groupByStatus(rows: QueueRequest[]): Map<RequestStatus, QueueRequest[]> {
  const map = new Map<RequestStatus, QueueRequest[]>();
  for (const r of rows) {
    const list = map.get(r.status) ?? [];
    list.push(r);
    map.set(r.status, list);
  }
  for (const [, list] of map) {
    list.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }
  return map;
}

function IncomingRow({ row }: { row: QueueRequest }) {
  const total = sumPriceCents(row.items);
  return (
    <li className="flex items-center justify-between gap-3 border-b py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{row.title}</span>
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {row.buyer?.user.name ? (
            <>
              <span className="font-medium">{row.buyer.user.name}</span>
              {' · '}
            </>
          ) : null}
          {row.items.length} item{row.items.length === 1 ? '' : 's'}
          {' · '}
          {formatCurrency(total, row.currency)}
          {' · '}
          {formatRelative(row.createdAt)}
        </div>
      </div>
      <Link
        to={`/requests/${row.id}`}
        className="shrink-0 text-sm font-medium text-primary hover:underline"
      >
        Review &rarr;
      </Link>
    </li>
  );
}

function MyActiveRow({ row }: { row: QueueRequest }) {
  const total = sumPriceCents(row.items);
  return (
    <li className="flex items-center justify-between gap-3 border-b py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            to={`/requests/${row.id}`}
            className="truncate text-sm font-medium hover:underline"
          >
            {row.title}
          </Link>
          <StatusBadge status={row.status} />
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          {row.items.length} item{row.items.length === 1 ? '' : 's'}
          {' · '}
          {formatCurrency(total, row.currency)}
          {' · '}
          {formatRelative(row.createdAt)}
        </div>
      </div>
    </li>
  );
}

export default function QueuePage() {
  const { toast } = useToast();
  const query = useQuery<QueueResponse>({
    queryKey: ['requests', 'queue'],
    queryFn: () => request<QueueResponse>('/api/requests'),
  });

  useEffect(() => {
    if (query.isError) {
      toast({
        title: "Couldn't load queue",
        variant: 'destructive',
      });
    }
  }, [query.isError, toast]);

  if (query.isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading&hellip;</div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-center gap-3 p-12 text-center">
        <p className="text-sm text-muted-foreground">Couldn&rsquo;t load queue.</p>
        <Button onClick={() => query.refetch()} variant="outline">
          Retry
        </Button>
      </div>
    );
  }

  const data = query.data ?? { incoming: [], myActive: [] };
  const incoming = data.incoming ?? [];
  const myActive = data.myActive ?? [];
  const bothEmpty = incoming.length === 0 && myActive.length === 0;

  if (bothEmpty) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-16 text-center">
        <h1 className="text-2xl font-semibold">No requests yet.</h1>
        <Link to="/requests/new">
          <Button>+ New request</Button>
        </Link>
      </div>
    );
  }

  const grouped = groupByStatus(myActive);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Requests</h1>
        <Link to="/requests/new">
          <Button>+ New request</Button>
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Incoming</CardTitle>
          </CardHeader>
          <CardContent>
            {incoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No incoming requests
              </p>
            ) : (
              <ul className="divide-y">
                {incoming.map((row) => (
                  <IncomingRow key={row.id} row={row} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>My active</CardTitle>
          </CardHeader>
          <CardContent>
            {myActive.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No active requests of yours
              </p>
            ) : (
              <div className="space-y-4">
                {STATUS_ORDER.map((status) => {
                  const rows = grouped.get(status);
                  if (!rows || rows.length === 0) return null;
                  return (
                    <section key={status}>
                      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        {STATUS_LABEL[status]}
                      </h3>
                      <ul className="divide-y">
                        {rows.map((row) => (
                          <MyActiveRow key={row.id} row={row} />
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
