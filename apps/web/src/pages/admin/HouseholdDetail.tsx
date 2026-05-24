import { useQuery } from '@tanstack/react-query';
import { request } from '@/lib/api';
import DetailDrawer from './components/DetailDrawer';

export default function HouseholdDetail({
  householdId,
  onClose,
}: {
  householdId: number | null;
  onClose: () => void;
}) {
  const open = householdId !== null;

  useQuery({
    queryKey: ['admin', 'households', householdId, 'detail'],
    queryFn: () => request(`/api/admin/households/${householdId}/detail`),
    enabled: open,
  });

  return (
    <DetailDrawer open={open} onClose={onClose} title="Household (stub)">
      <div>Detail UI added in next task.</div>
    </DetailDrawer>
  );
}
