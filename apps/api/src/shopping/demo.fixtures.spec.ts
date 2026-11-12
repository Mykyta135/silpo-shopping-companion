import { DEMO_LIST_PROPOSAL, demoReaction } from './demo.fixtures.js';

describe('DEMO_LIST_PROPOSAL', () => {
  it('gives every item a reason, since that is the product promise', () => {
    for (const item of DEMO_LIST_PROPOSAL.items) {
      expect(item.reason.trim().length).toBeGreaterThan(10);
    }
  });

  it('judges every coupon, including the ones it rejects', () => {
    const matched = DEMO_LIST_PROPOSAL.couponMatches.filter((c) => c.matchesDiet);
    const rejected = DEMO_LIST_PROPOSAL.couponMatches.filter((c) => !c.matchesDiet);

    // A demo that only ever says yes would not show the product's actual value.
    expect(matched.length).toBeGreaterThan(0);
    expect(rejected.length).toBeGreaterThan(0);
    for (const coupon of rejected) {
      expect(coupon.reason.trim().length).toBeGreaterThan(5);
    }
  });

  it('contains no duplicate products', () => {
    const titles = DEMO_LIST_PROPOSAL.items.map((i) => i.title.toLowerCase());
    expect(new Set(titles).size).toBe(titles.length);
    // Discovery must not repeat something already listed.
    expect(titles).not.toContain(DEMO_LIST_PROPOSAL.discovery?.title.toLowerCase());
  });
});

describe('demoReaction', () => {
  it('mentions the coupon when the guest picks the cheese', () => {
    const reaction = demoReaction(
      { type: 'picked', title: 'Сир кисломолочний President Сирна традиція 5%' },
      false,
    );
    expect(reaction.speak).toBe(true);
    expect(reaction.message).toContain('купон');
  });

  it('stays silent once it has already spoken in the zone', () => {
    const reaction = demoReaction(
      { type: 'picked', title: 'Сир кисломолочний President' },
      true,
    );
    expect(reaction.speak).toBe(false);
  });

  it('offers a substitute from the same product family', () => {
    const bread = demoReaction(
      { type: 'missing', title: 'Хліб Київхліб Український' },
      false,
    );
    expect(bread.suggestion?.title).toMatch(/хліб/i);

    // «яйця курячі» must not be answered with chicken fillet — the egg rule
    // has to win over the chicken one.
    const eggs = demoReaction({ type: 'missing', title: 'Яйця курячі Квочка С0' }, false);
    expect(eggs.suggestion?.title).toMatch(/яйц/i);
    expect(eggs.suggestion?.title).not.toMatch(/філе/i);

    const chicken = demoReaction(
      { type: 'missing', title: 'Філе куряче Епікур охолоджене' },
      false,
    );
    expect(chicken.suggestion?.title).toMatch(/філе/i);
  });

  it('admits it has no substitute rather than inventing one', () => {
    const reaction = demoReaction({ type: 'missing', title: 'Щось геть екзотичне' }, false);
    expect(reaction.speak).toBe(true);
    expect(reaction.suggestion).toBeUndefined();
  });

  it('says nothing when a zone is left with everything collected', () => {
    const reaction = demoReaction(
      { type: 'zone-left', zone: 'Бакалія', remaining: [] },
      false,
    );
    expect(reaction.speak).toBe(false);
  });

  it('names what was left behind when the guest walks on', () => {
    const reaction = demoReaction(
      { type: 'zone-left', zone: 'Молочне', remaining: ['Молоко', 'Яйця'] },
      false,
    );
    expect(reaction.speak).toBe(true);
    expect(reaction.message).toContain('Молоко');
  });
});
