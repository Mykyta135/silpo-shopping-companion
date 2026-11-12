import type { ProductOption } from '@silpo/shared';

/**
 * Turns `silpo_find_products_batch` results into product options for the list.
 *
 * The response is shaped `{ queries: [{ query, totalFound, products: [...] }] }`
 * — verified against the live server, not assumed.
 */

/** A product exactly as the catalogue returns it. */
interface RawProduct {
  id?: string;
  name?: string;
  slug?: string;
  price?: number;
  oldPrice?: number | null;
  stock?: number;
  available?: boolean;
  image?: string;
  weighted?: boolean;
  /** Smallest orderable increment; a fraction of a kg for weighted goods. */
  step?: number;
  companyId?: string;
  branchId?: string;
  externalProductId?: number;
}

interface BatchResponse {
  queries?: { query?: string; totalFound?: number; products?: RawProduct[] }[];
}

function toOption(raw: RawProduct): ProductOption | undefined {
  if (!raw?.id || !raw.name || typeof raw.price !== 'number') return undefined;
  return {
    productId: raw.id,
    title: raw.name,
    price: raw.price,
    oldPrice: raw.oldPrice ?? undefined,
    stock: raw.stock,
    available: raw.available,
    image: raw.image,
    slug: raw.slug,
    companyId: raw.companyId,
    branchId: raw.branchId,
    weighted: raw.weighted,
    step: raw.step,
  };
}

/**
 * Groups catalogue results by the search term that produced them.
 *
 * @returns Map of lower-cased query to the products found for it.
 */
export function groupByQuery(response: unknown): Map<string, ProductOption[]> {
  const grouped = new Map<string, ProductOption[]>();
  const queries = (response as BatchResponse)?.queries;
  if (!Array.isArray(queries)) return grouped;

  for (const entry of queries) {
    const key = (entry?.query ?? '').toLowerCase().trim();
    const options = (entry?.products ?? [])
      .map(toOption)
      .filter((p): p is ProductOption => Boolean(p));
    if (key) grouped.set(key, options);
  }

  return grouped;
}

/** True when the option is worth showing at all. */
function isOffered(option: ProductOption): boolean {
  return option.available !== false && (option.stock ?? 1) > 0;
}

/**
 * Progressively shorter search terms for one product.
 *
 * Silpo's search is unforgiving with qualified phrases — verified on the live
 * server, «молоко» returns three products while «молоко яготинське 2.6» returns
 * none. So a specific query is tried first, then broader fallbacks, keeping
 * brand precision when it works without losing the item when it does not.
 */
export function queryVariants(query: string): string[] {
  const cleaned = query.toLowerCase().replace(/[«»"'.,]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];

  // Digits and short tokens («2», «6», «5%») narrow the search without adding
  // meaning, so fallbacks are built from the meaningful words only.
  const words = cleaned.split(' ').filter((w) => w.length > 2);
  const variants = [cleaned];

  // Two words, then the head noun alone — the broadest term that still means
  // the right thing.
  if (words.length >= 2) variants.push(words.slice(0, 2).join(' '));
  if (words.length >= 1) variants.push(words[0]);

  return [...new Set(variants)];
}

/**
 * Splits catalogue matches into the guest's pick and the alternatives shown
 * next to it.
 *
 * The first in-stock result is treated as the main option, since the catalogue
 * orders by relevance to the search term. Alternatives are only offered when
 * they are cheaper — a pricier "alternative" is noise in a shop.
 *
 * @param maxAlternatives Cap so a card never turns into a catalogue page.
 */
export function pickOptions(
  options: ProductOption[],
  maxAlternatives = 2,
): { product?: ProductOption; alternatives: ProductOption[] } {
  const offered = options.filter(isOffered);
  if (!offered.length) {
    // Nothing in stock: still show the top match so the guest sees what was meant.
    return { product: options[0], alternatives: [] };
  }

  const [product, ...rest] = offered;
  const alternatives = rest
    .filter((option) => option.price < product.price)
    .sort((a, b) => a.price - b.price)
    .slice(0, maxAlternatives);

  return { product, alternatives };
}

/**
 * Words too generic to prove a match on their own.
 *
 * «філе» is the sharpest example: it appears on chicken, hake and herring
 * alike, so on live data it matched fish for a chicken query.
 */
const STOPWORDS = new Set([
  'свіжий', 'свіжа', 'свіже', 'охолоджений', 'охолоджене', 'охолоджена',
  'класичний', 'класична', 'домашній', 'домашня', 'домашні',
  'філе', 'стейк', 'шматочки', 'порції', 'нарізка', 'упаковка',
]);

/**
 * Product families that must never be substituted for one another.
 *
 * A shared word is not enough when the categories differ: «філе куряче» and
 * «хек філе» both contain «філе», but nobody cooking chicken wants fish.
 */
const EXCLUSIVE_FAMILIES: RegExp[][] = [
  [/куряч|курк|курча|бройлер/, /хек|минтай|тунец|оселедец|лосос|скумбр|риб|креветк/],
  [/яйц|яєц/, /молок|сир |кефір|йогурт/],
  [/молок/, /згущен|сухе молоко/],
  [/нут\b|нуту/, /шоколад|цукерк|батончик|бісквіт|праліне/],
];

/** True when query and product sit on opposite sides of an exclusive pair. */
function isCrossCategory(query: string, title: string): boolean {
  return EXCLUSIVE_FAMILIES.some(([a, b]) => {
    if (a.test(query) && b.test(title) && !a.test(title)) return true;
    if (b.test(query) && a.test(title) && !b.test(title)) return true;
    return false;
  });
}

/**
 * Checks that a catalogue hit is actually the thing that was asked for.
 *
 * Broadening a search rescues most lookups, but unchecked it also returns
 * nonsense: on live data «філе куряче» came back as hake, «яйця курячі» as
 * milk, and «нут» as chocolate with nuts. A wrong product on the shelf card is
 * worse than an honest blank, so at least one meaningful word from the query
 * must appear in the product name.
 */
export function isRelevant(query: string, option: ProductOption): boolean {
  const title = option.title.toLowerCase();
  const normalisedQuery = query.toLowerCase();

  // A shared generic word cannot bridge two different product families.
  if (isCrossCategory(normalisedQuery, title)) return false;

  const words = query
    .toLowerCase()
    .replace(/[«»"'.,]/g, ' ')
    .split(/\s+/)
    // Three letters is the floor: real products are named «нут», «сік», «рис».
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));

  if (!words.length) return true;

  // Compare on stems: Ukrainian declensions mean «яйця» must still match
  // «яєць», and «молоко» must match «молока».
  return words.some((word) => {
    const stem = word.slice(0, Math.max(3, word.length - 2));
    return title.includes(stem);
  });
}

/** Keeps only the catalogue hits that genuinely answer the query. */
export function filterRelevant(
  query: string,
  options: ProductOption[],
): ProductOption[] {
  return options.filter((option) => isRelevant(query, option));
}

/** Fat percentage stated in a product name, e.g. «5%» or «2,6%». */
function fatPercent(text: string): number | undefined {
  const match = text.match(/(\d+[.,]?\d*)\s*%/);
  if (!match) return undefined;
  return Number.parseFloat(match[1].replace(',', '.'));
}

/**
 * Reorders catalogue hits so the closest match to the query comes first.
 *
 * Relevance alone is not enough for dairy: a search for «Сир President Сирна
 * традиція 5%» returned the 0,2%, 5%, 9% and 5% variants, and taking the first
 * put 0,2% in the cart. Fat percentage is the one attribute a guest genuinely
 * notices, so an exact match on it wins.
 */
export function rankByCloseness(
  query: string,
  options: ProductOption[],
): ProductOption[] {
  const wanted = fatPercent(query);
  if (wanted === undefined) return options;

  return [...options].sort((a, b) => {
    const fatA = fatPercent(a.title);
    const fatB = fatPercent(b.title);
    // Products without a stated percentage sit between exact and wrong matches.
    const distance = (fat?: number) =>
      fat === undefined ? 0.5 : Math.abs(fat - wanted);
    return distance(fatA) - distance(fatB);
  });
}

/**
 * Quantity to order, honouring how the product is actually sold.
 *
 * Weighted goods come with a `step` (0.5 kg, 0.6 kg…) and ordering «1» means
 * one kilogram — which is how a single tray of chicken fillet turned into
 * 273 UAH of meat. Piece goods round to whole units.
 */
export function orderQuantity(option: ProductOption, requested: number): number {
  const step = option.step && option.step > 0 ? option.step : undefined;

  if (option.weighted && step) {
    // One "unit" of a weighted product is one step, not one kilogram.
    const steps = Math.max(1, Math.round(requested));
    return Number((steps * step).toFixed(3));
  }

  return Math.max(1, Math.round(requested));
}

/** Percentage saved by taking the alternative instead of the main option. */
export function savingPercent(main: ProductOption, alternative: ProductOption): number {
  if (!main.price) return 0;
  return ((main.price - alternative.price) / main.price) * 100;
}

/** True when the product carries an active promotion. */
export function isOnPromotion(option: ProductOption): boolean {
  return typeof option.oldPrice === 'number' && option.oldPrice > option.price;
}
