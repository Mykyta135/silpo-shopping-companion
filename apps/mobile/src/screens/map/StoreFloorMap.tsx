import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, G, Line, Path, Rect as SvgRect, Text as SvgText } from 'react-native-svg';
import Animated, {
  useAnimatedProps,
  useDerivedValue,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { theme } from '../../theme';
import type { ZoneGroup, ZoneId } from '../../types';
import { buildPath, ENTRANCE, FLOOR, getShape, pointAt, ZONE_SHAPES } from './layout';

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

interface Props {
  route: ZoneGroup[];
  /** Zone the guest says they are standing in. */
  currentZone?: ZoneId;
  onSelectZone: (zone: ZoneId) => void;
  /** Aspect-ratio-preserving height; the plan is 100×100 units. */
  height?: number;
}

/**
 * The sales floor drawn as an actual plan: shelf blocks, walkable aisles
 * between them, and the route threaded through the gaps.
 *
 * The avatar walks the path rather than jumping between cells, because the
 * point of the screen is orientation — seeing where you are relative to what is
 * still ahead.
 *
 * HONEST LIMITATION: this models a standard supermarket layout. Silpo's MCP
 * exposes no coordinates, so the map cannot claim to be a real branch plan, and
 * there is no live positioning — the guest tells us where they are.
 */
export function StoreFloorMap({ route, currentZone, onSelectZone, height }: Props) {
  const { width: screenWidth } = useWindowDimensions();
  const size = height ?? Math.min(screenWidth - 32, 420);

  const stops = useMemo(
    () =>
      route.map((group, index) => ({
        ...group,
        stop: index + 1,
        done: group.items.every((i) => i.picked || i.missing),
        remaining: group.items.filter((i) => !i.picked && !i.missing).length,
      })),
    [route],
  );

  /** Zones still to visit, in walking order — what the route line covers. */
  const activeZone = currentZone ?? stops.find((s) => !s.done)?.zone;
  const path = useMemo(() => buildPath(stops.map((s) => s.zone)), [stops]);

  /** How far along the route the guest is, 0…1. */
  const targetProgress = useMemo(() => {
    if (!stops.length) return 0;
    const index = stops.findIndex((s) => s.zone === activeZone);
    return index < 0 ? 1 : index / stops.length;
  }, [stops, activeZone]);

  const progress = useSharedValue(0);
  const pulse = useSharedValue(1);

  useEffect(() => {
    // Walk to the new position rather than teleporting — the movement is what
    // tells the guest which way they are heading.
    progress.value = withTiming(targetProgress, {
      duration: 900,
      easing: Easing.inOut(Easing.cubic),
    });
  }, [targetProgress, progress]);

  useEffect(() => {
    pulse.value = withRepeat(
      withSequence(
        withTiming(1.35, { duration: 900, easing: Easing.out(Easing.quad) }),
        withTiming(1, { duration: 900, easing: Easing.in(Easing.quad) }),
      ),
      -1,
      false,
    );
  }, [pulse]);

  const avatar = useDerivedValue(() => pointAt(path, progress.value));

  const avatarProps = useAnimatedProps(() => ({
    cx: avatar.value.x,
    cy: avatar.value.y,
  }));

  const haloProps = useAnimatedProps(() => ({
    cx: avatar.value.x,
    cy: avatar.value.y,
    r: 3.2 * pulse.value,
    opacity: 1.35 - pulse.value,
  }));

  // Dashes travel along the route to show direction of travel.
  const dashOffset = useSharedValue(0);
  useEffect(() => {
    dashOffset.value = withRepeat(
      withTiming(-8, { duration: 1200, easing: Easing.linear }),
      -1,
      false,
    );
  }, [dashOffset]);

  const routeProps = useAnimatedProps(() => ({
    strokeDashoffset: dashOffset.value,
  }));

  const routeD = useMemo(
    () =>
      path.length
        ? path.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' ')
        : '',
    [path],
  );

  return (
    <View style={styles.wrapper}>
      <Svg width="100%" height={size} viewBox="0 0 100 100">
        {/* Floor and walls */}
        <SvgRect
          x={FLOOR.x}
          y={FLOOR.y}
          width={FLOOR.width}
          height={FLOOR.height}
          rx={3}
          fill={theme.colors.surface}
          stroke={theme.colors.border}
          strokeWidth={0.8}
        />

        {/* Aisle guides — faint lanes so the gaps read as walkable space. */}
        {[24, 52, 78].map((y) => (
          <Line
            key={y}
            x1={4}
            y1={y}
            x2={96}
            y2={y}
            stroke={theme.colors.border}
            strokeWidth={0.3}
            strokeDasharray="1 2"
          />
        ))}

        {/* Route through the aisles */}
        {routeD ? (
          <AnimatedPath
            d={routeD}
            stroke={theme.colors.primary}
            strokeWidth={1.4}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray="4 4"
            fill="none"
            animatedProps={routeProps}
          />
        ) : null}

        {/* Shelf blocks */}
        {ZONE_SHAPES.map((shape) => {
          const stop = stops.find((s) => s.zone === shape.id);
          const active = shape.id === activeZone;
          const fill = !stop
            ? theme.colors.background
            : stop.done
              ? theme.colors.primarySoft
              : active
                ? theme.colors.primary
                : theme.colors.surface;

          return (
            <G key={shape.id} onPress={() => stop && onSelectZone(shape.id)}>
              <SvgRect
                x={shape.rect.x}
                y={shape.rect.y}
                width={shape.rect.width}
                height={shape.rect.height}
                rx={1.5}
                fill={fill}
                stroke={stop ? theme.colors.primary : theme.colors.border}
                strokeWidth={active ? 1 : 0.5}
                opacity={stop ? 1 : 0.55}
              />
              {stop ? (
                <>
                  <SvgText
                    x={shape.rect.x + shape.rect.width / 2}
                    y={shape.rect.y + shape.rect.height / 2 + 1}
                    fontSize={4}
                    fontWeight="bold"
                    fill={active ? '#fff' : theme.colors.text}
                    textAnchor="middle"
                  >
                    {stop.emoji}
                  </SvgText>
                  {/* Stop number, so the order of the walk is unambiguous. */}
                  <Circle
                    cx={shape.rect.x + 3}
                    cy={shape.rect.y + 3}
                    r={2.2}
                    fill={stop.done ? theme.colors.primaryDark : theme.colors.primary}
                  />
                  <SvgText
                    x={shape.rect.x + 3}
                    y={shape.rect.y + 4}
                    fontSize={2.6}
                    fontWeight="bold"
                    fill="#fff"
                    textAnchor="middle"
                  >
                    {stop.done ? '✓' : stop.stop}
                  </SvgText>
                </>
              ) : null}
            </G>
          );
        })}

        {/* Entrance */}
        <Circle cx={ENTRANCE.x} cy={ENTRANCE.y} r={2} fill={theme.colors.muted} />
        <SvgText
          x={ENTRANCE.x}
          y={ENTRANCE.y - 3.5}
          fontSize={2.8}
          fill={theme.colors.muted}
          textAnchor="middle"
        >
          вхід
        </SvgText>

        {/* The guest */}
        <AnimatedCircle
          animatedProps={haloProps}
          fill={theme.colors.primary}
          opacity={0.25}
        />
        <AnimatedCircle
          animatedProps={avatarProps}
          r={2.4}
          fill={theme.colors.primary}
          stroke="#fff"
          strokeWidth={0.8}
        />
      </Svg>

      <Text style={styles.caption}>
        Схема типового супермаркету. Точний план магазину може відрізнятися —
        познач зону, де ти зараз.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { gap: theme.spacing(2) },
  caption: { fontSize: 10, color: theme.colors.muted, lineHeight: 14 },
});
