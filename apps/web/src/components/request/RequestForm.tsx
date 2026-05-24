import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  type NewRequestInput,
  SERIOUSNESS,
  type Seriousness,
} from '@two-cents/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

// ── Form-level schema ─────────────────────────────────────────────────────────
//
// The form stores price as a dollars *number* (e.g. 12.34); on submit we
// convert to integer cents before handing to the parent. Keeping a separate
// schema here lets RHF surface validation errors on the displayed value
// without us juggling cents in the inputs.

const FormItemSchema = z.object({
  id: z.number().int().positive().optional(),
  title: z.string().min(1, 'title is required'),
  url: z.string().url('url must be a valid URL'),
  priceDollars: z
    .number({ invalid_type_error: 'price must be a number' })
    .nonnegative('price must be non-negative'),
  notes: z.string().default(''),
});

const FormSchema = z.object({
  title: z.string().min(1, 'title is required'),
  description: z.string().default(''),
  buyerSeriousness: z.enum(SERIOUSNESS),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'currency must be a 3-letter ISO 4217 code'),
  items: z.array(FormItemSchema).min(1, 'at least one item is required'),
});

type FormValues = z.infer<typeof FormSchema>;
type FormItemValues = z.infer<typeof FormItemSchema>;

const SERIOUSNESS_LABELS: Record<Seriousness, string> = {
  need: 'Need',
  really_want: 'Really want',
  nice_to_have: 'Nice to have',
};

// Convert a Partial<NewRequestInput> (cents) into form values (dollars).
function defaultsFromInput(
  defaults: Partial<NewRequestInput> | undefined,
): FormValues {
  const items: FormItemValues[] =
    defaults?.items && defaults.items.length > 0
      ? defaults.items.map((it) => ({
          id: it.id,
          title: it.title ?? '',
          url: it.url ?? '',
          priceDollars: (it.priceCents ?? 0) / 100,
          notes: it.notes ?? '',
        }))
      : [
          {
            title: '',
            url: '',
            priceDollars: 0,
            notes: '',
          },
        ];

  return {
    title: defaults?.title ?? '',
    description: defaults?.description ?? '',
    buyerSeriousness: defaults?.buyerSeriousness ?? 'really_want',
    currency: defaults?.currency ?? 'USD',
    items,
  };
}

export interface RequestFormProps {
  mode: 'new' | 'edit';
  defaultValues?: Partial<NewRequestInput>;
  onSubmit: (values: NewRequestInput) => Promise<void>;
  submitLabel?: string;
  isSubmitting?: boolean;
}

export function RequestForm({
  mode,
  defaultValues,
  onSubmit,
  submitLabel,
  isSubmitting,
}: RequestFormProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: defaultsFromInput(defaultValues),
  });

  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = form;

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'items',
  });

  const watchedSeriousness = watch('buyerSeriousness');

  const finalSubmitLabel =
    submitLabel ?? (mode === 'edit' ? 'Save changes' : 'Create request');

  const submit = handleSubmit(async (values) => {
    const transformed: NewRequestInput = {
      title: values.title,
      description: values.description ?? '',
      buyerSeriousness: values.buyerSeriousness,
      currency: values.currency,
      items: values.items.map((it) => ({
        ...(it.id !== undefined ? { id: it.id } : {}),
        title: it.title,
        url: it.url,
        priceCents: Math.round(it.priceDollars * 100),
        notes: it.notes ?? '',
        imageKey: '',
      })),
    };
    await onSubmit(transformed);
  });

  return (
    <form className="space-y-6" onSubmit={submit} noValidate>
      {/* Title */}
      <div className="space-y-2">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          aria-invalid={errors.title ? 'true' : undefined}
          {...register('title')}
        />
        {errors.title && (
          <p className="text-sm text-destructive">{errors.title.message}</p>
        )}
      </div>

      {/* Description */}
      <div className="space-y-2">
        <Label htmlFor="description">Description</Label>
        <Textarea id="description" rows={3} {...register('description')} />
      </div>

      {/* Seriousness segmented control */}
      <div className="space-y-2">
        <Label>Buyer seriousness</Label>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Buyer seriousness">
          {SERIOUSNESS.map((s) => {
            const selected = watchedSeriousness === s;
            return (
              <Button
                key={s}
                type="button"
                variant={selected ? 'default' : 'outline'}
                aria-pressed={selected}
                onClick={() =>
                  setValue('buyerSeriousness', s, {
                    shouldDirty: true,
                    shouldValidate: true,
                  })
                }
              >
                {SERIOUSNESS_LABELS[s]}
              </Button>
            );
          })}
        </div>
        {errors.buyerSeriousness && (
          <p className="text-sm text-destructive">
            {errors.buyerSeriousness.message}
          </p>
        )}
      </div>

      {/* Currency */}
      <div className="space-y-2">
        <Label htmlFor="currency">Currency</Label>
        <Input
          id="currency"
          className="w-24 uppercase"
          maxLength={3}
          {...register('currency', {
            setValueAs: (v: string) => (v ?? '').toUpperCase(),
          })}
        />
        {errors.currency && (
          <p className="text-sm text-destructive">{errors.currency.message}</p>
        )}
      </div>

      {/* Items */}
      <div className="space-y-3">
        <Label>Items</Label>
        {fields.map((field, idx) => {
          const itemErrors = errors.items?.[idx];
          return (
            <div
              key={field.id}
              className="space-y-2 rounded-md border border-input p-3"
              data-testid={`item-row-${idx}`}
            >
              <div className="space-y-1">
                <Label htmlFor={`items.${idx}.title`}>Item title</Label>
                <Input
                  id={`items.${idx}.title`}
                  {...register(`items.${idx}.title` as const)}
                />
                {itemErrors?.title && (
                  <p className="text-sm text-destructive">
                    {itemErrors.title.message}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor={`items.${idx}.url`}>URL</Label>
                <Input
                  id={`items.${idx}.url`}
                  type="url"
                  {...register(`items.${idx}.url` as const)}
                />
                {itemErrors?.url && (
                  <p className="text-sm text-destructive">
                    {itemErrors.url.message}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor={`items.${idx}.price`}>Price</Label>
                <Controller
                  control={control}
                  name={`items.${idx}.priceDollars` as const}
                  render={({ field: priceField }) => (
                    <div className="relative">
                      <span
                        className={cn(
                          'pointer-events-none absolute inset-y-0 left-2 flex items-center text-sm text-muted-foreground',
                        )}
                        aria-hidden="true"
                      >
                        $
                      </span>
                      <Input
                        id={`items.${idx}.price`}
                        type="number"
                        inputMode="decimal"
                        step="0.01"
                        min="0"
                        className="pl-6"
                        value={
                          priceField.value === undefined ||
                          Number.isNaN(priceField.value as number)
                            ? ''
                            : String(priceField.value)
                        }
                        onChange={(e) => {
                          const raw = e.target.value;
                          if (raw === '') {
                            priceField.onChange(0);
                            return;
                          }
                          const n = Number.parseFloat(raw);
                          priceField.onChange(Number.isFinite(n) ? n : 0);
                        }}
                        onBlur={priceField.onBlur}
                        name={priceField.name}
                        ref={priceField.ref}
                      />
                    </div>
                  )}
                />
                {itemErrors?.priceDollars && (
                  <p className="text-sm text-destructive">
                    {itemErrors.priceDollars.message}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <Label htmlFor={`items.${idx}.notes`}>Notes</Label>
                <Textarea
                  id={`items.${idx}.notes`}
                  rows={2}
                  {...register(`items.${idx}.notes` as const)}
                />
              </div>

              <div className="flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={fields.length <= 1}
                  onClick={() => remove(idx)}
                  aria-label={`Remove item ${idx + 1}`}
                >
                  Remove
                </Button>
              </div>
            </div>
          );
        })}

        <Button
          type="button"
          variant="outline"
          onClick={() =>
            append({
              title: '',
              url: '',
              priceDollars: 0,
              notes: '',
            })
          }
        >
          Add item
        </Button>
      </div>

      <div className="flex justify-end">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : finalSubmitLabel}
        </Button>
      </div>
    </form>
  );
}

export default RequestForm;
