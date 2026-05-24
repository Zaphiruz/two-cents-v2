import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/lib/api';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import DataTable, { type Column } from './components/DataTable';

interface AppealRow {
  id: number;
  status: 'pending' | 'upheld' | 'overturned';
  periodKey: string;
  requestId: number;
  requestTitle: string;
  householdId: number;
  householdName: string;
  buyerName: string;
  createdAt: string;
  resolvedAt: string | null;
}

interface ListResponse {
  appeals: AppealRow[];
  nextCursor: number | null;
}

export default function AdminAppealsPage() {
  const [status, setStatus] = useState<string>('');
  const [resolveTarget, setResolveTarget] = useState<AppealRow | null>(null);
  const queryClient = useQueryClient();

  const params = new URLSearchParams();
  if (status) params.set('status', status);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'appeals', status],
    queryFn: () => request<ListResponse>(`/api/admin/appeals?${params.toString()}`),
  });

  const resolve = useMutation({
    mutationFn: (vars: { id: number; decision: 'overturn' | 'uphold' }) =>
      request(`/api/admin/appeals/${vars.id}/resolve`, {
        method: 'POST',
        body: { decision: vars.decision },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'appeals'] });
      setResolveTarget(null);
    },
  });

  const columns: Column<AppealRow>[] = [
    { key: 'request', header: 'Request', render: (r) => r.requestTitle },
    { key: 'buyer', header: 'Buyer', render: (r) => r.buyerName },
    { key: 'household', header: 'Household', render: (r) => r.householdName },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <Badge variant={r.status === 'pending' ? 'default' : 'outline'}>{r.status}</Badge>,
    },
    { key: 'period', header: 'Period', render: (r) => r.periodKey },
    {
      key: 'created',
      header: 'Filed',
      render: (r) => new Date(r.createdAt).toLocaleDateString(),
    },
    {
      key: 'actions',
      header: '',
      render: (r) =>
        r.status === 'pending' ? (
          <Button
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              setResolveTarget(r);
            }}
          >
            Resolve
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Appeals</h1>
      <div className="flex items-center gap-2">
        <span className="text-sm text-muted-foreground">Status</span>
        <Select value={status || 'all'} onValueChange={(v) => setStatus(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">all</SelectItem>
            <SelectItem value="pending">pending</SelectItem>
            <SelectItem value="upheld">upheld</SelectItem>
            <SelectItem value="overturned">overturned</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <DataTable<AppealRow>
        rows={data?.appeals ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        isLoading={isLoading}
      />
      <Dialog open={resolveTarget !== null} onOpenChange={(o) => { if (!o) setResolveTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Resolve appeal #{resolveTarget?.id}</DialogTitle>
          </DialogHeader>
          <div className="text-sm text-muted-foreground">
            Request: <span className="text-foreground">{resolveTarget?.requestTitle}</span>
          </div>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() =>
                resolveTarget && resolve.mutate({ id: resolveTarget.id, decision: 'uphold' })
              }
              disabled={resolve.isPending}
            >
              Uphold (deny)
            </Button>
            <Button
              onClick={() =>
                resolveTarget && resolve.mutate({ id: resolveTarget.id, decision: 'overturn' })
              }
              disabled={resolve.isPending}
            >
              Overturn (approve)
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
