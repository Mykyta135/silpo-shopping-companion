/**
 * Purchase rhythm: what the guest buys regularly, and what is probably running out.
 *
 * Derived from offline receipts alone — the profile tools return nothing useful
 * on real accounts (see docs/mcp-data-findings.md), so buying behaviour is the
 * only honest signal about a person.
 *
 * IMPORTANT: with only a handful of receipts this is a weak estimate. Every
 * result carries an explicit `confidence` so the agent can hedge its wording
 * instead of claiming certainty it does not have.
 */

export interface RhythmLine {
  name: string;
  price: number;
  quantity?: number;
}

export interface PurchaseRhythm {
  title: string;
  /** How many separate shopping trips included this item. */
  purchaseCount: number;
  /** ISO date of the most recent purchase. */
  lastPurchasedAt: string;
  /** Mean gap between purchases, in days. Undefined when bought only once. */
  averageGapDays?: number;
  /** Days since the last purchase. */
  daysSinceLast: number;
  /**
   * How much to trust `averageGapDays`:
   * - `high`   — 4+ purchases, consistent gaps
   * - `medium` — 3 purchases
   * - `low`    — 2 purchases, a single gap
   * - `none`   — bought once; no rhythm can be inferred
   */
  confidence: 'high' | 'medium' | 'low' | 'none';
  /** True when more time has passed than the usual gap. */
  likelyRunningOut: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A gap counts as a top-up, rather than a cycle, when it is this small a
 * fraction of the product's own typical gap.
 *
 * Measuring the noise floor in absolute days was wrong: five days is a top-up
 * for coffee bought monthly, but a full cycle for bread bought weekly. Scaling
 * to each product's own rhythm compares like with like.
 */
const TOP_UP_FRACTION = 0.4;

/**
 * Absolute floor, regardless of cycle. Two trips on consecutive days are the
 * same shopping run however often the item is bought.
 */
const ABSOLUTE_FLOOR_DAYS = 1.5;

/** Median is used as the cycle seed: unlike the mean it ignores outliers. */
function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Separates real cycles from same-run top-ups.
 *
 * Chicken-and-egg: the noise floor depends on the cycle, but the cycle depends
 * on which gaps are noise. Resolved by seeding with the median gap — a couple
 * of short top-ups cannot drag it the way they drag a mean — then filtering
 * relative to that seed.
 */
function meaningfulGaps(gaps: number[]): number[] {
  if (gaps.length <= 1) {
    return gaps.filter((gap) => gap >= ABSOLUTE_FLOOR_DAYS);
  }

  const seed = median(gaps);
  const floor = Math.max(seed * TOP_UP_FRACTION, ABSOLUTE_FLOOR_DAYS);
  const kept = gaps.filter((gap) => gap >= floor);

  // Never discard everything: if the guest genuinely shops in tight bursts,
  // that IS their rhythm and the median already reflects it.
  return kept.length ? kept : gaps;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;
}

/** Groups identical products across trips; receipts repeat names verbatim. */
function normaliseTitle(name: string): string {
  return name.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Confidence from sample size and gap consistency.
 *
 * Two purchases give one gap — that is a coincidence, not a rhythm, so it caps
 * at `low` no matter how neat the number looks.
 */
function rateConfidence(gaps: number[]): PurchaseRhythm['confidence'] {
  if (gaps.length === 0) return 'none';
  if (gaps.length === 1) return 'low';
  if (gaps.length === 2) return 'medium';

  // With enough gaps, consistency decides: wildly irregular buying is not a rhythm.
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
  const spread = Math.sqrt(
    gaps.reduce((sum, g) => sum + (g - mean) ** 2, 0) / gaps.length,
  );
  return spread / mean < 0.5 ? 'high' : 'medium';
}

/**
 * Builds a rhythm profile per product.
 *
 * @param orders Offline orders, newest or oldest order does not matter.
 * @param now Reference point for "days since"; injectable so tests are stable.
 */
export function computeRhythms(
  orders: { createdAt: string; products: RhythmLine[] }[],
  now: Date = new Date(),
): PurchaseRhythm[] {
  const byProduct = new Map<string, { title: string; dates: string[] }>();

  for (const order of orders) {
    // One trip counts once per product, even if the line appears twice.
    const seenInOrder = new Set<string>();

    for (const line of order.products ?? []) {
      const key = normaliseTitle(line.name);
      if (!key || seenInOrder.has(key)) continue;
      seenInOrder.add(key);

      const entry = byProduct.get(key) ?? { title: line.name, dates: [] };
      entry.dates.push(order.createdAt);
      byProduct.set(key, entry);
    }
  }

  const nowIso = now.toISOString();
  const rhythms: PurchaseRhythm[] = [];

  for (const { title, dates } of byProduct.values()) {
    const sorted = [...dates].sort();
    const rawGaps: number[] = [];
    for (let i = 1; i < sorted.length; i += 1) {
      rawGaps.push(daysBetween(sorted[i - 1], sorted[i]));
    }
    // Noise floor scales with the product's own cycle, not a fixed day count.
    const gaps = meaningfulGaps(rawGaps);

    const lastPurchasedAt = sorted[sorted.length - 1];
    const daysSinceLast = daysBetween(lastPurchasedAt, nowIso);
    const averageGapDays = gaps.length
      ? gaps.reduce((a, b) => a + b, 0) / gaps.length
      : undefined;
    const confidence = rateConfidence(gaps);

    rhythms.push({
      title,
      purchaseCount: sorted.length,
      lastPurchasedAt,
      averageGapDays,
      daysSinceLast,
      confidence,
      // Only claim something is running out when a rhythm actually exists.
      likelyRunningOut:
        averageGapDays !== undefined &&
        confidence !== 'none' &&
        daysSinceLast >= averageGapDays,
    });
  }

  return rhythms.sort((a, b) => b.purchaseCount - a.purchaseCount);
}

/** Items bought on more than one trip — the guest's actual staples. */
export function regulars(rhythms: PurchaseRhythm[]): PurchaseRhythm[] {
  return rhythms.filter((r) => r.purchaseCount > 1);
}

/**
 * How many of its own cycles an item may be overdue before it counts as
 * abandoned rather than forgotten.
 *
 * Sorting purely by days overdue puts dropped products first — the synthetic
 * history surfaced a soy drink unbought for 127 days on a 12-day cycle at the
 * top of the list. Suggesting that every trip would only annoy.
 *
 * The multiple adapts to how reliably the guest buys the thing: a metronomic
 * habit is clearly broken after two missed cycles, while an erratic one needs
 * more slack before we conclude anything.
 */
function abandonedAfterCycles(rhythm: PurchaseRhythm): number {
  switch (rhythm.confidence) {
    case 'high':
      return 2.5;
    case 'medium':
      return 3.5;
    default:
      return 5;
  }
}

/** True when the guest appears to have stopped buying this altogether. */
function isAbandoned(rhythm: PurchaseRhythm): boolean {
  const cycle = rhythm.averageGapDays ?? 0;
  if (cycle <= 0 || rhythm.purchaseCount <= 1) return false;
  return rhythm.daysSinceLast > cycle * abandonedAfterCycles(rhythm);
}

/**
 * Candidates for the shopping list: regular items whose usual gap has elapsed
 * but which the guest has not clearly given up on.
 *
 * Sorted by how overdue they are relative to their own cycle, so a 30-day
 * coffee run does not outrank a 5-day bread run purely on raw days.
 */
export function runningOut(rhythms: PurchaseRhythm[]): PurchaseRhythm[] {
  return rhythms
    .filter((r) => r.likelyRunningOut && r.purchaseCount > 1 && !isAbandoned(r))
    .sort((a, b) => {
      // Overdue measured in cycles, not days, so a 30-day coffee run does not
      // outrank a 5-day bread run purely on elapsed time.
      const ratioA = a.daysSinceLast / (a.averageGapDays || 1);
      const ratioB = b.daysSinceLast / (b.averageGapDays || 1);
      return ratioB - ratioA;
    });
}

/** Items the guest appears to have dropped — never proposed, but useful signal. */
export function abandoned(rhythms: PurchaseRhythm[]): PurchaseRhythm[] {
  return rhythms.filter(isAbandoned);
}

/**
 * Wording the agent can use without overclaiming.
 * Low confidence must never sound like a fact.
 */
export function describeRhythm(rhythm: PurchaseRhythm): string {
  const days = Math.round(rhythm.averageGapDays ?? 0);

  switch (rhythm.confidence) {
    case 'high':
      return `береш кожні ~${days} дн.`;
    case 'medium':
      return `схоже, береш кожні ~${days} дн.`;
    case 'low':
      return `брав двічі, з перервою ~${days} дн.`;
    default:
      return 'брав один раз';
  }
}
