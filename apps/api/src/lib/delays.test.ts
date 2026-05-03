/**
 * delays.test.ts — mirrors v1's test_delays.py 1:1
 *
 * autoDelay: 16 cases (15 table + 1 invalid seriousness)
 * clampOverride: 3 cases
 * msToDelayDays: 3 cases
 * Total: 22
 */

import { describe, it, expect } from 'vitest';
import { autoDelay, clampOverride, msToDelayDays, DAY_MS, type Seriousness } from './delays';

const HOUR_MS = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// autoDelay — table parametrization (mirrors test_auto_delay_table)
// ---------------------------------------------------------------------------

describe('autoDelay — table', () => {
  it.each([
    // band 0: <$25 (price_cents < 2500)
    [1000, 'need',         12 * HOUR_MS],
    [1000, 'really_want',  3 * DAY_MS],
    [1000, 'nice_to_have', 7 * DAY_MS],
    // band 1: $25-$100 (2500 ≤ price_cents < 10000)
    [5000, 'need',          12 * HOUR_MS],
    [5000, 'really_want',   7 * DAY_MS],
    [5000, 'nice_to_have',  14 * DAY_MS],
    // band 2: $100-$300 (10000 ≤ price_cents < 30000)
    [15000, 'need',          1 * DAY_MS],
    [15000, 'really_want',   14 * DAY_MS],
    [15000, 'nice_to_have',  30 * DAY_MS],
    // band 3: $300-$1000 (30000 ≤ price_cents < 100000)
    [50000, 'need',          1 * DAY_MS],
    [50000, 'really_want',   21 * DAY_MS],
    [50000, 'nice_to_have',  60 * DAY_MS],
    // band 4: $1000+ (price_cents >= 100000)
    [100000, 'need',          2 * DAY_MS],
    [100000, 'really_want',   30 * DAY_MS],
    [100000, 'nice_to_have',  90 * DAY_MS],
  ] as [number, Seriousness, number][])(
    'autoDelay(%i, %s) === %i ms',
    (priceCents, seriousness, expectedMs) => {
      expect(autoDelay(priceCents, seriousness)).toBe(expectedMs);
    },
  );
});

// ---------------------------------------------------------------------------
// autoDelay — invalid seriousness (mirrors test_auto_delay_invalid_seriousness)
//
// v1 raises ValueError; our TS implementation has no runtime guard (TS
// enforces the union at compile time). At runtime the table lookup returns
// undefined for an unrecognised key, so we assert that here.
// ---------------------------------------------------------------------------

describe('autoDelay — invalid seriousness', () => {
  it('returns undefined for an unknown seriousness string', () => {
    // Cast through unknown to bypass the compile-time union check.
    const result = autoDelay(1000, 'whatever' as unknown as Seriousness);
    expect(result).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// clampOverride (mirrors v1's three test_clamp_override_* tests)
// ---------------------------------------------------------------------------

describe('clampOverride', () => {
  it('caps at 2× auto when requested exceeds it', () => {
    // auto = 7 days; 2× = 14 days; requested = 20 days → clamped to 14 days
    const autoMs = 7 * DAY_MS;
    const requestedMs = 20 * DAY_MS;
    expect(clampOverride(autoMs, requestedMs)).toBe(14 * DAY_MS);
  });

  it('caps at 90-day ceiling when 2× auto exceeds 90 days', () => {
    // auto = 60 days; 2× = 120 days > ceiling 90; requested = 120 days → clamped to 90 days
    const autoMs = 60 * DAY_MS;
    const requestedMs = 120 * DAY_MS;
    expect(clampOverride(autoMs, requestedMs)).toBe(90 * DAY_MS);
  });

  it('passes through a request within the 2× auto range', () => {
    // auto = 7 days; 2× = 14 days; requested = 10 days → unchanged
    const autoMs = 7 * DAY_MS;
    const requestedMs = 10 * DAY_MS;
    expect(clampOverride(autoMs, requestedMs)).toBe(10 * DAY_MS);
  });
});

// ---------------------------------------------------------------------------
// msToDelayDays — boundary cases (not in v1; added per task 1.2 spec)
// ---------------------------------------------------------------------------

describe('msToDelayDays', () => {
  it('returns 0 for 0 ms', () => {
    expect(msToDelayDays(0)).toBe(0);
  });

  it('returns 1 for exactly one day', () => {
    expect(msToDelayDays(DAY_MS)).toBe(1);
  });

  it('returns 0 for one millisecond less than a full day (truncates, not rounds)', () => {
    expect(msToDelayDays(DAY_MS - 1)).toBe(0);
  });
});
