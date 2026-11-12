/**
 * Coupon triage: which of the guest's coupons are actually worth anything to them.
 *
 * `get_my_coupons` returns a list; `get_coupon_details` adds `rewardText`,
 * `rewardValue` and `usedCount` — but **never a list of qualifying products**.
 * So matching a coupon to the guest's diet cannot be an id lookup; it is a
 * semantic judgement over the coupon's free-text description, which is why the
 * model does that step (see `list.service`).
 *
 * What lives here is everything that must NOT be left to a model: expiry
 * arithmetic, used/unused state, and ranking.
 */

export interface CouponSummary {
  id: number;
  active: boolean;
  description: string;
  beginDate: string;
  endDate: string;
}

export interface CouponDetail extends CouponSummary {
  /** e.g. «+20 балобонусів», «x30 балобонусів», «за 1 грн». */
  rewardText?: string;
  rewardValue?: number;
  /** 0 means the guest has not redeemed it yet. */
  usedCount?: number;
  limitText?: string;
}

export type CouponUrgency = 'expired' | 'today' | 'soon' | 'later';

export interface TriagedCoupon extends CouponDetail {
  /** Whole days until `endDate`; negative once expired. */
  daysLeft: number;
  urgency: CouponUrgency;
  /** True when still redeemable: active, unused and not expired. */
  redeemable: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Days from `now` to the end of `endDate`, counting the end date as usable. */
export function daysUntil(endDate: string, now: Date): number {
  const end = Date.parse(`${endDate}T23:59:59`);
  if (Number.isNaN(end)) return 0;
  return Math.floor((end - now.getTime()) / DAY_MS);
}

function rateUrgency(daysLeft: number): CouponUrgency {
  if (daysLeft < 0) return 'expired';
  if (daysLeft === 0) return 'today';
  if (daysLeft <= 2) return 'soon';
  return 'later';
}

/**
 * Adds expiry and redeemability to each coupon, newest deadline first.
 *
 * @param now Injectable clock so tests do not depend on the current date.
 */
export function triageCoupons(
  coupons: CouponDetail[],
  now: Date = new Date(),
): TriagedCoupon[] {
  return coupons
    .map((coupon) => {
      const daysLeft = daysUntil(coupon.endDate, now);
      const urgency = rateUrgency(daysLeft);
      return {
        ...coupon,
        daysLeft,
        urgency,
        // `usedCount` is absent on the list endpoint; treat unknown as unused,
        // since suggesting an already-used coupon is a milder failure than
        // hiding a valid one.
        redeemable: coupon.active && urgency !== 'expired' && !coupon.usedCount,
      };
    })
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

/** Coupons about to expire unused — the ones worth interrupting the guest for. */
export function expiringSoon(
  coupons: TriagedCoupon[],
  withinDays = 2,
): TriagedCoupon[] {
  return coupons.filter((c) => c.redeemable && c.daysLeft <= withinDays);
}

/**
 * Estimated worth of a coupon, used only for ranking.
 *
 * The reward formats are not comparable in any exact way — «x30 балобонусів»
 * is a multiplier on an unknown basket, «за 1 грн» is a free product. These
 * weights order them sensibly; they are NOT a promise of value to the guest,
 * so never show this number as money.
 */
export function estimateWorth(coupon: CouponDetail): number {
  const text = (coupon.rewardText ?? '').toLowerCase();
  const value = coupon.rewardValue ?? 0;

  if (text.includes('за 1 грн')) return 100;
  if (text.startsWith('x') || text.includes('×')) return value * 2;
  if (text.includes('%')) return value * 3;
  return value;
}

export interface CouponRelevance {
  couponId: number;
  /** Set by the model: does this coupon fit what the guest actually buys? */
  matchesDiet: boolean;
  /** Model's one-line reason, shown to the guest. */
  reason: string;
}

export interface RankedCoupon extends TriagedCoupon {
  matchesDiet: boolean;
  reason: string;
  /** Higher ranks first: relevance dominates, then urgency, then worth. */
  score: number;
}

/**
 * Ranks coupons by combining the model's diet judgement with hard facts.
 *
 * A coupon the guest will never use is worthless no matter how generous, so
 * relevance dominates the score. This is exactly the failure the live account
 * demonstrated: three coupons (Lion bars, croissants, juice) were activated
 * despite nothing of the sort appearing in three months of receipts.
 */
export function rankCoupons(
  coupons: TriagedCoupon[],
  relevance: CouponRelevance[],
): RankedCoupon[] {
  const byId = new Map(relevance.map((r) => [r.couponId, r]));

  return coupons
    .map((coupon) => {
      const match = byId.get(coupon.id);
      const matchesDiet = match?.matchesDiet ?? false;

      // Urgency only matters for coupons the guest would actually use.
      const urgencyBonus = matchesDiet && coupon.daysLeft <= 2 ? 50 : 0;
      const score =
        (matchesDiet ? 1000 : 0) + urgencyBonus + estimateWorth(coupon);

      return {
        ...coupon,
        matchesDiet,
        reason: match?.reason ?? 'Не збігається з тим, що ти зазвичай береш',
        score,
      };
    })
    .sort((a, b) => b.score - a.score);
}

/** Human-readable deadline for the UI. */
export function describeDeadline(coupon: TriagedCoupon): string {
  switch (coupon.urgency) {
    case 'expired':
      return 'вже згорів';
    case 'today':
      return 'згорає сьогодні';
    case 'soon':
      return `згорає через ${coupon.daysLeft} дн.`;
    default:
      return `діє ще ${coupon.daysLeft} дн.`;
  }
}
