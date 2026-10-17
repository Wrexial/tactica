/**
 * Range, line of sight & target predicates (T016, T028).
 *
 * Abilities in *Lines of Glory* preserve FFTA's targeting model (mapping §12
 * "Range / Line of Sight"): every action names a **minimum** and **maximum**
 * reach, measured in tiles, and most actions must be able to **see** the target
 * along a clear line. This module turns the geometry (`grid.ts`) and the ground
 * layer (`terrain.ts`) into the questions every ability, the AI and the
 * threat-range overlay ask:
 *
 * - *Is the target within reach?* — {@link withinRange} / {@link canTarget}.
 * - *Is the target visible from here?* — {@link lineOfSight}.
 *
 * T028 layers the **targeting rules** on that geometry: who an action may name
 * (self / ally / enemy / any / tile), how its **area of effect** spreads from
 * the chosen tile, and whether a specific soldier is a legal target once
 * affiliation, range and sight are all considered. See
 * {@link matchesTargetFilter}, {@link aoeTiles} and {@link resolveTargeting}.
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

import type { AbilityTarget, AoeShape } from "../data/schema";
import {
  allCoords,
  assertInBounds,
  chebyshevDistance,
  coordEquals,
  coordKey,
  inBounds,
  manhattanDistance,
  type Coord,
} from "./grid";
import type { UnitId } from "./ids";
import { blocksSightAt, heightAt, type TerrainMap } from "./terrain";
import type { UnitSide } from "./unit";

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

/* --------------------------------------------------------------------------
 * Target predicates (T028)
 * ------------------------------------------------------------------------ */

/**
 * The minimal shape the affiliation predicates need: any combatant with a
 * branded id and a side. A full `Unit` (T017) satisfies it structurally, so
 * callers pass deployed soldiers directly while the AI (T095) can score
 * hypothetical ones without building a whole unit.
 */
export interface TargetActor {
  /** The combatant's stable identity. */
  readonly id: UnitId;
  /** Which side it fights for (company / enemy / neutral). */
  readonly side: UnitSide;
}

/** A {@link TargetActor} that also stands on a tile, as every deployed unit does. */
export interface PositionedTarget extends TargetActor {
  readonly at: Coord;
}

/**
 * Whether two sides are *hostile* under the retheme. Only the free company and
 * the hostile irregulars fight each other; the **Provost Marshal** and other
 * arbiters are `"neutral"` and hostile to no one (mapping §9), so a combat
 * action may never name them as an enemy.
 */
export function areHostile(a: UnitSide, b: UnitSide): boolean {
  return (a === "company" && b === "enemy") || (a === "enemy" && b === "company");
}

/** Whether `candidate` *is* `actor` (FFTA Self-target). */
export function isSelfTarget(actor: TargetActor, candidate: TargetActor): boolean {
  return candidate.id === actor.id;
}

/**
 * Whether `candidate` stands on the actor's side (FFTA ally target). The actor
 * itself counts as an ally — as in FFTA, a Surgeon's bandage can be applied to
 * the one holding it.
 */
export function isAllyTarget(actor: TargetActor, candidate: TargetActor): boolean {
  return candidate.side === actor.side;
}

/** Whether `candidate` is a hostile combatant (FFTA enemy target). */
export function isEnemyTarget(actor: TargetActor, candidate: TargetActor): boolean {
  return areHostile(actor.side, candidate.side);
}

/**
 * Whether `candidate` satisfies an action's authored target rule
 * (`AbilityTarget` in `src/data/schema.ts`).
 *
 * `"tile"` actions are aimed at ground, so they never match a *unit*; use
 * {@link canTarget} for the tile geometry. `"any"` is the union of `"ally"`
 * and `"enemy"`, which is why it still excludes a neutral arbiter.
 */
export function matchesTargetFilter(
  filter: AbilityTarget,
  actor: TargetActor,
  candidate: TargetActor,
): boolean {
  switch (filter) {
    case "self":
      return isSelfTarget(actor, candidate);
    case "ally":
      return isAllyTarget(actor, candidate);
    case "enemy":
      return isEnemyTarget(actor, candidate);
    case "any":
      return isAllyTarget(actor, candidate) || isEnemyTarget(actor, candidate);
    case "tile":
      return false;
  }
}

/**
 * Keep only the soldiers that satisfy `filter` for `actor`, preserving field
 * order. A convenience over {@link matchesTargetFilter} for the AI and the
 * action executor (T041).
 */
export function filterTargets<T extends TargetActor>(
  units: readonly T[],
  filter: AbilityTarget,
  actor: TargetActor,
): T[] {
  return units.filter((unit) => matchesTargetFilter(filter, actor, unit));
}

/* --------------------------------------------------------------------------
 * Areas of effect (T028)
 * ------------------------------------------------------------------------ */

/** Assert an authored AoE size is a non-negative integer. */
function assertAoeSize(size: number): void {
  if (!Number.isInteger(size) || size < 0) {
    throw new RangeError(`aoe size must be a non-negative integer, received ${String(size)}`);
  }
}

/**
 * Unit direction for a `"line"` area: the dominant axis from `origin` to
 * `center`. Equidistant (or a missing origin) falls back to the horizontal
 * (`+x`) axis, so the shape is always defined and deterministic.
 */
function aoeLineDirection(center: Coord, origin?: Coord): Coord {
  if (origin === undefined) return { x: 1, y: 0 };
  const dx = center.x - origin.x;
  const dy = center.y - origin.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx === 0 ? { x: 1, y: 0 } : { x: dx > 0 ? 1 : -1, y: 0 };
  }
  return { x: 0, y: dy > 0 ? 1 : -1 };
}

/**
 * Enumerate the tiles an area effect covers when centred on `center`, in a
 * stable order (south→north, then west→east). Tiles outside the battlefield
 * are simply dropped, so an area at a map edge is clipped rather than wrapping.
 *
 * The shapes are authored data (`AoeShape`, `src/data/schema.ts`):
 *
 * - `"single"` — the centre tile only.
 * - `"cross"` — the centre plus four orthogonal arms of length `size` (a plus).
 * - `"line"` — a straight line of `size` tiles either side of the centre along
 *   the axis from `origin` (the actor's tile) to `center`; horizontal when no
 *   origin is supplied.
 * - `"square"` — every tile within Chebyshev distance `size` (a block).
 * - `"field"` — the entire battlefield (Guard Sorties, mapping §4).
 *
 * This is pure geometry: it applies **no** line-of-sight or affiliation test.
 * Check the centre with {@link canTarget} (or use {@link resolveTargeting}) and
 * filter the occupants with {@link matchesTargetFilter}.
 */
export function aoeTiles(
  map: TerrainMap,
  center: Coord,
  shape: AoeShape,
  size: number,
  origin?: Coord,
): Coord[] {
  assertInBounds(map.grid, center, "center");
  assertAoeSize(size);

  const seen = new Set<string>();
  const tiles: Coord[] = [];
  const push = (at: Coord): void => {
    if (!inBounds(map.grid, at)) return;
    const key = coordKey(at);
    if (seen.has(key)) return;
    seen.add(key);
    tiles.push({ x: at.x, y: at.y });
  };

  switch (shape) {
    case "single":
      push(center);
      break;
    case "cross":
      for (let d = -size; d <= size; d++) {
        push({ x: center.x + d, y: center.y });
        push({ x: center.x, y: center.y + d });
      }
      break;
    case "square":
      for (let dy = -size; dy <= size; dy++) {
        for (let dx = -size; dx <= size; dx++) {
          push({ x: center.x + dx, y: center.y + dy });
        }
      }
      break;
    case "line": {
      const direction = aoeLineDirection(center, origin);
      for (let d = -size; d <= size; d++) {
        push({ x: center.x + direction.x * d, y: center.y + direction.y * d });
      }
      break;
    }
    case "field":
      for (const at of allCoords(map.grid)) push(at);
      break;
  }

  tiles.sort((a, b) => a.y - b.y || a.x - b.x);
  return tiles;
}

/**
 * Every unit standing on one of `tiles`, in the order `units` were supplied
 * (so the result is as deterministic as the deployment list). Occupancy is by
 * tile identity, not distance — a `Map` keyed on {@link coordKey} keeps the
 * lookup `O(1)` per unit.
 */
export function unitsInAoe<T extends PositionedTarget>(
  units: readonly T[],
  tiles: readonly Coord[],
): T[] {
  const keys = new Set(tiles.map((at) => coordKey(at)));
  return units.filter((unit) => keys.has(coordKey(unit.at)));
}

/* --------------------------------------------------------------------------
 * Combined unit targeting (T028)
 * ------------------------------------------------------------------------ */

/** Why {@link canTargetUnit} or {@link resolveTargeting} rejected a target. */
export type TargetingFailReason =
  | TargetFailReason
  | "wrong-affiliation"
  | "unknown-target";

/** The detailed outcome of a single-soldier target check. */
export interface UnitTargetResult {
  /** `true` only when both affiliation and range/sight allow the target. */
  readonly ok: boolean;
  /** Whether `filter` admits the candidate (`false` for `"tile"` actions). */
  readonly filterOk: boolean;
  /** The underlying tile check — range, metric and line of sight. */
  readonly tile: TargetResult;
  /** The rejection reason, when {@link ok} is `false`. */
  readonly reason?: TargetingFailReason;
}

/**
 * Whether `actor` may name `candidate` as the target of an action: the
 * authored affiliation rule (`filter`) **and** the reach/sight check on the
 * candidate's tile. Affiliation is decided first, so a friendly never reports
 * `out-of-range`; the full tile check is still returned in `tile` so a caller
 * can display the geometry that would have applied.
 *
 * ```ts
 * canTargetUnit(map, rifleman, irregular, "enemy", { min: 1, max: 6 }).ok;
 * ```
 */
export function canTargetUnit(
  map: TerrainMap,
  actor: PositionedTarget,
  candidate: PositionedTarget,
  filter: AbilityTarget,
  profile: RangeProfile,
): UnitTargetResult {
  const filterOk = matchesTargetFilter(filter, actor, candidate);
  const tile = canTarget(map, actor.at, candidate.at, profile);
  let reason: TargetingFailReason | undefined;
  if (!filterOk) reason = "wrong-affiliation";
  else if (!tile.ok) reason = tile.reason;
  return { ok: filterOk && tile.ok, filterOk, tile, ...(reason ? { reason } : {}) };
}

/* --------------------------------------------------------------------------
 * Full resolution (T028)
 * ------------------------------------------------------------------------ */

/**
 * An action's targeting data, mirroring the authored `AbilityDef` fields the
 * engine needs. `aoeShape`/`aoeSize` default to `"single"` / `0`.
 */
export interface AbilityTargeting {
  /** Who the action may legally include (self / ally / enemy / any / tile). */
  readonly target: AbilityTarget;
  /** Reach and line-of-sight profile. */
  readonly range: RangeProfile;
  /** Footprint applied around the chosen centre. Defaults to `"single"`. */
  readonly aoeShape?: AoeShape;
  /** Footprint radius in tiles. Defaults to `0`. */
  readonly aoeSize?: number;
}

/**
 * What an action was aimed at. Mirrors the command layer's `Target` (T020) but
 * stays engine-local so targeting can be resolved without importing
 * `commands.ts` (and thus without a cycle when the executor reuses it).
 */
export type TargetSelection =
  | { readonly kind: "self" }
  | { readonly kind: "tile"; readonly at: Coord }
  | { readonly kind: "unit"; readonly unitId: UnitId };

/**
 * Everything a caller needs to apply an action: whether the aim was legal, the
 * centre tile, the area footprint, and who it catches.
 *
 * `affected` is *everyone* in the footprint (FFTA areas hit friend and foe
 * alike), while `matched` narrows that to units satisfying the action's target
 * rule. A tile-targeted area therefore reports its full occupant list in
 * `affected` even though `matched` is empty.
 */
export interface TargetingResolution<T extends PositionedTarget> {
  /** `true` only when affiliation and the centre's range/sight check pass. */
  readonly ok: boolean;
  /** The resolved centre tile the effect lands on. */
  readonly center: Coord;
  /** Whether the action's target rule admits the primary target. */
  readonly filterOk: boolean;
  /** The centre tile's range/sight check. */
  readonly tile: TargetResult;
  /** The area footprint (see {@link aoeTiles}). */
  readonly tiles: readonly Coord[];
  /** Every unit standing in the footprint, in field order. */
  readonly affected: readonly T[];
  /** Occupants that also satisfy the action's target rule. */
  readonly matched: readonly T[];
  /** The rejection reason, when {@link ok} is `false`. */
  readonly reason?: TargetingFailReason;
}

/**
 * Resolve an action's full targeting: affiliation, range, line of sight and
 * area of effect, in one deterministic pass.
 *
 * - `"self"` centres on the actor and requires a rule that admits the actor.
 * - `"tile"` centres on the named ground tile; legal for `"tile"`/`"any"`
 *   rules.
 * - `"unit"` centres on that soldier and applies the rule to them; an id that
 *   is not deployed returns `unknown-target` rather than throwing (the command
 *   layer validates ids at its own boundary).
 *
 * The area footprint is always computed, even on rejection, so the targeting
 * overlay (T030/T085) can preview an area before the player commits.
 */
export function resolveTargeting<T extends PositionedTarget>(
  map: TerrainMap,
  actor: PositionedTarget,
  units: readonly T[],
  selection: TargetSelection,
  targeting: AbilityTargeting,
): TargetingResolution<T> {
  const shape = targeting.aoeShape ?? "single";
  const size = targeting.aoeSize ?? 0;

  let center: Coord;
  let filterOk: boolean;

  switch (selection.kind) {
    case "self":
      center = { x: actor.at.x, y: actor.at.y };
      filterOk = matchesTargetFilter(targeting.target, actor, actor);
      break;
    case "tile":
      center = { x: selection.at.x, y: selection.at.y };
      filterOk = targeting.target === "tile" || targeting.target === "any";
      break;
    case "unit": {
      const found = units.find((unit) => unit.id === selection.unitId);
      if (found === undefined) {
        return {
          ok: false,
          center: { x: actor.at.x, y: actor.at.y },
          filterOk: false,
          tile: canTarget(map, actor.at, actor.at, targeting.range),
          tiles: [],
          affected: [],
          matched: [],
          reason: "unknown-target",
        };
      }
      center = { x: found.at.x, y: found.at.y };
      filterOk = matchesTargetFilter(targeting.target, actor, found);
      break;
    }
  }

  const tile = canTarget(map, actor.at, center, targeting.range);
  let reason: TargetingFailReason | undefined;
  if (!filterOk) reason = "wrong-affiliation";
  else if (!tile.ok) reason = tile.reason;

  const footprint = aoeTiles(map, center, shape, size, actor.at);
  const affected = unitsInAoe(units, footprint);
  const matched = affected.filter((unit) => matchesTargetFilter(targeting.target, actor, unit));

  return {
    ok: filterOk && tile.ok,
    center,
    filterOk,
    tile,
    tiles: footprint,
    affected,
    matched,
    ...(reason ? { reason } : {}),
  };
}
