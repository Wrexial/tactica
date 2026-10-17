/**
 * Range & line of sight (T016).
 *
 * Abilities in *Lines of Glory* preserve FFTA's targeting model (mapping §12
 * "Range / Line of Sight"): every action names a **minimum** and **maximum**
 * reach, measured in tiles, and most actions must be able to **see** the target
 * along a clear line. This module turns the geometry (`grid.ts`) and the ground
 * layer (`terrain.ts`) into the two questions every ability, the AI and the
 * threat-range overlay ask:
 *
 * - *Is the target within reach?* — {@link withinRange} / {@link canTarget}.
 * - *Is the target visible from here?* — {@link lineOfSight}.
 *
 * Which tiles lie on a firing line ({@link tilesOnLine}) comes from a
 * deterministic Bresenham walk; nothing here samples randomness, touches the
 * DOM, or mutates its inputs.
 *
 * ## Blocking model
 *
 * A sight line is drawn tile-centre to tile-centre and the **intermediate**
 * tiles are tested (the observer's and target's own tiles never block — you can
 * always see the unit you are shooting at even if it stands in a wood):
 *
 * 1. **Terrain** — a surface flagged `blocksSight` in `terrain.ts` (wood,
 *    village, wall) blocks sight outright. This mirrors FFTA, where cover
 *    terrain interrupts line of fire regardless of height.
 * 2. **Elevation** — each intermediate tile's ground is compared with the
 *    straight sight line between the two eye positions. If the ground rises
 *    *above* the line (a ridge taller than the shooter's view), sight is
 *    blocked. Because the line is interpolated, high ground both **blocks**
 *    attackers below it and **lets a unit shoot over** lesser ridges. The test
 *    is done with integer cross-multiplication so it stays byte-deterministic
 *    on every platform.
 *
 * ## Range and elevation
 *
 * Most actions use a fixed reach. Ranged actions (cast `elevationBonus`) extend
 * their maximum range when firing downhill from high ground — the Napoleonic
 * "commanding position" — capped by {@link MAX_ELEVATION_RANGE_DELTA}. The
 * minimum range is unchanged, which is what makes an artillery piece unable to
 * fire its roundshot into an adjacent tile (canister is a separate action).
 */

import {
  allCoords,
  assertInBounds,
  chebyshevDistance,
  coordEquals,
  manhattanDistance,
  type Coord,
} from "./grid";
import { blocksSightAt, heightAt, type TerrainMap } from "./terrain";

/* --------------------------------------------------------------------------
 * Constants (all tunable balance lives here, per agents.md §9)
 * ------------------------------------------------------------------------ */

/**
 * How far a unit's eye sits above its tile's elevation, in the same integer
 * units as `terrain.ts` heights. Used only to draw the sight line, so it
 * cancels out on level ground; it matters when comparing a rising ridge with a
 * shooter on a slope.
 */
export const EYE_HEIGHT = 1;

/** Maximum extra tiles of range granted per elevation layer gained downhill. */
export const ELEVATION_RANGE_PER_LEVEL = 1;

/**
 * Cap on the elevation range modifier, in elevation layers. A shooter on a
 * 15-layer crag does not gain infinite reach; they gain at most this many
 * layers' worth (times {@link ELEVATION_RANGE_PER_LEVEL}).
 */
export const MAX_ELEVATION_RANGE_DELTA = 3;

/* --------------------------------------------------------------------------
 * Range profiles
 * ------------------------------------------------------------------------ */

/**
 * How a range is measured across the square grid.
 *
 * - `"manhattan"` (default) — a diamond, four orthogonal neighbours at range 1.
 *   This is the FFTA spell/ability shape.
 * - `"chebyshev"` — a square, all eight neighbours at range 1. Used for
 *   weapons and actions that can traverse a diagonal (mapping §12).
 */
export type RangeMetric = "manhattan" | "chebyshev";

/**
 * Authored reach for an action or a threat overlay.
 *
 * These are data, not branches: abilities in `src/data/` carry a `RangeProfile`
 * and the engine never hard-codes a particular weapon's reach.
 */
export interface RangeProfile {
  /** Closest tile the action can reach. `0` allows the user's own tile. */
  readonly min: number;
  /** Furthest tile the action can reach, before any elevation bonus. */
  readonly max: number;
  /** Distance metric. Defaults to `"manhattan"`. */
  readonly metric?: RangeMetric;
  /**
   * Whether standing on higher ground extends {@link max} downhill. Ranged
   * actions set this; melee actions leave it off.
   */
  readonly elevationBonus?: boolean;
  /**
   * Whether the action needs an unbroken sight line. Defaults to `true`; set
   * `false` for lobbed or area effects that ignore line of sight.
   */
  readonly requiresLineOfSight?: boolean;
}

/** The two endpoints' elevations, for an elevation-aware range check. */
export interface Elevation {
  readonly observer: number;
  readonly target: number;
}

/** Distance between two tiles under `metric`. */
export function rangeBetween(a: Coord, b: Coord, metric: RangeMetric = "manhattan"): number {
  return metric === "chebyshev" ? chebyshevDistance(a, b) : manhattanDistance(a, b);
}

/** The metric declared by a profile, defaulting to Manhattan. */
export function profileMetric(profile: RangeProfile): RangeMetric {
  return profile.metric ?? "manhattan";
}

/** Throw unless a profile is well-formed and JSON-safe. */
function assertRangeProfile(profile: RangeProfile): void {
  if (!Number.isInteger(profile.min) || profile.min < 0) {
    throw new RangeError(
      `range.min must be a non-negative integer, received ${String(profile.min)}`,
    );
  }
  if (!Number.isInteger(profile.max) || profile.max < 0) {
    throw new RangeError(
      `range.max must be a non-negative integer, received ${String(profile.max)}`,
    );
  }
  if (profile.max < profile.min) {
    throw new RangeError(
      `range.max (${profile.max}) must not be less than range.min (${profile.min})`,
    );
  }
}

/* --------------------------------------------------------------------------
 * Range and elevation
 * ------------------------------------------------------------------------ */

/** Clamp `value` into the inclusive `[low, high]` band. */
function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * Tiles of extra reach from firing from `observerHeight` down to
 * `targetHeight`. Each layer of height advantage adds
 * {@link ELEVATION_RANGE_PER_LEVEL}, each layer of disadvantage subtracts it,
 * and the total is capped at ±{@link MAX_ELEVATION_RANGE_DELTA} layers. Level
 * ground is always `0`.
 */
export function elevationRangeModifier(observerHeight: number, targetHeight: number): number {
  const delta = clamp(
    observerHeight - targetHeight,
    -MAX_ELEVATION_RANGE_DELTA,
    MAX_ELEVATION_RANGE_DELTA,
  );
  return delta * ELEVATION_RANGE_PER_LEVEL;
}

/**
 * The maximum reach of `profile` from `observerHeight` to `targetHeight`.
 * Profiles without `elevationBonus` ignore the elevations and return
 * `profile.max` unchanged.
 */
export function effectiveRange(
  profile: RangeProfile,
  observerHeight: number,
  targetHeight: number,
): number {
  if (!profile.elevationBonus) return profile.max;
  return Math.max(0, profile.max + elevationRangeModifier(observerHeight, targetHeight));
}

/**
 * Whether `to` is within `profile`'s reach of `from`. Pure geometry: it does
 * **not** test line of sight (use {@link canTarget} for that). When an
 * elevation pair is supplied and the profile has `elevationBonus`, the maximum
 * range is adjusted accordingly.
 */
export function withinRange(
  profile: RangeProfile,
  from: Coord,
  to: Coord,
  elevation?: Elevation,
): boolean {
  assertRangeProfile(profile);
  const distance = rangeBetween(from, to, profileMetric(profile));
  const max = elevation
    ? effectiveRange(profile, elevation.observer, elevation.target)
    : profile.max;
  return distance >= profile.min && distance <= max;
}

/* --------------------------------------------------------------------------
 * Line of sight
 * ------------------------------------------------------------------------ */

/**
 * Why a sight line failed. `"terrain"` means a `blocksSight` surface;
 * `"elevation"` means ground rose above the interpolated sight line.
 */
export type SightBlocker = "terrain" | "elevation";

/** The outcome of {@link lineOfSight}. */
export interface LineOfSightResult {
  /** `true` when nothing blocks the line between the two tiles. */
  readonly clear: boolean;
  /** The first blocking tile, when {@link clear} is `false`. */
  readonly blockedBy?: Coord;
  /** What kind of tile blocked, when {@link clear} is `false`. */
  readonly blocker?: SightBlocker;
}

/**
 * Every tile a tile-centre-to-tile-centre line passes through, inclusive of
 * both endpoints. A standard integer Bresenham walk, so the result is
 * deterministic. Horizontal, vertical and exact-diagonal lines are exact;
 * near-diagonal lines resolve their corner ties consistently (the lower-right
 * tile of the crossed corner is chosen).
 *
 * This is the geometry primitive behind {@link lineOfSight}; it is exported
 * because rendering smoke/fire lanes and the AI's firing solutions reuse it.
 */
export function tilesOnLine(from: Coord, to: Coord): Coord[] {
  const points: Coord[] = [];
  let x = from.x;
  let y = from.y;
  const dx = Math.abs(to.x - x);
  const dy = -Math.abs(to.y - y);
  const stepX = x < to.x ? 1 : -1;
  const stepY = y < to.y ? 1 : -1;
  let error = dx + dy;

  for (;;) {
    points.push({ x, y });
    if (x === to.x && y === to.y) break;
    const doubled = 2 * error;
    if (doubled >= dy) {
      error += dy;
      x += stepX;
    }
    if (doubled <= dx) {
      error += dx;
      y += stepY;
    }
  }
  return points;
}

/**
 * A tile's position along the line as an exact fraction `num / den` with
 * `den > 0`, measured on whichever axis changes more. Used to interpolate the
 * sight-line height without floating point.
 */
function lineFraction(from: Coord, to: Coord, at: Coord): { num: number; den: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let num: number;
  let den: number;
  if (Math.abs(dx) >= Math.abs(dy)) {
    num = at.x - from.x;
    den = dx;
  } else {
    num = at.y - from.y;
    den = dy;
  }
  if (den < 0) {
    num = -num;
    den = -den;
  }
  return { num, den };
}

/** Assert both endpoints name tiles of the map. */
function assertEndpoints(map: TerrainMap, from: Coord, to: Coord): void {
  assertInBounds(map.grid, from, "from");
  assertInBounds(map.grid, to, "to");
}

/**
 * Trace the firing line from `from` to `to` and report whether it is clear.
 *
 * Terrain and elevation blocking follow the module header. The observer's and
 * target's own tiles are never blockers, so a unit can always engage the
 * occupant of a wood, and a unit standing in a wood can still see out.
 *
 * Throws a `RangeError` when either endpoint is off-grid, matching
 * `terrain.ts` and `pathfinding.ts`.
 */
export function lineOfSight(map: TerrainMap, from: Coord, to: Coord): LineOfSightResult {
  assertEndpoints(map, from, to);
  if (coordEquals(from, to)) return { clear: true };

  const path = tilesOnLine(from, to);
  const fromHeight = heightAt(map, from);
  const toHeight = heightAt(map, to);

  // Only intermediate tiles can block: index 0 is the observer, the last is
  // the target.
  for (let i = 1; i < path.length - 1; i++) {
    const at = path[i];
    if (blocksSightAt(map, at)) {
      return { clear: false, blockedBy: at, blocker: "terrain" };
    }
    // Compare the tile's ground with the interpolated eye line:
    //   ground > (fromEye + (toHeight - fromHeight) * num/den)
    // Cross-multiplying by the positive denominator keeps this integer-only.
    const { num, den } = lineFraction(from, to, at);
    const ground = heightAt(map, at) * den;
    const sightLine = (fromHeight + EYE_HEIGHT) * den + (toHeight - fromHeight) * num;
    if (ground > sightLine) {
      return { clear: false, blockedBy: at, blocker: "elevation" };
    }
  }

  return { clear: true };
}

/** Convenience boolean form of {@link lineOfSight}. */
export function hasLineOfSight(map: TerrainMap, from: Coord, to: Coord): boolean {
  return lineOfSight(map, from, to).clear;
}

/* --------------------------------------------------------------------------
 * Combined target check
 * ------------------------------------------------------------------------ */

/** Why {@link canTarget} rejected a target. */
export type TargetFailReason =
  "too-close" | "out-of-range" | "blocked-terrain" | "blocked-elevation";

/** The detailed outcome of {@link canTarget}. */
export interface TargetResult {
  /** `true` when the action can legally target `to` from `from`. */
  readonly ok: boolean;
  /** Metric distance between the tiles. */
  readonly distance: number;
  /** Effective maximum range after any elevation bonus. */
  readonly range: number;
  /** Effective minimum range (always `profile.min`). */
  readonly minRange: number;
  /** Whether the metric distance is within `[minRange, range]`. */
  readonly inRange: boolean;
  /** Whether the sight line is clear (or not required). */
  readonly lineOfSight: boolean;
  /** The first blocking tile, when rejected for sight. */
  readonly blockedBy?: Coord;
  /** The rejection reason, when {@link ok} is `false`. */
  readonly reason?: TargetFailReason;
}

/**
 * Whether `from` can target the tile `to` with `profile`: a range check plus,
 * unless `requiresLineOfSight` is `false`, a clear sight line. Range is
 * reported before sight, so an out-of-reach target is never called "blocked".
 *
 * ```ts
 * const rifle = { min: 1, max: 6, elevationBonus: true };
 * if (canTarget(map, shooter.at, enemy.at, rifle).ok) fire(shooter, enemy);
 * ```
 */
export function canTarget(
  map: TerrainMap,
  from: Coord,
  to: Coord,
  profile: RangeProfile,
): TargetResult {
  assertRangeProfile(profile);
  assertEndpoints(map, from, to);

  const observerHeight = heightAt(map, from);
  const targetHeight = heightAt(map, to);
  const distance = rangeBetween(from, to, profileMetric(profile));
  const range = effectiveRange(profile, observerHeight, targetHeight);
  const inRange = distance >= profile.min && distance <= range;
  const sight = lineOfSight(map, from, to);
  const needsSight = profile.requiresLineOfSight ?? true;
  const sightOk = !needsSight || sight.clear;

  let reason: TargetFailReason | undefined;
  if (!inRange) {
    reason = distance < profile.min ? "too-close" : "out-of-range";
  } else if (!sightOk) {
    reason = sight.blocker === "elevation" ? "blocked-elevation" : "blocked-terrain";
  }

  return {
    ok: inRange && sightOk,
    distance,
    range,
    minRange: profile.min,
    inRange,
    lineOfSight: sight.clear,
    ...(sight.blockedBy ? { blockedBy: sight.blockedBy } : {}),
    ...(reason ? { reason } : {}),
  };
}

/* --------------------------------------------------------------------------
 * Area enumeration (targeting overlay / AI)
 * ------------------------------------------------------------------------ */

/**
 * Every tile reachable from `from` by `profile`, sorted by
 * `(distance, y, x)` so the result is deterministic and stable. Line of sight
 * is applied per-tile (so a wood's shadow is excluded), matching
 * {@link canTarget}. The origin is included whenever `profile.min` is `0`.
 *
 * Cost is `O(width × height)`; use it to build an ability's highlight overlay
 * or to seed the AI's candidate list, not inside a per-tile inner loop.
 */
export function tilesInRange(map: TerrainMap, from: Coord, profile: RangeProfile): Coord[] {
  assertRangeProfile(profile);
  assertInBounds(map.grid, from, "from");

  const metric = profileMetric(profile);
  const needsSight = profile.requiresLineOfSight ?? true;
  const observerHeight = heightAt(map, from);
  // Any tile beyond this cannot be in range even with the full downhill bonus.
  const searchCeiling =
    profile.max +
    (profile.elevationBonus ? MAX_ELEVATION_RANGE_DELTA * ELEVATION_RANGE_PER_LEVEL : 0);

  const results: { at: Coord; distance: number }[] = [];
  for (const candidate of allCoords(map.grid)) {
    const distance = rangeBetween(from, candidate, metric);
    if (distance < profile.min || distance > searchCeiling) continue;
    const range = effectiveRange(profile, observerHeight, heightAt(map, candidate));
    if (distance > range) continue;
    if (needsSight && !hasLineOfSight(map, from, candidate)) continue;
    results.push({ at: candidate, distance });
  }

  results.sort((a, b) => a.distance - b.distance || a.at.y - b.at.y || a.at.x - b.at.x);
  return results.map((entry) => entry.at);
}
