import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { request } from '@/lib/api';
import DataTable, { type Column } from './components/DataTable';

interface SubmissionRow {
  id: number;
  category: string;
  githubIssueNumber: number | null;
  githubIssueUrl: string;
  createdAt: string;
  userId: number;
  userName: string;
}

interface ListResponse {
  submissions: SubmissionRow[];
  nextCursor: number | null;
}

export default function AdminFeedbackPage() {
  const [category, setCategory] = useState('');

  const params = new URLSearchParams();
  if (category) params.set('category', category);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'feedback', category],
    queryFn: () => request<ListResponse>(`/api/admin/feedback?${params.toString()}`),
  });

  const columns: Column<SubmissionRow>[] = [
    { key: 'user', header: 'User', render: (r) => r.userName },
    { key: 'category', header: 'Category', render: (r) => r.category || '—' },
    {
      key: 'ghIssue',
      header: 'GitHub issue',
      render: (r) =>
        r.githubIssueNumber !== null && r.githubIssueUrl
          ? (
            <a
              href={r.githubIssueUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
              onClick={(e) => e.stopPropagation()}
            >
              #{r.githubIssueNumber}
            </a>
          )
          : '—',
    },
    {
      key: 'createdAt',
      header: 'Filed',
      render: (r) => new Date(r.createdAt).toLocaleDateString(),
    },
  ];

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Feedback</h1>
      <div className="flex items-center gap-2">
        <label htmlFor="feedback-category" className="text-sm text-muted-foreground">
          Category
        </label>
        <select
          id="feedback-category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className="rounded border border-border bg-background px-2 py-1 text-sm"
        >
          <option value="">all</option>
          <option value="bug">bug</option>
          <option value="enhancement">enhancement</option>
          <option value="question">question</option>
        </select>
      </div>
      <DataTable<SubmissionRow>
        rows={data?.submissions ?? []}
        columns={columns}
        rowKey={(r) => r.id}
        isLoading={isLoading}
      />
    </div>
  );
}
