import { useState } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ApproverActionInputSchema,
  type ApproverActionInput,
  SERIOUSNESS,
  type ApproverAction as ApproverActionType,
} from '@two-cents/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/ui/use-toast';
import { request, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';

interface ApproverActionProps {
  requestId: number;
  onActed?: () => void;
}

interface ActResponse {
  id: number;
  status: string;
  statusExpiresAt: string | null;
}

const SERIOUSNESS_LABELS: Record<(typeof SERIOUSNESS)[number], string> = {
  need: 'Need',
  really_want: 'Really want',
  nice_to_have: 'Nice to have',
};

// react-hook-form needs a defined default for the action field even though
// the user picks it by clicking a button. We treat 'approve' as the initial
// placeholder; whichever button is clicked overwrites it before submit.
type FormValues = ApproverActionInput;

export function ApproverAction({ requestId, onActed }: ApproverActionProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [pendingAction, setPendingAction] = useState<ApproverActionType | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(ApproverActionInputSchema),
    defaultValues: {
      action: 'approve',
      approverSeriousness: 'really_want',
      delayOverrideDays: undefined,
      notes: '',
    },
  });

  const {
    control,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = form;

  const watchedAction = watch('action');
  const watchedDelayDays = watch('delayOverrideDays');

  const mutation = useMutation({
    mutationFn: async (values: FormValues) => {
      // Strip empty notes and ensure delayOverrideDays only sent when relevant.
      const body: ApproverActionInput = {
        action: values.action,
        approverSeriousness: values.approverSeriousness,
        notes: values.notes?.trim() ?? '',
        ...(values.action === 'delay' && values.delayOverrideDays
          ? { delayOverrideDays: values.delayOverrideDays }
          : {}),
      };
      return request<ActResponse>(`/api/requests/${requestId}/act`, {
        method: 'POST',
        body,
      });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['request', requestId] });
      onActed?.();
    },
    onError: (err: unknown) => {
      if (err instanceof ApiError && err.status === 409) {
        toast({
          title: 'Cannot act on this request',
          description: 'This request can no longer be acted on.',
          variant: 'destructive',
        });
        return;
      }
      const description =
        err instanceof Error ? err.message : 'Something went wrong';
      toast({
        title: 'Action failed',
        description,
        variant: 'destructive',
      });
    },
    onSettled: () => {
      setPendingAction(null);
    },
  });

  const submitWith = (action: ApproverActionType) => {
    setPendingAction(action);
    setValue('action', action, { shouldValidate: false });
    void handleSubmit(
      (values) => {
        mutation.mutate({ ...values, action });
      },
      () => {
        // validation failed — clear pending state so buttons re-enable
        setPendingAction(null);
      },
    )();
  };

  const isPending = mutation.isPending;
  const delayEnabled = watchedAction === 'delay' || pendingAction === 'delay';

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        // Prevent default form submit (e.g., Enter key); user must click a button.
        e.preventDefault();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="approverSeriousness">Your seriousness</Label>
        <Controller
          control={control}
          name="approverSeriousness"
          render={({ field }) => (
            <Select value={field.value} onValueChange={field.onChange}>
              <SelectTrigger id="approverSeriousness" aria-label="Your seriousness">
                <SelectValue placeholder="Select seriousness" />
              </SelectTrigger>
              <SelectContent>
                {SERIOUSNESS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SERIOUSNESS_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        {errors.approverSeriousness && (
          <p className="text-sm text-destructive">
            {errors.approverSeriousness.message}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="delayOverrideDays">Delay override (days)</Label>
        <Controller
          control={control}
          name="delayOverrideDays"
          render={({ field }) => (
            <Input
              id="delayOverrideDays"
              type="number"
              min={1}
              step={1}
              disabled={!delayEnabled}
              value={field.value ?? ''}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  field.onChange(undefined);
                  return;
                }
                const n = Number.parseInt(raw, 10);
                field.onChange(Number.isFinite(n) ? n : undefined);
              }}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          )}
        />
        {delayEnabled && watchedDelayDays && watchedDelayDays > 0 ? (
          <p className={cn('text-xs text-muted-foreground')}>
            Delays this request for {watchedDelayDays} day
            {watchedDelayDays === 1 ? '' : 's'}.
          </p>
        ) : null}
        {errors.delayOverrideDays && (
          <p className="text-sm text-destructive">
            {errors.delayOverrideDays.message}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="notes">Notes (optional)</Label>
        <Controller
          control={control}
          name="notes"
          render={({ field }) => (
            <Textarea
              id="notes"
              rows={3}
              value={field.value ?? ''}
              onChange={field.onChange}
              onBlur={field.onBlur}
              name={field.name}
              ref={field.ref}
            />
          )}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="default"
          disabled={isPending}
          onClick={() => submitWith('approve')}
        >
          Approve
        </Button>
        <Button
          type="button"
          variant="secondary"
          disabled={isPending}
          onClick={() => submitWith('delay')}
        >
          Delay
        </Button>
        <Button
          type="button"
          variant="destructive"
          disabled={isPending}
          onClick={() => submitWith('deny')}
        >
          Deny
        </Button>
      </div>
    </form>
  );
}

export default ApproverAction;
