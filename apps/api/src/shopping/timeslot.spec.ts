import { ConfigService } from '@nestjs/config';

jest.mock('@ai-sdk/anthropic', () => ({ createAnthropic: () => () => ({}) }));
jest.mock('ai', () => ({
  generateText: jest.fn(),
  stepCountIs: jest.fn(),
  tool: jest.fn(),
}));

import { ShoppingService } from './shopping.service.js';
import type { McpToolsFactory } from '../agent/mcp-tools.factory.js';
import type { SilpoMcpService } from '../mcp/silpo-mcp.service.js';
import type { ListStore } from './list.store.js';

/**
 * Catalogue availability is scoped to the cart's delivery window, so an elapsed
 * slot silently breaks every product search. Verified on the live server: with
 * a stale slot «хліб» returned 0 products; on the next open slot it returned 3,
 * and the full list went from 4/7 resolved to 7/7.
 */
describe('timeslot refresh', () => {
  const PAST = '2020-01-01T10:00:00+00:00';
  const FUTURE = new Date(Date.now() + 3 * 3600_000).toISOString();

  function makeService(mcp: Partial<SilpoMcpService>) {
    const config = {
      getOrThrow: () => 'test-key',
      get: (_key: string, fallback: string) => fallback,
    } as unknown as ConfigService;

    return new ShoppingService(
      {} as McpToolsFactory,
      mcp as SilpoMcpService,
      {} as ListStore,
      config,
    );
  }

  /** Reaches the private resolver without exporting it just for tests. */
  function cartContext(service: ShoppingService) {
    return (
      service as unknown as {
        cartContext: (s: string) => Promise<{ timeslotStart?: string; timeslotEnd?: string }>;
      }
    ).cartContext('s1');
  }

  function mcpWith(cartSlot: { start: string; end: string }, slots: unknown[]) {
    const calls: string[] = [];
    const mcp = {
      callTool: (_s: string, name: string) => {
        calls.push(name);
        if (name === 'silpo_get_my_shopping_cart') {
          return Promise.resolve({ shoppingCartId: 'cart-1' });
        }
        if (name === 'silpo_get_shopping_cart_by_id') {
          return Promise.resolve({
            cart: {
              deliveryType: 'DeliveryHome',
              timeslot: cartSlot,
              shipments: [{ branchId: 'branch-1' }],
            },
          });
        }
        if (name === 'silpo_get_time_slots') return Promise.resolve({ slots });
        return Promise.resolve({});
      },
    };
    return { mcp, calls };
  }

  it('swaps an elapsed slot for the next available one', async () => {
    const { mcp, calls } = mcpWith({ start: PAST, end: PAST }, [
      { start: PAST, end: PAST, available: true },
      { start: FUTURE, end: FUTURE, available: true },
    ]);

    const context = await cartContext(makeService(mcp));

    expect(calls).toContain('silpo_get_time_slots');
    expect(context.timeslotStart).toBe(FUTURE);
  });

  it('leaves a still-valid slot alone', async () => {
    const { mcp, calls } = mcpWith({ start: FUTURE, end: FUTURE }, []);

    const context = await cartContext(makeService(mcp));

    // No need to spend a call when the cart's own slot still works.
    expect(calls).not.toContain('silpo_get_time_slots');
    expect(context.timeslotStart).toBe(FUTURE);
  });

  it('ignores slots that are unavailable or already past', async () => {
    const { mcp } = mcpWith({ start: PAST, end: PAST }, [
      { start: FUTURE, end: FUTURE, available: false },
      { start: PAST, end: PAST, available: true },
      { start: FUTURE, end: FUTURE, available: true },
    ]);

    const context = await cartContext(makeService(mcp));
    expect(context.timeslotStart).toBe(FUTURE);
  });

  it('keeps the stale slot when no replacement can be found', async () => {
    const { mcp } = mcpWith({ start: PAST, end: PAST }, []);

    const context = await cartContext(makeService(mcp));
    // Better a stale window than none: the caller still gets a usable context.
    expect(context.timeslotStart).toBe(PAST);
  });

  it('survives a failing time-slot lookup', async () => {
    const mcp = {
      callTool: (_s: string, name: string) => {
        if (name === 'silpo_get_my_shopping_cart') {
          return Promise.resolve({ shoppingCartId: 'cart-1' });
        }
        if (name === 'silpo_get_shopping_cart_by_id') {
          return Promise.resolve({
            cart: {
              deliveryType: 'DeliveryHome',
              timeslot: { start: PAST, end: PAST },
              shipments: [{ branchId: 'branch-1' }],
            },
          });
        }
        return Promise.reject(new Error('slots unavailable'));
      },
    };

    await expect(cartContext(makeService(mcp))).resolves.toMatchObject({
      branchId: 'branch-1',
    });
  });
});
