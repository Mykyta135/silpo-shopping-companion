/**
 * Local mirror of the API contract.
 *
 * Kept separate from @silpo/shared because Metro does not resolve workspace
 * TypeScript sources without extra config; these few types are cheap to duplicate.
 */

export interface AuthStatus {
  authorized: boolean;
  authorizationUrl?: string;
}

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

/** Why an item is on the list — always shown to the guest. */
export type ItemSource = 'rhythm' | 'coupon' | 'price' | 'discovery' | 'guest';

/** A concrete product resolved from the Silpo catalogue. */
export interface ProductOption {
  productId: string;
  title: string;
  price: number;
  /** Pre-discount price when the item is on promotion. */
  oldPrice?: number;
  stock?: number;
  available?: boolean;
  image?: string;
  slug?: string;
  weighted?: boolean;
}

export interface ListItem {
  id: string;
  title: string;
  query: string;
  quantity: number;
  unit: string;
  zone: ZoneId;
  source: ItemSource;
  reason: string;
  picked: boolean;
  missing?: boolean;
  /** The guest's usual pick, resolved against the catalogue. */
  product?: ProductOption;
  /** Cheaper options shown ALONGSIDE `product`, never replacing it. */
  alternatives?: ProductOption[];
  /** Which option the guest settled on; defaults to `product`. */
  chosenProductId?: string;
  inCart?: boolean;
  price?: number;
  productId?: string;
}

export interface ZoneGroup {
  zone: ZoneId;
  title: string;
  emoji: string;
  hint: string;
  /** Position on the schematic 4×4 floor plan; a model, not a real store's plan. */
  cell: { col: number; row: number };
  items: ListItem[];
}

export interface CouponVerdict {
  id: number;
  description: string;
  rewardText?: string;
  daysLeft: number;
  urgency: 'expired' | 'today' | 'soon' | 'later';
  matchesDiet: boolean;
  reason: string;
}

export interface PriceAlert {
  title: string;
  paidPrice: number;
  currentPrice: number;
  changePercent: number;
}

export interface ShoppingList {
  sessionId: string;
  createdAt: string;
  greeting: string;
  items: ListItem[];
  coupons: CouponVerdict[];
  priceAlerts: PriceAlert[];
  currentZone?: ZoneId;
  spokenZones: ZoneId[];
  toolCalls: string[];
}

export interface AgentReaction {
  spoke: boolean;
  message?: string;
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
  zonesDone: string[];
  currentZone?: string;
}

export interface ListResponse {
  list: ShoppingList;
  route: ZoneGroup[];
  progress: WalkProgress;
}

export interface AisleEventResponse extends ListResponse {
  reaction: AgentReaction;
}

export interface AddToCartResponse extends ListResponse {
  /** How many products were written into the Silpo cart. */
  added: number;
  /** Link the guest opens to finish the order; the agent never checks out. */
  checkoutUrl?: string;
  /** Cart total after discounts, straight from Silpo. */
  total?: number;
  /** Blockers the guest has to resolve before checkout becomes available. */
  warnings?: string[];
}

export type AisleEventType = 'picked' | 'missing' | 'zone-left' | 'finished';
