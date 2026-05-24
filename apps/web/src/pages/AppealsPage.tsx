import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { ApiError, request } from '@/lib/api';
import { formatCurrency, formatRelative } from '@/lib/format';

interface AppealItem {
  id: number;
  title: string;
  priceCents: number;
  position: number;
}

interface AppealRequest {
  id: number;
  title: string;
  description: string;
  currency: string;
  items: AppealItem[];
}

interface AppealRow {
  id: number;
  justification: string;
  createdAt: string;
  buyer: { id: number; user: { id: number; name: string } };
  request: AppealRequest;
}

interface QueueResponse {
  appeals: AppealRow[];
}

type Decision = 'overturn' | 'uphold';

export default function AppealsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingRow, setPendingRow] = useState<number | null>(null);

  const query = useQuery<QueueResponse, ApiError>({
    queryKey: ['appeals', 'queue'],
    queryFn: () => request<QueueResponse>('/api/appeals/queue'),
    retry: false,
  });

  const resolveMutation = useMutation({
    mutationFn: ({
      id,
      decision,
    }: {
      id: number;
      decision: Decision;
      requestId: number;
    }) =>
      request(`/api/appeals/${id}/resolve`, {
        method: 'POST',
        body: { decision },
      }),
    onMutate: ({ id }) => {
      setPendingRow(id);
    },
    onSuccess: (_data, vars) => {
      toast({
        title:
          vars.decision === 'overturn'
            ? 'Appeal overturned.'
            : 'Appeal upheld.',
      });
      void queryClient.invalidateQueries({ queryKey: ['appeals', 'queue'] });
      void queryClient.invalidateQueries({
        queryKey: ['request', vars.requestId],
      });
      void queryClient.invalidateQueries({ queryKey: ['requests', 'queue'] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        toast({
          title: 'Already resolved',
          description: 'This appeal has already been resolved.',
          variant: 'destructive',
        });
        return;
      }
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
        title: 'Action failed',
        description,
        variant: 'destructive',
      });
    },
    onSettled: () => {
      setPendingRow(null);
    },
  });

  if (query.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-center gap-3 p-12 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&rsquo;t load appeals.
        </p>
        <Button onClick={() => query.refetch()} variant="outline">
          Retry
        </Button>
      </div>
    );
  }

  const appeals = query.data?.appeals ?? [];

  if (appeals.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-6 p-6">
        <h1 className="text-2xl font-semibold">Appeals</h1>
        <p className="text-sm text-muted-foreground">No pending appeals.</p>
      </div>
    );
  }

  const handleResolve = (row: AppealRow, decision: Decision) => {
    resolveMutation.mutate({
      id: row.id,
      decision,
      requestId: row.request.id,
    });
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Appeals</h1>
      <ul className="space-y-4">
        {appeals.map((appeal) => {
          const total = appeal.request.items.reduce(
            (acc, it) => acc + (it.priceCents ?? 0),
            0,
          );
          const isPending = pendingRow === appeal.id && resolveMutation.isPending;
          return (
            <li key={appeal.id}>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">
                    <span className="font-medium">{appeal.buyer.user.name}</span>
                    {' · '}
                    <Link
                      to={`/requests/${appeal.request.id}`}
                      className="text-primary hover:underline"
                    >
                      {appeal.request.title}
                    </Link>
                  </CardTitle>
                  <div className="text-xs text-muted-foreground">
                    {appeal.request.items.length}{' '}
                    {appeal.request.items.length === 1 ? 'item' : 'items'}
                    {' · '}
                    {formatCurrency(total, appeal.request.currency)}
                    {' · '}
                    {formatRelative(appeal.createdAt)}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <p className="whitespace-pre-wrap text-sm">
                    {appeal.justification}
                  </p>
                  <Separator />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="default"
                      disabled={isPending}
                      onClick={() => handleResolve(appeal, 'overturn')}
                    >
                      Overturn
                    </Button>
                    <Button
                      variant="outline"
                      disabled={isPending}
                      onClick={() => handleResolve(appeal, 'uphold')}
                    >
                      Uphold
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
