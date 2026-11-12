import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { theme } from '../theme';

interface Props {
  children: ReactNode;
  /** Swipe right — the guest put it in the basket. */
  onPick: () => void;
  /** Swipe left — it is not on the shelf. */
  onMissing: () => void;
  /** Already settled: no gesture, no hint. */
  disabled?: boolean;
}

/** How far the guest must drag before the action fires. */
const THRESHOLD = 90;
/** Where the row settles while the action is running. */
const REST = 60;

/**
 * A shopping-list row that responds to horizontal swipes.
 *
 * In a shop one hand holds a basket, so a swipe is easier than aiming at a
 * checkbox. Both directions stay available as taps too — a gesture nobody
 * discovers is worse than a button.
 */
export function SwipeableItem({ children, onPick, onMissing, disabled }: Props) {
  const offset = useSharedValue(0);
  const settled = useSharedValue(false);

  const pan = Gesture.Pan()
    // Let vertical scrolling win until the drag is clearly sideways.
    .activeOffsetX([-15, 15])
    .failOffsetY([-12, 12])
    .enabled(!disabled)
    .onUpdate((event) => {
      if (settled.value) return;
      offset.value = event.translationX;
    })
    .onEnd(() => {
      if (settled.value) return;

      if (offset.value > THRESHOLD) {
        settled.value = true;
        offset.value = withTiming(REST, { duration: 120 });
        runOnJS(onPick)();
      } else if (offset.value < -THRESHOLD) {
        settled.value = true;
        offset.value = withTiming(-REST, { duration: 120 });
        runOnJS(onMissing)();
      } else {
        // Not far enough — spring back so the row never sits half-open.
        offset.value = withSpring(0, { damping: 20, stiffness: 220 });
      }
    });

  const rowStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: offset.value }],
  }));

  // Backdrops fade in with the drag, so intent is visible before release.
  const pickStyle = useAnimatedStyle(() => ({
    opacity: interpolate(offset.value, [0, THRESHOLD], [0, 1], 'clamp'),
  }));
  const missingStyle = useAnimatedStyle(() => ({
    opacity: interpolate(offset.value, [0, -THRESHOLD], [0, 1], 'clamp'),
  }));

  if (disabled) return <>{children}</>;

  return (
    <View style={styles.wrapper}>
      <Animated.View style={[styles.backdrop, styles.pickBackdrop, pickStyle]}>
        <Text style={styles.backdropText}>✓ Взяв</Text>
      </Animated.View>
      <Animated.View style={[styles.backdrop, styles.missingBackdrop, missingStyle]}>
        <Text style={styles.backdropTextRight}>Немає ✕</Text>
      </Animated.View>

      <GestureDetector gesture={pan}>
        <Animated.View style={rowStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { position: 'relative' },
  backdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: theme.radius.md,
    justifyContent: 'center',
    paddingHorizontal: theme.spacing(5),
  },
  pickBackdrop: { backgroundColor: theme.colors.primary, alignItems: 'flex-start' },
  missingBackdrop: { backgroundColor: theme.colors.muted, alignItems: 'flex-end' },
  backdropText: { color: '#fff', fontWeight: '800', fontSize: 14 },
  backdropTextRight: { color: '#fff', fontWeight: '800', fontSize: 14 },
});
