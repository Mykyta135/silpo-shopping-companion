import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  computeInflation,
  formatPercent,
  significantIncreases,
  type ReceiptLine,
} from './price-history.js';

/** Builds one order with the given lines. */
function order(createdAt: string, products: ReceiptLine[]) {
  return { createdAt, products };
}

/** Shorthand for a comparable line: paid `paid`, now costs `now`. */
function line(name: string, paid: number, now: number | null): ReceiptLine {
  return {
    name,
    price: paid,
    catalogProduct: now === null ? null : { price: now, id: `id-${name}` },
  };
}

describe('computeInflation', () => {
  it('splits items into increases and decreases, steepest first', () => {
    const result = computeInflation([
      order('2026-06-10T10:00:00', [
        line('Крупа перлова', 29.99, 38.99), // +30%
        line('Гриби', 58.49, 84.99), // +45%
        line('Перець', 18.49, 14.99), // −19%
      ]),
    ]);

    expect(result.increases.map((c) => c.title)).toEqual(['Гриби', 'Крупа перлова']);
    expect(result.decreases.map((c) => c.title)).toEqual(['Перець']);
    expect(result.increases[0].changePercent).toBeCloseTo(45.3, 1);
  });

  it('skips lines with no catalogue price instead of reporting −100%', () => {
    const result = computeInflation([
      order('2026-06-10T10:00:00', [
        line('Є в каталозі', 10, 12),
        line('Знято з продажу', 10, null),
      ]),
    ]);

    expect(result.comparedCount).toBe(1);
    expect(result.skippedCount).toBe(1);
    expect(result.increases).toHaveLength(1);
  });

  it('counts a repeat purchase once, using the most recent price paid', () => {
    const result = computeInflation([
      order('2026-05-23T10:00:00', [line('Цибуля', 10.99, 15.49)]),
      order('2026-06-07T10:00:00', [line('Цибуля', 15.49, 15.49)]),
    ]);

    expect(result.comparedCount).toBe(1);
    // The later purchase wins: paid 15.49, so no change today.
    expect(result.increases).toHaveLength(0);
    expect(result.decreases).toHaveLength(0);
  });

  it('weights the basket figure by spend, not by item count', () => {
    // A cheap item doubling must not outweigh an expensive item holding steady.
    const result = computeInflation([
      order('2026-06-10T10:00:00', [
        line('Дешеве', 10, 20), // +100% on 10 UAH
        line('Дороге', 990, 990), // unchanged on 990 UAH
      ]),
    ]);

    // Total 1000 → 1010, i.e. +1%, not the +50% a naive average would give.
    expect(result.overallPercent).toBeCloseTo(1, 1);
  });

  it('returns zeroes for an empty history rather than dividing by zero', () => {
    const result = computeInflation([]);
    expect(result.overallPercent).toBe(0);
    expect(result.comparedCount).toBe(0);
  });
});

describe('significantIncreases', () => {
  it('keeps only rises at or above the threshold', () => {
    const inflation = computeInflation([
      order('2026-06-10T10:00:00', [
        line('Сильно', 100, 130), // +30%
        line('Трохи', 100, 105), // +5%
      ]),
    ]);

    const flagged = significantIncreases(inflation, 15);
    expect(flagged.map((c) => c.title)).toEqual(['Сильно']);
  });
});

describe('formatPercent', () => {
  it('signs and rounds for display', () => {
    expect(formatPercent(45.32)).toBe('+45.3%');
    expect(formatPercent(-18.94)).toBe('-18.9%');
    expect(formatPercent(0)).toBe('0%');
  });
});

describe('on real receipts', () => {
  const receipts = JSON.parse(
    readFileSync(join(__dirname, '__fixtures__/real-receipts.json'), 'utf8'),
  ) as { createdAt: string; products: ReceiptLine[] }[];

  it('finds the price movements observed on the live account', () => {
    const result = computeInflation(receipts);

    expect(result.comparedCount).toBeGreaterThan(20);

    const byTitle = (needle: string) =>
      [...result.increases, ...result.decreases].find((c) =>
        c.title.toLowerCase().includes(needle),
      );

    // Verified against the live account on 2026-08-09.
    expect(byTitle('гриби шампіньйони')?.changePercent).toBeCloseTo(45.3, 0);
    expect(byTitle('крупа перлова')?.changePercent).toBeCloseTo(30, 0);
    // Pepper is the one item that got cheaper.
    expect(byTitle('перець мрія')?.changePercent).toBeLessThan(0);
  });

  it('produces a basket figure a guest could be shown', () => {
    const result = computeInflation(receipts);
    // Sanity band: a real basket should move, but not absurdly.
    expect(result.overallPercent).toBeGreaterThan(0);
    expect(result.overallPercent).toBeLessThan(50);
  });
});
