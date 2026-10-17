/**
 * Pathfinding — A* over the square grid (T015).
 *
 * Movement in *Lines of Glory* preserves FFTA's model (mapping §12, D10): a
 * unit travels tile-by-tile along the four cardinal directions, pays each
 * destination tile's terrain cost, may not cross a step taller than its
 * **Climb** (FFTA "Jump"), and may not finish on a tile another unit occupies.
 * This module turns those rules from `terrain.ts` into the least-cost route
 * between two tiles.
 *
 * Contract:
 * - **Pure and deterministic.** No DOM, no I/O, no `Math.random`. The same map
 *   and inputs always produce the same path. Ties in the open set are broken by
 *   `(f, g, insertion order)`, and neighbours are expanded in the fixed
 *   north → east → south → west order from `grid.ts`, so equal-cost routes
 *   resolve reproducibly.
 * - **Optimal.** Costs are non-negative and every traversable step costs at
 *   least 1, so Manhattan distance is an admissible and consistent heuristic.
 *   A* therefore returns a genuinely least-cost path, not merely a short one.
 * - **Renderer-free.** The isometric projection (`src/render/iso.ts`) is a
 *   presentation concern; geometry here stays in grid space.
 *
 * The two entry points:
 * - {@link findPath} answers "how do I get from A to B, and what does it cost?"
 * - {@link reachableWithin} answers "which tiles can I reach with a Move budget?"
 *   (the blue movement range FFTA highlights — see `docs/wiki/pages/Move_(stat).md`).
 */

import {
  coordEquals,
  coordKey,
  inBounds,
  manhattanDistance,
  neighboursInGrid,
  type Coord,
} from "./grid";
import { canClimb, getTerrainDef, stepCost, terrainTileAt, type TerrainMap } from "./terrain";

/* --------------------------------------------------------------------------
 * Options & results
 * ------------------------------------------------------------------------ */

/**
 * Movement context shared by {@link findPath} and {@link reachableWithin}.
 *
 * All fields are optional so callers can ask purely geometric questions
 * (level open ground) with no ceremony.
 */
export interface PathfinderOptions {
  /**
   * The mover's Climb (FFTA "Jump", mapping §12). The height difference across
   * any step — up or down — may not exceed this. Defaults to `0`, meaning the
   * mover never changes elevation.
   */
  readonly climb?: number;
  /**
   * Tiles that cannot be entered because another unit is standing there (or an
   * equivalent obstacle blocks them). The mover's own starting tile is ignored,
   * so a unit may always leave the tile it stands on. Defaults to none.
   */
  readonly occupied?: Iterable<Coord>;
  /**
   * Optional movement budget. Any partial path whose cost exceeds it is pruned.
   * Omit (or pass `Infinity`) for an unbounded search. Use this to answer "can
   * I reach B within my Move?" without running the whole map.
   */
  readonly maxCost?: number;
}

/**
 * The outcome of {@link findPath}.
 *
 * When {@link found} is `true`, {@link path} starts at the origin, ends at the
 * destination, and is contiguous (every consecutive pair is orthogonally
 * adjacent). {@link cost} is the sum of the per-tile step costs. When `false`,
 * `path` is empty and `cost` is `Infinity`.
 */
export interface PathResult {
  readonly found: boolean;
  readonly path: readonly Coord[];
  readonly cost: number;
}

/** One tile reachable within a budget, with the cheapest cost to reach it. */
export interface ReachableTile {
  readonly at: Coord;
  /** Least movement cost from the origin to {@link at}. */
  readonly cost: number;
}

/* --------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------ */

/** Throw unless `climb` is a usable, non-negative integer. */
function assertClimb(climb: number): void {
  if (!Number.isInteger(climb) || climb < 0) {
    throw new RangeError(`climb must be a non-negative integer, received ${String(climb)}`);
  }
}

/** Throw unless `maxCost` is a non-negative number (Infinity allowed). */
function assertMaxCost(maxCost: number): void {
  if (typeof maxCost !== "number" || Number.isNaN(maxCost) || maxCost < 0) {
    throw new RangeError(`maxCost must be a non-negative number, received ${String(maxCost)}`);
  }
}

/** Collect occupied coordinates into a fast key-lookup set of copies. */
function toOccupiedSet(occupied: Iterable<Coord> | undefined): ReadonlySet<string> {
  const set = new Set<string>();
  if (!occupied) return set;
  for (const at of occupied) set.add(coordKey(at));
  return set;
}

/** Assert both endpoints name tiles of the map. */
function assertEndpoints(map: TerrainMap, from: Coord, to: Coord): void {
  if (!inBounds(map.grid, from)) {
    throw new RangeError(
      `from { x: ${from.x}, y: ${from.y} } is outside the ${map.grid.width}×${map.grid.height} map`,
    );
  }
  if (!inBounds(map.grid, to)) {
    throw new RangeError(
      `to { x: ${to.x}, y: ${to.y} } is outside the ${map.grid.width}×${map.grid.height} map`,
    );
  }
}

/* --------------------------------------------------------------------------
 * Neighbour expansion (the shared move rule)
 * ------------------------------------------------------------------------ */

/** A legal step to an adjacent tile, with the movement cost to take it. */
interface Step {
  readonly at: Coord;
  readonly cost: number;
}

/**
 * Yield every tile the mover may step onto directly from `at`, in the fixed
 * `north, east, south, west` order, together with the step cost. A neighbour is
 * legal when it is in bounds, unoccupied, passable, and within the Climb limit.
 */
function* legalSteps(
  map: TerrainMap,
  at: Coord,
  climb: number,
  occupied: ReadonlySet<string>,
): Generator<Step, void, void> {
  const fromTile = terrainTileAt(map, at);
  for (const next of neighboursInGrid(map.grid, at)) {
    if (occupied.has(coordKey(next))) continue;
    const toTile = terrainTileAt(map, next);
    if (!getTerrainDef(toTile.terrain).passable) continue;
    if (!canClimb(climb, fromTile.height, toTile.height)) continue;
    yield { at: next, cost: stepCost(fromTile, toTile) };
  }
}

/* --------------------------------------------------------------------------
 * Min-heap priority queue
 * ------------------------------------------------------------------------ */

/**
 * A tiny binary min-heap. Deterministic given a deterministic comparator, which
 * is what keeps equal-cost A* frontiers reproducible.
 */
class MinHeap<T> {
  private readonly items: T[] = [];

  constructor(private readonly compare: (a: T, b: T) => number) {}

  get size(): number {
    return this.items.length;
  }

  push(value: T): void {
    const items = this.items;
    items.push(value);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.compare(items[index], items[parent]) >= 0) break;
      [items[index], items[parent]] = [items[parent], items[index]];
      index = parent;
    }
  }

  pop(): T | undefined {
    const items = this.items;
    if (items.length === 0) return undefined;
    const top = items[0];
    const last = items.pop() as T;
    if (items.length === 0) return top;
    items[0] = last;
    let index = 0;
    const length = items.length;
    for (;;) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < length && this.compare(items[left], items[smallest]) < 0) smallest = left;
      if (right < length && this.compare(items[right], items[smallest]) < 0) smallest = right;
      if (smallest === index) break;
      [items[index], items[smallest]] = [items[smallest], items[index]];
      index = smallest;
    }
    return top;
  }
}

/* --------------------------------------------------------------------------
 * A* shortest path
 * ------------------------------------------------------------------------ */

/** An open-set entry: a tile, the cost to reach it and its A* priority. */
interface OpenNode {
  readonly at: Coord;
  /** Cost from the origin to {@link at} (`g`). */
  readonly g: number;
  /** Estimated total cost (`f = g + h`). */
  readonly f: number;
  /** Monotonic insertion order, for deterministic tie-breaking. */
  readonly seq: number;
}

/** Find the least-cost path from `from` to `to`. */
export function findPath(
  map: TerrainMap,
  from: Coord,
  to: Coord,
  options: PathfinderOptions = {},
): PathResult {
  assertEndpoints(map, from, to);
  const climb = options.climb ?? 0;
  assertClimb(climb);
  const maxCost = options.maxCost ?? Number.POSITIVE_INFINITY;
  assertMaxCost(maxCost);
  const occupied = toOccupiedSet(options.occupied);

  if (coordEquals(from, to)) {
    return { found: true, path: [{ ...from }], cost: 0 };
  }

  const startKey = coordKey(from);
  const goalKey = coordKey(to);
  let seq = 0;

  // `gScore` holds the best known cost to each tile; `cameFrom` the predecessor
  // on that best route, so we can reconstruct the path once the goal is popped.
  const gScore = new Map<string, number>([[startKey, 0]]);
  const cameFrom = new Map<string, Coord>();
  const open = new MinHeap<OpenNode>((a, b) => a.f - b.f || a.g - b.g || a.seq - b.seq);

  open.push({ at: from, g: 0, f: manhattanDistance(from, to), seq: seq++ });

  while (open.size > 0) {
    const current = open.pop() as OpenNode;
    const currentKey = coordKey(current.at);
    const bestKnown = gScore.get(currentKey);
    if (bestKnown !== undefined && current.g > bestKnown) continue; // stale entry

    if (currentKey === goalKey) {
      const path = reconstructPath(cameFrom, from, to);
      return { found: true, path, cost: current.g };
    }

    for (const step of legalSteps(map, current.at, climb, occupied)) {
      const tentative = current.g + step.cost;
      if (tentative > maxCost) continue;
      const stepKey = coordKey(step.at);
      const known = gScore.get(stepKey);
      if (known !== undefined && tentative >= known) continue;

      gScore.set(stepKey, tentative);
      cameFrom.set(stepKey, { ...current.at });
      open.push({
        at: step.at,
        g: tentative,
        f: tentative + manhattanDistance(step.at, to),
        seq: seq++,
      });
    }
  }

  return { found: false, path: [], cost: Number.POSITIVE_INFINITY };
}

/** Walk `cameFrom` backwards from `to`, returning a fresh origin→goal array. */
function reconstructPath(cameFrom: ReadonlyMap<string, Coord>, from: Coord, to: Coord): Coord[] {
  const fromKey = coordKey(from);
  const path: Coord[] = [{ ...to }];
  let cursor = to;
  while (coordKey(cursor) !== fromKey) {
    const previous = cameFrom.get(coordKey(cursor));
    if (!previous) break; // defensive: malformed frontier
    path.push({ ...previous });
    cursor = previous;
  }
  path.reverse();
  return path;
}

/* --------------------------------------------------------------------------
 * Reachable range (Dijkstra flood fill)
 * ------------------------------------------------------------------------ */

/**
 * Every tile reachable from `from` for at most `budget` movement points, with
 * the cheapest cost to each. This is the engine form of FFTA's blue "move
 * range" overlay (`docs/wiki/pages/Move_(stat).md`).
 *
 * Returns a new array sorted by `(cost, y, x)` so callers and tests get a
 * stable, deterministic ordering. The origin is included at cost `0`.
 */
export function reachableWithin(
  map: TerrainMap,
  from: Coord,
  budget: number,
  options: PathfinderOptions = {},
): ReachableTile[] {
  if (!inBounds(map.grid, from)) {
    throw new RangeError(
      `from { x: ${from.x}, y: ${from.y} } is outside the ${map.grid.width}×${map.grid.height} map`,
    );
  }
  if (typeof budget !== "number" || Number.isNaN(budget) || budget < 0) {
    throw new RangeError(`budget must be a non-negative number, received ${String(budget)}`);
  }
  const climb = options.climb ?? 0;
  assertClimb(climb);
  const occupied = toOccupiedSet(options.occupied);

  const startKey = coordKey(from);
  const best = new Map<string, ReachableTile>([[startKey, { at: { ...from }, cost: 0 }]]);
  let seq = 0;
  const open = new MinHeap<OpenNode>((a, b) => a.f - b.f || a.g - b.g || a.seq - b.seq);
  open.push({ at: { ...from }, g: 0, f: 0, seq: seq++ });

  while (open.size > 0) {
    const current = open.pop() as OpenNode;
    const currentKey = coordKey(current.at);
    const known = best.get(currentKey);
    if (known && current.g > known.cost) continue; // stale entry

    for (const step of legalSteps(map, current.at, climb, occupied)) {
      const tentative = current.g + step.cost;
      if (tentative > budget) continue;
      const stepKey = coordKey(step.at);
      const previous = best.get(stepKey);
      if (previous && tentative >= previous.cost) continue;
      best.set(stepKey, { at: { ...step.at }, cost: tentative });
      open.push({ at: step.at, g: tentative, f: tentative, seq: seq++ });
    }
  }

  return [...best.values()].sort((a, b) => a.cost - b.cost || a.at.y - b.at.y || a.at.x - b.at.x);
}
