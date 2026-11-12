import { ConfigService } from '@nestjs/config';

// The AI SDK is ESM-only and would need its whole transitive chain transformed.
// These tests never reach the model, so the modules are mocked outright.
jest.mock('@ai-sdk/anthropic', () => ({ createAnthropic: () => () => ({}) }));
jest.mock('ai', () => ({
  generateText: jest.fn(),
  stepCountIs: jest.fn(),
  tool: jest.fn(),
}));

import type { ListItem, ShoppingList } from '@silpo/shared';
import { ShoppingService } from './shopping.service.js';
import type { ListProposal } from './shopping.schemas.js';
import type { McpToolsFactory } from '../agent/mcp-tools.factory.js';
import type { SilpoMcpService } from '../mcp/silpo-mcp.service.js';
import type { ListStore } from './list.store.js';

/** Reaches the private mapper without exporting it just for tests. */
function toItems(service: ShoppingService, proposal: ListProposal) {
  return (
    service as unknown as {
      toListItems: (p: ListProposal) => { title: string; source: string; id: string }[];
    }
  ).toListItems(proposal);
}

function makeService(
  mcp: Partial<SilpoMcpService> = {},
  store: Partial<ListStore> = {},
): ShoppingService {
  const config = {
    getOrThrow: () => 'test-key',
    get: (_key: string, fallback: string) => fallback,
  } as unknown as ConfigService;

  return new ShoppingService(
    {} as McpToolsFactory,
    mcp as SilpoMcpService,
    store as ListStore,
    config,
  );
}

describe('ShoppingService.addToCart', () => {
  const option = (over: Record<string, unknown> = {}) => ({
    productId: 'prod-1',
    title: 'Молоко',
    price: 40,
    companyId: 'co-1',
    branchId: 'br-1',
    ...over,
  });

  function item(over: Partial<ListItem> = {}): ListItem {
    return {
      id: 'item-0',
      title: 'Молоко',
      query: 'молоко',
      quantity: 2,
      unit: 'шт',
      zone: 'dairy',
      source: 'rhythm',
      reason: 'причина',
      picked: false,
      product: option(),
      ...over,
    } as ListItem;
  }

  /** Captures what the service sends to the cart tools. */
  function harness(items: ListItem[]) {
    const list: ShoppingList = {
      sessionId: 's1',
      createdAt: '',
      greeting: '',
      items,
      coupons: [],
      priceAlerts: [],
      spokenZones: [],
      toolCalls: [],
    };
    const calls: { name: string; args: Record<string, unknown> }[] = [];

    const mcp = {
      callTool: (_s: string, name: string, args: Record<string, unknown>) => {
        calls.push({ name, args });
        if (name === 'silpo_get_my_shopping_cart') {
          return Promise.resolve({ shoppingCartId: 'cart-1' });
        }
        if (name === 'silpo_get_shopping_cart_by_id') {
          return Promise.resolve({ cart: { checkoutWebLink: 'https://silpo.ua/checkout' } });
        }
        return Promise.resolve({});
      },
    };
    const store = {
      get: () => Promise.resolve(list),
      mutate: (_s: string, fn: (l: ShoppingList) => void) => {
        fn(list);
        return Promise.resolve(list);
      },
    };

    return { list, calls, service: makeService(mcp, store) };
  }

  it('sends the chosen product with its company and branch', async () => {
    const { calls, service } = harness([item()]);

    const result = await service.addToCart('s1');

    const add = calls.find((c) => c.name === 'silpo_add_or_update_cart_products');
    expect(add?.args.products).toEqual([
      { productId: 'prod-1', companyId: 'co-1', branchId: 'br-1', quantity: 2 },
    ]);
    expect(result.added).toBe(1);
    expect(result.checkoutUrl).toBe('https://silpo.ua/checkout');
  });

  it('sends the alternative when the guest picked one', async () => {
    const { calls, service } = harness([
      item({
        alternatives: [option({ productId: 'prod-2', price: 30 })],
        chosenProductId: 'prod-2',
      }),
    ]);

    await service.addToCart('s1');

    const add = calls.find((c) => c.name === 'silpo_add_or_update_cart_products');
    expect((add?.args.products as { productId: string }[])[0].productId).toBe('prod-2');
  });

  it('skips items already in the cart or missing from the shelf', async () => {
    const { service, calls } = harness([
      item({ id: 'a', inCart: true }),
      item({ id: 'b', missing: true }),
      item({ id: 'c' }),
    ]);

    const result = await service.addToCart('s1');

    expect(result.added).toBe(1);
    const add = calls.find((c) => c.name === 'silpo_add_or_update_cart_products');
    expect(add?.args.products).toHaveLength(1);
  });

  it('does not call the cart tools when there is nothing to add', async () => {
    const { service, calls } = harness([item({ inCart: true })]);

    const result = await service.addToCart('s1');

    expect(result.added).toBe(0);
    // Writing an empty cart update would be a pointless round-trip.
    expect(calls).toHaveLength(0);
  });

  it('re-reads the cart after writing, as the tool contract requires', async () => {
    const { service, calls } = harness([item()]);

    await service.addToCart('s1');

    const order = calls.map((c) => c.name);
    expect(order.indexOf('silpo_get_shopping_cart_by_id')).toBeGreaterThan(
      order.indexOf('silpo_add_or_update_cart_products'),
    );
  });

  it('marks added items as inCart, which is what spends a coupon', async () => {
    const { list, service } = harness([item()]);

    await service.addToCart('s1');

    // `picked` means "in my basket in the shop"; only `inCart` means ordered.
    expect(list.items[0].inCart).toBe(true);
    expect(list.items[0].picked).toBe(false);
  });

  it('surfaces an expired timeslot instead of reporting plain success', async () => {
    const list: ShoppingList = {
      sessionId: 's1',
      createdAt: '',
      greeting: '',
      items: [item()],
      coupons: [],
      priceAlerts: [],
      spokenZones: [],
      toolCalls: [],
    };
    const mcp = {
      callTool: (_s: string, name: string) => {
        if (name === 'silpo_get_my_shopping_cart') {
          return Promise.resolve({ shoppingCartId: 'cart-1' });
        }
        if (name === 'silpo_get_shopping_cart_by_id') {
          // Exactly what the live cart returned on a stale slot.
          return Promise.resolve({
            cart: {
              calculation: {
                totalAfterDiscounts: 635.58,
                validations: [
                  { level: 'error', type: 'timeslot', message: 'timeslot.not_found' },
                  { level: 'error', type: 'product', message: 'product.offer.stock.max' },
                  { level: 'error', type: 'product', message: 'product.offer.stock.max' },
                  { level: 'info', type: 'order', message: 'order.payment_types.disabled' },
                ],
              },
            },
          });
        }
        return Promise.resolve({});
      },
    };
    const store = {
      get: () => Promise.resolve(list),
      mutate: (_s: string, fn: (l: ShoppingList) => void) => {
        fn(list);
        return Promise.resolve(list);
      },
    };

    const result = await makeService(mcp, store).addToCart('s1');

    expect(result.warnings?.[0]).toContain('Час доставки');
    expect(result.warnings?.[1]).toContain('2');
    expect(result.total).toBe(635.58);
    // Info-level notes are not blockers and must not be reported as such.
    expect(result.warnings).toHaveLength(2);
  });

  it('states the exact shortfall when the order is below the minimum', async () => {
    const list: ShoppingList = {
      sessionId: 's1',
      createdAt: '',
      greeting: '',
      items: [item()],
      coupons: [],
      priceAlerts: [],
      spokenZones: [],
      toolCalls: [],
    };
    const mcp = {
      callTool: (_s: string, name: string) => {
        if (name === 'silpo_get_my_shopping_cart') {
          return Promise.resolve({ shoppingCartId: 'cart-1' });
        }
        if (name === 'silpo_get_shopping_cart_by_id') {
          // Exactly what the live cart returned once the timeslot was valid.
          return Promise.resolve({
            cart: {
              calculation: {
                totalAfterDiscounts: 558.35,
                validations: [
                  {
                    level: 'error',
                    type: 'order',
                    message: 'order.cost.min',
                    context: { orderCostMin: 699 },
                  },
                ],
              },
            },
          });
        }
        return Promise.resolve({});
      },
    };
    const store = {
      get: () => Promise.resolve(list),
      mutate: (_s: string, fn: (l: ShoppingList) => void) => {
        fn(list);
        return Promise.resolve(list);
      },
    };

    const result = await makeService(mcp, store).addToCart('s1');

    // A vague "other issues" note is useless when the guest can just add items.
    expect(result.warnings?.[0]).toContain('699');
    expect(result.warnings?.[0]).toContain('140.65');
  });

  it('reports no warnings for a healthy cart', async () => {
    const { service } = harness([item()]);
    const result = await service.addToCart('s1');
    expect(result.warnings).toEqual([]);
  });

  it('orders weighted goods by step, not by kilogram', async () => {
    // Live bug: a 0.6 kg tray of chicken fillet ordered as «1» became a kilo.
    const { calls, service } = harness([
      item({ quantity: 1, product: option({ weighted: true, step: 0.6 }) }),
    ]);

    await service.addToCart('s1');

    const add = calls.find((c) => c.name === 'silpo_add_or_update_cart_products');
    expect((add?.args.products as { quantity: number }[])[0].quantity).toBe(0.6);
  });

  it('rounds a fractional quantity for goods sold by piece', async () => {
    const { calls, service } = harness([item({ quantity: 1.4 })]);

    await service.addToCart('s1');

    const add = calls.find((c) => c.name === 'silpo_add_or_update_cart_products');
    expect((add?.args.products as { quantity: number }[])[0].quantity).toBe(1);
  });
});

describe('ShoppingService.toListItems', () => {
  const service = makeService();

  const base = {
    query: 'q',
    quantity: 1,
    unit: 'шт',
    reason: 'причина',
    source: 'rhythm' as const,
  };

  it('drops a product the model proposed twice', () => {
    // Seen on live data: avocado arrived once in `items` and again as discovery.
    const items = toItems(service, {
      greeting: '',
      items: [
        { ...base, title: 'Авокадо' },
        { ...base, title: 'Молоко' },
      ],
      couponMatches: [],
      discovery: { title: 'Авокадо', reason: 'спробуй нове' },
    });

    expect(items).toHaveLength(2);
    expect(items.map((i) => i.title)).toEqual(['Авокадо', 'Молоко']);
    // The first mention wins, so the rhythm reason survives.
    expect(items[0].source).toBe('rhythm');
  });

  it('treats titles differing only by case or spacing as the same product', () => {
    const items = toItems(service, {
      greeting: '',
      items: [
        { ...base, title: 'Молоко' },
        { ...base, title: '  молоко  ' },
      ],
      couponMatches: [],
    });

    expect(items).toHaveLength(1);
  });

  it('keeps discovery when it is genuinely a new product', () => {
    const items = toItems(service, {
      greeting: '',
      items: [{ ...base, title: 'Молоко' }],
      couponMatches: [],
      discovery: { title: 'Імбир свіжий', reason: 'пасує твоїм спеціям' },
    });

    expect(items).toHaveLength(2);
    expect(items[1].source).toBe('discovery');
  });

  it('assigns ids that stay in step with the array after de-duplication', () => {
    const items = toItems(service, {
      greeting: '',
      items: [
        { ...base, title: 'A' },
        { ...base, title: 'A' },
        { ...base, title: 'B' },
      ],
      couponMatches: [],
    });

    // Ids must not skip a number just because a duplicate was dropped.
    expect(items.map((i) => i.id)).toEqual(['item-0', 'item-1']);
  });
});
