/**
 * Domain types for the official Silpo MCP server (https://mcp.silpo.ua/mcp).
 *
 * These mirror the documented tool surface. The server is the source of truth —
 * always read `tools/list` at agent startup rather than hardcoding schemas.
 */

/** Delivery types returned by silpo_get_available_delivery_types. */
export type SilpoDeliveryType =
  | 'DeliveryHome'
  | 'WideAssortDelivery'
  | 'SelfPickup'
  | 'NovaPoshta'
  | 'B2B';

/**
 * Cart context required by every tool marked "cart" in the docs.
 * Obtained via silpo_get_my_shopping_cart -> silpo_get_shopping_cart_by_id.
 */
export interface SilpoCartContext {
  cartId: string;
  branchId: string;
  deliveryType: SilpoDeliveryType;
  /** Selected timeslot id; must be re-validated via silpo_get_time_slots. */
  timeslotId?: string;
}

/** Loyalty block of the cart, used to decide whether to offer balabonuses. */
export interface SilpoLoyaltyState {
  bonusAvailable: number;
  bonusRequested: number | null;
  isEnabled: boolean;
}

/**
 * Read-only Silpo MCP tools are recognised by name (`silpo_get_*`,
 * `silpo_find_*`, …). Tools are loaded live from the MCP server, so the check
 * fails closed: any other name — including a write tool Silpo adds later — is
 * treated as state-changing and needs the guest's approval.
 */
const SILPO_READ_TOOL = /^silpo_(get|find|list|search)_[a-z0-9_]+$/;

export function isSilpoReadTool(name: string): boolean {
  return SILPO_READ_TOOL.test(name);
}

export function isSilpoWriteTool(name: string): boolean {
  return !isSilpoReadTool(name);
}

/** Tools that require cart context (branchId/deliveryType/timeslot) to be resolved first. */
export const SILPO_CART_SCOPED_TOOLS = [
  'silpo_find_products_batch',
  'silpo_get_products',
  'silpo_get_product_details',
  'silpo_get_similar_products',
  'silpo_get_replacements',
  'silpo_get_promotions',
  'silpo_get_popular_categories',
  'silpo_get_category',
  'silpo_get_categories_tree',
] as const;

export function isCartScopedTool(name: string): boolean {
  return (SILPO_CART_SCOPED_TOOLS as readonly string[]).includes(name);
}
