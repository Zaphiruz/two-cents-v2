import { FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import DataTable, { type Column } from './components/DataTable';
import DetailDrawer from './components/DetailDrawer';

type HitType = 'request' | 'comment' | 'notificationLog' | 'pushSubscription' | 'consumedJwtJti';

interface SearchHit {
  type: HitType;
  id: number | string;
  primary: string;
  userName: string | null;
  householdName: string | null;
  timestamp: string;
  raw: Record<string, unknown>;
}

interface SearchResponse {
  results: SearchHit[];
}

export default function AdminSearchPage() {
  // Pending input (what the user is typing) vs submitted (what we actually query)
  const [pendingQ, setPendingQ] = useState('');
  const [pendingType, setPendingType] = useState<'' | HitType>('');
  const [submitted, setSubmitted] = useState<{ q: string; type: '' | HitType } | null>(null);
  const [selected, setSelected] = useState<SearchHit | null>(null);

  const params = new URLSearchParams();
  if (submitted) {
    params.set('q', submitted.q);
    if (submitted.type) params.set('type', submitted.type);
  }

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'search', submitted?.q ?? '', submitted?.type ?? ''],
    queryFn: () => request<SearchResponse>(`/api/admin/search?${params.toString()}`),
    enabled: submitted !== null && submitted.q.trim().length > 0,
  });

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const q = pendingQ.trim();
    if (!q) return;
    setSubmitted({ q, type: pendingType });
  }

  const columns: Column<SearchHit>[] = [
    {
      key: 'type',
      header: 'Type',
      render: (r) => <Badge variant="outline">{r.type}</Badge>,
      width: '160px',
    },
    {
      key: 'primary',
      header: 'Primary',
      render: (r) => <span className="truncate">{r.primary}</span>,
    },
    { key: 'user', header: 'User', render: (r) => r.userName ?? '—' },
    {
      key: 'household',
      header: 'Household',
      render: (r) => r.householdName ?? '—',
    },
    {
      key: 'timestamp',
      header: 'When',
      render: (r) => new Date(r.timestamp).toLocaleString(),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Audit Search</h1>
      <form role="search" onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[200px]">
          <Input
            type="search"
            placeholder="Search title / body / event / endpoint / jti…"
            value={pendingQ}
            onChange={(e) => setPendingQ(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="search-type" className="mb-1 block text-xs uppercase text-muted-foreground">
            Type
          </label>
          <select
            id="search-type"
            value={pendingType}
            onChange={(e) => setPendingType(e.target.value as '' | HitType)}
            className="rounded border border-border bg-background px-2 py-1 text-sm"
          >
            <option value="">all</option>
            <option value="request">request</option>
            <option value="comment">comment</option>
            <option value="notificationLog">notificationLog</option>
            <option value="pushSubscription">pushSubscription</option>
            <option value="consumedJwtJti">consumedJwtJti</option>
          </select>
        </div>
        <Button type="submit">Search</Button>
      </form>
      {submitted && (
        <DataTable<SearchHit>
          rows={data?.results ?? []}
          columns={columns}
          rowKey={(r) => `${r.type}:${r.id}`}
          isLoading={isLoading}
          emptyMessage="No results."
          onRowClick={(r) => setSelected(r)}
        />
      )}
      <DetailDrawer
        open={selected !== null}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.type} #${selected.id}` : ''}
      >
        {selected && (
          <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
            {JSON.stringify(selected.raw, null, 2)}
          </pre>
        )}
      </DetailDrawer>
    </div>
  );
}
