import { Badge } from '@/components/ui/badge';

export type RequestStatus =
  | 'pending'
  | 'delayed'
  | 'awaiting_reconfirm'
  | 'approved'
  | 'denied'
  | 'cancelled'
  | 'archived'
  | 'purchased';

const LABEL: Record<RequestStatus, string> = {
  pending: 'Pending',
  delayed: 'Delayed',
  awaiting_reconfirm: 'Awaiting reconfirm',
  approved: 'Approved',
  denied: 'Denied',
  cancelled: 'Cancelled',
  archived: 'Archived',
  purchased: 'Purchased',
};

export const STATUS_LABEL = LABEL;

export function StatusBadge({ status }: { status: RequestStatus }) {
  const label = LABEL[status] ?? status;
  if (status === 'pending') return <Badge variant="default">{label}</Badge>;
  if (status === 'delayed' || status === 'awaiting_reconfirm')
    return <Badge variant="secondary">{label}</Badge>;
  if (status === 'approved')
    return <Badge className="bg-green-600 text-white">{label}</Badge>;
  if (status === 'denied') return <Badge variant="destructive">{label}</Badge>;
  return <Badge variant="outline">{label}</Badge>;
}
