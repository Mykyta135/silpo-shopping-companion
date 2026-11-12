import { z } from 'zod';

/**
 * Zod schemas for the agent's submission tools.
 *
 * The agent explores freely with the Silpo MCP tools, then commits its answer by
 * calling one of these. That keeps the multi-step tool loop available — which
 * `generateObject` would forbid — while still producing validated output.
 */

/** One line the agent proposes for the shopping list. */
export const suggestedItemSchema = z.object({
  title: z.string().describe('Назва товару, як показати гостю'),
  query: z.string().describe('Пошуковий запит для silpo_find_products_batch'),
  quantity: z.number().positive().default(1),
  unit: z.string().default('шт'),
  reason: z
    .string()
    .describe(
      'ЧОМУ ця позиція в списку — коротко і конкретно. Напр. «береш кожні ~10 днів» ' +
        'або «купон згорає через 2 дні». Без причини позицію не пропонуй.',
    ),
  source: z
    .enum(['rhythm', 'coupon', 'price', 'discovery', 'guest'])
    .describe(
      'rhythm — закінчується; coupon — під купон; price — заміна того, що подорожчало; ' +
        'discovery — «спробуй нове»; guest — гість попросив сам',
    ),
});

/** Coupon relevance judgement — the one thing only a model can do here. */
export const couponMatchSchema = z.object({
  couponId: z.number(),
  matchesDiet: z
    .boolean()
    .describe('Чи збігається купон з тим, що гість РЕАЛЬНО купує за чеками'),
  reason: z.string().describe('Одне речення: чому збігається або ні'),
});

/** Phase 1 output: the assembled shopping list. */
export const listProposalSchema = z.object({
  greeting: z
    .string()
    .describe('1-2 речення гостю: що ти помітив і що склав. Без води.'),
  items: z.array(suggestedItemSchema).min(1).max(25),
  couponMatches: z
    .array(couponMatchSchema)
    .describe('Вердикт по КОЖНОМУ купону гостя, навіть якщо не підходить'),
  discovery: z
    .object({
      title: z.string(),
      reason: z.string().describe('Чому це пасує саме цьому раціону'),
    })
    .optional()
    .describe('Одна позиція «спробуй нове». Тільки якщо справді пасує раціону.'),
});

/** Phase 2 output: how the agent reacts to something happening in the aisle. */
export const reactionSchema = z.object({
  speak: z
    .boolean()
    .describe(
      'false — промовчати. Обирай false, коли сказати нема чого важливого: ' +
        'агент не має набридати.',
    ),
  message: z
    .string()
    .optional()
    .describe('Що сказати гостю. Одне речення. Порожнє, якщо speak = false.'),
  suggestion: z
    .object({
      title: z.string(),
      query: z.string(),
      reason: z.string(),
    })
    .optional()
    .describe('Товар, який варто додати просто зараз (заміна або під купон)'),
});

export type SuggestedItem = z.infer<typeof suggestedItemSchema>;
export type CouponMatch = z.infer<typeof couponMatchSchema>;
export type ListProposal = z.infer<typeof listProposalSchema>;
export type Reaction = z.infer<typeof reactionSchema>;
