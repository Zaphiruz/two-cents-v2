import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FeedbackInputSchema, type FeedbackInput } from '@two-cents/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/use-toast';
import { request, ApiError } from '@/lib/api';

export default function NewFeedbackPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('');
  const [body, setBody] = useState('');

  const mutation = useMutation({
    mutationFn: (values: FeedbackInput) =>
      request('/api/feedback', { method: 'POST', body: values }),
    onSuccess: async () => {
      toast({ title: 'Feedback submitted.' });
      await queryClient.invalidateQueries({ queryKey: ['feedback', 'list'] });
      navigate('/feedback');
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError) {
        const body = err.body as
          | { message?: unknown; error?: unknown; resetInSeconds?: unknown }
          | null;
        if (err.status === 429) {
          const seconds =
            body && typeof body.resetInSeconds === 'number'
              ? body.resetInSeconds
              : 60;
          toast({
            title: 'Slow down',
            description: `Hold on — you can submit again in ${seconds} seconds.`,
            variant: 'destructive',
          });
          return;
        }
        const description =
          body && typeof body.message === 'string' ? body.message : err.message;
        toast({
          title: 'Could not submit feedback',
          description,
          variant: 'destructive',
        });
        return;
      }
      const description = err instanceof Error ? err.message : 'Something went wrong';
      toast({
        title: 'Could not submit feedback',
        description,
        variant: 'destructive',
      });
    },
  });

  const trimmedTitle = title.trim();
  const trimmedBody = body.trim();
  const disabled =
    mutation.isPending || trimmedTitle.length === 0 || trimmedBody.length === 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (disabled) return;
    const payload: FeedbackInput = {
      title: trimmedTitle,
      body: trimmedBody,
      ...(category.trim() ? { category: category.trim() } : {}),
    };
    const parsed = FeedbackInputSchema.safeParse(payload);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      toast({
        title: 'Invalid feedback',
        description: issue?.message ?? 'Check your input',
        variant: 'destructive',
      });
      return;
    }
    mutation.mutate(parsed.data);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Submit feedback</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="feedback-title">Title</Label>
          <Input
            id="feedback-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="feedback-category">Category</Label>
          <Input
            id="feedback-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            maxLength={50}
            placeholder="bug, feature, question, etc."
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="feedback-body">Body</Label>
          <Textarea
            id="feedback-body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={10_000}
            rows={8}
            required
          />
        </div>
        <div className="flex justify-end">
          <Button type="submit" disabled={disabled}>
            {mutation.isPending ? 'Submitting…' : 'Submit'}
          </Button>
        </div>
      </form>
    </div>
  );
}
