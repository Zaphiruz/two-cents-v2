import { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { ApiError, request } from '@/lib/api';
import { useUser } from '@/lib/auth';
import { ApproverAction } from '@/components/request/ApproverAction';
import { Comments, type CommentItem } from '@/components/request/Comments';

type RequestStatus =
  | 'pending'
  | 'delayed'
  | 'awaiting_reconfirm'
  | 'approved'
  | 'denied'
  | 'cancelled'
  | 'archived'
  | 'purchased';

interface ItemRow {
  id: number;
  title: string;
  url?: string | null;
  priceCents: number;
  notes?: string | null;
  position: number;
}

interface ReviewRow {
  id: number;
  action: 'approve' | 'delay' | 'deny';
  approverSeriousness: 'need' | 'really_want' | 'nice_to_have';
  notes?: string | null;
  createdAt: string;
  approver: { id: number; user: { id: number; name: string } };
}

interface BuyerInfo {
  id: number;
  householdId: number;
  user: { id: number; name: string };
}

interface DetailRequest {
  id: number;
  title: string;
  description: string;
  status: RequestStatus;
  currency: string;
  createdAt: string;
  statusExpiresAt?: string | null;
  items: ItemRow[];
  reviews: ReviewRow[];
  comments: CommentItem[];
  buyer: BuyerInfo;
}

export interface DetailResponse {
  request: DetailRequest;
  appealsRemaining: number;
}

const STATUS_LABEL: Record<RequestStatus, string> = {
  pending: 'Pending',
  delayed: 'Delayed',
  awaiting_reconfirm: 'Awaiting reconfirm',
  approved: 'Approved',
  denied: 'Denied',
  cancelled: 'Cancelled',
  archived: 'Archived',
  purchased: 'Purchased',
};

const ACTION_LABEL: Record<ReviewRow['action'], string> = {
  approve: 'Approved',
  delay: 'Delayed',
  deny: 'Denied',
};

const SERIOUSNESS_LABEL: Record<ReviewRow['approverSeriousness'], string> = {
  need: 'Need',
  really_want: 'Really want',
  nice_to_have: 'Nice to have',
};

const REL_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: 'year', seconds: 60 * 60 * 24 * 365 },
  { unit: 'month', seconds: 60 * 60 * 24 * 30 },
  { unit: 'week', seconds: 60 * 60 * 24 * 7 },
  { unit: 'day', seconds: 60 * 60 * 24 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
  { unit: 'second', seconds: 1 },
];

function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const deltaSec = Math.round((then - now.getTime()) / 1000);
  const abs = Math.abs(deltaSec);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const { unit, seconds } of REL_UNITS) {
    if (abs >= seconds || unit === 'second') {
      const value = Math.round(deltaSec / seconds);
      return rtf.format(value, unit);
    }
  }
  return '';
}

function formatCurrency(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

function statusBadge(status: RequestStatus) {
  const label = STATUS_LABEL[status] ?? status;
  if (status === 'pending') {
    return <Badge variant="default">{label}</Badge>;
  }
  if (status === 'delayed' || status === 'awaiting_reconfirm') {
    return <Badge variant="secondary">{label}</Badge>;
  }
  if (status === 'approved') {
    return <Badge className="bg-green-600 text-white">{label}</Badge>;
  }
  if (status === 'denied') {
    return <Badge variant="destructive">{label}</Badge>;
  }
  return <Badge variant="outline">{label}</Badge>;
}

export default function RequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const requestId = Number(id);
  const idValid = Number.isFinite(requestId) && requestId > 0;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useUser();

  const query = useQuery<DetailResponse, ApiError>({
    queryKey: ['request', requestId],
    queryFn: () => request<DetailResponse>(`/api/requests/${requestId}`),
    enabled: idValid,
    retry: false,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['request', requestId] });
    void queryClient.invalidateQueries({ queryKey: ['requests', 'queue'] });
  };

  const handleMutationError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 409) {
      toast({
        title: 'Out of date',
        description: 'This request can no longer be changed.',
        variant: 'destructive',
      });
      return;
    }
    const description = err instanceof Error ? err.message : 'Something went wrong';
    toast({ title: 'Action failed', description, variant: 'destructive' });
  };

  const cancelMutation = useMutation({
    mutationFn: () =>
      request(`/api/requests/${requestId}/cancel`, { method: 'POST' }),
    onSuccess: invalidate,
    onError: handleMutationError,
  });

  const reconfirmMutation = useMutation({
    mutationFn: () =>
      request(`/api/requests/${requestId}/reconfirm`, { method: 'POST' }),
    onSuccess: invalidate,
    onError: handleMutationError,
  });

  const purchaseMutation = useMutation({
    mutationFn: () =>
      request(`/api/requests/${requestId}/purchase`, { method: 'POST' }),
    onSuccess: invalidate,
    onError: handleMutationError,
  });

  const anyPending =
    cancelMutation.isPending ||
    reconfirmMutation.isPending ||
    purchaseMutation.isPending;

  useEffect(() => {
    if (query.isError && !(query.error instanceof ApiError)) {
      toast({ title: "Couldn't load request", variant: 'destructive' });
    }
  }, [query.isError, query.error, toast]);

  if (!idValid) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Invalid request id.</div>
    );
  }

  if (query.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (query.isError) {
    const err = query.error;
    if (err instanceof ApiError && err.status === 404) {
      return (
        <div className="flex flex-col items-center gap-3 p-12 text-center">
          <p className="text-sm text-muted-foreground">Request not found.</p>
          <Link
            to="/"
            className="text-sm font-medium text-primary hover:underline"
          >
            ← Back to queue
          </Link>
        </div>
      );
    }
    if (err instanceof ApiError && err.status === 403) {
      return (
        <div className="p-12 text-center text-sm text-muted-foreground">
          You don&rsquo;t have access to this request.
        </div>
      );
    }
    return (
      <div className="flex flex-col items-center gap-3 p-12 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&rsquo;t load request.
        </p>
        <Button onClick={() => query.refetch()} variant="outline">
          Retry
        </Button>
      </div>
    );
  }

  const data = query.data;
  if (!data) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  const { request: req, appealsRemaining } = data;
  const isBuyer = !!user && req.buyer.user.id === user.id;
  const isApprover = !!user && !isBuyer;
  const total = req.items.reduce((acc, it) => acc + (it.priceCents ?? 0), 0);

  const showReopens =
    (req.status === 'delayed' || req.status === 'awaiting_reconfirm') &&
    req.statusExpiresAt;

  const buyerCtas: React.ReactNode[] = [];
  if (isBuyer) {
    if (req.status === 'pending') {
      buyerCtas.push(
        <Link key="edit" to={`/requests/${req.id}/edit`}>
          <Button variant="outline" disabled={anyPending}>
            Edit
          </Button>
        </Link>,
        <Button
          key="cancel"
          variant="destructive"
          disabled={anyPending}
          onClick={() => cancelMutation.mutate()}
        >
          Cancel
        </Button>,
      );
    } else if (req.status === 'delayed') {
      buyerCtas.push(
        <Button
          key="cancel"
          variant="destructive"
          disabled={anyPending}
          onClick={() => cancelMutation.mutate()}
        >
          Cancel
        </Button>,
      );
    } else if (req.status === 'awaiting_reconfirm') {
      buyerCtas.push(
        <Button
          key="reconfirm"
          variant="default"
          disabled={anyPending}
          onClick={() => reconfirmMutation.mutate()}
        >
          Reconfirm
        </Button>,
        <Button
          key="cancel"
          variant="destructive"
          disabled={anyPending}
          onClick={() => cancelMutation.mutate()}
        >
          Cancel
        </Button>,
      );
    } else if (req.status === 'approved') {
      buyerCtas.push(
        <Button
          key="purchase"
          variant="default"
          disabled={anyPending}
          onClick={() => purchaseMutation.mutate()}
        >
          Purchase
        </Button>,
        <Button
          key="cancel"
          variant="destructive"
          disabled={anyPending}
          onClick={() => cancelMutation.mutate()}
        >
          Cancel
        </Button>,
      );
    } else if (req.status === 'denied') {
      if (appealsRemaining > 0) {
        buyerCtas.push(
          <Link key="appeal" to={`/appeals/new/${req.id}`}>
            <Button variant="default">Appeal</Button>
          </Link>,
        );
      }
      buyerCtas.push(
        <span key="appeals-count" className="text-sm text-muted-foreground">
          Appeals remaining: {appealsRemaining}
        </span>,
      );
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 p-6">
      {/* State block */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{req.title}</h1>
          {statusBadge(req.status)}
        </div>
        <div className="text-sm text-muted-foreground">
          <span className="font-medium">{req.buyer.user.name}</span>
          {' · '}
          {req.currency}
          {' · '}
          {formatRelative(req.createdAt)}
        </div>
        {showReopens && req.statusExpiresAt ? (
          <div className="text-sm text-muted-foreground">
            {req.status === 'awaiting_reconfirm' ? 'Reconfirm by' : 'Reopens'}{' '}
            {formatRelative(req.statusExpiresAt)}.
          </div>
        ) : null}
        {req.description ? (
          <p className="whitespace-pre-wrap text-sm">{req.description}</p>
        ) : null}
      </section>

      {/* Items */}
      <section className="space-y-3" aria-label="Items">
        <h2 className="text-lg font-semibold">Items</h2>
        {req.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No items.</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {req.items
              .slice()
              .sort((a, b) => a.position - b.position)
              .map((it) => (
                <li key={it.id} className="flex flex-col gap-1 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium">
                        {it.title}
                      </div>
                      {it.url ? (
                        <a
                          href={it.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block truncate text-xs text-primary hover:underline"
                        >
                          {it.url}
                        </a>
                      ) : null}
                      {it.notes ? (
                        <p className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                          {it.notes}
                        </p>
                      ) : null}
                    </div>
                    <div className="shrink-0 text-sm tabular-nums">
                      {formatCurrency(it.priceCents, req.currency)}
                    </div>
                  </div>
                </li>
              ))}
          </ul>
        )}
        {req.items.length > 0 ? (
          <div className="flex justify-end text-sm font-medium">
            Total: {formatCurrency(total, req.currency)}
          </div>
        ) : null}
      </section>

      {/* Reviews */}
      {req.reviews.length > 0 ? (
        <section className="space-y-3" aria-label="Reviews">
          <h2 className="text-lg font-semibold">Reviews</h2>
          <ul className="space-y-3">
            {req.reviews.map((rv) => (
              <li key={rv.id} className="space-y-1 rounded-md border p-3">
                <div className="flex flex-wrap items-baseline gap-2 text-sm">
                  <span className="font-medium">{rv.approver.user.name}</span>
                  <span className="text-muted-foreground">
                    {ACTION_LABEL[rv.action]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({SERIOUSNESS_LABEL[rv.approverSeriousness]})
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">
                    {formatRelative(rv.createdAt)}
                  </span>
                </div>
                {rv.notes ? (
                  <p className="whitespace-pre-wrap text-sm">{rv.notes}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {/* Buyer CTAs */}
      {buyerCtas.length > 0 ? (
        <section className="flex flex-wrap items-center gap-2" aria-label="Actions">
          {buyerCtas}
        </section>
      ) : null}

      {/* Approver action */}
      {req.status === 'pending' && isApprover ? (
        <section className="space-y-3" aria-label="Approver action">
          <h2 className="text-lg font-semibold">Your decision</h2>
          <ApproverAction requestId={req.id} />
        </section>
      ) : null}

      <Separator />

      {/* Comments */}
      <Comments requestId={req.id} comments={req.comments} />
    </div>
  );
}
