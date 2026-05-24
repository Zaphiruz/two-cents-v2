import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import DataTable, { type Column } from './components/DataTable';
import PeopleDetail from './PeopleDetail';

interface UserRow {
  id: number;
  name: string;
  isAdmin: boolean;
  householdName: string | null;
  createdAt: string;
}

interface ListResponse {
  users: UserRow[];
  nextCursor: number | null;
}

export default function PeoplePage() {
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const params = new URLSearchParams();
  if (q.trim()) params.set('q', q.trim());

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'users', q],
    queryFn: () => request<ListResponse>(`/api/admin/users?${params.toString()}`),
  });

  const columns: Column<UserRow>[] = [
    { key: 'name', header: 'Name', render: (r) => r.name },
    { key: 'household', header: 'Household', render: (r) => r.householdName ?? '—' },
    {
      key: 'isAdmin',
      header: 'Role',
      render: (r) => (r.isAdmin ? <Badge>Admin</Badge> : <span className="text-muted-foreground">user</span>),
    },
    {
      key: 'createdAt',
      header: 'Joined',
      render: (r) => new Date(r.createdAt).toLocaleDateString(),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">People</h1>
      <Input
        type="search"
        placeholder="Search by name…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-sm"
      />
      <DataTable<UserRow>
        rows={data?.users ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        onRowClick={(r) => setSelectedId(r.id)}
      />
      <PeopleDetail userId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
