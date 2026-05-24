import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { NewRequestInput } from '@two-cents/shared';
import { RequestForm } from '@/components/request/RequestForm';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/use-toast';
import { request, ApiError } from '@/lib/api';

interface RequestItem {
  id: number;
  title: string;
  url: string;
  priceCents: number;
  notes: string | null;
}

interface RequestDetail {
  id: number;
  title: string;
  description: string;
  buyerSeriousness: NewRequestInput['buyerSeriousness'];
  currency: string;
  items: RequestItem[];
}

interface RequestDetailResponse {
  request: RequestDetail;
}

interface EditResponse {
  requestId: number;
  wasMeaningful: boolean;
}

export default function EditRequestPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const query = useQuery({
    queryKey: ['request', id],
    queryFn: () => request<RequestDetailResponse>(`/api/requests/${id}`),
    enabled: !!id,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: (values: NewRequestInput) =>
      request<EditResponse>(`/api/requests/${id}`, {
        method: 'PATCH',
        body: {
          bundleChanges: {
            title: values.title,
            description: values.description,
            buyerSeriousness: values.buyerSeriousness,
          },
          itemsPayload: values.items,
        },
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['request', id] });
      queryClient.invalidateQueries({ queryKey: ['requests', 'queue'] });
      toast({ title: 'Changes saved.' });
      navigate(`/requests/${id}`);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        toast({
          title: 'This request can no longer be edited.',
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
        title: 'Could not save changes',
        description,
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = async (values: NewRequestInput) => {
    mutation.mutate(values);
  };

  if (query.isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  if (query.isError) {
    const err = query.error;
    if (err instanceof ApiError && err.status === 404) {
      return (
        <div className="mx-auto max-w-2xl space-y-4 p-6">
          <p className="text-sm text-muted-foreground">Request not found.</p>
          <Link to="/queue" className="text-sm underline">
            Back to queue
          </Link>
        </div>
      );
    }
    if (err instanceof ApiError && err.status === 403) {
      return (
        <div className="mx-auto max-w-2xl space-y-4 p-6">
          <p className="text-sm text-muted-foreground">
            You don&apos;t have access to this request.
          </p>
          <Link to="/queue" className="text-sm underline">
            Back to queue
          </Link>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        <p className="text-sm text-destructive">
          Could not load this request.
        </p>
        <Button onClick={() => query.refetch()}>Retry</Button>
      </div>
    );
  }

  const data = query.data;
  if (!data) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  const req = data.request;
  const defaultValues: Partial<NewRequestInput> = {
    title: req.title,
    description: req.description,
    buyerSeriousness: req.buyerSeriousness,
    currency: req.currency,
    items: req.items.map((it) => ({
      id: it.id,
      title: it.title,
      url: it.url,
      priceCents: it.priceCents,
      notes: it.notes ?? '',
      imageKey: '',
    })),
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Edit request</h1>
      <RequestForm
        mode="edit"
        defaultValues={defaultValues}
        onSubmit={handleSubmit}
        isSubmitting={mutation.isPending}
      />
    </div>
  );
}
