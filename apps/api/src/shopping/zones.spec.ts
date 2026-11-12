import { buildRoute, resolveZone, ZONES } from './zones.js';

describe('resolveZone', () => {
  it('routes chilled and fresh goods to perimeter zones', () => {
    expect(resolveZone('Цибуля ріпчаста жовта')).toBe('produce');
    expect(resolveZone('Хліб Агробізнес Гречаний нарізаний')).toBe('bakery');
    expect(resolveZone('Філе куряче Епікур охолоджене малий лоток')).toBe('meat');
    expect(resolveZone('Лосось стейк охолоджений')).toBe('fish');
    expect(resolveZone('Яйця курячі Квочка Домашні С0')).toBe('dairy');
  });

  it('routes dry goods to the centre aisles', () => {
    expect(resolveZone('Крупа перлова Ситий двір №1')).toBe('grocery');
    expect(resolveZone('Куркума PREMIA мелена')).toBe('grocery');
    expect(resolveZone('Олія оливкова Премія Pure суміш')).toBe('grocery');
  });

  it('puts frozen goods last, ahead of the meat and fish rules', () => {
    // «Минтай Філе с/м В ГЛАЗУРІ» is fish, but frozen fish is picked up on the
    // way out so it does not thaw — the frozen rule must win.
    expect(resolveZone('Минтай Філе с/м  В ГЛАЗУРІ')).toBe('frozen');
    expect(resolveZone('Хек філе с/м В ГЛАЗУРІ')).toBe('frozen');
  });

  it('separates household goods from food', () => {
    expect(resolveZone('Пакет Сільпо Пакет з Пакетів 18кг')).toBe('household');
    expect(resolveZone('Дезодорант спрей Old Spice WhiteWater')).toBe('household');
  });

  it('sends shelf-stable versions of fresh food to the centre aisles', () => {
    // Canned tuna is grocery, not fish — you do not pick it up at the counter.
    expect(resolveZone('Тунець Iberica цілий у власному соку')).toBe('grocery');
    expect(resolveZone('Квасоля в томатному соусі консервована')).toBe('grocery');
    // A spice named after fish is still a spice.
    expect(resolveZone('Приправа Премія до риби')).toBe('grocery');
    expect(resolveZone('Приправа Премія до курки')).toBe('grocery');
  });

  it('does not mistake a tinned fish for a leaf salad', () => {
    // «Тунець салатний» must not reach produce via a bare «салат» keyword.
    expect(resolveZone('Тунець Iberica салатний у власному соку')).toBe('grocery');
    expect(resolveZone('Салат листовий')).toBe('produce');
  });

  it('does not mistake turmeric for chicken', () => {
    // «Куркума» contains «курк» — the meat rule must not claim it.
    expect(resolveZone('Куркума PREMIA мелена')).toBe('grocery');
    // Eggs are dairy even though they are «курячі».
    expect(resolveZone('Яйця курячі Квочка Домашні С0')).toBe('dairy');
    // Actual chicken meat still routes to meat.
    expect(resolveZone('Філе куряче Епікур охолоджене')).toBe('meat');
    expect(resolveZone("Шлунок м'язової курчати-бройлера")).toBe('meat');
  });

  it('routes by product type, not by an ingredient named in the title', () => {
    // Seen on live data: a teriyaki sauce reached produce via «імбир».
    expect(
      resolveZone('Соус соєвий Bonsai «Теріякі» з часником та імбиром'),
    ).toBe('grocery');
    expect(resolveZone('Кетчуп з томатами та базиліком')).toBe('grocery');
    // Bare ingredients still route to produce.
    expect(resolveZone('Часник')).toBe('produce');
    expect(resolveZone('Імбир свіжий')).toBe('produce');
  });

  it('does not mistake a soy drink for a soy sauce', () => {
    // «Напій соєвий» must not land in grocery via the «соус соєвий» keyword.
    expect(resolveZone('Соус соєвий Премія Теріякі пастеризований')).toBe('grocery');
    expect(resolveZone('Напій соєвий Alpro Plant Protein Chocolate flavour')).toBe('grocery');
  });

  it('prefers the catalogue category when the name is ambiguous', () => {
    expect(resolveZone('Премія', 'Молочні продукти / Сири')).toBe('dairy');
  });

  it('falls back to the centre aisles for unknown products', () => {
    expect(resolveZone('Щось геть невідоме')).toBe('grocery');
  });
});

describe('buildRoute', () => {
  it('returns zones in walking order and omits empty ones', () => {
    const route = buildRoute([
      { title: 'Крупа перлова' },
      { title: 'Банан' },
      { title: 'Пакет біорозкладний 3кг' },
      { title: 'Хліб Гречаний' },
    ]);

    expect(route.map((g) => g.zone.id)).toEqual([
      'produce',
      'bakery',
      'grocery',
      'household',
    ]);
    // Zones with nothing to pick up never appear.
    expect(route.some((g) => g.zone.id === 'fish')).toBe(false);
  });

  it('keeps every item and tags it with its zone', () => {
    const route = buildRoute([{ title: 'Морква' }, { title: 'Часник' }]);
    expect(route).toHaveLength(1);
    expect(route[0].items.map((i) => i.title)).toEqual(['Морква', 'Часник']);
    expect(route[0].items[0].zone).toBe('produce');
  });

  it('orders the zone catalogue itself consistently', () => {
    const orders = ZONES.map((z) => z.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
    expect(ZONES[ZONES.length - 1].id).toBe('checkout');
  });
});

describe('floor plan geometry', () => {
  it('gives every zone its own cell on the 4×4 grid', () => {
    const cells = ZONES.map((z) => `${z.cell.col},${z.cell.row}`);
    // Overlapping zones would draw on top of each other.
    expect(new Set(cells).size).toBe(ZONES.length);
  });

  it('keeps every cell inside the grid', () => {
    for (const zone of ZONES) {
      expect(zone.cell.col).toBeGreaterThanOrEqual(0);
      expect(zone.cell.col).toBeLessThan(4);
      expect(zone.cell.row).toBeGreaterThanOrEqual(0);
      expect(zone.cell.row).toBeLessThan(4);
    }
  });

  it('leaves the entrance cell free', () => {
    // Bottom-right is the entrance marker; a zone there would cover it.
    const occupied = ZONES.some((z) => z.cell.col === 3 && z.cell.row === 3);
    expect(occupied).toBe(false);
  });

  it('runs fresh departments along the top perimeter', () => {
    // Chilled goods sit where refrigeration power runs — the outer wall.
    for (const id of ['produce', 'bakery', 'meat', 'fish'] as const) {
      expect(ZONES.find((z) => z.id === id)?.cell.row).toBe(0);
    }
  });

  it('walks the route without teleporting between distant cells', () => {
    const path = [...ZONES].sort((a, b) => a.order - b.order);
    for (let i = 1; i < path.length; i += 1) {
      const step =
        Math.abs(path[i].cell.col - path[i - 1].cell.col) +
        Math.abs(path[i].cell.row - path[i - 1].cell.row);
      // Each leg should be a short walk, not a jump across the shop.
      expect(step).toBeLessThanOrEqual(2);
    }
  });
});
