import { useMutation, useQueryClient } from '@tanstack/react-query';
import { request } from '@/lib/api';

interface Member {
  id: number;
  userName: string;
}

interface BA {
  id: number;
  buyerId: number;
  approverId: number;
}

interface Props {
  householdId: number;
  members: Member[];
  pairs: BA[];
}

export default function BuyerApproverMatrix({ householdId, members, pairs }: Props) {
  const queryClient = useQueryClient();
  const pairsByKey = new Map<string, BA>(pairs.map((p) => [`${p.buyerId}-${p.approverId}`, p]));

  const add = useMutation({
    mutationFn: (vars: { buyerId: number; approverId: number }) =>
      request('/api/admin/buyer-approvers', { method: 'PUT', body: vars }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['admin', 'households', householdId, 'detail'],
      }),
  });

  const remove = useMutation({
    mutationFn: (id: number) =>
      request(`/api/admin/buyer-approvers/${id}`, { method: 'DELETE' }),
    onSuccess: () =>
      queryClient.invalidateQueries({
        queryKey: ['admin', 'households', householdId, 'detail'],
      }),
  });

  function toggle(buyer: Member, approver: Member, existing: BA | undefined) {
    if (existing) remove.mutate(existing.id);
    else add.mutate({ buyerId: buyer.id, approverId: approver.id });
  }

  if (members.length === 0) {
    return <div className="text-sm text-muted-foreground">Add members first.</div>;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr>
            <th className="p-1 text-left text-muted-foreground">buyer ↓ / approver →</th>
            {members.map((m) => (
              <th key={m.id} className="p-1 text-left text-muted-foreground">
                {m.userName}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((buyer) => (
            <tr key={buyer.id} className="border-t border-border">
              <td className="p-1 font-medium">{buyer.userName}</td>
              {members.map((approver) => {
                const key = `${buyer.id}-${approver.id}`;
                const existing = pairsByKey.get(key);
                const isSelf = buyer.id === approver.id;
                return (
                  <td key={approver.id} className="p-1">
                    <input
                      type="checkbox"
                      disabled={isSelf}
                      checked={!!existing}
                      onChange={() => toggle(buyer, approver, existing)}
                      aria-label={`${buyer.userName}→${approver.userName}`}
                    />
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
