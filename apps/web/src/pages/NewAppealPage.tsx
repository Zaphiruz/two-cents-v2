import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileAppealInputSchema } from '@two-cents/shared';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { ApiError, request } from '@/lib/api';

interface ContextResponse {
  request: {
    id: number;
    title: string;
    status: string;
    reviews: Array<{
      id: number;
      action: 'approve' | 'delay' | 'deny';
      notes?: string | null;
      approver: { id: number; user: { id: number; name: string } };
    }>;
  };
}

const MAX_JUST = 10_000;

export default function NewAppealPage() {
  const { requestId: requestIdParam } = useParams<{ requestId: string }>();
  const requestId = Number(requestIdParam);
  const idValid = Number.isFinite(requestId) && requestId > 0;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [justification, setJustification] = useState('');
  const [error, setError] = useState<string | null>(null);

  const ctxQuery = useQuery<ContextResponse, ApiError>({
    queryKey: ['request', requestId],
    queryFn: () => request<ContextResponse>(`/api/requests/${requestId}`),
    enabled: idValid,
    retry: false,
  });

  const mutation = useMutation({
    mutationFn: (body: { requestId: number; justification: string }) =>
      request('/api/appeals', { method: 'POST', body }),
    onSuccess: () => {
      toast({ title: 'Appeal filed.' });
      void queryClient.invalidateQueries({ queryKey: ['request', requestId] });
      void queryClient.invalidateQueries({ queryKey: ['requests', 'queue'] });
      navigate(`/requests/${requestId}`);
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 422) {
        toast({
          title: 'Quota exceeded',
          description: "You've used all your appeals for this period.",
          variant: 'destructive',
        });
        return;
      }
      if (err instanceof ApiError && err.status === 409) {
        toast({
          title: 'Not appealable',
          description: "This request can't be appealed.",
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
        title: 'Could not file appeal',
        description,
        variant: 'destructive',
      });
    },
  });

  if (!idValid) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Invalid request id.</div>
    );
  }

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const parsed = FileAppealInputSchema.safeParse({
      requestId,
      justification,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      setError(first?.message ?? 'Invalid input');
      return;
    }
    mutation.mutate(parsed.data);
  };

  const ctx = ctxQuery.data?.request;
  const denyReview = ctx?.reviews.find((r) => r.action === 'deny');

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">File appeal</h1>

      {ctx ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{ctx.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {denyReview ? (
              <div className="text-sm">
                <div className="font-medium">
                  Denied by {denyReview.approver.user.name}
                </div>
                {denyReview.notes ? (
                  <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">
                    {denyReview.notes}
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No denial notes.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="justification">Justification</Label>
          <Textarea
            id="justification"
            value={justification}
            onChange={(e) => setJustification(e.target.value)}
            maxLength={MAX_JUST}
            rows={6}
            required
            disabled={mutation.isPending}
          />
          {error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {justification.length} / {MAX_JUST}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Filing…' : 'File appeal'}
          </Button>
          <Link to={`/requests/${requestId}`}>
            <Button type="button" variant="outline" disabled={mutation.isPending}>
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
