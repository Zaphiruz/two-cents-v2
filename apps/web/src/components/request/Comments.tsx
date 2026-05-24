import * as React from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { CommentInputSchema } from '@two-cents/shared';
import { request, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';

export interface CommentItem {
  id: number;
  body: string;
  createdAt: string;
  author: { id: number; name: string };
}

interface CommentsProps {
  requestId: number;
  comments: CommentItem[];
}

const RELATIVE_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: 'year', seconds: 60 * 60 * 24 * 365 },
  { unit: 'month', seconds: 60 * 60 * 24 * 30 },
  { unit: 'week', seconds: 60 * 60 * 24 * 7 },
  { unit: 'day', seconds: 60 * 60 * 24 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
  { unit: 'second', seconds: 1 },
];

function formatRelative(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;
  const diffSeconds = Math.round((then - now.getTime()) / 1000);
  const abs = Math.abs(diffSeconds);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const { unit, seconds } of RELATIVE_UNITS) {
    if (abs >= seconds || unit === 'second') {
      const value = Math.round(diffSeconds / seconds);
      return rtf.format(value, unit);
    }
  }
  return rtf.format(0, 'second');
}

interface RequestCacheShape {
  comments?: CommentItem[];
  [k: string]: unknown;
}

export function Comments({ requestId, comments }: CommentsProps) {
  const [body, setBody] = React.useState('');
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const queryKey = React.useMemo(() => ['request', requestId] as const, [requestId]);

  const mutation = useMutation({
    mutationFn: async (input: { body: string }) => {
      return request<CommentItem>(`/api/requests/${requestId}/comments`, {
        method: 'POST',
        body: input,
      });
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<RequestCacheShape>(queryKey);
      if (previous) {
        const optimistic: CommentItem = {
          id: -Date.now(),
          body: input.body,
          createdAt: new Date().toISOString(),
          author: { id: 0, name: 'You' },
        };
        queryClient.setQueryData<RequestCacheShape>(queryKey, {
          ...previous,
          comments: [...(previous.comments ?? []), optimistic],
        });
      }
      return { previous };
    },
    onError: (error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKey, context.previous);
      }
      const message =
        error instanceof ApiError ? error.message : 'Failed to post comment';
      toast({ title: 'Comment failed', description: message, variant: 'destructive' });
    },
    onSuccess: () => {
      setBody('');
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const parsed = CommentInputSchema.safeParse({ body });
    if (!parsed.success) {
      toast({
        title: 'Invalid comment',
        description: parsed.error.issues[0]?.message ?? 'Please check the comment.',
        variant: 'destructive',
      });
      return;
    }
    mutation.mutate(parsed.data);
  };

  return (
    <section className="space-y-4" aria-label="Comments">
      <h2 className="text-lg font-semibold">Comments</h2>

      {comments.length === 0 ? (
        <p className="text-sm text-muted-foreground">No comments yet.</p>
      ) : (
        <ul className="space-y-4">
          {comments.map((c) => (
            <li key={c.id} className="space-y-1">
              <div className="flex items-baseline gap-2 text-sm">
                <span className="font-medium">{c.author.name}</span>
                <span className="text-xs text-muted-foreground">
                  {formatRelative(c.createdAt)}
                </span>
              </div>
              <p className="whitespace-pre-wrap text-sm">{c.body}</p>
            </li>
          ))}
        </ul>
      )}

      <Separator />

      <form onSubmit={handleSubmit} className="space-y-2">
        <Label htmlFor="comment-body">Add a comment</Label>
        <Textarea
          id="comment-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={10_000}
          rows={3}
          placeholder="Share your thoughts..."
          disabled={mutation.isPending}
        />
        <div className="flex justify-end">
          <Button type="submit" disabled={mutation.isPending || body.trim().length === 0}>
            {mutation.isPending ? 'Posting...' : 'Post comment'}
          </Button>
        </div>
      </form>
    </section>
  );
}

export default Comments;
