import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from '@/lib/api';
import DataTable, { type Column } from './components/DataTable';
import HouseholdDetail from './HouseholdDetail';

interface HouseholdRow {
  id: number;
  name: string;
  appealQuotaCount: number;
  appealQuotaPeriod: 'monthly' | 'quarterly';
  memberCount: number;
  createdAt: string;
}

interface ListResponse {
  households: HouseholdRow[];
}

export default function HouseholdsPage() {
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'households'],
    queryFn: () => request<ListResponse>('/api/admin/households'),
  });

  const columns: Column<HouseholdRow>[] = [
    { key: 'name', header: 'Name', render: (r) => r.name },
    { key: 'members', header: 'Members', render: (r) => r.memberCount },
    {
      key: 'quota',
      header: 'Appeal quota',
      render: (r) => `${r.appealQuotaCount} / ${r.appealQuotaPeriod}`,
    },
    {
      key: 'createdAt',
      header: 'Created',
      render: (r) => new Date(r.createdAt).toLocaleDateString(),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Households</h1>
      <DataTable<HouseholdRow>
        rows={data?.households ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        isLoading={isLoading}
        onRowClick={(r) => setSelectedId(r.id)}
      />
      <HouseholdDetail householdId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
