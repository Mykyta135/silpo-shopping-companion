import type { WalkProgress } from '@silpo/shared';
import type { RankedCoupon, TriagedCoupon } from './coupons.js';
import { describeDeadline } from './coupons.js';
import type { PriceChange } from './price-history.js';
import { formatPercent } from './price-history.js';
import type { PurchaseRhythm } from './rhythm.js';
import { describeRhythm } from './rhythm.js';

/**
 * Prompts for the in-store companion.
 *
 * Division of labour, deliberately strict: **code computes, the model words.**
 * Price deltas, purchase gaps and coupon deadlines are all arithmetic, and a
 * model asked to do arithmetic over raw receipts will quietly get it wrong.
 * So every number below arrives pre-computed; the model's job is judgement —
 * does this coupon fit this diet, is this substitution sensible, is this worth
 * saying out loud at all.
 */

export const COMPANION_PERSONA = `Ти — помічник у торговому залі «Сільпо». Гість зараз ІДЕ ПО МАГАЗИНУ з телефоном у руці.

## Головне правило
Магазин спроєктований так, щоб людина ходила довше й купувала зайве.
Ти — навпаки: щоб вона пройшла один раз, не забула потрібне і не переплатила.

## Стиль
- Українською, стисло. Одне-два речення. Гість читає на ходу.
- Звертайся на «ти», ПРЯМО до гостя. Ніколи не пиши «гість» у третій особі —
  він читає це про себе.
- Кожна порада має ПРИЧИНУ з його чеків. Без причини — не пропонуй.
- Ніколи не вигадуй товари, ціни, знижки чи наявність. Тільки те, що дали tools.
- Не тисни і не рекламуй. Ти на боці гостя, не на боці полиці.

## Чого не робити
- Не пропонуй те, чого гість не купує (перевір по чеках).
- Не повторюй те, що вже в списку.
- Не оформлюй замовлення сам — це робить гість.`;

/** Renders the pre-computed analytics the model must reason over, not recompute. */
function analyticsBlock(input: {
  rhythms: PurchaseRhythm[];
  priceRises: PriceChange[];
  coupons: TriagedCoupon[];
  recentProducts: string[];
}): string {
  const parts: string[] = [];

  if (input.recentProducts.length) {
    parts.push(
      `## Що гість купує (з реальних чеків)\n${input.recentProducts
        .slice(0, 40)
        .map((p) => `- ${p}`)
        .join('\n')}`,
    );
  }

  const due = input.rhythms.filter((r) => r.likelyRunningOut);
  if (due.length) {
    parts.push(
      `## Ймовірно закінчується\n${due
        .map(
          (r) =>
            `- ${r.title} — ${describeRhythm(r)}, минуло ${Math.round(r.daysSinceLast)} дн.`,
        )
        .join('\n')}`,
    );
  }

  if (input.priceRises.length) {
    parts.push(
      `## Подорожчало з часу купівлі\n${input.priceRises
        .slice(0, 10)
        .map(
          (p) =>
            `- ${p.title}: ${p.paidPrice} → ${p.currentPrice} грн (${formatPercent(p.changePercent)})`,
        )
        .join('\n')}`,
    );
  }

  if (input.coupons.length) {
    parts.push(
      `## Купони гостя\n${input.coupons
        .map(
          (c) =>
            `- id=${c.id} «${c.description}» — ${c.rewardText ?? 'винагорода невідома'}, ${describeDeadline(c)}`,
        )
        .join('\n')}`,
    );
  }

  return parts.join('\n\n');
}

/**
 * Phase 1: assemble the shopping list before the guest sets off.
 *
 * The guest's own requests always win — the agent proposes, the guest disposes.
 */
export function buildListPrompt(input: {
  rhythms: PurchaseRhythm[];
  priceRises: PriceChange[];
  coupons: TriagedCoupon[];
  recentProducts: string[];
  guestRequest?: string;
}): string {
  const request = input.guestRequest?.trim();

  return `${COMPANION_PERSONA}

${analyticsBlock(input)}

## Завдання: склади список покупок

${
  request
    ? `Гість попросив: «${request}»\nЦе ГОЛОВНЕ — усе, що він назвав, має бути в списку з source: "guest".\n`
    : 'Гість нічого не просив — запропонуй сам, спираючись на дані вище.\n'
}
Правила:
1. Кожна позиція має reason з даних вище. Числа бери ГОТОВІ — не рахуй сам.
2. Для КОЖНОГО купона дай вердикт у couponMatches: чи збігається він з тим,
   що гість реально купує. Дивись на список покупок вище, не на назву купона.
   Купон на солодке для людини, яка не бере солодкого, — це matchesDiet: false.
3. Якщо позиція сильно подорожчала — можеш запропонувати заміну
   (source: "price"), але тільки ту, що справді існує в каталозі.
4. discovery — одна позиція, якої гість НЕ купував, але яка пасує його раціону.
   Якщо нічого доречного немає — не вигадуй, лиши порожнім.
5. Якщо серед купонів є такі, що згорають за 1-2 дні і НЕ пасують гостю —
   згадай це в greeting одним реченням. Гість має знати, що вони згорять,
   і чому ти їх не взяв. Це чесніше, ніж мовчки їх пропустити.

Поверни результат через інструмент submit.`;
}

/** What just happened in the aisle. */
export type AisleEvent =
  | { type: 'picked'; title: string }
  | { type: 'missing'; title: string }
  | { type: 'zone-left'; zone: string; remaining: string[] }
  | { type: 'finished' };

function describeEvent(event: AisleEvent): string {
  switch (event.type) {
    case 'picked':
      return `Гість щойно взяв: «${event.title}».`;
    case 'missing':
      return `Гість каже, що на полиці НЕМАЄ: «${event.title}».`;
    case 'zone-left':
      return `Гість вийшов із зони «${event.zone}», але не взяв: ${event.remaining.join(', ')}.`;
    case 'finished':
      return 'Гість зібрав увесь список.';
  }
}

/**
 * Phase 2: react to an event in the aisle — or stay quiet.
 *
 * Silence is the default. The whole point of the product is escaping the
 * app's popup noise, so a companion that comments on everything defeats it.
 */
/**
 * Walk context for the prompt.
 *
 * Extends the public `WalkProgress` with the picked product names, which the
 * agent needs to reason about the basket but the client already has in the list.
 */
export interface WalkContext extends WalkProgress {
  pickedTitles: string[];
}

export function buildReactionPrompt(input: {
  event: AisleEvent;
  coupons: RankedCoupon[];
  priceRises: PriceChange[];
  alreadySpokeInZone: boolean;
  remainingItems: string[];
  progress: WalkContext;
}): string {
  const couponLines = input.coupons
    .filter((c) => c.redeemable)
    .map((c) => `- «${c.description}» — ${c.rewardText ?? ''}, ${describeDeadline(c)}`)
    .join('\n');

  const { progress } = input;

  return `${COMPANION_PERSONA}

## Подія в залі
${describeEvent(input.event)}

## Як іде обхід
- Зібрано: ${progress.picked} · немає на полиці: ${progress.missing} · лишилось: ${progress.remaining}
- У кошику зараз: ${progress.basketTotal.toFixed(2)} грн
${progress.currentZone ? `- Поточна зона: ${progress.currentZone}` : ''}
${progress.zonesDone.length ? `- Пройдені зони: ${progress.zonesDone.join(', ')}` : ''}
${progress.pickedTitles.length ? `- Уже взято: ${progress.pickedTitles.join(', ')}` : ''}

## Доступні купони
${couponLines || '(немає)'}

## Ще не взято
${input.remainingItems.length ? input.remainingItems.join(', ') : '(усе зібрано)'}

${
  input.priceRises.length
    ? `## Позиції, що подорожчали\n${input.priceRises
        .slice(0, 5)
        .map((p) => `- ${p.title}: ${formatPercent(p.changePercent)} (зараз ${p.currentPrice} грн)`)
        .join('\n')}`
    : ''
}

## Завдання: вирішити, чи озиватись

${
  input.alreadySpokeInZone
    ? '⚠️ Ти вже говорив у цій зоні. Мовчи (speak: false), якщо привід не критичний — наприклад, купон, що згорає сьогодні.'
    : 'У цій зоні ти ще не говорив.'
}

Озивайся ЛИШЕ якщо є конкретна користь:
- до взятого товару є купон, який гість не використав
- взята позиція помітно подорожчала і є дешевша заміна
- гість іде далі, забувши щось із цієї зони
- товару немає — запропонуй заміну
- з того, що вже в кошику, складається страва — можеш підказати, чого бракує
  (лише якщо це РЕАЛЬНО доречно і одним реченням)

Використовуй контекст обходу: якщо гість уже взяв половину списку і зайшов у
останню зону — доречно нагадати про купон, який ще не застосовано. Якщо він
щойно почав — не поспішай.

В усіх інших випадках — speak: false. Мовчання краще за шум.

Поверни результат через інструмент submit.`;
}
