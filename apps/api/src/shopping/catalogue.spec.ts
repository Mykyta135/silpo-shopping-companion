import {
  filterRelevant,
  groupByQuery,
  isOnPromotion,
  isRelevant,
  orderQuantity,
  pickOptions,
  queryVariants,
  rankByCloseness,
  savingPercent,
} from './catalogue.js';
import type { ProductOption } from '@silpo/shared';

/** Mirrors the live response shape: { queries: [{ query, products }] }. */
function response(query: string, products: unknown[]) {
  return { queries: [{ query, totalFound: products.length, products }] };
}

function raw(over: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    name: 'Молоко',
    price: 42,
    stock: 5,
    available: true,
    ...over,
  };
}

describe('groupByQuery', () => {
  it('maps each search term to its products', () => {
    const grouped = groupByQuery(response('молоко', [raw(), raw({ id: 'p2' })]));
    expect(grouped.get('молоко')).toHaveLength(2);
  });

  it('skips products missing an id, name or price', () => {
    const grouped = groupByQuery(
      response('молоко', [
        raw(),
        raw({ id: undefined }),
        raw({ name: undefined }),
        raw({ price: undefined }),
      ]),
    );
    // A product we cannot price or add to a cart is useless to show.
    expect(grouped.get('молоко')).toHaveLength(1);
  });

  it('returns an empty map for unrecognised payloads rather than throwing', () => {
    expect(groupByQuery(null).size).toBe(0);
    expect(groupByQuery({ totally: 'unexpected' }).size).toBe(0);
  });

  it('normalises the query key so lookups are case-insensitive', () => {
    const grouped = groupByQuery(response('  Молоко  ', [raw()]));
    expect(grouped.has('молоко')).toBe(true);
  });
});

describe('pickOptions', () => {
  const option = (over: Partial<ProductOption>): ProductOption => ({
    productId: 'x',
    title: 'товар',
    price: 50,
    stock: 5,
    available: true,
    ...over,
  });

  it('treats the first in-stock result as the main option', () => {
    const { product } = pickOptions([
      option({ productId: 'a', price: 60 }),
      option({ productId: 'b', price: 40 }),
    ]);
    // Catalogue order is relevance, so the first match is what was asked for.
    expect(product?.productId).toBe('a');
  });

  it('offers only cheaper products as alternatives', () => {
    const { alternatives } = pickOptions([
      option({ productId: 'a', price: 50 }),
      option({ productId: 'b', price: 40 }),
      option({ productId: 'c', price: 70 }),
    ]);

    expect(alternatives.map((o) => o.productId)).toEqual(['b']);
  });

  it('sorts alternatives cheapest first and caps how many are shown', () => {
    const { alternatives } = pickOptions(
      [
        option({ productId: 'a', price: 100 }),
        option({ productId: 'b', price: 90 }),
        option({ productId: 'c', price: 50 }),
        option({ productId: 'd', price: 70 }),
      ],
      2,
    );

    expect(alternatives.map((o) => o.productId)).toEqual(['c', 'd']);
  });

  it('skips out-of-stock products when choosing the main option', () => {
    const { product } = pickOptions([
      option({ productId: 'a', stock: 0 }),
      option({ productId: 'b', available: false }),
      option({ productId: 'c' }),
    ]);
    expect(product?.productId).toBe('c');
  });

  it('still shows the top match when nothing is in stock', () => {
    // Better to show what was meant than an empty row.
    const { product, alternatives } = pickOptions([
      option({ productId: 'a', stock: 0 }),
      option({ productId: 'b', stock: 0 }),
    ]);
    expect(product?.productId).toBe('a');
    expect(alternatives).toEqual([]);
  });

  it('returns nothing when the catalogue found nothing', () => {
    expect(pickOptions([])).toEqual({ product: undefined, alternatives: [] });
  });
});

describe('queryVariants', () => {
  it('broadens a qualified phrase down to the head noun', () => {
    // Live server behaviour: «молоко» finds products, «молоко яготинське 2.6»
    // finds none — so the specific term is tried first, then fallbacks.
    expect(queryVariants('молоко яготинське 2.6')).toEqual([
      'молоко яготинське 2 6',
      'молоко яготинське',
      'молоко',
    ]);
  });

  it('leaves a single word alone', () => {
    expect(queryVariants('нут')).toEqual(['нут']);
  });

  it('strips quotes and punctuation that break the search', () => {
    expect(queryVariants('Крупа перлова «Повна Чаша»')[0]).toBe('крупа перлова повна чаша');
  });

  it('never returns duplicates', () => {
    const variants = queryVariants('сир сир');
    expect(new Set(variants).size).toBe(variants.length);
  });

  it('returns nothing for an empty query', () => {
    expect(queryVariants('   ')).toEqual([]);
  });
});

describe('isRelevant', () => {
  const product = (title: string): ProductOption => ({
    productId: 'p',
    title,
    price: 10,
  });

  it('rejects the wrong-category hits seen on live data', () => {
    // Every one of these actually came back from a broadened search.
    // Fish is not chicken, even though both are sold as «філе».
    expect(isRelevant('Філе куряче Епікур', product('Хек VICI, порції філе'))).toBe(false);
    expect(
      isRelevant('Філе куряче Епікур', product('Оселедець Премія філе з прянощами')),
    ).toBe(false);
    expect(isRelevant('Яйця курячі Квочка С0', product('Молоко ультрапастеризоване'))).toBe(
      false,
    );
    expect(isRelevant('Нут Kwidzyn', product('Шоколад молочний Millennium Nut'))).toBe(
      false,
    );
  });

  it('still accepts the right product within a guarded family', () => {
    expect(
      isRelevant('Філе куряче Епікур', product('Філе куряче «Наша Ряба» охолоджене')),
    ).toBe(true);
    expect(isRelevant('Яйця курячі Квочка', product('Яйця курячі «Ясенсвіт» С0'))).toBe(
      true,
    );
    // Fish queries must still find fish.
    expect(isRelevant('Хек філе', product('Хек VICI, порції філе'))).toBe(true);
  });

  it('accepts a genuine match despite brand noise', () => {
    expect(
      isRelevant('Молоко Яготинське 2.6%', product('Молоко ультрапастеризоване «Яготинське» 2,6%')),
    ).toBe(true);
    expect(
      isRelevant('Крупа перлова «Повна Чаша»', product('Крупа «Сквирянка» ячмінна перлова')),
    ).toBe(true);
  });

  it('matches simple declensions by stem', () => {
    expect(isRelevant('молоко', product('Молока пляшка'))).toBe(true);
    expect(isRelevant('крупа', product('Крупи ячмінні'))).toBe(true);
    // Vowel alternation («яйця» → «яєць») is beyond a stem prefix; catalogue
    // titles use the nominative anyway, so this is not worth a morphology lib.
    expect(isRelevant('яйця', product('Яйця курячі С0'))).toBe(true);
  });

  it('ignores generic words that prove nothing', () => {
    // «свіжий» alone must not make canned fish a match for fresh mushrooms.
    expect(isRelevant('свіжий', product('Тунець консервований'))).toBe(true);
    expect(isRelevant('Гриби свіжі', product('Тунець консервований'))).toBe(false);
  });
});

describe('filterRelevant', () => {
  it('drops irrelevant hits and keeps the rest', () => {
    const options: ProductOption[] = [
      { productId: 'a', title: 'Нут сушений', price: 50 },
      { productId: 'b', title: 'Шоколад Nut Praline', price: 25 },
    ];
    expect(filterRelevant('Нут', options).map((o) => o.productId)).toEqual(['a']);
  });
});

describe('rankByCloseness', () => {
  const cheese = (fat: string, id: string): ProductOption => ({
    productId: id,
    title: `Сир кисломолочний President Сирна Традиція ${fat}, ванночка`,
    price: 60,
  });

  it('puts the requested fat percentage first', () => {
    // Live bug: a 5% request ordered the 0,2% tub, because relevance alone
    // could not tell the variants apart.
    const ranked = rankByCloseness('Сир кисломолочний President Сирна традиція 5%', [
      cheese('0,2%', 'a'),
      cheese('9%', 'b'),
      cheese('5%', 'c'),
    ]);

    expect(ranked[0].productId).toBe('c');
  });

  it('prefers the nearest percentage when there is no exact match', () => {
    const ranked = rankByCloseness('молоко 2,6%', [
      { productId: 'a', title: 'Молоко 1%', price: 30 },
      { productId: 'b', title: 'Молоко 2,5%', price: 32 },
    ]);
    expect(ranked[0].productId).toBe('b');
  });

  it('leaves the order alone when the query states no percentage', () => {
    const options = [cheese('0,2%', 'a'), cheese('5%', 'b')];
    expect(rankByCloseness('сир President', options).map((o) => o.productId)).toEqual([
      'a',
      'b',
    ]);
  });
});

describe('orderQuantity', () => {
  it('orders weighted goods in steps, not kilograms', () => {
    // Live bug: one tray of chicken fillet (step 0.6 kg) was ordered as «1»,
    // which Silpo read as a full kilogram — 273 UAH of meat.
    const fillet: ProductOption = {
      productId: 'a',
      title: 'Філе куряче',
      price: 303,
      weighted: true,
      step: 0.6,
    };

    expect(orderQuantity(fillet, 1)).toBe(0.6);
    expect(orderQuantity(fillet, 2)).toBe(1.2);
  });

  it('rounds piece goods to whole units', () => {
    const eggs: ProductOption = {
      productId: 'b',
      title: 'Яйця',
      price: 59,
      weighted: false,
      step: 1,
    };

    expect(orderQuantity(eggs, 1.4)).toBe(1);
    expect(orderQuantity(eggs, 2)).toBe(2);
  });

  it('never orders less than one unit', () => {
    const item: ProductOption = { productId: 'c', title: 'X', price: 10 };
    expect(orderQuantity(item, 0)).toBe(1);
    expect(orderQuantity(item, -3)).toBe(1);
  });

  it('falls back to whole units when no step is given', () => {
    const weightless: ProductOption = {
      productId: 'd',
      title: 'Y',
      price: 10,
      weighted: true,
    };
    expect(orderQuantity(weightless, 2)).toBe(2);
  });
});

describe('savingPercent', () => {
  it('measures the saving against the main option', () => {
    const main = { productId: 'a', title: '', price: 100 };
    const cheaper = { productId: 'b', title: '', price: 75 };
    expect(savingPercent(main, cheaper)).toBe(25);
  });

  it('does not divide by a zero price', () => {
    expect(savingPercent({ productId: 'a', title: '', price: 0 }, { productId: 'b', title: '', price: 10 })).toBe(0);
  });
});

describe('isOnPromotion', () => {
  it('detects a real discount only', () => {
    expect(isOnPromotion({ productId: 'a', title: '', price: 40, oldPrice: 50 })).toBe(true);
    expect(isOnPromotion({ productId: 'a', title: '', price: 40 })).toBe(false);
    // An oldPrice at or below the current price is not a discount.
    expect(isOnPromotion({ productId: 'a', title: '', price: 40, oldPrice: 40 })).toBe(false);
  });
});
