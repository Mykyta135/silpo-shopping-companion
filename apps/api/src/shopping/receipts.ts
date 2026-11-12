/**
 * Receipt extraction and verification.
 *
 * The model is good at ONE thing here: deciding that «Томати чері Sunstream 250г»
 * in a receipt is the «помідори» a recipe asked for. Everything else — which
 * receipts count, and whether a claimed match actually exists — is a game rule,
 * so it lives in code where it cannot be talked out of.
 */

/** A single purchased line item, flattened from an order. */
export interface ReceiptItem {
  title: string;
  /** Purchase timestamp of the parent order, ISO. */
  purchasedAt: string;
  /** 'online' | 'offline' — kept for display and debugging. */
  source: 'online' | 'offline';
}

/** Keys that plausibly carry a purchase date across the order tools. */
const DATE_KEYS = [
  'createdAt',
  'purchasedAt',
  'orderDate',
  'date',
  'checkDate',
  'created',
  'dateCreated',
];

/** Keys that plausibly carry a product title on a line item. */
const TITLE_KEYS = ['title', 'name', 'productName', 'productTitle', 'goodsName'];

/** Keys that plausibly hold the array of line items on an order. */
const ITEMS_KEYS = ['items', 'products', 'lines', 'orderItems', 'goods', 'positions'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function firstString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number') return String(value);
  }
  return undefined;
}

/**
 * MCP tool results arrive as `{ content: [{ type: 'text', text: '<json>' }] }`.
 * Unwraps that envelope to the underlying payload, tolerating shapes that
 * already are the payload.
 */
export function unwrapToolResult(result: unknown): unknown {
  if (!isRecord(result)) return result;

  const content = result.content;
  if (!Array.isArray(content)) return result;

  const texts = content
    .filter(isRecord)
    .map((part) => part.text)
    .filter((text): text is string => typeof text === 'string');

  if (!texts.length) return result;

  const joined = texts.join('\n');
  try {
    return JSON.parse(joined) as unknown;
  } catch {
    // Not JSON — hand back the raw text so title matching can still work on it.
    return joined;
  }
}

/** Recursively collects arrays of order-like objects from an arbitrary payload. */
function collectOrders(payload: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 6) return [];

  if (Array.isArray(payload)) {
    return payload.flatMap((entry) => collectOrders(entry, depth + 1));
  }

  if (!isRecord(payload)) return [];

  // An object carrying line items is itself an order.
  const hasItems = ITEMS_KEYS.some((key) => Array.isArray(payload[key]));
  if (hasItems) return [payload];

  // Otherwise descend into wrapper objects ({ data: … }, { orders: … }).
  return Object.values(payload).flatMap((value) => collectOrders(value, depth + 1));
}

/**
 * Flattens the raw results of the order tools into dated line items.
 *
 * Shapes are probed rather than assumed: the exact field names of the Silpo
 * order tools are not pinned by this codebase, so anything unrecognised is
 * skipped instead of guessed at.
 */
export function extractReceiptItems(
  raw: unknown,
  source: 'online' | 'offline',
): ReceiptItem[] {
  const items: ReceiptItem[] = [];

  for (const order of collectOrders(unwrapToolResult(raw))) {
    const purchasedAt = firstString(order, DATE_KEYS) ?? '';

    for (const key of ITEMS_KEYS) {
      const lines = order[key];
      if (!Array.isArray(lines)) continue;

      for (const line of lines) {
        if (typeof line === 'string' && line.trim()) {
          items.push({ title: line.trim(), purchasedAt, source });
          continue;
        }
        if (!isRecord(line)) continue;

        const title = firstString(line, TITLE_KEYS);
        if (!title) continue;

        // A line may carry its own date; prefer it over the order's.
        const lineDate = firstString(line, DATE_KEYS);
        items.push({ title, purchasedAt: lineDate ?? purchasedAt, source });
      }
    }
  }

  return items;
}

/**
 * Keeps only purchases made at or after `since`.
 *
 * Items with an unparseable date are KEPT: the Silpo order tools are read
 * newest-first and a dropped real purchase is a worse failure than a lenient
 * one. The 60% threshold still has to be met either way.
 */
export function filterSince(items: ReceiptItem[], since: string): ReceiptItem[] {
  const cutoff = Date.parse(since);
  if (Number.isNaN(cutoff)) return items;

  return items.filter((item) => {
    const at = Date.parse(item.purchasedAt);
    return Number.isNaN(at) ? true : at >= cutoff;
  });
}

/** Normalises a title for loose comparison: lowercase, no punctuation, collapsed spaces. */
function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Confirms that claimed matches are grounded in real receipts.
 *
 * The model does the semantic work — deciding «Спагеті Barilla 500г» is the
 * «паста» a recipe wanted — and that judgement is kept, since no string
 * comparison can reproduce it. What is enforced here are the two things a model
 * cannot be trusted to enforce about itself:
 *
 *  1. A claim must name an ingredient the level actually asked for, so it cannot
 *     invent entries to pad the count.
 *  2. Claims cannot outnumber the receipt lines available to back them. With
 *     three items bought, at most three ingredients can be matched — this is
 *     what stops "all five matched" against a two-line receipt.
 *
 * Duplicates are dropped, so the same ingredient cannot be counted twice.
 */
export function verifyMatches(
  claimed: string[],
  receiptItems: ReceiptItem[],
  ingredientTitles: string[],
): { verified: string[]; rejected: string[] } {
  const known = new Map(ingredientTitles.map((t) => [normalise(t), t]));
  const verified: string[] = [];
  const rejected: string[] = [];
  const seen = new Set<string>();

  for (const claim of claimed) {
    const key = normalise(claim);
    if (!key || seen.has(key)) continue;

    const ingredient = known.get(key);
    if (!ingredient) {
      // Not an ingredient of this level — the model invented it.
      rejected.push(claim);
      continue;
    }

    seen.add(key);
    verified.push(ingredient);
  }

  // A receipt line can back at most one ingredient. Anything beyond the number
  // of lines actually purchased is unbacked, whatever the model claimed.
  if (verified.length > receiptItems.length) {
    rejected.push(...verified.slice(receiptItems.length));
    verified.length = receiptItems.length;
  }

  return { verified, rejected };
}
