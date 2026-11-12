import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { theme } from '../theme';

interface Props {
  busy: boolean;
  onBuild: (request?: string) => void;
}

/**
 * Phase 1 entry point.
 *
 * The list is a hybrid: the agent proposes from receipts, coupons and price
 * moves, and anything the guest types here is treated as non-negotiable.
 */
export function ListBuilderScreen({ busy, onBuild }: Props) {
  const [request, setRequest] = useState('');

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.emoji}>🛒</Text>
      <Text style={styles.title}>Супутник у залі</Text>
      <Text style={styles.subtitle}>
        Магазин спроєктований, щоб ти ходив довше.{'\n'}
        Я складу список, щоб ти пройшов один раз.
      </Text>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Що я зроблю</Text>
        {[
          ['🧾', 'Подивлюсь твої чеки — що ти справді береш'],
          ['📈', 'Перевірю, що подорожчало з минулого разу'],
          ['🎟️', 'Знайду купони, які тобі підходять'],
          ['🗺️', 'Складу маршрут по зонах магазину'],
        ].map(([icon, text]) => (
          <View key={text} style={styles.row}>
            <Text style={styles.rowIcon}>{icon}</Text>
            <Text style={styles.rowText}>{text}</Text>
          </View>
        ))}
      </View>

      <Text style={styles.label}>Треба щось конкретне?</Text>
      <TextInput
        style={styles.input}
        value={request}
        onChangeText={setRequest}
        placeholder="Напр.: молоко, хліб і щось на вечерю"
        placeholderTextColor="#aaa"
        editable={!busy}
        multiline
      />

      <Pressable
        style={[styles.button, busy && styles.buttonDisabled]}
        onPress={() => onBuild(request.trim() || undefined)}
        disabled={busy}
      >
        {busy ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Скласти список →</Text>
        )}
      </Pressable>

      {busy ? (
        <Text style={styles.hint}>
          Читаю чеки, ціни та купони в «Сільпо»…{'\n'}Це займе кілька секунд.
        </Text>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: theme.spacing(5),
    paddingTop: theme.spacing(14),
    gap: theme.spacing(3),
    backgroundColor: theme.colors.background,
    flexGrow: 1,
  },
  emoji: { fontSize: 52, textAlign: 'center' },
  title: { fontSize: 28, fontWeight: '800', textAlign: 'center', color: theme.colors.text },
  subtitle: {
    fontSize: 15,
    color: theme.colors.muted,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: theme.spacing(2),
  },
  card: {
    backgroundColor: theme.colors.surface,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    padding: theme.spacing(4),
    gap: theme.spacing(3),
  },
  cardTitle: {
    fontSize: 12,
    fontWeight: '800',
    color: theme.colors.muted,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  row: { flexDirection: 'row', gap: theme.spacing(3), alignItems: 'center' },
  rowIcon: { fontSize: 18 },
  rowText: { flex: 1, fontSize: 14, color: theme.colors.text, lineHeight: 19 },
  label: { fontSize: 13, fontWeight: '700', color: theme.colors.muted, marginTop: theme.spacing(2) },
  input: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.surface,
    padding: theme.spacing(4),
    fontSize: 15,
    minHeight: 76,
    textAlignVertical: 'top',
  },
  button: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.radius.pill,
    paddingVertical: theme.spacing(4),
    alignItems: 'center',
    marginTop: theme.spacing(2),
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: '#fff', fontWeight: '800', fontSize: 16 },
  hint: { textAlign: 'center', color: theme.colors.muted, fontSize: 13, lineHeight: 19 },
});
