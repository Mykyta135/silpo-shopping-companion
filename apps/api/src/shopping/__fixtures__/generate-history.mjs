/**
 * Generates a synthetic purchase history to test rhythm detection at a realistic
 * scale — the live test account only has 4 receipts, which is far too thin to
 * tell a working algorithm from a broken one.
 *
 * Run: node src/shopping/__fixtures__/generate-history.mjs
 *
 * The shopper is deliberately built with known ground truth so tests can assert
 * against it, including the awkward cases: an item bought twice in one week,
 * a one-off purchase, and something abandoned months ago.
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const END = new Date('2026-08-09T12:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;

/**
 * Ground truth. `everyDays` is the real cycle; `jitter` is how sloppy the
 * shopper is about it — nobody buys milk exactly every 7 days.
 */
const STAPLES = [
  { name: 'Молоко Яготинське 2.6%', price: 42.99, everyDays: 7, jitter: 2 },
  { name: 'Хліб Київхліб Український', price: 32.5, everyDays: 5, jitter: 1 },
  { name: 'Яйця курячі Квочка С0', price: 62.69, everyDays: 14, jitter: 3 },
  { name: 'Філе куряче Епікур охолоджене', price: 289, everyDays: 10, jitter: 3 },
  { name: 'Банан', price: 48.99, everyDays: 9, jitter: 3 },
  { name: 'Сир кисломолочний President 5%', price: 199, everyDays: 21, jitter: 5 },
  { name: 'Кава Lavazza Crema e Aroma', price: 419, everyDays: 30, jitter: 7 },
  { name: 'Пакет Сільпо Пакет з Пакетів 18кг', price: 9.99, everyDays: 6, jitter: 2 },
];

/** Bought once or twice and never again — must NOT be reported as a rhythm. */
const ONE_OFFS = [
  { name: 'Дезодорант Old Spice WhiteWater', price: 184 },
  { name: 'Гриль-решітка одноразова', price: 129 },
  { name: 'Лохина BlueBerry Club', price: 149 },
];

/** Dropped in April — the guest stopped buying it. */
const ABANDONED = { name: 'Напій соєвий Alpro Chocolate', price: 89.99, everyDays: 12 };

/** Two trips three days apart — a top-up run, not a 3-day cycle. */
const TOP_UP_ANOMALY = { name: 'Крупа перлова Ситий двір', price: 38.99 };

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Current catalogue price: most items drift up, a few come down. */
function cataloguePrice(base) {
  const drift = Math.random();
  if (drift < 0.15) return Math.round(base * (0.82 + Math.random() * 0.1) * 100) / 100;
  if (drift < 0.55) return base;
  return Math.round(base * (1.05 + Math.random() * 0.4) * 100) / 100;
}

const catalogue = new Map();
function lineFor(name, price) {
  if (!catalogue.has(name)) catalogue.set(name, cataloguePrice(price));
  return {
    name,
    price,
    quantity: 1,
    unit: 'шт',
    catalogProduct: {
      id: `cat-${name.length}-${name.charCodeAt(0)}`,
      price: catalogue.get(name),
      slug: name.toLowerCase().replace(/[^a-zа-яіїєґ0-9]+/gi, '-'),
      available: true,
      companyId: '1ec88c5d-a050-669c-8467-570a157f3e31',
      branchId: '1ee56cb2-afaa-60e6-8ee5-e17d00bb2c74',
    },
  };
}

/** Trips over the past year, roughly every 4–6 days. */
const trips = [];
for (let daysAgo = 365; daysAgo > 0; daysAgo -= randomInt(4, 6)) {
  trips.push(new Date(END.getTime() - daysAgo * DAY));
}

const orders = trips.map((date) => ({
  createdAt: date.toISOString().replace('Z', ''),
  filialName: 'вул. Сахарова академіка, буд. 45',
  cityName: 'Львів',
  sumReg: 0,
  sumDiscount: 0,
  products: [],
}));

// Staples: place each purchase on its own cycle, with jitter.
for (const staple of STAPLES) {
  let cursor = 365;
  while (cursor > 0) {
    const target = END.getTime() - cursor * DAY;
    // Attach to the nearest trip, so purchases sit on real shopping days.
    let nearest = orders[0];
    let best = Infinity;
    for (const order of orders) {
      const distance = Math.abs(Date.parse(`${order.createdAt}Z`) - target);
      if (distance < best) {
        best = distance;
        nearest = order;
      }
    }
    if (!nearest.products.some((p) => p.name === staple.name)) {
      nearest.products.push(lineFor(staple.name, staple.price));
    }
    cursor -= staple.everyDays + randomInt(-staple.jitter, staple.jitter);
  }
}

// One-offs: a single trip each, spread across the year.
ONE_OFFS.forEach((item, index) => {
  const order = orders[Math.floor((orders.length / (ONE_OFFS.length + 1)) * (index + 1))];
  order.products.push(lineFor(item.name, item.price));
});

// Abandoned: regular until ~120 days ago, then nothing.
for (let daysAgo = 365; daysAgo > 120; daysAgo -= ABANDONED.everyDays) {
  const target = END.getTime() - daysAgo * DAY;
  const order = orders.reduce((closest, candidate) =>
    Math.abs(Date.parse(`${candidate.createdAt}Z`) - target) <
    Math.abs(Date.parse(`${closest.createdAt}Z`) - target)
      ? candidate
      : closest,
  );
  if (!order.products.some((p) => p.name === ABANDONED.name)) {
    order.products.push(lineFor(ABANDONED.name, ABANDONED.price));
  }
}

// Top-up anomaly: two purchases three days apart, nothing else.
const anomalyIndex = orders.length - 8;
orders[anomalyIndex].products.push(lineFor(TOP_UP_ANOMALY.name, TOP_UP_ANOMALY.price));
orders[anomalyIndex + 1].products.push(lineFor(TOP_UP_ANOMALY.name, TOP_UP_ANOMALY.price));

// Drop trips that ended up empty, then total each receipt.
const populated = orders.filter((o) => o.products.length > 0);
for (const order of populated) {
  order.sumReg = Math.round(order.products.reduce((s, p) => s + p.price, 0) * 100) / 100;
  order.sumDiscount = Math.round(order.sumReg * 0.08 * 100) / 100;
}

writeFileSync(
  join(HERE, 'synthetic-history.json'),
  JSON.stringify(populated, null, 2),
);

console.log(`orders: ${populated.length}`);
console.log(`line items: ${populated.reduce((s, o) => s + o.products.length, 0)}`);
console.log(`unique products: ${catalogue.size}`);
console.log('\nground truth (real cycles):');
for (const s of STAPLES) console.log(`  ${s.name} — every ${s.everyDays} days`);
console.log(`  ${ABANDONED.name} — abandoned ~120 days ago`);
console.log(`  ${TOP_UP_ANOMALY.name} — two trips 3 days apart (top-up, NOT a cycle)`);
for (const o of ONE_OFFS) console.log(`  ${o.name} — one-off`);
