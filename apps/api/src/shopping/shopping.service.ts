import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAnthropic } from '@ai-sdk/anthropic';
import { generateText, stepCountIs, tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type {
  AisleEventRequest,
  AgentReaction,
  CouponVerdict,
  ListItem,
  PriceAlert,
  ProductOption,
  ShoppingList,
  WalkProgress,
  ZoneGroup,
  ZoneId,
} from '@silpo/shared';
import { McpToolsFactory } from '../agent/mcp-tools.factory.js';
import { SilpoMcpService } from '../mcp/silpo-mcp.service.js';
import { unwrapToolResult } from './receipts.js';
import { ListStore } from './list.store.js';
import {
  expiringSoon,
  rankCoupons,
  triageCoupons,
  type CouponDetail,
  type TriagedCoupon,
} from './coupons.js';
import {
  computeInflation,
  significantIncreases,
  type PriceChange,
  type ReceiptLine,
} from './price-history.js';
import {
  computeRhythms,
  describeRhythm,
  runningOut,
  type PurchaseRhythm,
} from './rhythm.js';
import { buildRoute, getZone, resolveZone, ZONES } from './zones.js';
import {
  buildListPrompt,
  buildReactionPrompt,
  type AisleEvent,
  type WalkContext,
} from './shopping-prompts.js';
import {
  listProposalSchema,
  reactionSchema,
  type ListProposal,
  type Reaction,
} from './shopping.schemas.js';
import { DEMO_LIST_PROPOSAL, demoReaction } from './demo.fixtures.js';
import {
  filterRelevant,
  groupByQuery,
  orderQuantity,
  pickOptions,
  queryVariants,
  rankByCloseness,
} from './catalogue.js';

/** Offline order as returned by the MCP tool, narrowed to what we read. */
interface OfflineOrder {
  createdAt: string;
  products: (ReceiptLine & { name: string })[];
}

@Injectable()
export class ShoppingService {
  private readonly logger = new Logger(ShoppingService.name);
  private readonly anthropic;
  private readonly modelId: string;
  /**
   * Demo mode replaces the model with canned output while keeping every MCP
   * call real, so a pitch is reproducible, rehearsable and survives a dead
   * network or an exhausted API balance. See demo.fixtures.ts.
   */
  private readonly demoMode: boolean;

  constructor(
    private readonly toolsFactory: McpToolsFactory,
    private readonly mcp: SilpoMcpService,
    private readonly store: ListStore,
    config: ConfigService,
  ) {
    this.demoMode = config.get('DEMO_MODE', 'false') === 'true';
    // In demo mode the key is never used, so a placeholder must not crash boot.
    const apiKey = this.demoMode
      ? (config.get<string>('ANTHROPIC_API_KEY') ?? 'demo')
      : config.getOrThrow<string>('ANTHROPIC_API_KEY');

    this.anthropic = createAnthropic({ apiKey });
    this.modelId = config.get('AGENT_MODEL', 'claude-sonnet-5');

    if (this.demoMode) {
      this.logger.warn('DEMO_MODE is on — model output is canned, MCP calls are real');
    }
  }

  /**
   * Runs an agent loop that may call any Silpo MCP tool and finishes when the
   * agent commits through `submit`.
   *
   * A submission tool rather than `generateObject`, so the multi-step tool loop
   * stays available.
   */
  private async runStructured<T>(
    sessionId: string,
    prompt: string,
    schema: z.ZodType<T>,
    submitDescription: string,
    maxSteps = 16,
  ): Promise<{ output: T; toolCalls: string[] }> {
    const toolCalls: string[] = [];
    let submitted: T | undefined;

    const mcpTools = await this.toolsFactory.build(sessionId, {
      // The guest triggered this explicitly; cart writes are not part of these
      // flows, so a second confirmation round-trip would only add latency.
      requireApproval: false,
      onToolCall: (name) => toolCalls.push(name),
    });

    const tools: ToolSet = {
      ...mcpTools,
      submit: tool({
        description: submitDescription,
        inputSchema: schema as z.ZodType<T> & z.ZodTypeAny,
        execute: async (input: T) => {
          submitted = input;
          return { ok: true };
        },
      }),
    };

    const result = await generateText({
      model: this.anthropic(this.modelId),
      prompt,
      tools,
      stopWhen: stepCountIs(maxSteps),
    });

    if (submitted === undefined) {
      this.logger.warn(`Agent finished without submit (${toolCalls.length} calls)`);
      throw new Error(
        `Агент не повернув структурований результат. ${result.text.slice(0, 200)}`,
      );
    }

    return { output: submitted, toolCalls };
  }

  /** Resolves cart context, required by catalogue-scoped tools. */
  private async cartContext(sessionId: string): Promise<{
    branchId?: string;
    deliveryType?: string;
    timeslotStart?: string;
    timeslotEnd?: string;
  }> {
    const idRaw = unwrapToolResult(
      await this.mcp.callTool(sessionId, 'silpo_get_my_shopping_cart', {}),
    ) as { shoppingCartId?: string };
    if (!idRaw?.shoppingCartId) return {};

    const cartRaw = unwrapToolResult(
      await this.mcp.callTool(sessionId, 'silpo_get_shopping_cart_by_id', {
        shoppingCartId: idRaw.shoppingCartId,
      }),
    ) as {
      cart?: {
        deliveryType?: string;
        timeslot?: { start?: string; end?: string };
        shipments?: { branchId?: string }[];
      };
    };

    const cart = cartRaw?.cart;
    const context = {
      branchId: cart?.shipments?.[0]?.branchId,
      deliveryType: cart?.deliveryType,
      timeslotStart: cart?.timeslot?.start,
      timeslotEnd: cart?.timeslot?.end,
    };

    // The cart keeps whatever slot the guest last used, and catalogue
    // availability is scoped to that window — an elapsed slot makes every
    // search return nothing. Verified live: on a stale slot «хліб» found 0
    // products, on the next open slot it found 3.
    if (context.branchId && this.hasElapsed(context.timeslotEnd)) {
      const fresh = await this.nextAvailableSlot(
        sessionId,
        context.branchId,
        context.deliveryType,
      );
      if (fresh) {
        this.logger.log(`Stale timeslot replaced with ${fresh.start}`);
        context.timeslotStart = fresh.start;
        context.timeslotEnd = fresh.end;
      }
    }

    return context;
  }

  /** True when the slot's end is in the past (or unparseable). */
  private hasElapsed(end?: string): boolean {
    if (!end) return true;
    const parsed = Date.parse(end);
    return Number.isNaN(parsed) || parsed < Date.now();
  }

  /**
   * Finds the next bookable delivery window.
   *
   * Read-only: the cart is never modified, since changing the guest's delivery
   * slot behind their back would be a side effect they did not ask for. The
   * slot is used only to scope catalogue lookups.
   */
  private async nextAvailableSlot(
    sessionId: string,
    branchId: string,
    deliveryType?: string,
  ): Promise<{ start: string; end: string } | undefined> {
    try {
      const raw = unwrapToolResult(
        await this.mcp.callTool(sessionId, 'silpo_get_time_slots', {
          branchId,
          ...(deliveryType ? { deliveryTypes: [deliveryType] } : {}),
          limit: 10,
        }),
      ) as { slots?: { start?: string; end?: string; available?: boolean }[] };

      const slot = (raw?.slots ?? []).find(
        (s) => s.available && s.start && s.end && !this.hasElapsed(s.end),
      );
      return slot?.start && slot.end ? { start: slot.start, end: slot.end } : undefined;
    } catch (err) {
      this.logger.warn(`Could not read time slots: ${(err as Error).message}`);
      return undefined;
    }
  }

  /** Reads offline purchase history. Requires cart context. */
  private async fetchReceipts(
    sessionId: string,
    context: Awaited<ReturnType<ShoppingService['cartContext']>>,
  ): Promise<OfflineOrder[]> {
    if (!context.branchId || !context.deliveryType || !context.timeslotStart) {
      this.logger.warn('No cart context — cannot read offline orders');
      return [];
    }

    const raw = unwrapToolResult(
      await this.mcp.callTool(sessionId, 'silpo_get_my_offline_orders', {
        branchId: context.branchId,
        deliveryType: context.deliveryType,
        timeslotStart: context.timeslotStart,
        timeslotEnd: context.timeslotEnd,
        // The tool rejects anything above 10.
        limit: 10,
      }),
    ) as { orders?: OfflineOrder[] };

    return raw?.orders ?? [];
  }

  /** Reads coupons and enriches each with its details (the list omits rewards). */
  private async fetchCoupons(sessionId: string): Promise<CouponDetail[]> {
    const raw = unwrapToolResult(
      await this.mcp.callTool(sessionId, 'silpo_get_my_coupons', {}),
    ) as { coupons?: CouponDetail[] };
    const coupons = raw?.coupons ?? [];

    // N+1 by necessity: rewardText/usedCount only exist on the detail endpoint.
    return Promise.all(
      coupons.map(async (coupon) => {
        try {
          const detail = unwrapToolResult(
            await this.mcp.callTool(sessionId, 'silpo_get_coupon_details', {
              businessCouponId: coupon.id,
            }),
          ) as { coupon?: CouponDetail };
          return { ...coupon, ...(detail?.coupon ?? {}) };
        } catch (err) {
          this.logger.warn(`coupon ${coupon.id} details failed: ${(err as Error).message}`);
          return coupon;
        }
      }),
    );
  }

  /**
   * Phase 1: assemble the list.
   *
   * Analytics are computed in code and handed to the model pre-computed — a
   * model asked to do arithmetic over raw receipts gets it wrong quietly.
   * The model contributes judgement: coupon relevance, substitutions, wording.
   */
  async buildList(sessionId: string, request?: string): Promise<ShoppingList> {
    const toolCalls: string[] = [];

    const context = await this.cartContext(sessionId);
    toolCalls.push('silpo_get_my_shopping_cart', 'silpo_get_shopping_cart_by_id');

    const [orders, couponDetails] = await Promise.all([
      this.fetchReceipts(sessionId, context),
      this.fetchCoupons(sessionId),
    ]);
    toolCalls.push('silpo_get_my_offline_orders', 'silpo_get_my_coupons');
    if (couponDetails.length) toolCalls.push('silpo_get_coupon_details');

    const now = new Date();
    const rhythms = computeRhythms(orders, now);
    const inflation = computeInflation(orders);
    const priceRises = significantIncreases(inflation);
    const triaged = triageCoupons(couponDetails, now);

    const recentProducts = [
      ...new Set(orders.flatMap((o) => (o.products ?? []).map((p) => p.name))),
    ];

    let proposal: ListProposal | undefined;
    try {
      if (this.demoMode) {
        proposal = DEMO_LIST_PROPOSAL;
        // Named so the UI still shows a realistic tool trace.
        toolCalls.push('silpo_find_products_batch');
      } else {
        const { output, toolCalls: agentCalls } = await this.runStructured<ListProposal>(
          sessionId,
          buildListPrompt({
            rhythms: runningOut(rhythms).length ? runningOut(rhythms) : rhythms,
            priceRises,
            coupons: triaged,
            recentProducts,
            guestRequest: request,
          }),
          listProposalSchema,
          'Збережи готовий список покупок і вердикти по купонах',
        );
        proposal = output;
        toolCalls.push(...agentCalls);
      }
    } catch (err) {
      // Losing the list because the model is unavailable would be the worst
      // failure in a shop, so fall back to what the analytics already computed.
      this.logger.warn(`List proposal failed, using fallback: ${(err as Error).message}`);
    }

    const list: ShoppingList = proposal
      ? {
          sessionId,
          createdAt: now.toISOString(),
          greeting: proposal.greeting,
          items: this.toListItems(proposal),
          coupons: this.toCouponVerdicts(triaged, proposal),
          priceAlerts: this.toPriceAlerts(priceRises),
          spokenZones: [],
          toolCalls: [...new Set(toolCalls)],
        }
      : this.fallbackList(sessionId, now, rhythms, priceRises, triaged, toolCalls);

    // Resolve every line against the catalogue so the guest sees real prices and
    // real alternatives rather than a bare name.
    await this.attachProducts(sessionId, list, context);

    await this.store.save(list);
    return list;
  }

  /**
   * Fills each list item with its catalogue product and cheaper alternatives.
   *
   * One batched call covers the whole list — the tool takes up to 30 terms, and
   * looking products up one by one would be slow enough to notice in a shop.
   */
  private async attachProducts(
    sessionId: string,
    list: ShoppingList,
    context: Awaited<ReturnType<ShoppingService['cartContext']>>,
  ): Promise<void> {
    if (!context.branchId || !context.deliveryType || !context.timeslotStart) {
      this.logger.warn('No cart context — skipping catalogue lookup');
      return;
    }
    if (!list.items.length) return;

    // Send every variant of every query in one batch: the tool takes up to 30
    // terms, so broadening a failed search costs no extra round-trip.
    const variantsByItem = new Map(
      list.items.map((item) => [item.id, queryVariants(item.query)]),
    );
    const queries = [...new Set([...variantsByItem.values()].flat())].slice(0, 30);
    if (!queries.length) return;

    try {
      const raw = await this.mcp.callTool(sessionId, 'silpo_find_products_batch', {
        branchId: context.branchId,
        deliveryType: context.deliveryType,
        timeslotStart: context.timeslotStart,
        timeslotEnd: context.timeslotEnd,
        products: queries,
        limit: 5,
      });
      if (!list.toolCalls.includes('silpo_find_products_batch')) {
        list.toolCalls.push('silpo_find_products_batch');
      }

      const grouped = groupByQuery(unwrapToolResult(raw));

      for (const item of list.items) {
        // First variant that found anything RELEVANT wins — specific before
        // broad. Without the relevance filter, broadening returned hake for
        // chicken fillet and chocolate for chickpeas.
        const matches = (variantsByItem.get(item.id) ?? [])
          .map((variant) => filterRelevant(item.title, grouped.get(variant) ?? []))
          .find((found) => found.length);
        if (!matches?.length) continue;

        // Relevance alone put 0,2% cheese in the cart for a 5% request, so the
        // closest variant on the attribute a guest notices goes first.
        const { product, alternatives } = pickOptions(
          rankByCloseness(item.title, matches),
        );
        item.product = product;
        item.alternatives = alternatives;
        item.chosenProductId = product?.productId;
      }
    } catch (err) {
      // A failed lookup costs prices and alternatives, not the list itself.
      this.logger.warn(`Catalogue lookup failed: ${(err as Error).message}`);
    }
  }

  /**
   * A list built from analytics alone, with no model involved.
   *
   * Wording is plainer than the agent's, but every entry still carries the same
   * computed reason — which is the part that makes a suggestion trustworthy.
   */
  private fallbackList(
    sessionId: string,
    now: Date,
    rhythms: PurchaseRhythm[],
    priceRises: PriceChange[],
    coupons: TriagedCoupon[],
    toolCalls: string[],
  ): ShoppingList {
    const due = runningOut(rhythms).slice(0, 8);
    const items: ListItem[] = due.map((r, index) => ({
      id: `item-${index}`,
      title: r.title,
      query: r.title,
      quantity: 1,
      unit: 'шт',
      zone: resolveZone(r.title),
      source: 'rhythm' as const,
      reason: `${describeRhythm(r)}, минуло ${Math.round(r.daysSinceLast)} дн.`,
      picked: false,
    }));

    return {
      sessionId,
      createdAt: now.toISOString(),
      greeting: items.length
        ? 'AI-помічник тимчасово недоступний — зібрав список за твоїми звичними покупками.'
        : 'AI-помічник тимчасово недоступний, а даних для автоматичного списку замало. Додай позиції вручну.',
      items,
      // Without the model there is no diet judgement, so no coupon is claimed
      // to match — better silent than wrong.
      coupons: coupons.map((c) => ({
        id: c.id,
        description: c.description,
        rewardText: c.rewardText,
        endDate: c.endDate,
        daysLeft: c.daysLeft,
        urgency: c.urgency,
        matchesDiet: false,
        reason: 'Перевір сам — AI-помічник був недоступний',
      })),
      priceAlerts: this.toPriceAlerts(priceRises),
      spokenZones: [],
      toolCalls: [...new Set(toolCalls)],
    };
  }

  private toListItems(proposal: ListProposal): ListItem[] {
    const items: ListItem[] = [];
    // The model sometimes proposes the same product twice — typically once in
    // `items` and again as `discovery`. Two lines for one product read as a bug
    // to the guest, so the first mention wins.
    const seen = new Set<string>();

    const add = (item: Omit<ListItem, 'id' | 'zone' | 'picked'>) => {
      const key = item.title.toLowerCase().trim();
      if (!key || seen.has(key)) return;
      seen.add(key);
      items.push({
        ...item,
        id: `item-${items.length}`,
        zone: resolveZone(item.title),
        picked: false,
      });
    };

    for (const item of proposal.items) {
      add({
        title: item.title,
        query: item.query,
        quantity: item.quantity,
        unit: item.unit,
        source: item.source,
        reason: item.reason,
      });
    }

    if (proposal.discovery) {
      add({
        title: proposal.discovery.title,
        query: proposal.discovery.title,
        quantity: 1,
        unit: 'шт',
        source: 'discovery',
        reason: proposal.discovery.reason,
      });
    }

    return items;
  }

  private toCouponVerdicts(
    triaged: TriagedCoupon[],
    proposal: ListProposal,
  ): CouponVerdict[] {
    const ranked = rankCoupons(triaged, proposal.couponMatches);
    return ranked.map((c) => ({
      id: c.id,
      description: c.description,
      rewardText: c.rewardText,
      endDate: c.endDate,
      daysLeft: c.daysLeft,
      urgency: c.urgency,
      matchesDiet: c.matchesDiet,
      reason: c.reason,
    }));
  }

  private toPriceAlerts(changes: PriceChange[]): PriceAlert[] {
    return changes.slice(0, 10).map((c) => ({
      title: c.title,
      paidPrice: c.paidPrice,
      currentPrice: c.currentPrice,
      changePercent: c.changePercent,
    }));
  }

  async getList(sessionId: string): Promise<ShoppingList> {
    const list = await this.store.get(sessionId);
    if (!list) throw new NotFoundException('Список ще не складено');
    return list;
  }

  /** Public snapshot of the walk, for the client. */
  progressFor(list: ShoppingList): WalkProgress {
    const { pickedTitles: _pickedTitles, ...rest } = this.walkProgress(
      list,
      list.currentZone,
    );
    return rest;
  }

  /** Groups the list into zones, in walking order. */
  buildRouteFor(list: ShoppingList): ZoneGroup[] {
    return buildRoute(list.items).map((group) => ({
      zone: group.zone.id,
      title: group.zone.title,
      emoji: group.zone.emoji,
      hint: group.zone.hint,
      cell: group.zone.cell,
      items: group.items as ListItem[],
    }));
  }

  /** Guest edits: their own words always win over the agent's proposal. */
  async patchList(
    sessionId: string,
    patch: {
      add?: { title: string; quantity?: number; unit?: string };
      removeId?: string;
      choose?: { itemId: string; productId: string };
      currentZone?: ZoneId;
    },
  ): Promise<ShoppingList> {
    return this.store.mutate(sessionId, (list) => {
      if (patch.removeId) {
        list.items = list.items.filter((i) => i.id !== patch.removeId);
      }

      // Indoor positioning does not exist here — no GPS indoors, no coordinates
      // in the MCP data — so the guest tells us where they are standing.
      if (patch.currentZone) {
        list.currentZone = patch.currentZone;
      }

      if (patch.choose) {
        const item = list.items.find((i) => i.id === patch.choose!.itemId);
        // Only accept an id the item actually offers, so a stale client cannot
        // point a line at an unrelated product.
        const offered = [item?.product, ...(item?.alternatives ?? [])].filter(Boolean);
        if (item && offered.some((o) => o!.productId === patch.choose!.productId)) {
          item.chosenProductId = patch.choose.productId;
        }
      }
      if (patch.add?.title) {
        list.items.push({
          id: `item-${Date.now()}`,
          title: patch.add.title,
          query: patch.add.title,
          quantity: patch.add.quantity ?? 1,
          unit: patch.add.unit ?? 'шт',
          zone: resolveZone(patch.add.title),
          source: 'guest',
          reason: 'Ти додав сам',
          picked: false,
        });
      }
    });
  }

  /**
   * Phase 2: react to something happening in the aisle.
   *
   * Silence is the default — the product exists to escape the app's popup noise,
   * so a companion that comments on everything defeats its own purpose.
   */
  async handleEvent(
    sessionId: string,
    request: AisleEventRequest,
  ): Promise<{ list: ShoppingList; reaction: AgentReaction }> {
    const list = await this.getList(sessionId);
    const item = request.itemId
      ? list.items.find((i) => i.id === request.itemId)
      : undefined;

    // Record the event first, so the list is correct even if the model fails.
    const updated = await this.store.mutate(sessionId, (draft) => {
      const target = draft.items.find((i) => i.id === request.itemId);
      if (!target) return;
      if (request.type === 'picked') target.picked = true;
      if (request.type === 'missing') target.missing = true;
    });

    const event = this.toAisleEvent(request, updated, item?.title);
    const zone = item?.zone ?? request.zone;
    const alreadySpoke = zone ? updated.spokenZones.includes(zone) : false;

    let reaction: AgentReaction = { spoke: false, toolCalls: [] };

    if (this.demoMode) {
      const canned = demoReaction(event, alreadySpoke);
      reaction = {
        spoke: canned.speak,
        message: canned.speak ? canned.message : undefined,
        suggestion: canned.suggestion,
        toolCalls: canned.suggestion ? ['silpo_get_replacements'] : [],
      };
      if (reaction.spoke && zone) {
        await this.store.mutate(sessionId, (draft) => {
          if (!draft.spokenZones.includes(zone)) draft.spokenZones.push(zone);
          draft.currentZone = zone;
        });
      }
      return { list: await this.getList(sessionId), reaction };
    }

    try {
      const { output, toolCalls } = await this.runStructured<Reaction>(
        sessionId,
        buildReactionPrompt({
          event,
          coupons: rankCoupons(
            // Real dates matter here: an empty endDate made every coupon look
            // like it expired today, and the agent said so out loud.
            triageCoupons(
              updated.coupons.map((c) => ({
                id: c.id,
                active: true,
                description: c.description,
                beginDate: '',
                endDate: c.endDate,
                rewardText: c.rewardText,
              })),
            ),
            updated.coupons.map((c) => ({
              couponId: c.id,
              matchesDiet: c.matchesDiet,
              reason: c.reason,
            })),
          ),
          priceRises: updated.priceAlerts.map((a) => ({
            title: a.title,
            paidPrice: a.paidPrice,
            currentPrice: a.currentPrice,
            changePercent: a.changePercent,
            purchasedAt: '',
          })),
          alreadySpokeInZone: alreadySpoke,
          remainingItems: updated.items.filter((i) => !i.picked).map((i) => i.title),
          progress: this.walkProgress(updated, zone),
        }),
        reactionSchema,
        'Збережи рішення: озиватись чи мовчати',
        8,
      );

      reaction = {
        spoke: output.speak,
        message: output.speak ? output.message : undefined,
        suggestion: output.suggestion,
        toolCalls,
      };
    } catch (err) {
      // A failed reaction must never break the list — silence is a safe default.
      this.logger.warn(`Reaction failed: ${(err as Error).message}`);
    }

    if (reaction.spoke && zone) {
      await this.store.mutate(sessionId, (draft) => {
        if (!draft.spokenZones.includes(zone)) draft.spokenZones.push(zone);
        draft.currentZone = zone;
      });
    }

    return { list: await this.getList(sessionId), reaction };
  }

  private toAisleEvent(
    request: AisleEventRequest,
    list: ShoppingList,
    title?: string,
  ): AisleEvent {
    switch (request.type) {
      case 'picked':
        return { type: 'picked', title: title ?? '' };
      case 'missing':
        return { type: 'missing', title: title ?? '' };
      case 'zone-left': {
        const zoneId = request.zone ?? 'grocery';
        return {
          type: 'zone-left',
          zone: getZone(zoneId).title,
          remaining: list.items
            .filter((i) => i.zone === zoneId && !i.picked)
            .map((i) => i.title),
        };
      }
      default:
        return { type: 'finished' };
    }
  }

  /**
   * Writes the chosen products into the guest's real Silpo cart.
   *
   * Separate from ticking items off in the aisle: `picked` means "it is in my
   * basket", which is not the same as ordering it online. A coupon is only
   * spent once the product is actually in the Silpo cart, which is why
   * `inCart` — not `picked` — is what marks a coupon as used.
   */
  async addToCart(
    sessionId: string,
    itemIds?: string[],
  ): Promise<{
    list: ShoppingList;
    added: number;
    checkoutUrl?: string;
    total?: number;
    warnings?: string[];
  }> {
    const list = await this.getList(sessionId);

    const targets = list.items.filter((item) => {
      if (itemIds?.length && !itemIds.includes(item.id)) return false;
      if (item.missing || item.inCart) return false;
      return Boolean(this.chosenOption(item));
    });

    if (!targets.length) return { list, added: 0 };

    const cartIdRaw = unwrapToolResult(
      await this.mcp.callTool(sessionId, 'silpo_get_my_shopping_cart', {}),
    ) as { shoppingCartId?: string };
    const shoppingCartId = cartIdRaw?.shoppingCartId;
    if (!shoppingCartId) throw new Error('Не вдалося отримати кошик «Сільпо»');

    const products = targets.map((item) => {
      const option = this.chosenOption(item)!;
      return {
        productId: option.productId,
        companyId: option.companyId,
        branchId: option.branchId,
        // Weighted goods sell in steps — ordering "1" for a 0.6 kg tray of
        // chicken fillet meant a whole kilogram in the live cart.
        quantity: orderQuantity(option, item.quantity),
      };
    });

    await this.mcp.callTool(sessionId, 'silpo_add_or_update_cart_products', {
      shoppingCartId,
      products,
    });

    // The tool docs require re-reading the cart to surface validations and the
    // checkout link, so never report success without it.
    const cartRaw = unwrapToolResult(
      await this.mcp.callTool(sessionId, 'silpo_get_shopping_cart_by_id', {
        shoppingCartId,
      }),
    ) as {
      cart?: {
        checkoutWebLink?: string;
        calculation?: {
          totalAfterDiscounts?: number;
          validations?: {
            level?: string;
            type?: string;
            message?: string;
            context?: Record<string, unknown>;
          }[];
        };
      };
    };

    // Blockers must reach the guest: an expired timeslot marks every product
    // out of stock and silently removes the checkout link, so reporting a
    // cheerful "added 7" alone would be misleading.
    const warnings = this.describeCartProblems(
      cartRaw?.cart?.calculation?.validations ?? [],
      cartRaw?.cart?.calculation?.totalAfterDiscounts,
    );

    const updated = await this.store.mutate(sessionId, (draft) => {
      for (const target of targets) {
        const item = draft.items.find((i) => i.id === target.id);
        if (item) item.inCart = true;
      }
      for (const name of [
        'silpo_get_my_shopping_cart',
        'silpo_add_or_update_cart_products',
        'silpo_get_shopping_cart_by_id',
      ]) {
        if (!draft.toolCalls.includes(name)) draft.toolCalls.push(name);
      }
    });

    return {
      list: updated,
      added: targets.length,
      checkoutUrl: cartRaw?.cart?.checkoutWebLink,
      total: cartRaw?.cart?.calculation?.totalAfterDiscounts,
      warnings,
    };
  }

  /**
   * Turns cart validation errors into something a guest can act on.
   *
   * Silpo returns machine codes like `timeslot.not_found`; shown raw they mean
   * nothing, and left out entirely the guest wonders why checkout never appears.
   */
  private describeCartProblems(
    validations: {
      level?: string;
      type?: string;
      message?: string;
      context?: Record<string, unknown>;
    }[],
    total?: number,
  ): string[] {
    const problems = validations.filter((v) => v.level === 'error');
    if (!problems.length) return [];

    const messages: string[] = [];

    if (problems.some((p) => p.type === 'timeslot')) {
      messages.push(
        'Час доставки в кошику застарів — обери новий слот у застосунку «Сільпо», щоб оформити замовлення.',
      );
    }

    const outOfStock = problems.filter((p) => p.message?.includes('stock')).length;
    if (outOfStock) {
      messages.push(
        `${outOfStock} ${outOfStock === 1 ? 'товару' : 'товарів'} на складі менше, ніж потрібно — зменш кількість у застосунку.`,
      );
    }

    // Minimum order value blocks checkout outright, and the guest can act on it
    // immediately, so it deserves the exact shortfall rather than a vague note.
    const minCost = problems.find((p) => p.message?.includes('cost.min'));
    if (minCost) {
      const required = Number(minCost.context?.orderCostMin);
      const shortfall =
        Number.isFinite(required) && typeof total === 'number' ? required - total : undefined;
      messages.push(
        shortfall && shortfall > 0
          ? `Мінімальне замовлення — ${required} ₴. Не вистачає ${shortfall.toFixed(2)} ₴.`
          : 'Сума замовлення менша за мінімальну для доставки.',
      );
    }

    // Anything unrecognised still deserves a mention rather than silence.
    const other = problems.filter(
      (p) =>
        p.type !== 'timeslot' &&
        !p.message?.includes('stock') &&
        !p.message?.includes('cost.min'),
    );
    if (other.length) {
      messages.push(`Кошик має ${other.length} інших зауважень — перевір у застосунку.`);
    }

    return messages;
  }

  /**
   * Snapshot of how the walk is going.
   *
   * This is what makes the companion agentic rather than reactive: it reasons
   * about the trip as a whole — what is already in the basket, what it cost,
   * which zones are behind — instead of treating each tap in isolation.
   */
  private walkProgress(list: ShoppingList, currentZone?: string): WalkContext {
    const picked = list.items.filter((i) => i.picked);
    const missing = list.items.filter((i) => i.missing);

    const basketTotal = picked.reduce((sum, item) => {
      const option = this.chosenOption(item);
      return sum + (option?.price ?? 0) * item.quantity;
    }, 0);

    // A zone counts as done when nothing in it is still outstanding.
    const byZone = new Map<string, ListItem[]>();
    for (const item of list.items) {
      byZone.set(item.zone, [...(byZone.get(item.zone) ?? []), item]);
    }
    const zonesDone = [...byZone.entries()]
      .filter(([, items]) => items.every((i) => i.picked || i.missing))
      .map(([zone]) => getZone(zone as Parameters<typeof getZone>[0]).title);

    return {
      picked: picked.length,
      missing: missing.length,
      remaining: list.items.length - picked.length - missing.length,
      basketTotal,
      zonesDone,
      currentZone: currentZone
        ? getZone(currentZone as Parameters<typeof getZone>[0]).title
        : undefined,
      pickedTitles: picked.map((i) => i.title),
    };
  }

  /** The product option the guest settled on, defaulting to the main one. */
  private chosenOption(item: ListItem) {
    const options = [item.product, ...(item.alternatives ?? [])].filter(Boolean);
    return (
      options.find((o) => o!.productId === item.chosenProductId) ?? item.product
    );
  }

  async reset(sessionId: string): Promise<void> {
    await this.store.clear(sessionId);
  }

  /** Zone catalogue, for clients that want to render the full route upfront. */
  zones() {
    return ZONES;
  }
}
