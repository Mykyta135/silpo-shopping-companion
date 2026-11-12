/**
 * Personal price inflation, computed from receipts alone.
 *
 * Every line item in `silpo_get_my_offline_orders` carries both the price the
 * guest paid and a `catalogProduct` block with the CURRENT catalogue price. That
 * makes "how much has my basket gone up" a pure calculation — no extra tool
 * calls, no historical price API.
 *
 * This is the gap Silpo's own assistant admits to: «система мені не показує
 * історичні ціни з попередніх тижнів».
 */

/** A product as it appears inside an offline order. */
export interface ReceiptLine {
  name: string;
  price: number;
  quantity?: number;
  /** Catalogue snapshot taken at read time. */
  catalogProduct?: {
    id?: string;
    price?: number;
    slug?: string;
    available?: boolean;
    companyId?: string;
    branchId?: string;
  } | null;
}

export interface PriceChange {
  title: string;
  /** Price the guest actually paid, UAH. */
  paidPrice: number;
  /** Catalogue price right now, UAH. */
  currentPrice: number;
  /** Percentage change; positive means more expensive now. */
  changePercent: number;
  /** ISO date of the purchase this comparison is anchored to. */
  purchasedAt: string;
  /** Catalogue id, so the caller can offer a replacement. */
  productId?: string;
  slug?: string;
}

export interface BasketInflation {
  /** Weighted change across the whole basket, in percent. */
  overallPercent: number;
  /** Items that went up, steepest first. */
  increases: PriceChange[];
  /** Items that went down, steepest first. */
  decreases: PriceChange[];
  /** How many line items could be compared at all. */
  comparedCount: number;
  /** Line items skipped because the catalogue price was missing. */
  skippedCount: number;
}

/**
 * Fallback threshold, used only when a basket is too small to derive one.
 * Prefer `significantIncreases`, which adapts to the guest's own basket.
 */
export const SIGNIFICANT_CHANGE_PERCENT = 15;

/** Floor and ceiling for the adaptive threshold, so it stays sane either way. */
const MIN_THRESHOLD = 8;
const MAX_THRESHOLD = 30;

/**
 * A price pair is only meaningful if both numbers are real. Missing catalogue
 * prices are common (discontinued lines), so they are skipped rather than
 * treated as zero — a false "−100%" would be worse than saying nothing.
 */
function comparable(line: ReceiptLine): boolean {
  const current = line.catalogProduct?.price;
  return (
    typeof current === 'number' &&
    current > 0 &&
    typeof line.price === 'number' &&
    line.price > 0
  );
}

/**
 * Compares what the guest paid against today's catalogue price.
 *
 * @param orders Offline orders, each with a purchase date and its line items.
 * @returns Per-item changes plus a basket-level figure.
 */
export function computeInflation(
  orders: { createdAt: string; products: ReceiptLine[] }[],
): BasketInflation {
  const changes: PriceChange[] = [];
  let skippedCount = 0;
  /** Latest comparison per product, so repeat purchases are not double-counted. */
  const latest = new Map<string, PriceChange>();

  for (const order of orders) {
    for (const line of order.products ?? []) {
      if (!comparable(line)) {
        skippedCount += 1;
        continue;
      }

      const currentPrice = line.catalogProduct!.price as number;
      const change: PriceChange = {
        title: line.name,
        paidPrice: line.price,
        currentPrice,
        changePercent: ((currentPrice - line.price) / line.price) * 100,
        purchasedAt: order.createdAt,
        productId: line.catalogProduct?.id,
        slug: line.catalogProduct?.slug,
      };

      const key = line.name.toLowerCase().trim();
      const existing = latest.get(key);
      // Keep the most recent purchase — it reflects the freshest price paid.
      if (!existing || existing.purchasedAt < order.createdAt) {
        latest.set(key, change);
      }
    }
  }

  changes.push(...latest.values());

  const increases = changes
    .filter((c) => c.changePercent > 0)
    .sort((a, b) => b.changePercent - a.changePercent);
  const decreases = changes
    .filter((c) => c.changePercent < 0)
    .sort((a, b) => a.changePercent - b.changePercent);

  // Basket-level figure is weighted by what the guest actually spent, so a
  // 45% jump on a 15 UAH item does not outweigh a 5% jump on a 300 UAH one.
  const paidTotal = changes.reduce((sum, c) => sum + c.paidPrice, 0);
  const currentTotal = changes.reduce((sum, c) => sum + c.currentPrice, 0);
  const overallPercent = paidTotal
    ? ((currentTotal - paidTotal) / paidTotal) * 100
    : 0;

  return {
    overallPercent,
    increases,
    decreases,
    comparedCount: changes.length,
    skippedCount,
  };
}

/**
 * Threshold above which a rise is worth mentioning, derived from this guest's
 * own basket rather than a fixed number.
 *
 * A basket where everything drifts a few percent makes a 12% jump notable; one
 * that swings wildly makes 12% unremarkable. Using the median rise as the
 * anchor keeps the comparison to how *this* person's prices normally behave.
 */
export function adaptiveThreshold(inflation: BasketInflation): number {
  const rises = inflation.increases.map((c) => c.changePercent);
  // Too few data points to infer anything — fall back to the fixed default.
  if (rises.length < 4) return SIGNIFICANT_CHANGE_PERCENT;

  const sorted = [...rises].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;

  // Flag what stands out against the guest's own normal drift.
  return Math.min(Math.max(median * 1.5, MIN_THRESHOLD), MAX_THRESHOLD);
}

/**
 * Items worth acting on: rises that stand out for this guest.
 * Pass an explicit threshold to override the adaptive one.
 */
export function significantIncreases(
  inflation: BasketInflation,
  threshold = adaptiveThreshold(inflation),
): PriceChange[] {
  return inflation.increases.filter((c) => c.changePercent >= threshold);
}

/** Rounds to one decimal for display without dragging float noise into the UI. */
export function formatPercent(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}
