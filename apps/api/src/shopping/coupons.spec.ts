import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  daysUntil,
  describeDeadline,
  estimateWorth,
  expiringSoon,
  rankCoupons,
  triageCoupons,
  type CouponDetail,
} from './coupons.js';

const NOW = new Date('2026-08-09T12:00:00.000Z');

function coupon(over: Partial<CouponDetail> & { id: number }): CouponDetail {
  return {
    active: true,
    description: 'тестовий купон',
    beginDate: '2026-08-01',
    endDate: '2026-08-20',
    ...over,
  };
}

describe('daysUntil', () => {
  it('counts the end date itself as usable', () => {
    expect(daysUntil('2026-08-09', NOW)).toBe(0);
    expect(daysUntil('2026-08-11', NOW)).toBe(2);
  });

  it('goes negative once past', () => {
    expect(daysUntil('2026-08-07', NOW)).toBeLessThan(0);
  });
});

describe('triageCoupons', () => {
  it('sorts by deadline and labels urgency', () => {
    const result = triageCoupons(
      [
        coupon({ id: 1, endDate: '2026-08-31' }),
        coupon({ id: 2, endDate: '2026-08-09' }),
        coupon({ id: 3, endDate: '2026-08-11' }),
      ],
      NOW,
    );

    expect(result.map((c) => c.id)).toEqual([2, 3, 1]);
    expect(result[0].urgency).toBe('today');
    expect(result[1].urgency).toBe('soon');
    expect(result[2].urgency).toBe('later');
  });

  it('marks used, inactive and expired coupons as not redeemable', () => {
    const result = triageCoupons(
      [
        coupon({ id: 1, usedCount: 1 }),
        coupon({ id: 2, active: false }),
        coupon({ id: 3, endDate: '2026-08-01' }),
        coupon({ id: 4 }),
      ],
      NOW,
    );

    const redeemable = result.filter((c) => c.redeemable).map((c) => c.id);
    expect(redeemable).toEqual([4]);
  });

  it('treats an unknown usedCount as unused', () => {
    // The list endpoint omits usedCount; hiding a valid coupon would be worse
    // than suggesting one already redeemed.
    const [result] = triageCoupons([coupon({ id: 1 })], NOW);
    expect(result.redeemable).toBe(true);
  });
});

describe('expiringSoon', () => {
  it('returns only redeemable coupons inside the window', () => {
    const triaged = triageCoupons(
      [
        coupon({ id: 1, endDate: '2026-08-10' }),
        coupon({ id: 2, endDate: '2026-08-10', usedCount: 1 }),
        coupon({ id: 3, endDate: '2026-08-25' }),
      ],
      NOW,
    );

    expect(expiringSoon(triaged).map((c) => c.id)).toEqual([1]);
  });
});

describe('estimateWorth', () => {
  it('ranks a free product above multipliers and flat bonuses', () => {
    const free = estimateWorth(coupon({ id: 1, rewardText: 'за 1 грн', rewardValue: 1 }));
    const multiplier = estimateWorth(
      coupon({ id: 2, rewardText: 'x30 балобонусів', rewardValue: 30 }),
    );
    const flat = estimateWorth(
      coupon({ id: 3, rewardText: '+20 балобонусів', rewardValue: 20 }),
    );

    expect(free).toBeGreaterThan(multiplier);
    expect(multiplier).toBeGreaterThan(flat);
  });
});

describe('rankCoupons', () => {
  it('puts a relevant coupon above a generous irrelevant one', () => {
    const triaged = triageCoupons(
      [
        coupon({ id: 1, rewardText: 'за 1 грн', rewardValue: 1 }), // generous
        coupon({ id: 2, rewardText: '+20 балобонусів', rewardValue: 20 }), // modest
      ],
      NOW,
    );

    const ranked = rankCoupons(triaged, [
      { couponId: 2, matchesDiet: true, reason: 'ти це береш' },
      { couponId: 1, matchesDiet: false, reason: 'не береш' },
    ]);

    // Relevance dominates: a coupon the guest will never use is worth nothing.
    expect(ranked[0].id).toBe(2);
  });

  it('raises a relevant coupon that is about to expire', () => {
    const triaged = triageCoupons(
      [
        coupon({ id: 1, endDate: '2026-08-25', rewardValue: 20 }),
        coupon({ id: 2, endDate: '2026-08-10', rewardValue: 20 }),
      ],
      NOW,
    );

    const ranked = rankCoupons(triaged, [
      { couponId: 1, matchesDiet: true, reason: '' },
      { couponId: 2, matchesDiet: true, reason: '' },
    ]);

    expect(ranked[0].id).toBe(2);
  });

  it('explains why an unmatched coupon was skipped', () => {
    const triaged = triageCoupons([coupon({ id: 1 })], NOW);
    const [ranked] = rankCoupons(triaged, []);

    expect(ranked.matchesDiet).toBe(false);
    expect(ranked.reason).toContain('Не збігається');
  });
});

describe('describeDeadline', () => {
  it('words each urgency level for the guest', () => {
    const [today, soon, later] = triageCoupons(
      [
        coupon({ id: 1, endDate: '2026-08-09' }),
        coupon({ id: 2, endDate: '2026-08-11' }),
        coupon({ id: 3, endDate: '2026-08-31' }),
      ],
      NOW,
    );

    expect(describeDeadline(today)).toBe('згорає сьогодні');
    expect(describeDeadline(soon)).toBe('згорає через 2 дн.');
    expect(describeDeadline(later)).toContain('діє ще');
  });
});

describe('on real coupons', () => {
  const coupons = JSON.parse(
    readFileSync(join(__dirname, '__fixtures__/real-coupons.json'), 'utf8'),
  ) as CouponDetail[];

  it('flags the three that expire first on the live account', () => {
    const triaged = triageCoupons(coupons, NOW);
    const soon = expiringSoon(triaged);

    // Lion, croissants and juice all end 2026-08-11 — two days out.
    expect(soon).toHaveLength(3);
    expect(soon.every((c) => c.daysLeft === 2)).toBe(true);
    expect(soon.map((c) => c.description).join(' ')).toContain('Lion');
  });

  it('demotes the expiring coupons once the diet says they do not fit', () => {
    const triaged = triageCoupons(coupons, NOW);

    // The guest bought no sweets, pastry or juice in three months of receipts.
    const ranked = rankCoupons(triaged, [
      { couponId: 530007895, matchesDiet: true, reason: 'береш без цукру' },
      { couponId: 530007897, matchesDiet: true, reason: 'багато товарів Премія' },
      { couponId: 530007412, matchesDiet: false, reason: 'солодке не береш' },
      { couponId: 530007413, matchesDiet: false, reason: 'випічку не береш' },
      { couponId: 530007414, matchesDiet: false, reason: 'соки не береш' },
    ]);

    const topIds = ranked.slice(0, 2).map((c) => c.id);
    expect(topIds).toContain(530007895);
    expect(topIds).toContain(530007897);

    // The urgent-but-irrelevant ones sink despite expiring in two days.
    const lion = ranked.findIndex((c) => c.id === 530007412);
    expect(lion).toBeGreaterThan(1);
  });
});
