import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { theme } from '../theme';
import type { ListItem, ProductOption } from '../types';

interface Props {
  item: ListItem;
  disabled?: boolean;
  onChoose: (productId: string) => void;
}

/** Percentage saved by taking `option` instead of `main`. */
function savingPercent(main: ProductOption, option: ProductOption): number {
  if (!main.price) return 0;
  return Math.round(((main.price - option.price) / main.price) * 100);
}

function OptionCard({
  option,
  selected,
  saving,
  disabled,
  onPress,
}: {
  option: ProductOption;
  selected: boolean;
  saving?: number;
  disabled?: boolean;
  onPress: () => void;
}) {
  const onPromotion = typeof option.oldPrice === 'number' && option.oldPrice > option.price;

  return (
    <Pressable
      style={[styles.card, selected && styles.cardSelected]}
      onPress={onPress}
      disabled={disabled}
    >
      {option.image ? (
        <Image source={{ uri: option.image }} style={styles.image} resizeMode="contain" />
      ) : (
        <View style={[styles.image, styles.imageEmpty]} />
      )}

      <Text style={styles.cardTitle} numberOfLines={2}>
        {option.title}
      </Text>

      <View style={styles.priceRow}>
        <Text style={[styles.price, onPromotion && styles.pricePromo]}>
          {option.price.toFixed(2)} ₴
        </Text>
        {onPromotion ? (
          <Text style={styles.oldPrice}>{option.oldPrice!.toFixed(2)}</Text>
        ) : null}
      </View>

      {/* Out-of-stock still shows, so the guest knows what was meant. */}
      {option.available === false || option.stock === 0 ? (
        <Text style={styles.outOfStock}>немає в наявності</Text>
      ) : saving && saving > 0 ? (
        <Text style={styles.saving}>дешевше на {saving}%</Text>
      ) : null}

      {selected ? <View style={styles.selectedDot} /> : null}
    </Pressable>
  );
}

/**
 * Shows the guest's usual product next to cheaper alternatives.
 *
 * The alternative is never substituted silently: both sit side by side and the
 * guest picks. Swapping for them would save money while quietly overriding a
 * choice they may have made deliberately.
 */
export function ProductChoice({ item, disabled, onChoose }: Props) {
  if (!item.product) return null;

  const alternatives = item.alternatives ?? [];
  const chosen = item.chosenProductId ?? item.product.productId;

  // With nothing to compare against, a single card adds only noise — the price
  // already appears on the item row.
  if (!alternatives.length) return null;

  return (
    <View style={styles.wrapper}>
      <Text style={styles.label}>Твій звичний · або дешевше</Text>
      <View style={styles.row}>
        <OptionCard
          option={item.product}
          selected={chosen === item.product.productId}
          disabled={disabled}
          onPress={() => onChoose(item.product!.productId)}
        />
        {alternatives.map((option) => (
          <OptionCard
            key={option.productId}
            option={option}
            selected={chosen === option.productId}
            saving={savingPercent(item.product!, option)}
            disabled={disabled}
            onPress={() => onChoose(option.productId)}
          />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: 4, marginTop: theme.spacing(2) },
  label: { fontSize: 10, color: theme.colors.muted, fontWeight: '700' },
  row: { flexDirection: 'row', gap: theme.spacing(2) },
  card: {
    flex: 1,
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.sm,
    borderWidth: 2,
    borderColor: theme.colors.border,
    padding: theme.spacing(2),
    gap: 2,
  },
  cardSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.primarySoft,
  },
  image: { width: '100%', height: 48, borderRadius: 4 },
  imageEmpty: { backgroundColor: theme.colors.border },
  cardTitle: { fontSize: 11, fontWeight: '600', color: theme.colors.text, lineHeight: 14 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
  price: { fontSize: 14, fontWeight: '800', color: theme.colors.text },
  pricePromo: { color: theme.colors.danger },
  oldPrice: {
    fontSize: 11,
    color: theme.colors.muted,
    textDecorationLine: 'line-through',
  },
  saving: { fontSize: 10, color: theme.colors.primary, fontWeight: '700' },
  outOfStock: { fontSize: 10, color: theme.colors.danger, fontWeight: '600' },
  selectedDot: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 8,
    height: 8,
    borderRadius: theme.radius.pill,
    backgroundColor: theme.colors.primary,
  },
});
