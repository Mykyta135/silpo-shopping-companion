import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import {
  addToCart,
  buildList,
  getAuthStatus,
  getList,
  patchList,
  resetList,
  sendEvent,
} from './src/api';
import { getSessionId } from './src/session';
import { CompanionScreen } from './src/screens/CompanionScreen';
import { ListBuilderScreen } from './src/screens/ListBuilderScreen';
import { MapScreen } from './src/screens/MapScreen';
import { theme } from './src/theme';
import type {
  AgentReaction,
  ListItem,
  ListResponse,
  ZoneGroup,
  ZoneId,
} from './src/types';

/**
 * Random per-install session id (see src/session.ts); the MCP token for it
 * lives only on the server. Resolved on the first load, before any request.
 */
let SESSION_ID = '';

export default function App() {
  const [data, setData] = useState<ListResponse>();
  const [reaction, setReaction] = useState<AgentReaction>();
  const [busyItemId, setBusyItemId] = useState<string>();
  const [building, setBuilding] = useState(false);
  const [addingToCart, setAddingToCart] = useState(false);
  const [authUrl, setAuthUrl] = useState<string>();
  const [loading, setLoading] = useState(true);
  /** The map leads while walking; the list is one tap away. */
  const [view, setView] = useState<'map' | 'list'>('map');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      SESSION_ID ||= await getSessionId();
      const status = await getAuthStatus(SESSION_ID);
      if (!status.authorized) {
        setAuthUrl(status.authorizationUrl);
        return;
      }
      setAuthUrl(undefined);
      setData(await getList(SESSION_ID));
    } catch (err) {
      Alert.alert('Помилка зʼєднання', (err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Routes a 401 to the login screen; anything else surfaces as an alert. */
  const handleError = useCallback((err: unknown) => {
    const authorizationUrl = (err as { authorizationUrl?: string }).authorizationUrl;
    if (authorizationUrl) setAuthUrl(authorizationUrl);
    else Alert.alert('Не вдалося', (err as Error).message);
  }, []);

  async function onBuild(request?: string) {
    setBuilding(true);
    setReaction(undefined);
    try {
      setData(await buildList(SESSION_ID, request));
    } catch (err) {
      handleError(err);
    } finally {
      setBuilding(false);
    }
  }

  /** Reports an aisle event; the agent decides whether it is worth a word. */
  async function onEvent(
    type: 'picked' | 'missing' | 'zone-left',
    payload: { itemId?: string; zone?: ZoneGroup['zone'] },
  ) {
    setBusyItemId(payload.itemId);
    try {
      const result = await sendEvent(SESSION_ID, type, payload);
      setData({ list: result.list, route: result.route, progress: result.progress });
      // Only surface the bubble when the agent chose to speak.
      setReaction(result.reaction.spoke ? result.reaction : undefined);
    } catch (err) {
      handleError(err);
    } finally {
      setBusyItemId(undefined);
    }
  }

  /** Guest picks between their usual product and a cheaper alternative. */
  async function onChoose(item: ListItem, productId: string) {
    setBusyItemId(item.id);
    try {
      setData(await patchList(SESSION_ID, { choose: { itemId: item.id, productId } }));
    } catch (err) {
      handleError(err);
    } finally {
      setBusyItemId(undefined);
    }
  }

  /** The guest marks which zone they are standing in; positioning is manual. */
  async function onSetZone(zone: ZoneId) {
    try {
      setData(await patchList(SESSION_ID, { currentZone: zone }));
    } catch (err) {
      handleError(err);
    }
  }

  /** Writes the chosen products into the guest's real Silpo cart. */
  async function onAddToCart() {
    setAddingToCart(true);
    try {
      const result = await addToCart(SESSION_ID);
      setData({ list: result.list, route: result.route, progress: result.progress });

      // Blockers matter more than the count: without a valid timeslot every
      // product reads as out of stock and checkout never appears.
      const body = [
        result.total ? `Сума: ${result.total.toFixed(2)} ₴` : undefined,
        ...(result.warnings ?? []),
        result.checkoutUrl ? 'Оформити замовлення?' : undefined,
      ]
        .filter(Boolean)
        .join('\n\n');

      Alert.alert(
        `🛒 Додано ${result.added} у кошик «Сільпо»`,
        body || 'Товари додано в кошик «Сільпо».',
        result.checkoutUrl
          ? [
              { text: 'Пізніше', style: 'cancel' },
              {
                text: 'Оформити',
                // The agent never checks out on the guest's behalf.
                onPress: () => void Linking.openURL(result.checkoutUrl!),
              },
            ]
          : undefined,
      );
    } catch (err) {
      handleError(err);
    } finally {
      setAddingToCart(false);
    }
  }

  async function onRebuild() {
    try {
      await resetList(SESSION_ID);
      setData(undefined);
      setReaction(undefined);
    } catch (err) {
      handleError(err);
    }
  }

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color={theme.colors.primary} />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (authUrl) {
    return (
      <View style={styles.centered}>
        <Text style={styles.authEmoji}>🔐</Text>
        <Text style={styles.authTitle}>Вхід у «Сільпо»</Text>
        <Text style={styles.authHint}>
          Увійди в акаунт «Сільпо», щоб я міг подивитись твої чеки, ціни та купони.
        </Text>
        <Pressable style={styles.authButton} onPress={() => void Linking.openURL(authUrl)}>
          <Text style={styles.authButtonText}>Увійти</Text>
        </Pressable>
        <Pressable onPress={() => void load()} hitSlop={8}>
          <Text style={styles.authLink}>Я вже увійшов — перевірити</Text>
        </Pressable>
        <StatusBar style="auto" />
      </View>
    );
  }

  if (!data) {
    return (
      <>
        <ListBuilderScreen busy={building} onBuild={(r) => void onBuild(r)} />
        <StatusBar style="auto" />
      </>
    );
  }

  if (view === 'map') {
    return (
      <GestureHandlerRootView style={styles.root}>
        <MapScreen
          list={data.list}
          route={data.route}
          progress={data.progress}
          reaction={reaction}
          busyItemId={busyItemId}
          onPick={(item: ListItem) => void onEvent('picked', { itemId: item.id })}
          onMissing={(item: ListItem) => void onEvent('missing', { itemId: item.id })}
          onSetZone={(zone) => void onSetZone(zone)}
          onOpenList={() => setView('list')}
          onAddToCart={() => void onAddToCart()}
          addingToCart={addingToCart}
        />
        <StatusBar style="auto" />
      </GestureHandlerRootView>
    );
  }

  return (
    // Gestures need this root wrapper; without it swipes silently do nothing.
    <GestureHandlerRootView style={styles.root}>
      <CompanionScreen
        list={data.list}
        route={data.route}
        progress={data.progress}
        reaction={reaction}
        busyItemId={busyItemId}
        onPick={(item: ListItem) => void onEvent('picked', { itemId: item.id })}
        onMissing={(item: ListItem) => void onEvent('missing', { itemId: item.id })}
        onLeaveZone={(group: ZoneGroup) => void onEvent('zone-left', { zone: group.zone })}
        onChoose={(item: ListItem, productId: string) => void onChoose(item, productId)}
        onAddToCart={() => void onAddToCart()}
        addingToCart={addingToCart}
        onBackToMap={() => setView('map')}
        onRebuild={() => void onRebuild()}
      />
      <StatusBar style="auto" />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing(6),
    gap: theme.spacing(3),
    backgroundColor: theme.colors.background,
  },
  authEmoji: { fontSize: 48 },
  authTitle: { fontSize: 22, fontWeight: '800', color: theme.colors.text },
  authHint: { color: theme.colors.muted, textAlign: 'center', lineHeight: 21, fontSize: 14 },
  authButton: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.pill,
    paddingHorizontal: theme.spacing(10),
    paddingVertical: theme.spacing(4),
  },
  authButtonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  authLink: { color: theme.colors.primary, textDecorationLine: 'underline', fontSize: 14 },
});
