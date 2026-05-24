import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { NewRequestInput } from '@two-cents/shared';
import { RequestForm } from '@/components/request/RequestForm';
import { useToast } from '@/components/ui/use-toast';
import { request, ApiError } from '@/lib/api';

interface CreateResponse {
  id: number;
}

export default function NewRequestPage() {
  const navigate = useNavigate();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (values: NewRequestInput) =>
      request<CreateResponse>('/api/requests', {
        method: 'POST',
        body: values,
      }),
    onSuccess: (data) => {
      toast({ title: 'Request created.' });
      navigate(`/requests/${data.id}`);
    },
    onError: (err: unknown) => {
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
        title: 'Could not create request',
        description,
        variant: 'destructive',
      });
    },
  });

  const handleSubmit = async (values: NewRequestInput) => {
    // Use mutate (not mutateAsync) so the error is handled by onError without
    // propagating an unhandled rejection out of the form submit handler.
    mutation.mutate(values);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">New request</h1>
      <RequestForm
        mode="new"
        onSubmit={handleSubmit}
        isSubmitting={mutation.isPending}
      />
    </div>
  );
}
