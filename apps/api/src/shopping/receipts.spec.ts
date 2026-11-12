import {
  extractReceiptItems,
  filterSince,
  unwrapToolResult,
  verifyMatches,
} from './receipts.js';

describe('unwrapToolResult', () => {
  it('unwraps the MCP text-content envelope into the JSON payload', () => {
    const wrapped = {
      content: [{ type: 'text', text: '{"orders":[{"id":1}]}' }],
    };
    expect(unwrapToolResult(wrapped)).toEqual({ orders: [{ id: 1 }] });
  });

  it('passes through payloads that are not wrapped', () => {
    expect(unwrapToolResult({ orders: [] })).toEqual({ orders: [] });
  });
});

describe('extractReceiptItems', () => {
  it('flattens line items and inherits the order date', () => {
    const payload = {
      orders: [
        {
          createdAt: '2026-01-11T10:00:00.000Z',
          items: [{ title: 'Спагеті Barilla 500г' }, { name: 'Томати чері 250г' }],
        },
      ],
    };

    const items = extractReceiptItems(payload, 'offline');

    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      title: 'Спагеті Barilla 500г',
      purchasedAt: '2026-01-11T10:00:00.000Z',
      source: 'offline',
    });
    // `name` is accepted as an alternative title key.
    expect(items[1].title).toBe('Томати чері 250г');
  });

  it('finds orders nested inside wrapper objects', () => {
    const payload = { data: { result: { orders: [{ products: [{ title: 'Сир' }] }] } } };
    expect(extractReceiptItems(payload, 'online').map((i) => i.title)).toEqual(['Сир']);
  });

  it('returns nothing for unrecognised shapes rather than guessing', () => {
    expect(extractReceiptItems({ totally: 'unexpected' }, 'online')).toEqual([]);
    expect(extractReceiptItems(null, 'online')).toEqual([]);
  });
});

describe('filterSince', () => {
  const items = [
    { title: 'старе', purchasedAt: '2026-01-01T00:00:00.000Z', source: 'offline' as const },
    { title: 'нове', purchasedAt: '2026-01-15T00:00:00.000Z', source: 'offline' as const },
  ];

  it('drops purchases made before the cutoff', () => {
    const kept = filterSince(items, '2026-01-10T00:00:00.000Z');
    expect(kept.map((i) => i.title)).toEqual(['нове']);
  });

  it('keeps items whose date could not be parsed', () => {
    const undated = [{ title: 'без дати', purchasedAt: '', source: 'offline' as const }];
    expect(filterSince(undated, '2026-01-10T00:00:00.000Z')).toHaveLength(1);
  });
});

describe('verifyMatches', () => {
  const ingredients = ['паста', 'томати', 'сир'];
  const receipts = [
    { title: 'Спагеті Barilla', purchasedAt: '', source: 'offline' as const },
    { title: 'Томати чері', purchasedAt: '', source: 'offline' as const },
    { title: 'Сир Гауда', purchasedAt: '', source: 'offline' as const },
  ];

  it('keeps the model semantic matches when receipts back them', () => {
    const { verified, rejected } = verifyMatches(
      ['паста', 'томати'],
      receipts,
      ingredients,
    );
    expect(verified).toEqual(['паста', 'томати']);
    expect(rejected).toEqual([]);
  });

  it('rejects ingredients the level never asked for', () => {
    const { verified, rejected } = verifyMatches(
      ['паста', 'ікра'],
      receipts,
      ingredients,
    );
    expect(verified).toEqual(['паста']);
    expect(rejected).toEqual(['ікра']);
  });

  it('caps matches at the number of receipt lines available', () => {
    const oneLine = [receipts[0]];
    const { verified } = verifyMatches(ingredients, oneLine, ingredients);
    // Three claims, one purchased line — only one can be backed.
    expect(verified).toHaveLength(1);
  });

  it('counts a duplicated claim only once', () => {
    const { verified } = verifyMatches(['паста', 'паста'], receipts, ingredients);
    expect(verified).toEqual(['паста']);
  });
});
