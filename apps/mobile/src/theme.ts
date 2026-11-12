/** Shared visual tokens. Silpo green as the primary, warm accents for alerts. */
export const theme = {
  colors: {
    primary: '#1f8a3b',
    primaryDark: '#166b2c',
    primarySoft: '#e6f4e9',
    accent: '#e8a33d',
    accentSoft: '#fdf3e2',
    danger: '#c0392b',
    text: '#1a1a1a',
    muted: '#6b6b6b',
    border: '#e4e4e7',
    surface: '#ffffff',
    background: '#f7f7f8',
  },
  radius: { sm: 8, md: 14, lg: 20, pill: 999 },
  spacing: (n: number) => n * 4,
} as const;

/**
 * Why an item is on the list.
 *
 * Every suggestion carries its reason — that is what separates a recommendation
 * from an advert, and it is the product's core promise.
 */
export const SOURCE_BADGES = {
  rhythm: { emoji: '🔄', color: '#6b6b6b' },
  coupon: { emoji: '🎟️', color: '#8a6115' },
  price: { emoji: '📈', color: '#c0392b' },
  discovery: { emoji: '✨', color: '#1f8a3b' },
  guest: { emoji: '✍️', color: '#6b6b6b' },
} as const;
