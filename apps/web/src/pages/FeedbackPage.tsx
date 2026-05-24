import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { request } from '@/lib/api';

interface FeedbackRow {
  id: number;
  githubIssueNumber: number | null;
  githubIssueUrl: string;
  category: string;
  createdAt: string;
  githubState: 'open' | 'closed' | 'unknown' | null;
  githubStateReason: string | null;
}

interface FeedbackListResponse {
  submissions: FeedbackRow[];
}

const REL_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
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
  if (Number.isNaN(then)) return '';
  const deltaSec = Math.round((then - now.getTime()) / 1000);
  const abs = Math.abs(deltaSec);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const { unit, seconds } of REL_UNITS) {
    if (abs >= seconds || unit === 'second') {
      const value = Math.round(deltaSec / seconds);
      return rtf.format(value, unit);
    }
  }
  return '';
}

function GitHubStateBadge({ row }: { row: FeedbackRow }) {
  if (row.githubState === null) {
    return <Badge variant="outline">Not tracked</Badge>;
  }
  if (row.githubState === 'unknown') {
    return <Badge variant="outline">Unknown</Badge>;
  }
  if (row.githubState === 'open') {
    return <Badge variant="secondary">Open</Badge>;
  }
  // closed
  if (row.githubStateReason === 'completed') {
    return <Badge className="bg-green-600 text-white">Completed</Badge>;
  }
  if (row.githubStateReason === 'not_planned') {
    return <Badge variant="outline">Not planned</Badge>;
  }
  return <Badge variant="outline">Closed</Badge>;
}

function FeedbackCard({ row }: { row: FeedbackRow }) {
  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-center gap-2">
            {row.category ? (
              <Badge variant="secondary">{row.category}</Badge>
            ) : null}
            <GitHubStateBadge row={row} />
          </div>
          <div className="text-xs text-muted-foreground">
            {formatRelative(row.createdAt)}
          </div>
        </div>
        {row.githubIssueUrl ? (
          <a
            href={row.githubIssueUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="shrink-0 text-sm font-medium text-primary hover:underline"
          >
            View on GitHub &rarr;
          </a>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function FeedbackPage() {
  const { toast } = useToast();
  const query = useQuery<FeedbackListResponse>({
    queryKey: ['feedback', 'list'],
    queryFn: () => request<FeedbackListResponse>('/api/feedback'),
  });

  useEffect(() => {
    if (query.isError) {
      toast({
        title: "Couldn't load feedback",
        variant: 'destructive',
      });
    }
  }, [query.isError, toast]);

  if (query.isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading&hellip;</div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-center gap-3 p-12 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&rsquo;t load feedback.
        </p>
        <Button onClick={() => query.refetch()} variant="outline">
          Retry
        </Button>
      </div>
    );
  }

  const submissions = query.data?.submissions ?? [];

  if (submissions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 p-16 text-center">
        <h1 className="text-2xl font-semibold">Feedback</h1>
        <p className="text-sm text-muted-foreground">
          No feedback submitted yet.
        </p>
        <Link to="/feedback/new">
          <Button>Submit feedback</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Feedback</h1>
        <Link to="/feedback/new">
          <Button>+ New feedback</Button>
        </Link>
      </div>
      <Separator />
      <div className="space-y-3">
        {submissions.map((row) => (
          <FeedbackCard key={row.id} row={row} />
        ))}
      </div>
    </div>
  );
}
