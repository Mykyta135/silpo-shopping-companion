import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme, SOURCE_BADGES } from '../theme';
import { StoreFloorMap } from './map/StoreFloorMap';
import type {
  AgentReaction,
  ListItem,
  ShoppingList,
  WalkProgress,
  ZoneGroup,
  ZoneId,
} from '../types';

interface Props {
  list: ShoppingList;
  route: ZoneGroup[];
  progress: WalkProgress;
  reaction?: AgentReaction;
  busyItemId?: string;
  onPick: (item: ListItem) => void;
  onMissing: (item: ListItem) => void;
  onSetZone: (zone: ZoneId) => void;
  onOpenList: () => void;
  onAddToCart: () => void;
  addingToCart?: boolean;
}

/**
 * The map as the primary screen.
 *
 * While walking, orientation matters more than a scrolling list: where am I,
 * what is left here, what comes next. The list stays one tap away rather than
 * competing for the same space.
 */
export function MapScreen({
  list,
  route,
  progress,
  reaction,
  busyItemId,
  onPick,
  onMissing,
  onSetZone,
  onOpenList,
  onAddToCart,
  addingToCart,
}: Props) {
  const [openZone, setOpenZone] = useState<ZoneId>();

  const activeZone = useMemo(
    () =>
      list.currentZone ??
      route.find((g) => g.items.some((i) => !i.picked && !i.missing))?.zone,
    [list.currentZone, route],
  );

  const zone = route.find((g) => g.zone === (openZone ?? activeZone));
  const pending = zone?.items.filter((i) => !i.picked && !i.missing) ?? [];

  const readyForCart = list.items.filter(
    (i) => !i.inCart && !i.missing && i.product,
  ).length;

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.heading}>Маршрут</Text>
            <Text style={styles.sub}>
              {progress.picked}/{progress.picked + progress.remaining} зібрано
              {progress.basketTotal > 0
                ? ` · ${progress.basketTotal.toFixed(0)} ₴`
                : ''}
            </Text>
          </View>
          <Pressable style={styles.listButton} onPress={onOpenList} hitSlop={8}>
            <Text style={styles.listButtonText}>Список ☰</Text>
          </Pressable>
        </View>

        <StoreFloorMap
          route={route}
          currentZone={openZone ?? activeZone}
          onSelectZone={(z) => setOpenZone(z)}
        />

        {/* The agent speaks here, next to the map, so a hint never costs the
            guest their place on the floor. */}
        {reaction?.spoke && reaction.message ? (
          <View style={styles.bubble}>
            <Text style={styles.bubbleAuthor}>🛒 Супутник</Text>
            <Text style={styles.bubbleText}>{reaction.message}</Text>
            {reaction.suggestion ? (
              <Text style={styles.bubbleSuggestion}>
                + {reaction.suggestion.title} — {reaction.suggestion.reason}
              </Text>
            ) : null}
          </View>
        ) : null}

        {/* Popup for the zone the guest tapped: what to take right here. */}
        {zone ? (
          <View style={styles.popup}>
            <View style={styles.popupHeader}>
              <Text style={styles.popupTitle}>
                {zone.emoji} {zone.title}
              </Text>
              <Text style={styles.popupHint}>{zone.hint}</Text>
            </View>

            {pending.length === 0 ? (
              <Text style={styles.popupEmpty}>Тут усе зібрано ✓</Text>
            ) : (
              pending.map((item) => {
                const badge = SOURCE_BADGES[item.source];
                const chosen =
                  [item.product, ...(item.alternatives ?? [])].find(
                    (o) => o?.productId === item.chosenProductId,
                  ) ?? item.product;

                return (
                  <View key={item.id} style={styles.popupItem}>
                    <View style={styles.popupItemBody}>
                      <Text style={styles.popupItemTitle}>{item.title}</Text>
                      <Text style={styles.popupItemReason}>
                        {badge.emoji} {item.reason}
                      </Text>
                    </View>

                    {chosen ? (
                      <Text style={styles.popupPrice}>
                        {chosen.price.toFixed(2)} ₴
                      </Text>
                    ) : null}

                    <View style={styles.popupActions}>
                      <Pressable
                        style={styles.takeButton}
                        onPress={() => onPick(item)}
                        disabled={busyItemId === item.id}
                      >
                        {busyItemId === item.id ? (
                          <ActivityIndicator size="small" color="#fff" />
                        ) : (
                          <Text style={styles.takeButtonText}>Взяв</Text>
                        )}
                      </Pressable>
                      <Pressable onPress={() => onMissing(item)} hitSlop={6}>
                        <Text style={styles.skipText}>немає</Text>
                      </Pressable>
                    </View>
                  </View>
                );
              })
            )}

            {/* Positioning is manual: there is no indoor GPS, and pretending
                otherwise would be a claim we cannot back. */}
            {zone.zone !== activeZone ? (
              <Pressable
                style={styles.hereButton}
                onPress={() => {
                  onSetZone(zone.zone);
                  setOpenZone(undefined);
                }}
              >
                <Text style={styles.hereButtonText}>📍 Я зараз тут</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      {readyForCart > 0 ? (
        <View style={styles.footer}>
          <Pressable
            style={[styles.cartButton, addingToCart && styles.cartButtonBusy]}
            onPress={onAddToCart}
            disabled={addingToCart}
          >
            {addingToCart ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.cartButtonText}>
                🛒 Додати в кошик «Сільпо» ({readyForCart})
              </Text>
            )}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  container: {
    padding: theme.spacing(4),
    paddingTop: theme.spacing(14),
    paddingBottom: theme.spacing(6),
    gap: theme.spacing(3),
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  heading: { fontSize: 24, fontWeight: '800', color: theme.colors.text },
  sub: { fontSize: 13, color: theme.colors.muted, marginTop: 2 },
  listButton: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.pill,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(2),
  },
  listButtonText: { fontSize: 13, fontWeight: '700', color: theme.colors.text },

  bubble: {
    backgroundColor: theme.colors.primarySoft,
    borderRadius: theme.radius.md,
    padding: theme.spacing(4),
    gap: 4,
  },
  bubbleAuthor: { fontSize: 12, fontWeight: '800', color: theme.colors.primaryDark },
  bubbleText: { fontSize: 15, lineHeight: 21, color: theme.colors.text },
  bubbleSuggestion: { fontSize: 13, color: theme.colors.primaryDark },

  popup: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(3),
  },
  popupHeader: { gap: 2 },
  popupTitle: { fontSize: 17, fontWeight: '800', color: theme.colors.text },
  popupHint: { fontSize: 11, color: theme.colors.muted },
  popupEmpty: { fontSize: 14, color: theme.colors.muted },
  popupItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(2),
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing(3),
  },
  popupItemBody: { flex: 1, gap: 2 },
  popupItemTitle: { fontSize: 14, fontWeight: '600', color: theme.colors.text },
  popupItemReason: { fontSize: 11, color: theme.colors.muted },
  popupPrice: { fontSize: 14, fontWeight: '800', color: theme.colors.text },
  popupActions: { alignItems: 'center', gap: 4 },
  takeButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing(4),
    paddingVertical: theme.spacing(2),
    minWidth: 62,
    alignItems: 'center',
  },
  takeButtonText: { color: '#fff', fontWeight: '800', fontSize: 13 },
  skipText: { fontSize: 11, color: theme.colors.muted, textDecorationLine: 'underline' },

  hereButton: {
    alignItems: 'center',
    paddingVertical: theme.spacing(3),
    backgroundColor: theme.colors.background,
    borderRadius: theme.radius.sm,
  },
  hereButtonText: { fontSize: 13, fontWeight: '700', color: theme.colors.primary },

  footer: {
    padding: theme.spacing(4),
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface,
  },
  cartButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.pill,
    paddingVertical: theme.spacing(4),
    alignItems: 'center',
  },
  cartButtonBusy: { opacity: 0.6 },
  cartButtonText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
