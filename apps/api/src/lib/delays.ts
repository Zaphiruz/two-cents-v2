/**
 * delays.ts — port of v1 delays.py
 *
 * Lookup table: (price_band, seriousness) → delay duration in milliseconds.
 * Bands: 0=<$25, 1=$25-$99.99, 2=$100-$299.99, 3=$300-$999.99, 4>=$1000
 * (price in cents: 0=<2500, 1=2500-9999, 2=10000-29999, 3=30000-99999, 4>=100000)
 */

export type Seriousness = 'need' | 'really_want' | 'nice_to_have';

/** Duration in milliseconds */
type Ms = number;

const HOUR_MS = 60 * 60 * 1000;
export const DAY_MS = 24 * HOUR_MS;

/** Table: [band][seriousness] → duration in ms */
const TABLE: Record<0 | 1 | 2 | 3 | 4, Record<Seriousness, Ms>> = {
  0: {
    need: 12 * HOUR_MS,
    really_want: 3 * DAY_MS,
    nice_to_have: 7 * DAY_MS,
  },
  1: {
    need: 12 * HOUR_MS,
    really_want: 7 * DAY_MS,
    nice_to_have: 14 * DAY_MS,
  },
  2: {
    need: 1 * DAY_MS,
    really_want: 14 * DAY_MS,
    nice_to_have: 30 * DAY_MS,
  },
  3: {
    need: 1 * DAY_MS,
    really_want: 21 * DAY_MS,
    nice_to_have: 60 * DAY_MS,
  },
  4: {
    need: 2 * DAY_MS,
    really_want: 30 * DAY_MS,
    nice_to_have: 90 * DAY_MS,
  },
};

const CEILING_MS = 90 * DAY_MS;
const MAX_OVERRIDE_MULTIPLIER = 2;

function band(priceCents: number): 0 | 1 | 2 | 3 | 4 {
  if (priceCents < 2500) return 0;
  if (priceCents < 10000) return 1;
  if (priceCents < 30000) return 2;
  if (priceCents < 100000) return 3;
  return 4;
}

/**
 * Returns the auto-delay duration in milliseconds for the given price and seriousness.
 */
export function autoDelay(priceCents: number, seriousness: Seriousness): Ms {
  const b = band(priceCents);
  return TABLE[b][seriousness];
}

/**
 * Returns the number of whole days for a given millisecond duration.
 * Matches v1's `timedelta.days` which truncates (not rounds).
 */
export function msToDelayDays(ms: Ms): number {
  return Math.floor(ms / DAY_MS);
}

/**
 * Clamp an override duration: cannot exceed 2× auto or 90 days.
 * If requested is negative, falls back to auto.
 */
export function clampOverride(autoMs: Ms, requestedMs: Ms): Ms {
  const upper = Math.min(autoMs * MAX_OVERRIDE_MULTIPLIER, CEILING_MS);
  if (requestedMs > upper) return upper;
  if (requestedMs < 0) return autoMs;
  return requestedMs;
}
