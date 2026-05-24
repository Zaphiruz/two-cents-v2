import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/lib/api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import DetailDrawer from './components/DetailDrawer';
import BuyerApproverMatrix from './BuyerApproverMatrix';

interface DetailResponse {
  household: {
    id: number;
    name: string;
    appealQuotaCount: number;
    appealQuotaPeriod: 'monthly' | 'quarterly';
  };
  members: Array<{
    id: number;
    userId: number;
    userName: string;
    approvalMode: 'any' | 'all';
    joinedAt: string;
  }>;
  buyerApprovers: Array<{ id: number; buyerId: number; approverId: number }>;
}

interface UnassignedResponse {
  users: Array<{ id: number; name: string }>;
}

export default function HouseholdDetail({
  householdId,
  onClose,
}: {
  householdId: number | null;
  onClose: () => void;
}) {
  const open = householdId !== null;
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['admin', 'households', householdId, 'detail'],
    queryFn: () => request<DetailResponse>(`/api/admin/households/${householdId}/detail`),
    enabled: open,
  });

  const { data: unassigned } = useQuery({
    queryKey: ['admin', 'users', 'unassigned'],
    queryFn: () => request<UnassignedResponse>('/api/admin/users/unassigned'),
    enabled: open,
  });

  const [name, setName] = useState('');
  const [quotaCount, setQuotaCount] = useState(0);
  const [quotaPeriod, setQuotaPeriod] = useState<'monthly' | 'quarterly'>('monthly');

  useEffect(() => {
    if (data?.household) {
      setName(data.household.name);
      setQuotaCount(data.household.appealQuotaCount);
      setQuotaPeriod(data.household.appealQuotaPeriod);
    }
  }, [data?.household]);

  const saveMutation = useMutation({
    mutationFn: () =>
      request(`/api/admin/households/${householdId}`, {
        method: 'PATCH',
        body: { name, appealQuotaCount: quotaCount, appealQuotaPeriod: quotaPeriod },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'households'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'households', householdId, 'detail'] });
    },
  });

  const addMember = useMutation({
    mutationFn: (vars: { userId: number; approvalMode: 'any' | 'all' }) =>
      request(`/api/admin/households/${householdId}/members`, {
        method: 'POST',
        body: vars,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'households', householdId, 'detail'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', 'unassigned'] });
    },
  });

  const updateMember = useMutation({
    mutationFn: (vars: { memberId: number; approvalMode: 'any' | 'all' }) =>
      request(`/api/admin/household-members/${vars.memberId}`, {
        method: 'PATCH',
        body: { approvalMode: vars.approvalMode },
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['admin', 'households', householdId, 'detail'],
      }),
  });

  const removeMember = useMutation({
    mutationFn: (memberId: number) =>
      request(`/api/admin/household-members/${memberId}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'households', householdId, 'detail'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', 'unassigned'] });
    },
  });

  const [newUserId, setNewUserId] = useState<string>('');
  const [newApprovalMode, setNewApprovalMode] = useState<'any' | 'all'>('any');

  return (
    <DetailDrawer open={open} onClose={onClose} title={data?.household.name ?? 'Household'}>
      {!data ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-6 text-sm">
          <section className="space-y-2">
            <div>
              <label className="mb-1 block text-xs uppercase text-muted-foreground">Name</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs uppercase text-muted-foreground">
                  Appeal quota count
                </label>
                <Input
                  type="number"
                  value={quotaCount}
                  onChange={(e) => setQuotaCount(Number(e.target.value))}
                />
              </div>
              <div className="flex-1">
                <label className="mb-1 block text-xs uppercase text-muted-foreground">Period</label>
                <Select value={quotaPeriod} onValueChange={(v) => setQuotaPeriod(v as 'monthly' | 'quarterly')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">monthly</SelectItem>
                    <SelectItem value="quarterly">quarterly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </Button>
          </section>

          <section>
            <h3 className="mb-2 font-medium">Members</h3>
            <table className="w-full text-xs">
              <thead><tr>
                <th className="p-1 text-left text-muted-foreground">Name</th>
                <th className="p-1 text-left text-muted-foreground">Approval mode</th>
                <th className="p-1"></th>
              </tr></thead>
              <tbody>
                {data.members.map((m) => (
                  <tr key={m.id} className="border-t border-border">
                    <td className="p-1">{m.userName}</td>
                    <td className="p-1">
                      <Select
                        value={m.approvalMode}
                        onValueChange={(v) =>
                          updateMember.mutate({ memberId: m.id, approvalMode: v as 'any' | 'all' })
                        }
                      >
                        <SelectTrigger className="h-7 w-24"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="any">any</SelectItem>
                          <SelectItem value="all">all</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="p-1">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => removeMember.mutate(m.id)}
                      >
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="mt-2 flex items-end gap-2">
              <div className="flex-1">
                <label className="mb-1 block text-xs uppercase text-muted-foreground">
                  Add member
                </label>
                <Select value={newUserId} onValueChange={setNewUserId}>
                  <SelectTrigger><SelectValue placeholder="Pick a user…" /></SelectTrigger>
                  <SelectContent>
                    {(unassigned?.users ?? []).map((u) => (
                      <SelectItem key={u.id} value={String(u.id)}>{u.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="w-28">
                <label className="mb-1 block text-xs uppercase text-muted-foreground">Mode</label>
                <Select value={newApprovalMode} onValueChange={(v) => setNewApprovalMode(v as 'any' | 'all')}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">any</SelectItem>
                    <SelectItem value="all">all</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button
                disabled={!newUserId || addMember.isPending}
                onClick={() => {
                  addMember.mutate({ userId: Number(newUserId), approvalMode: newApprovalMode });
                  setNewUserId('');
                }}
              >
                Add
              </Button>
            </div>
          </section>

          <section>
            <h3 className="mb-2 font-medium">Buyer → Approver matrix</h3>
            <BuyerApproverMatrix
              householdId={data.household.id}
              members={data.members}
              pairs={data.buyerApprovers}
            />
          </section>
        </div>
      )}
    </DetailDrawer>
  );
}
