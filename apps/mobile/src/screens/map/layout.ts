import type { ZoneId } from '../../types';

/**
 * Floor plan geometry for the store map.
 *
 * Coordinates are in an abstract 100×100 space so the plan scales to any screen
 * without recomputing anything. Y grows downward, matching screen coordinates.
 *
 * HONEST LIMITATION: this is a MODEL of a standard supermarket, not the plan of
 * any real branch. The Silpo MCP server exposes no aisle, shelf or coordinate
 * data — verified across all 39 tools. Fresh departments line the perimeter
 * (that is where refrigeration power runs), dry goods fill the centre aisles,
 * checkout sits by the entrance. The map says so on screen.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ZoneShape {
  id: ZoneId;
  /** The shelf block itself. */
  rect: Rect;
  /**
   * Where a shopper stands to reach this shelf — always in an aisle, never
   * inside the block. Route lines connect these, not the shelves.
   */
  stand: Point;
  /** Which way the label should read: along the block or across it. */
  orientation: 'horizontal' | 'vertical';
}

/** Outer walls of the sales floor. */
export const FLOOR: Rect = { x: 0, y: 0, width: 100, height: 100 };

/** Where the guest comes in — bottom right, so the walk runs anti-clockwise. */
export const ENTRANCE: Point = { x: 88, y: 96 };

/**
 * Shelf blocks.
 *
 * Perimeter blocks hug the walls; the three centre blocks are the classic
 * parallel grocery aisles with walkable gaps between them.
 */
export const ZONE_SHAPES: readonly ZoneShape[] = [
  // Perimeter — fresh departments along the top and left walls.
  {
    id: 'produce',
    rect: { x: 60, y: 4, width: 36, height: 14 },
    stand: { x: 78, y: 24 },
    orientation: 'horizontal',
  },
  {
    id: 'bakery',
    rect: { x: 32, y: 4, width: 24, height: 14 },
    stand: { x: 44, y: 24 },
    orientation: 'horizontal',
  },
  {
    id: 'meat',
    rect: { x: 4, y: 4, width: 24, height: 14 },
    stand: { x: 16, y: 24 },
    orientation: 'horizontal',
  },
  {
    id: 'fish',
    rect: { x: 4, y: 22, width: 12, height: 20 },
    stand: { x: 22, y: 32 },
    orientation: 'vertical',
  },
  {
    id: 'dairy',
    rect: { x: 4, y: 46, width: 12, height: 26 },
    stand: { x: 22, y: 59 },
    orientation: 'vertical',
  },
  // Centre — parallel aisles with gaps a shopper walks down.
  {
    id: 'grocery',
    rect: { x: 30, y: 32, width: 14, height: 40 },
    stand: { x: 50, y: 52 },
    orientation: 'vertical',
  },
  {
    id: 'frozen',
    rect: { x: 56, y: 32, width: 14, height: 40 },
    stand: { x: 74, y: 52 },
    orientation: 'vertical',
  },
  {
    id: 'household',
    rect: { x: 82, y: 32, width: 14, height: 40 },
    stand: { x: 78, y: 78 },
    orientation: 'vertical',
  },
  // Checkout line along the bottom wall.
  {
    id: 'checkout',
    rect: { x: 20, y: 84, width: 46, height: 10 },
    stand: { x: 43, y: 80 },
    orientation: 'horizontal',
  },
] as const;

const SHAPE_BY_ID = new Map(ZONE_SHAPES.map((z) => [z.id, z]));

export function getShape(id: ZoneId): ZoneShape | undefined {
  return SHAPE_BY_ID.get(id);
}

/**
 * Horizontal corridors a shopper can walk along, as Y coordinates.
 *
 * Routes are built from straight segments that follow these lanes, so a path
 * never cuts diagonally through a shelf.
 */
const LANES = [24, 52, 78];

/** The walkable lane closest to a point. */
function nearestLane(y: number): number {
  return LANES.reduce((best, lane) =>
    Math.abs(lane - y) < Math.abs(best - y) ? lane : best,
  );
}

/**
 * Builds a walking path between two standing points.
 *
 * Movement is orthogonal — along an aisle, across a lane, along the next aisle —
 * because that is how a person actually walks a shop floor. A straight diagonal
 * would cut through shelving and look wrong the moment it animates.
 */
export function pathBetween(from: Point, to: Point): Point[] {
  // Same lane: a single straight walk.
  if (Math.abs(from.y - to.y) < 6) return [from, to];

  const lane = nearestLane((from.y + to.y) / 2);
  return [from, { x: from.x, y: lane }, { x: to.x, y: lane }, to];
}

/** Full route through the given zones, starting at the entrance. */
export function buildPath(zones: ZoneId[]): Point[] {
  const stops = zones
    .map((id) => getShape(id)?.stand)
    .filter((p): p is Point => Boolean(p));

  if (!stops.length) return [];

  const points: Point[] = [ENTRANCE];
  let current = ENTRANCE;

  for (const stop of stops) {
    const leg = pathBetween(current, stop);
    // Skip the first point of each leg — it repeats the previous stop.
    points.push(...leg.slice(1));
    current = stop;
  }

  return points;
}

/** Total length of a path, for pacing the walking animation. */
export function pathLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}

/**
 * Position along a path at progress `t` (0…1).
 * Used to move the avatar smoothly between stops.
 */
export function pointAt(points: Point[], t: number): Point {
  if (points.length === 0) return ENTRANCE;
  if (points.length === 1) return points[0];

  const target = pathLength(points) * Math.min(Math.max(t, 0), 1);
  let travelled = 0;

  for (let i = 1; i < points.length; i += 1) {
    const segment = Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
    if (travelled + segment >= target) {
      const local = segment === 0 ? 0 : (target - travelled) / segment;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * local,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * local,
      };
    }
    travelled += segment;
  }

  return points[points.length - 1];
}
