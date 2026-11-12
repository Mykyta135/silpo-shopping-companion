/**
 * «Супутник у залі» — domain model.
 *
 * A shopping list the agent assembles from real receipts, grouped into store
 * zones in walking order, that the guest ticks off while physically in the shop.
 */

export type ZoneId =
  | 'produce'
  | 'bakery'
  | 'meat'
  | 'fish'
  | 'dairy'
  | 'grocery'
  | 'frozen'
  | 'household'
  | 'checkout';

/** Why an item is on the list. Shown to the guest — never a bare suggestion. */
export type ItemSource =
  /** Running out, based on purchase rhythm. */
  | 'rhythm'
  /** Covered by a coupon worth using. */
  | 'coupon'
  /** Replacement for something that got noticeably more expensive. */
  | 'price'
  /** «Спробуй нове» — fits the diet but never bought. */
  | 'discovery'
  /** The guest asked for it. */
  | 'guest';

/**
 * A concrete product resolved from the Silpo catalogue.
 * Mirrors what `silpo_find_products_batch` returns per product.
 */
export interface ProductOption {
  productId: string;
  title: string;
  price: number;
  /** Pre-discount price when the item is on promotion. */
  oldPrice?: number;
  /** Units on the shelf; 0 means out of stock. */
  stock?: number;
  available?: boolean;
  image?: string;
  slug?: string;
  companyId?: string;
  branchId?: string;
  /** Sold by weight rather than by piece. */
  weighted?: boolean;
  /**
   * Smallest orderable increment. For weighted goods this is a fraction of a
   * kilogram (0.5, 0.6…), so ordering "1" means one kilogram, not one tray.
   */
  step?: number;
}

export interface ListItem {
  id: string;
  title: string;
  /** Search term for silpo_find_products_batch. */
  query: string;
  quantity: number;
  unit: string;
  zone: ZoneId;
  source: ItemSource;
  /** One line explaining why this is here, in the agent's words. */
  reason: string;
  /** Ticked off in the aisle. */
  picked: boolean;
  /** Guest reported it missing from the shelf. */
  missing?: boolean;

  /**
   * The guest's usual pick, resolved against the catalogue.
   * Undefined while the item is only a plan.
   */
  product?: ProductOption;
  /**
   * Cheaper or better-suited options shown ALONGSIDE `product`, never instead
   * of it — swapping silently would take the choice away from the guest.
   */
  alternatives?: ProductOption[];
  /** Which option the guest settled on; defaults to `product`. */
  chosenProductId?: string;
  /** Set once the item has been written into the real Silpo cart. */
  inCart?: boolean;

  /** @deprecated Kept for older stored lists; prefer `product.price`. */
  price?: number;
  /** @deprecated Kept for older stored lists; prefer `product.productId`. */
  productId?: string;
}

export interface ZoneGroup {
  zone: ZoneId;
  title: string;
  emoji: string;
  hint: string;
  /**
   * Position on a schematic 4×4 floor plan, used to draw the route.
   * A model of a typical supermarket layout, not a real store's plan.
   */
  cell: { col: number; row: number };
  items: ListItem[];
}

/** A coupon with the agent's verdict on whether it suits this guest. */
export interface CouponVerdict {
  id: number;
  description: string;
  rewardText?: string;
  /** Kept so deadlines can be recomputed later without re-reading the coupon. */
  endDate: string;
  /** Whole days until expiry; negative once expired. */
  daysLeft: number;
  urgency: 'expired' | 'today' | 'soon' | 'later';
  matchesDiet: boolean;
  reason: string;
}

/** A product whose price moved since the guest last bought it. */
export interface PriceAlert {
  title: string;
  paidPrice: number;
  currentPrice: number;
  changePercent: number;
}

export interface ShoppingList {
  sessionId: string;
  createdAt: string;
  /** The agent's opening line. */
  greeting: string;
  items: ListItem[];
  coupons: CouponVerdict[];
  priceAlerts: PriceAlert[];
  /** Zone the guest is currently in, if known. */
  currentZone?: ZoneId;
  /** Zones the agent has already spoken in — one remark per zone. */
  spokenZones: ZoneId[];
  /** MCP tools called while building the list, surfaced as proof of integration. */
  toolCalls: string[];
}

/* ------------------------------------------------------------------ *
 * Wire contract
 * ------------------------------------------------------------------ */

export interface BuildListRequest {
  sessionId: string;
  /** Optional free-text request; the guest's own words always win. */
  request?: string;
}

export interface PatchListRequest {
  sessionId: string;
  /** Add a guest-authored item. */
  add?: { title: string; quantity?: number; unit?: string };
  /** Remove an item the guest does not want. */
  removeId?: string;
  /** Switch an item between its main product and an alternative. */
  choose?: { itemId: string; productId: string };
  /**
   * Where the guest says they are standing. There is no indoor positioning —
   * no GPS indoors and no coordinates in the MCP data — so this is manual.
   */
  currentZone?: ZoneId;
}

export type AisleEventType = 'picked' | 'missing' | 'zone-left' | 'finished';

export interface AisleEventRequest {
  sessionId: string;
  type: AisleEventType;
  /** Item the event refers to; required for 'picked' and 'missing'. */
  itemId?: string;
  /** Zone the guest just left; required for 'zone-left'. */
  zone?: ZoneId;
}

export interface AgentReaction {
  /** False means the agent deliberately stayed quiet. */
  spoke: boolean;
  message?: string;
  /** Something worth adding right now. */
  suggestion?: { title: string; query: string; reason: string };
  toolCalls: string[];
}

/** How the trip is going — accumulates as the guest walks. */
export interface WalkProgress {
  picked: number;
  missing: number;
  remaining: number;
  /** Running cost of what is in the basket, UAH. */
  basketTotal: number;
  /** Zones with nothing left outstanding. */
  zonesDone: string[];
  currentZone?: string;
}

export interface ListResponse {
  list: ShoppingList;
  /** Items grouped into zones, in walking order. */
  route: ZoneGroup[];
  progress: WalkProgress;
}

export interface AisleEventResponse extends ListResponse {
  reaction: AgentReaction;
}

export interface AddToCartRequest {
  sessionId: string;
  /** Specific items to add; omit to add everything still outstanding. */
  itemIds?: string[];
}

export interface AddToCartResponse extends ListResponse {
  /** How many products were written into the Silpo cart. */
  added: number;
  /** Link the guest opens to finish the order; the agent never checks out. */
  checkoutUrl?: string;
  /** Cart total after discounts, straight from Silpo. */
  total?: number;
  /**
   * Blockers the guest has to resolve — an expired timeslot, out-of-stock
   * items. Present whenever checkout is unavailable.
   */
  warnings?: string[];
}
