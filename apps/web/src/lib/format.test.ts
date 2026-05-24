import { describe, expect, it } from 'vitest';
import { formatCurrency, formatRelative } from './format';

describe('formatCurrency', () => {
  it('renders thousands separators for USD', () => {
    // 123456 cents = $1,234.56
    const out = formatCurrency(123456, 'USD');
    expect(out).toContain('1,234.56');
  });

  it('falls back gracefully for unknown currency codes', () => {
    const out = formatCurrency(100, 'XYZ');
    expect(out).toContain('1.00');
  });
});

describe('formatRelative', () => {
  it('returns a non-empty string for a recent timestamp', () => {
    const iso = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const out = formatRelative(iso);
    expect(typeof out).toBe('string');
    expect(out.length).toBeGreaterThan(0);
  });

  it("returns '' for an invalid iso", () => {
    expect(formatRelative('not-a-date')).toBe('');
  });
});
