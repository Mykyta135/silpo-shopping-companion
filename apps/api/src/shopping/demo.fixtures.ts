import type { ListProposal } from './shopping.schemas.js';
import type { Reaction } from './shopping.schemas.js';
import type { AisleEvent } from './shopping-prompts.js';

/**
 * Canned model output for demo mode.
 *
 * Why this exists: every live run phrases things differently, which makes a
 * video pitch impossible to rehearse, and a dead network or an exhausted API
 * balance would take the demo down mid-presentation.
 *
 * MCP calls stay real in demo mode — only the model is replaced. So the
 * receipts, prices and coupons on screen are still the guest's actual data.
 */

/**
 * Built to match the synthetic 75-receipt history, where rhythm detection
 * actually has enough data to work — see __fixtures__/generate-history.mjs.
 */
export const DEMO_LIST_PROPOSAL: ListProposal = {
  greeting:
    'Привіт! Зібрав список за твоїми чеками. Одразу попереджу: купони на батончик Lion і круасани PREMIA згорають за 2 дні, але я їх не беру — ти такого не купуєш.',
  items: [
    {
      title: 'Хліб Київхліб Український',
      query: 'хліб український',
      quantity: 1,
      unit: 'шт',
      reason: 'Береш кожні ~5 днів, а минуло вже 7 — ймовірно закінчився.',
      source: 'rhythm',
    },
    {
      title: 'Філе куряче Епікур охолоджене',
      query: 'філе куряче охолоджене',
      quantity: 1,
      unit: 'кг',
      reason: 'Береш кожні ~9 днів, минуло 13.',
      source: 'rhythm',
    },
    {
      title: 'Молоко Яготинське 2.6%',
      query: 'молоко яготинське 2.6',
      quantity: 2,
      unit: 'шт',
      reason: 'Твій найстабільніший товар — кожні ~7 днів.',
      source: 'rhythm',
    },
    {
      title: 'Сир кисломолочний President Сирна традиція 5%',
      query: 'сир кисломолочний president',
      quantity: 1,
      unit: 'шт',
      reason: 'У тебе купон на цей товар за 1 грн, діє ще 4 дні — а ти й так береш його регулярно.',
      source: 'coupon',
    },
    {
      title: 'Крупа перлова «Повна Чаша»',
      query: 'крупа перлова',
      quantity: 1,
      unit: 'шт',
      reason:
        'Твоя звична крупа «Ситий двір» подорожчала з 29.99 до 38.99 грн (+30%) — ця дешевша.',
      source: 'price',
    },
    {
      title: 'Яйця курячі Квочка С0',
      query: 'яйця курячі квочка',
      quantity: 1,
      unit: 'уп',
      reason: 'Береш кожні ~14 днів, минуло 12 — скоро знадобляться.',
      source: 'rhythm',
    },
  ],
  couponMatches: [
    {
      couponId: 530007945,
      matchesDiet: true,
      reason: 'Регулярно береш саме цей сир President.',
    },
    {
      couponId: 530007895,
      matchesDiet: true,
      reason: 'Майже весь твій кошик — без доданого цукру.',
    },
    {
      couponId: 530007897,
      matchesDiet: true,
      reason: 'Часто береш товари «Премія» та «Повна Чаша».',
    },
    {
      couponId: 530007412,
      matchesDiet: false,
      reason: 'Солодкого немає в жодному твоєму чеку за рік.',
    },
    {
      couponId: 530007413,
      matchesDiet: false,
      reason: 'Випічку не береш.',
    },
    {
      couponId: 530007414,
      matchesDiet: false,
      reason: 'Соки не береш — п’єш воду й каву.',
    },
  ],
  discovery: {
    title: 'Нут Kwidzyn',
    reason:
      'Ти регулярно береш сочевицю та квасолю — нут добре доповнить твій раціон бобових.',
  },
};

/** Replacements offered when a listed product is missing from the shelf. */
const DEMO_SUBSTITUTES = [
  {
    match: /хліб/i,
    title: 'Хліб «Кулиничі» Український нарізаний',
    query: 'хліб український нарізаний',
    reason: 'Той самий тип хліба, є в наявності.',
  },
  {
    match: /молоко/i,
    title: 'Молоко Простонаше 2.5%',
    query: 'молоко простонаше 2.5',
    reason: 'Схожа жирність, дешевше на 3 грн.',
  },
  // Order matters: «яйця курячі» must be matched by the egg rule, not the
  // chicken one — the same trap that bit the zone keywords.
  {
    match: /яйц/i,
    title: 'Яйця курячі «Ясенсвіт» С0',
    query: 'яйця курячі ясенсвіт с0',
    reason: 'Та сама категорія С0.',
  },
  {
    match: /сир|president/i,
    title: 'Сир кисломолочний «Яготинське» 5%',
    query: 'сир кисломолочний яготинське 5',
    reason: 'Та сама жирність.',
  },
  {
    match: /філе куряч|курча|бройлер/i,
    title: 'Філе куряче «Наша Ряба» охолоджене',
    query: 'філе куряче наша ряба',
    reason: 'Той самий відруб, є на вітрині.',
  },
  {
    match: /крупа|перлов/i,
    title: 'Крупа перлова «Сквирянка»',
    query: 'крупа перлова сквирянка',
    reason: 'Та сама крупа, інший бренд.',
  },
];

/**
 * Reactions keyed by event type.
 *
 * `zone-left` deliberately stays silent: the demo should show that the agent
 * knows when NOT to speak, which is the whole point of the one-remark-per-zone
 * rule.
 */
export function demoReaction(event: AisleEvent, alreadySpokeInZone: boolean): Reaction {
  if (alreadySpokeInZone) {
    return { speak: false };
  }

  switch (event.type) {
    case 'picked':
      if (/сир|president/i.test(event.title)) {
        return {
          speak: true,
          message:
            'У тебе купон саме на цей сир — за 1 грн, діє ще 4 дні. Не забудь застосувати на касі.',
        };
      }
      if (/крупа|перлова/i.test(event.title)) {
        return {
          speak: true,
          message: 'Гарний вибір — твоя звична крупа зараз на 9 грн дорожча.',
        };
      }
      return { speak: false };

    case 'missing': {
      // A canned replacement must still match the missing product — proposing
      // milk when the bread ran out reads as a broken agent.
      const substitute = DEMO_SUBSTITUTES.find((s) => s.match.test(event.title));
      return {
        speak: true,
        message: substitute
          ? `«${event.title}» немає — візьми ${substitute.title}.`
          : `«${event.title}» немає. Пропущу, підберемо наступного разу.`,
        suggestion: substitute
          ? {
              title: substitute.title,
              query: substitute.query,
              reason: substitute.reason,
            }
          : undefined,
      };
    }

    case 'zone-left':
      // Silence is the interesting behaviour here.
      return event.remaining.length
        ? {
            speak: true,
            message: `Ти йдеш далі, а в цій зоні лишилось: ${event.remaining.join(', ')}.`,
          }
        : { speak: false };

    default:
      return {
        speak: true,
        message: 'Усе зібрано. Каси прямо — і не забудь купон на сир.',
      };
  }
}
