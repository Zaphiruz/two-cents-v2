const REL_UNITS: Array<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: 'year', seconds: 60 * 60 * 24 * 365 },
  { unit: 'month', seconds: 60 * 60 * 24 * 30 },
  { unit: 'week', seconds: 60 * 60 * 24 * 7 },
  { unit: 'day', seconds: 60 * 60 * 24 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
  { unit: 'second', seconds: 1 },
];

export function formatRelative(iso: string, now: Date = new Date()): string {
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

export function formatCurrency(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}
