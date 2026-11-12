import { useMemo, useRef } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { theme, SOURCE_BADGES } from '../theme';
import { ProductChoice } from './ProductChoice';
import { SwipeableItem } from './SwipeableItem';
import type {
  AgentReaction,
  ListItem,
  ShoppingList,
  WalkProgress,
  ZoneGroup,
} from '../types';

interface Props {
  list: ShoppingList;
  route: ZoneGroup[];
  progress: WalkProgress;
  reaction?: AgentReaction;
  busyItemId?: string;
  onPick: (item: ListItem) => void;
  onMissing: (item: ListItem) => void;
  onLeaveZone: (group: ZoneGroup) => void;
  onChoose: (item: ListItem, productId: string) => void;
  onAddToCart: () => void;
  addingToCart?: boolean;
  /** Back to the map, which leads while the guest is walking. */
  onBackToMap?: () => void;
  onRebuild: () => void;
}

/** The agent's line, shown only when it actually had something to say. */
function AgentBubble({ reaction }: { reaction: AgentReaction }) {
  if (!reaction.spoke || !reaction.message) return null;

  return (
    <View style={styles.bubble}>
      <Text style={styles.bubbleAuthor}>🛒 Супутник</Text>
      <Text style={styles.bubbleText}>{reaction.message}</Text>
      {reaction.suggestion ? (
        <Text style={styles.bubbleSuggestion}>
          + {reaction.suggestion.title} — {reaction.suggestion.reason}
        </Text>
      ) : null}
    </View>
  );
}

function ItemRow({
  item,
  busy,
  onPick,
  onMissing,
  onChoose,
}: {
  item: ListItem;
  busy: boolean;
  onPick: () => void;
  onMissing: () => void;
  onChoose: (productId: string) => void;
}) {
  const badge = SOURCE_BADGES[item.source];
  // Price shown is the option the guest actually settled on.
  const chosen =
    [item.product, ...(item.alternatives ?? [])].find(
      (o) => o?.productId === item.chosenProductId,
    ) ?? item.product;

  // Both states are "settled": one was taken, the other cannot be.
  const done = item.picked || item.missing;

  return (
    <View style={[styles.item, done && styles.itemDone]}>
      {/* Large tap target — the guest is holding a basket in the other hand. */}
      <Pressable
        style={[
          styles.checkbox,
          item.picked && styles.checkboxOn,
          item.missing && styles.checkboxMissing,
        ]}
        onPress={onPick}
        disabled={busy || done}
        hitSlop={8}
      >
        {busy ? (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        ) : item.picked ? (
          <Text style={styles.checkmark}>✓</Text>
        ) : item.missing ? (
          <Text style={styles.crossmark}>✕</Text>
        ) : null}
      </Pressable>

      <View style={styles.itemBody}>
        <View style={styles.titleRow}>
          <Text style={[styles.itemTitle, done && styles.itemTitleDone]}>
            {item.title}
          </Text>
          {chosen ? (
            <Text style={[styles.itemPrice, done && styles.itemTitleDone]}>
              {chosen.price.toFixed(2)} ₴
            </Text>
          ) : null}
        </View>

        <View style={styles.itemMeta}>
          <Text style={styles.itemQty}>
            {item.missing ? 'немає на полиці' : `${item.quantity} ${item.unit}`}
            {chosen?.weighted ? ' · вагове' : ''}
            {chosen?.stock !== undefined && chosen.stock <= 3 && chosen.stock > 0
              ? ` · залишилось ${chosen.stock}`
              : ''}
            {item.inCart ? ' · 🛒 у кошику' : ''}
          </Text>
          <Text style={[styles.badge, { color: badge.color }]}>
            {badge.emoji} {item.reason}
          </Text>
        </View>

        {!done ? <ProductChoice item={item} disabled={busy} onChoose={onChoose} /> : null}
      </View>

      {!done ? (
        <Pressable onPress={onMissing} hitSlop={8} disabled={busy}>
          <Text style={styles.missing}>немає</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function CompanionScreen({
  list,
  route,
  progress,
  reaction,
  busyItemId,
  onPick,
  onMissing,
  onLeaveZone,
  onChoose,
  onAddToCart,
  addingToCart,
  onBackToMap,
  onRebuild,
}: Props) {
  // Items reported missing are settled, not outstanding — they count as done so
  // the progress figure can actually reach its total.
  const { picked, total } = useMemo(
    () => ({
      picked: list.items.filter((i) => i.picked || i.missing).length,
      total: list.items.length,
    }),
    [list.items],
  );

  /** Items that could still be written into the Silpo cart, and their total. */
  const { pendingCart, cartTotal } = useMemo(() => {
    const pending = list.items.filter(
      (i) => !i.inCart && !i.missing && (i.product || i.alternatives?.length),
    );
    const total = pending.reduce((sum, item) => {
      const chosen =
        [item.product, ...(item.alternatives ?? [])].find(
          (o) => o?.productId === item.chosenProductId,
        ) ?? item.product;
      return sum + (chosen?.price ?? 0) * item.quantity;
    }, 0);
    return { pendingCart: pending.length, cartTotal: total };
  }, [list.items]);

  const scrollRef = useRef<ScrollView>(null);
  /** Y offset of each zone section, so tapping the map can scroll to it. */
  const zoneOffsets = useRef<Record<string, number>>({});

  /**
   * The zone the guest is most likely standing in.
   *
   * Explicit `currentZone` wins; otherwise it is the first stop on the route
   * with anything left to pick up, since the route is walked in order.
   */
  const activeZone = useMemo(() => {
    if (list.currentZone) return list.currentZone;
    return route.find((g) => g.items.some((i) => !i.picked && !i.missing))?.zone;
  }, [list.currentZone, route]);

  // Individual jumps land far harder than a basket average, so the biggest
  // mover is what the guest sees — see docs/architecture-plan.md.
  //
  // Once the guest has taken the item, the warning has done its job: leaving it
  // on screen just makes them second-guess a decision already made.
  const topAlert = useMemo(() => {
    const isTaken = (title: string) =>
      list.items.some(
        (i) =>
          i.picked &&
          (i.title.toLowerCase().includes(title.toLowerCase()) ||
            title.toLowerCase().includes(i.title.toLowerCase())),
      );
    return list.priceAlerts.find((a) => !isTaken(a.title));
  }, [list.priceAlerts, list.items]);

  /**
   * A coupon is spent when its product reaches the Silpo cart — not when the
   * guest ticks it off in the aisle. Ticking means "it is in my basket", which
   * says nothing about whether the coupon has been applied.
   */
  const isCouponUsed = (description: string) =>
    list.items.some(
      (i) =>
        i.inCart &&
        (description.toLowerCase().includes(i.title.toLowerCase().slice(0, 20)) ||
          i.title.toLowerCase().includes(description.toLowerCase().slice(0, 20))),
    );

  return (
    <View style={styles.screen}>
      <ScrollView ref={scrollRef} contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Text style={styles.heading}>Список</Text>
          <View style={styles.headerRight}>
            <Text style={styles.progress}>
              {picked}/{total}
            </Text>
            {/* A running basket total is the number a guest actually watches
                while walking, more than the item count. */}
            {progress.basketTotal > 0 ? (
              <Text style={styles.basketTotal}>
                {progress.basketTotal.toFixed(0)} ₴
              </Text>
            ) : null}
          </View>
        </View>

        {list.greeting ? <Text style={styles.greeting}>{list.greeting}</Text> : null}

        {/* A gesture nobody discovers is worse than a button, so say it once —
            and only while there is still something to swipe. */}
        {picked === 0 && total > 0 ? (
          <Text style={styles.swipeHint}>
            👉 Свайп вправо — взяв · 👈 вліво — немає на полиці
          </Text>
        ) : null}

        {reaction ? <AgentBubble reaction={reaction} /> : null}

        {topAlert ? (
          <View style={styles.alert}>
            <Text style={styles.alertTitle}>
              📈 {topAlert.title} подорожчав на {Math.round(topAlert.changePercent)}%
            </Text>
            <Text style={styles.alertBody}>
              Ти брав по {topAlert.paidPrice} ₴, зараз {topAlert.currentPrice} ₴
            </Text>
          </View>
        ) : null}

        {/* The map has its own screen now; from the list it is one tap back. */}
        {onBackToMap ? (
          <Pressable style={styles.backToMap} onPress={onBackToMap}>
            <Text style={styles.backToMapText}>🗺️ Показати маршрут на карті</Text>
          </Pressable>
        ) : null}

        {route.map((group) => {
          // Items the guest reported missing cannot be picked up, so counting
          // them as outstanding would send them back for nothing.
          const remaining = group.items.filter((i) => !i.picked && !i.missing).length;
          return (
            <View
              key={group.zone}
              style={styles.zone}
              // Remember where each zone starts so the map can scroll to it.
              onLayout={(e) => {
                zoneOffsets.current[group.zone] = e.nativeEvent.layout.y;
              }}
            >
              <View style={styles.zoneHeader}>
                <Text
                  style={[
                    styles.zoneTitle,
                    group.zone === activeZone && styles.zoneTitleActive,
                  ]}
                >
                  {group.emoji} {group.title}
                </Text>
                <Text style={styles.zoneHint}>{group.hint}</Text>
              </View>

              {group.items.map((item) => (
                <SwipeableItem
                  key={item.id}
                  disabled={item.picked || item.missing || busyItemId === item.id}
                  onPick={() => onPick(item)}
                  onMissing={() => onMissing(item)}
                >
                  <ItemRow
                    item={item}
                    busy={busyItemId === item.id}
                    onPick={() => onPick(item)}
                    onMissing={() => onMissing(item)}
                    onChoose={(productId) => onChoose(item, productId)}
                  />
                </SwipeableItem>
              ))}

              {/* Leaving a zone with items unticked is worth a nudge. */}
              {remaining > 0 ? (
                <Pressable style={styles.leaveZone} onPress={() => onLeaveZone(group)}>
                  <Text style={styles.leaveZoneText}>
                    Іду далі →{'  '}
                    <Text style={styles.leaveZoneCount}>лишилось {remaining}</Text>
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}

        {list.coupons.some((c) => c.matchesDiet) ? (
          <View style={styles.coupons}>
            <Text style={styles.sectionTitle}>Твої купони</Text>
            {list.coupons
              .filter((c) => c.matchesDiet)
              .map((c) => {
                const used = isCouponUsed(c.description);
                return (
                  <View key={c.id} style={[styles.coupon, used && styles.couponUsed]}>
                    <Text style={[styles.couponText, used && styles.couponTextUsed]}>
                      {c.description}
                    </Text>
                    <Text style={[styles.couponMeta, used && styles.couponMetaUsed]}>
                      {used ? '✓ товар у кошику — застосуй на касі' : c.rewardText ?? ''}
                      {!used && (c.urgency === 'soon' || c.urgency === 'today')
                        ? ` · ⏳ ${c.daysLeft === 0 ? 'сьогодні' : `${c.daysLeft} дн.`}`
                        : ''}
                    </Text>
                  </View>
                );
              })}
          </View>
        ) : null}

        {/* Proof of MCP integration, which the hackathon rules reward. */}
        {list.toolCalls.length ? (
          <View style={styles.tools}>
            <Text style={styles.toolsTitle}>🔧 MCP</Text>
            <Text style={styles.toolsText}>{list.toolCalls.join(' · ')}</Text>
          </View>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        {/* Ordering online is a separate act from walking the aisles, so the
            cart button never fires implicitly when items are ticked off. */}
        {pendingCart > 0 ? (
          <Pressable
            style={[styles.cartButton, addingToCart && styles.cartButtonBusy]}
            onPress={onAddToCart}
            disabled={addingToCart}
          >
            {addingToCart ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.cartButtonText}>
                🛒 Додати в кошик «Сільпо» ({pendingCart})
                {cartTotal > 0 ? ` · ${cartTotal.toFixed(0)} ₴` : ''}
              </Text>
            )}
          </Pressable>
        ) : null}

        <Pressable style={styles.secondaryButton} onPress={onRebuild}>
          <Text style={styles.secondaryText}>Скласти новий список</Text>
        </Pressable>
      </View>
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
  header: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  headerRight: { alignItems: 'flex-end' },
  heading: { fontSize: 26, fontWeight: '800', color: theme.colors.text },
  progress: { fontSize: 17, fontWeight: '700', color: theme.colors.muted },
  basketTotal: { fontSize: 13, fontWeight: '700', color: theme.colors.primary },
  greeting: { fontSize: 15, lineHeight: 21, color: theme.colors.muted },
  backToMap: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    paddingVertical: theme.spacing(3),
    alignItems: 'center',
  },
  backToMapText: { fontSize: 14, fontWeight: '700', color: theme.colors.primary },
  swipeHint: {
    fontSize: 12,
    color: theme.colors.muted,
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    paddingVertical: theme.spacing(2),
    paddingHorizontal: theme.spacing(3),
    textAlign: 'center',
  },

  bubble: {
    backgroundColor: theme.colors.primarySoft,
    borderRadius: theme.radius.md,
    padding: theme.spacing(4),
    gap: 4,
  },
  bubbleAuthor: { fontSize: 12, fontWeight: '800', color: theme.colors.primaryDark },
  bubbleText: { fontSize: 15, lineHeight: 21, color: theme.colors.text },
  bubbleSuggestion: { fontSize: 13, color: theme.colors.primaryDark, marginTop: 4 },

  alert: {
    backgroundColor: theme.colors.accentSoft,
    borderRadius: theme.radius.md,
    padding: theme.spacing(4),
    gap: 2,
  },
  alertTitle: { fontSize: 14, fontWeight: '700', color: '#8a6115' },
  alertBody: { fontSize: 13, color: '#8a6115' },

  zone: { gap: theme.spacing(2), marginTop: theme.spacing(2) },
  zoneHeader: { flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing(2) },
  zoneTitle: { fontSize: 16, fontWeight: '800', color: theme.colors.text },
  zoneTitleActive: { color: theme.colors.primary },
  zoneHint: { fontSize: 11, color: theme.colors.muted },

  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing(3),
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(3),
  },
  itemDone: { opacity: 0.5 },
  checkbox: {
    width: 34,
    height: 34,
    borderRadius: theme.radius.sm,
    borderWidth: 2,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: theme.colors.primary, borderColor: theme.colors.primary },
  checkboxMissing: { backgroundColor: theme.colors.border, borderColor: theme.colors.border },
  checkmark: { color: '#fff', fontSize: 18, fontWeight: '800' },
  crossmark: { color: theme.colors.muted, fontSize: 16, fontWeight: '800' },
  itemBody: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'baseline', gap: theme.spacing(2) },
  itemTitle: { flex: 1, fontSize: 15, fontWeight: '600', color: theme.colors.text },
  itemPrice: { fontSize: 15, fontWeight: '800', color: theme.colors.text },
  itemTitleDone: { textDecorationLine: 'line-through', color: theme.colors.muted },
  itemMeta: { gap: 1 },
  itemQty: { fontSize: 12, color: theme.colors.muted },
  badge: { fontSize: 11 },
  missing: { fontSize: 12, color: theme.colors.muted, textDecorationLine: 'underline' },

  leaveZone: { paddingVertical: theme.spacing(2), alignItems: 'center' },
  leaveZoneText: { fontSize: 13, color: theme.colors.primary, fontWeight: '600' },
  leaveZoneCount: { color: theme.colors.muted, fontWeight: '400' },

  coupons: { gap: theme.spacing(2), marginTop: theme.spacing(3) },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: theme.colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  coupon: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(3),
  },
  couponText: { fontSize: 14, color: theme.colors.text },
  couponMeta: { fontSize: 12, color: theme.colors.primary, marginTop: 2 },
  couponUsed: { opacity: 0.55, backgroundColor: theme.colors.primarySoft },
  couponTextUsed: { textDecorationLine: 'line-through' },
  couponMetaUsed: { color: theme.colors.primaryDark, fontWeight: '600' },

  tools: {
    marginTop: theme.spacing(4),
    padding: theme.spacing(3),
    backgroundColor: '#f0f0f2',
    borderRadius: theme.radius.sm,
  },
  toolsTitle: { fontSize: 11, fontWeight: '800', color: theme.colors.muted },
  toolsText: { fontSize: 10, color: theme.colors.muted, marginTop: 2, lineHeight: 15 },

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
  secondaryButton: { alignItems: 'center', paddingVertical: theme.spacing(3) },
  secondaryText: { color: theme.colors.muted, fontWeight: '600', fontSize: 14 },
});
