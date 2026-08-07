import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { getAuthStatus, sendMessage } from './src/api';
import type { ChatMessage } from './src/types';

/** Opaque per-install session id; the MCP token for it lives only on the server. */
const SESSION_ID = 'demo-session-1';

export default function App() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [authUrl, setAuthUrl] = useState<string>();
  const [checking, setChecking] = useState(true);
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const appendSystemError = useCallback((err: unknown) => {
    const text = err instanceof Error ? err.message : String(err);
    setMessages((prev) => [
      ...prev,
      { id: `err-${prev.length}`, role: 'assistant', text: `⚠️ ${text}` },
    ]);
  }, []);

  const checkAuth = useCallback(async () => {
    setChecking(true);
    try {
      const status = await getAuthStatus(SESSION_ID);
      setAuthUrl(status.authorized ? undefined : status.authorizationUrl);
    } catch (err) {
      setAuthUrl(undefined);
      appendSystemError(err);
    } finally {
      setChecking(false);
    }
  }, [appendSystemError]);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  async function onSend() {
    const text = input.trim();
    if (!text || busy) return;

    setInput('');
    setMessages((prev) => [...prev, { id: `u-${prev.length}`, role: 'user', text }]);
    setBusy(true);

    try {
      const result = await sendMessage({ sessionId: SESSION_ID, message: text });
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${prev.length}`,
          role: 'assistant',
          text: result.text,
          toolCalls: result.toolCalls.map((c) => c.toolName),
        },
      ]);
    } catch (err) {
      // A 401 carries the Silpo login URL — switch to the auth screen.
      const authorizationUrl = (err as { authorizationUrl?: string }).authorizationUrl;
      if (authorizationUrl) {
        setAuthUrl(authorizationUrl);
      } else {
        appendSystemError(err);
      }
    } finally {
      setBusy(false);
    }
  }

  if (checking) {
    return (
      <View style={[styles.container, styles.centered]}>
        <ActivityIndicator />
        <StatusBar style="auto" />
      </View>
    );
  }

  if (authUrl) {
    return (
      <View style={[styles.container, styles.centered]}>
        <Text style={styles.title}>Вхід у «Сільпо»</Text>
        <Text style={styles.hint}>
          Увійди в акаунт «Сільпо», щоб асистент міг працювати з твоїм кошиком.
        </Text>
        <Pressable style={styles.button} onPress={() => void Linking.openURL(authUrl)}>
          <Text style={styles.buttonText}>Увійти</Text>
        </Pressable>
        <Pressable onPress={() => void checkAuth()}>
          <Text style={styles.link}>Я вже увійшов — перевірити</Text>
        </Pressable>
        <StatusBar style="auto" />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={styles.header}>Асистент «Сільпо»</Text>

      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
        ListEmptyComponent={
          <Text style={styles.hint}>
            Спробуй: «Додай у кошик 2 літри молока, буханець хліба і десяток яєць»
          </Text>
        }
        renderItem={({ item }) => (
          <View style={[styles.bubble, item.role === 'user' ? styles.user : styles.assistant]}>
            <Text style={styles.bubbleText}>{item.text}</Text>
            {item.toolCalls?.length ? (
              <Text style={styles.tools}>🔧 {item.toolCalls.join(', ')}</Text>
            ) : null}
          </View>
        )}
      />

      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Напиши свій список покупок…"
          editable={!busy}
          onSubmitEditing={() => void onSend()}
        />
        <Pressable
          style={[styles.button, busy && styles.buttonDisabled]}
          onPress={() => void onSend()}
          disabled={busy}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>→</Text>}
        </Pressable>
      </View>

      <StatusBar style="auto" />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff', paddingTop: 60 },
  centered: { alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  header: { fontSize: 20, fontWeight: '700', paddingHorizontal: 16, paddingBottom: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  hint: { color: '#666', textAlign: 'center', paddingHorizontal: 24, lineHeight: 20 },
  list: { padding: 16, gap: 10 },
  bubble: { padding: 12, borderRadius: 14, maxWidth: '85%' },
  user: { alignSelf: 'flex-end', backgroundColor: '#d8f0d8' },
  assistant: { alignSelf: 'flex-start', backgroundColor: '#f1f1f3' },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  tools: { fontSize: 11, color: '#777', marginTop: 6 },
  inputRow: {
    flexDirection: 'row',
    gap: 8,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    fontSize: 15,
  },
  button: {
    backgroundColor: '#1f8a3b',
    borderRadius: 22,
    paddingHorizontal: 20,
    paddingVertical: 12,
    minWidth: 56,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '700', fontSize: 16 },
  link: { color: '#1f8a3b', textDecorationLine: 'underline' },
});
