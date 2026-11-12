/**
 * Store zones and walking order.
 *
 * The Silpo MCP server exposes NO physical location data — none of the 39 tools
 * carry aisle, shelf or section fields. What it does expose is each product's
 * category, and categories map onto zones reliably: chilled goods sit on the
 * perimeter because that is where the power for refrigeration runs, dry goods
 * sit in the centre aisles.
 *
 * The order below follows the standard linear supermarket layout — entrance on
 * the right, shoppers moving anti-clockwise around the perimeter before the
 * centre aisles, checkout last.
 *
 * IMPORTANT: this is a MODEL of a typical store, not a floor plan of a specific
 * one. Silpo's planograms are not public, and since 2018 new stores are built to
 * individual themed designs. Present it as a sensible route, never as exact
 * navigation.
 */

import type { ZoneId } from '@silpo/shared';

export type { ZoneId };

export interface Zone {
  id: ZoneId;
  title: string;
  emoji: string;
  /** Position in the walking route, 1-based. */
  order: number;
  /** Shown under the zone heading to explain why it comes here. */
  hint: string;
  /**
   * Position on a schematic 4×4 floor plan, for drawing the route.
   *
   * Fresh departments hug the perimeter (that is where refrigeration power
   * runs), dry goods fill the centre, checkout sits by the entrance. These are
   * NOT real coordinates of any store — see the module note above.
   */
  cell: { col: number; row: number };
}

export const ZONES: readonly Zone[] = [
  { id: 'produce', title: 'Овочі та фрукти', emoji: '🥬', order: 1, hint: 'Одразу біля входу', cell: { col: 3, row: 0 } },
  { id: 'bakery', title: 'Хліб і випічка', emoji: '🍞', order: 2, hint: 'Далі по периметру', cell: { col: 2, row: 0 } },
  { id: 'meat', title: "М'ясо", emoji: '🥩', order: 3, hint: 'Холодильна вітрина', cell: { col: 1, row: 0 } },
  { id: 'fish', title: 'Риба', emoji: '🐟', order: 4, hint: 'Поруч з м’ясом', cell: { col: 0, row: 0 } },
  { id: 'dairy', title: 'Молочне та яйця', emoji: '🥛', order: 5, hint: 'Кінець периметра', cell: { col: 0, row: 1 } },
  { id: 'grocery', title: 'Бакалія', emoji: '🫙', order: 6, hint: 'Центральні ряди', cell: { col: 1, row: 2 } },
  { id: 'frozen', title: 'Заморозка', emoji: '🧊', order: 7, hint: 'Беремо останнім, щоб не розтануло', cell: { col: 2, row: 2 } },
  { id: 'household', title: 'Побутове', emoji: '🧴', order: 8, hint: 'Перед касами', cell: { col: 3, row: 2 } },
  // Next to the entrance, not on it — the plan draws an entrance marker at (3,3).
  { id: 'checkout', title: 'Каси', emoji: '🛒', order: 9, hint: 'Фініш', cell: { col: 2, row: 3 } },
] as const;

const ZONE_BY_ID = new Map(ZONES.map((z) => [z.id, z]));

export function getZone(id: ZoneId): Zone {
  const zone = ZONE_BY_ID.get(id);
  if (!zone) throw new Error(`Unknown zone: ${id}`);
  return zone;
}

/**
 * Keyword rules mapping a product title to a zone.
 *
 * Ordered most-specific first: «напій соєвий» must not fall into `grocery` via
 * "соєвий соус", and frozen fish must beat the generic fish rule. Matching is
 * done on a normalised title, so declensions still need explicit stems
 * («яйц» covers яйця/яєць).
 */
const RULES: { zone: ZoneId; keywords: string[] }[] = [
  // Frozen first — it wins over the meat/fish rules below.
  {
    zone: 'frozen',
    keywords: ['заморож', 'с/м', 'в глазурі', 'морозиво', 'пельмен', 'вареник', 'напівфабрикат'],
  },
  // Shelf-stable versions of fresh products live in the centre aisles, so these
  // must beat the produce/fish/meat rules: canned tuna is grocery, not fish, and
  // «приправа до риби» is a spice, not a fish.
  //
  // Product-type words also belong here because they outrank ingredient words
  // further down: «Соус соєвий Теріякі з часником та імбиром» is a sauce, and
  // must not reach produce via «часник» or «імбир».
  {
    zone: 'grocery',
    keywords: [
      'консерв', 'у власному соку', 'в томатному соусі', 'мариноват',
      'приправа', 'спеці', 'суміш прянощ', 'сушен', 'сухий',
      // «олія», not «олі» — the shorter stem also matches «свіжий» declensions.
      'соус', 'кетчуп', 'майонез', 'паста том', 'сироп', 'олія', 'олив',
    ],
  },
  {
    zone: 'produce',
    keywords: [
      'овоч', 'фрукт', 'банан', 'яблук', 'цибул', 'морква', 'картопл', 'капуст',
      'часник', 'гриб', 'печериц', 'шампіньйон', 'помідор', 'томат', 'огірок',
      // NOT bare «салат» — it also matches «тунець салатний».
      'зелен', 'салат листов', 'кріп', 'петрушк', 'тим’ян', "тим'ян", 'базилік',
      'лохин', 'ягод', 'лимон', 'апельсин', 'перець солод', 'буряк', 'кабач',
      'імбир', 'авокадо', 'селер', 'редис', 'гарбуз', 'баклажан', 'груш',
      'виноград', 'полуниц', 'малин', 'персик', 'слив', 'кавун', 'диня',
    ],
  },
  {
    zone: 'bakery',
    keywords: ['хліб', 'багет', 'булк', 'батон', 'лаваш', 'випічк', 'круасан', 'печив', 'тортил'],
  },
  // Fish before meat: a species name is more specific than the cuts both share
  // («стейк», «філе»), so «Лосось стейк» must not be claimed by the meat rule.
  {
    zone: 'fish',
    keywords: ['риб', 'тунец', 'лосос', 'оселедц', 'селедк', 'скумбр', 'хек', 'минтай', 'креветк', 'кальмар', 'ікр'],
  },
  {
    zone: 'meat',
    keywords: [
      'м’яс', "м'яс", 'свинин', 'свиняч', 'яловичин', 'філе куряч', 'куряч грудк',
      'фарш', 'ковбас', 'сосиск', 'бекон', 'шинк', 'окіст', 'шлунок', 'печінк',
      'індичк', 'качк', 'стейк', 'курча', 'бройлер',
      // NOT «курк»: it also matches «куркума». NOT bare «куряч»: «яйця курячі»
      // belong in dairy, so chicken meat is matched via more specific phrases.
    ],
  },
  {
    zone: 'dairy',
    keywords: [
      'молок', 'молочн', 'сир ', 'сирн', 'йогурт', 'кефір', 'вершк', 'масло вершк',
      'сметан', 'творог', 'айран', 'яйц', 'ряжанк',
    ],
  },
  {
    zone: 'household',
    keywords: [
      'пакет', 'серветк', 'папір', 'мило', 'шампун', 'дезодорант', 'зубн', 'пральн',
      'миюч', 'губк', 'засіб', 'освіжувач', 'підгузк', 'батарейк',
    ],
  },
  {
    zone: 'grocery',
    keywords: [
      'крупа', 'рис', 'гречк', 'макарон', 'вермішел', 'спагет', 'паст', 'борошн',
      'цукор', 'сіль', 'олі', 'оцет', 'соус', 'кетчуп', 'майонез', 'приправ',
      'спеці', 'куркум', 'каррі', 'перець', 'лавров', 'прянощ', 'консерв',
      'квасол', 'сочевиц', 'горох', 'пластівц', 'мюслі', 'чай', 'кава', 'какао',
      'горіх', "кеш'ю", 'кешью', 'арахіс', 'насінн', 'сухофрукт', 'мед', 'джем',
      'напій', 'сік', 'вод', 'шоколад', 'цукерк', 'батончик',
    ],
  },
];

/** Normalises a product title for keyword matching. */
function normalise(title: string): string {
  return title.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Picks the zone for a product title.
 *
 * @param title Product name as it appears in a receipt or the catalogue.
 * @param categoryPath Optional category path from `get_categories_tree`; when
 *   present it is searched too, since catalogue categories are more reliable
 *   than marketing-heavy product names.
 * @returns The matched zone, defaulting to `grocery` — the centre aisles are
 *   where an unknown dry good most likely sits.
 */
export function resolveZone(title: string, categoryPath?: string): ZoneId {
  const haystack = normalise(`${title} ${categoryPath ?? ''}`);

  for (const rule of RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword))) {
      return rule.zone;
    }
  }
  return 'grocery';
}

export interface ZonedItem {
  title: string;
  zone: ZoneId;
}

export interface ZoneGroup {
  zone: Zone;
  items: ZonedItem[];
}

/**
 * Groups items into zones and returns them in walking order.
 * Empty zones are omitted — the route only shows stops that matter.
 */
export function buildRoute<T extends { title: string; categoryPath?: string }>(
  items: T[],
): { zone: Zone; items: (T & { zone: ZoneId })[] }[] {
  const buckets = new Map<ZoneId, (T & { zone: ZoneId })[]>();

  for (const item of items) {
    const zone = resolveZone(item.title, item.categoryPath);
    const bucket = buckets.get(zone) ?? [];
    bucket.push({ ...item, zone });
    buckets.set(zone, bucket);
  }

  return ZONES.filter((zone) => buckets.get(zone.id)?.length).map((zone) => ({
    zone,
    items: buckets.get(zone.id) as (T & { zone: ZoneId })[],
  }));
}
