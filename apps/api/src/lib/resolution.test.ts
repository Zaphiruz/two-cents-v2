/**
 * resolution.test.ts — mirrors v1's test_resolution.py 1:1
 *
 * resolveAllMode: 4 cases
 *   1. all approve → "approved"
 *   2. one deny → "denied"
 *   3. one delay (no deny) → ["delayed", days]
 *   4. partial reviews (not all acted) → null
 *
 * This is a pure function test — no DB required.
 */

import { describe, it, expect } from 'vitest';
import { resolveAllMode, type ReviewInput } from './resolution';

// ---------------------------------------------------------------------------
// Helpers — construct minimal ReviewInput objects in memory
// ---------------------------------------------------------------------------

function approve(approverId: number, createdAt: Date = new Date()): ReviewInput {
  return { approverId, action: 'approve', delayDays: null, createdAt };
}

function deny(approverId: number, createdAt: Date = new Date()): ReviewInput {
  return { approverId, action: 'deny', delayDays: null, createdAt };
}

function delay(
  approverId: number,
  days: number,
  createdAt: Date = new Date(),
): ReviewInput {
  return { approverId, action: 'delay', delayDays: days, createdAt };
}

// Two approver IDs used across tests
const A1 = 1;
const A2 = 2;
const REQUIRED = new Set([A1, A2]);

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

describe('resolveAllMode', () => {
  it('returns "approved" when all approvers approve', () => {
    const reviews = [approve(A1), approve(A2)];
    expect(resolveAllMode(REQUIRED, reviews)).toBe('approved');
  });

  it('returns "denied" when any approver denies (deny dominates)', () => {
    const reviews = [approve(A1), deny(A2)];
    expect(resolveAllMode(REQUIRED, reviews)).toBe('denied');
  });

  it('returns ["delayed", longest_days] when any delay and no deny', () => {
    const reviews = [approve(A1), delay(A2, 7)];
    expect(resolveAllMode(REQUIRED, reviews)).toStrictEqual(['delayed', 7]);
  });

  it('returns null when not all required approvers have acted', () => {
    // Only A1 has reviewed; A2 has not
    const reviews = [approve(A1)];
    expect(resolveAllMode(REQUIRED, reviews)).toBeNull();
  });
});
