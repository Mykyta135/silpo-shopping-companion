import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const KEY = 'silpo-companion.session-id';

/**
 * The session id is the credential that keys this guest's Silpo tokens on the
 * server, so every install gets its own random one (128-bit UUID, 32 hex
 * chars), kept in the Keychain/Keystore. A dev machine can still point at an
 * already-authorized session with EXPO_PUBLIC_SESSION_ID.
 */
export async function getSessionId(): Promise<string> {
  const override = process.env.EXPO_PUBLIC_SESSION_ID;
  if (override) return override;

  const existing =
    Platform.OS === 'web'
      ? (globalThis.localStorage?.getItem(KEY) ?? null)
      : await SecureStore.getItemAsync(KEY);
  if (existing) return existing;

  const id = Crypto.randomUUID().replace(/-/g, '');
  if (Platform.OS === 'web') globalThis.localStorage?.setItem(KEY, id);
  else await SecureStore.setItemAsync(KEY, id);
  return id;
}
