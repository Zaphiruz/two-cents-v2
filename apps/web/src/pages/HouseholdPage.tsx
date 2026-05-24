import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HouseholdInviteInputSchema } from '@two-cents/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { ApiError, request } from '@/lib/api';
import { formatRelative } from '@/lib/format';

type ApprovalMode = 'any' | 'all' | string;

interface MemberUser {
  id: number;
  name: string;
}

interface HouseholdMember {
  id: number;
  approvalMode: ApprovalMode;
  joinedAt: string;
  user: MemberUser;
}

interface Household {
  id: number;
  name: string;
  appealQuotaCount: number;
  appealQuotaPeriod: string;
  members: HouseholdMember[];
}

interface HouseholdResponse {
  household: Household | null;
  myApprovers?: HouseholdMember[];
  myBuyers?: HouseholdMember[];
}

function MemberLine({ m }: { m: HouseholdMember }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="truncate text-sm font-medium">{m.user.name}</span>
      <Badge variant="outline" className="shrink-0 text-xs">
        {m.approvalMode}
      </Badge>
    </li>
  );
}

export default function HouseholdPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [username, setUsername] = useState('');

  const query = useQuery<HouseholdResponse>({
    queryKey: ['household'],
    queryFn: () => request<HouseholdResponse>('/api/household'),
  });

  const inviteMutation = useMutation({
    mutationFn: (authentikUsername: string) =>
      request<{ pending: unknown }>('/api/household/invite', {
        method: 'POST',
        body: { authentikUsername },
      }),
    onSuccess: () => {
      toast({ title: 'Invite sent.' });
      setUsername('');
      void queryClient.invalidateQueries({ queryKey: ['household'] });
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        toast({
          title: 'That username already has a pending invite.',
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
        title: 'Could not send invite',
        description,
        variant: 'destructive',
      });
    },
  });

  if (query.isLoading) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading&hellip;</div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex flex-col items-center gap-3 p-12 text-center">
        <p className="text-sm text-muted-foreground">
          Couldn&rsquo;t load household.
        </p>
        <Button onClick={() => query.refetch()} variant="outline">
          Retry
        </Button>
      </div>
    );
  }

  const data = query.data;
  if (!data || data.household === null) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 p-6">
        <h1 className="text-2xl font-semibold">Household</h1>
        <p className="text-sm text-muted-foreground">
          You&rsquo;re not part of a household yet. Ask an existing member to
          invite you (by your Authentik username).
        </p>
      </div>
    );
  }

  const household = data.household;
  const myApprovers = data.myApprovers ?? [];
  const myBuyers = data.myBuyers ?? [];

  const handleInvite = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = username.trim();
    const parsed = HouseholdInviteInputSchema.safeParse({
      authentikUsername: trimmed,
    });
    if (!parsed.success) {
      toast({
        title: 'Enter an Authentik username.',
        variant: 'destructive',
      });
      return;
    }
    inviteMutation.mutate(parsed.data.authentikUsername);
  };

  return (
    <div className="space-y-6 p-6">
      <h1 className="text-2xl font-semibold">Household</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2 className="text-xl font-semibold">{household.name}</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm text-muted-foreground">
              {household.members.length} member
              {household.members.length === 1 ? '' : 's'}
              {' · '}
              Appeal quota: {household.appealQuotaCount} per{' '}
              {household.appealQuotaPeriod}
            </div>
            <Separator />
            <ul className="divide-y">
              {household.members.map((m) => (
                <li
                  key={m.id}
                  className="flex items-center justify-between gap-3 py-2"
                >
                  <span className="truncate text-sm font-medium">
                    {m.user.name}
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    Joined {formatRelative(m.joinedAt)}
                  </span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>My approvers</CardTitle>
          </CardHeader>
          <CardContent>
            {myApprovers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No approvers configured yet.
              </p>
            ) : (
              <ul className="divide-y">
                {myApprovers.map((m) => (
                  <MemberLine key={m.id} m={m} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>My buyers</CardTitle>
          </CardHeader>
          <CardContent>
            {myBuyers.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nobody routes requests through you.
              </p>
            ) : (
              <ul className="divide-y">
                {myBuyers.map((m) => (
                  <MemberLine key={m.id} m={m} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Invite a member</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleInvite} className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="authentikUsername">Authentik username</Label>
                <Input
                  id="authentikUsername"
                  name="authentikUsername"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="off"
                />
              </div>
              <Button type="submit" disabled={inviteMutation.isPending}>
                Invite
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
