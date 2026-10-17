/**
 * Shove (knockback) (T044) — FFTA knockback re-authored as a Napoleonic
 * **Shove** (mapping §12: "Knockback → Shove | Cavalry impact, explosions").
 *
 * A shove displaces a soldier along a cardinal direction by a number of tiles.
 * Unlike a march (`actions/move.ts`, T025) — which is a *choice* the mover makes
 * and prices with its **Move** budget — a shove is an **external displacement**:
 * it ignores Move and terrain cost, but obeys the same geometry of collision and
 * elevation that already governs movement:
 *
 * - **Collision.** A tile another soldier holds stops the shove. With
 *   `chain: true` the blocker is shoved in the same direction too, so a whole
 *   line of troops can be driven back together — the cavalry-impact image the
 *   mapping calls out. A chain that cannot move anywhere stops the line at that
 *   point, leaving every shovee before it where it stands.
 * - **Elevation.** Impassable terrain and the map edge stop the shove. So does
 *   a step steeper than the shovee's **Climb** (FFTA "Jump", mapping §12) —
 *   uphill always, and downhill unless `allowFall` turns the drop into a fall.
 *   A fall deals {@link FALL_DAMAGE_PER_LEVEL} hit points for every level beyond
 *   Climb, reported as `"none"`-type `damaged` events (environmental harm; see
 *   `DAMAGE_TYPES` in `events.ts`) and an `outOfAction` when it is fatal.
 * - **Push / pull.** `direction` is the direction from the shover towards the
 *   target. A **push** drives the target further along it; a **pull** drags the
 *   target back towards the shover.
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Pure & deterministic** — no DOM, no I/O, no `Math.random`, no `Date`. The
 *   same context and request always yield byte-identical units and events, so a
 *   replay reproduces every displacement.
 * - **State in, state out** — the input units and map are never mutated; a new
 *   unit array and event list are returned (structural sharing is fine).
 * - **Data-driven** — direction, distance, mode, chaining and whether a drop is
 *   allowed to become a fall are all request data; only the reference
 *   coefficients are exported constants content may retune.
 *
 * The module deliberately works on a small {@link ShoveContext} (a map plus the
 * deployed units) rather than the whole `BattleState`, so it stays a rules
 * primitive: the battle layer (T022) or an action executor can call it and fold
 * the returned units back into state. `agents.md` §7 keeps `rules/` free of the
 * state machine.
 *
 * Reference: `docs/NAPOLEONIC_MAPPING.md` §12. FFTA documents no numeric
 * knockback formula, so the collision/elevation rules and fall damage here are
 * **authored** balance, not wiki gospel (`agents.md` §3, §10).
 */

import type { BattleEvent } from "../events";
import {
  FACING_OFFSETS,
  addCoords,
  coordEquals,
  inBounds,
  isFacing,
  oppositeFacing,
  type Coord,
  type Facing,
} from "../grid";
import type { UnitId } from "../ids";
import { getTerrainDef, terrainTileAt, type TerrainMap } from "../terrain";
import { withHp, withPosition, type Unit } from "../unit";

/* --------------------------------------------------------------------------
 * Tunable balance (Phase 13 owns the final pass)
 * ------------------------------------------------------------------------ */

/**
 * The two directions a shove can take relative to the shover → target vector.
 * A **push** moves the target away; a **pull** drags it closer.
 */
export const SHOVE_MODES = ["push", "pull"] as const;
export type ShoveMode = (typeof SHOVE_MODES)[number];

/** Runtime guard for untrusted mode values (save files, network, AI). */
export function isShoveMode(value: unknown): value is ShoveMode {
  return typeof value === "string" && (SHOVE_MODES as readonly string[]).includes(value);
}

/**
 * Hard ceiling on a collision chain, so a malformed save or a map full of
 * soldiers can never recurse without bound. A chain cannot exceed the number of
 * deployed soldiers anyway; this is a belt-and-braces guard.
 */
export const MAX_SHOVE_CHAIN = 32;

/**
 * Hit points lost per elevation level a soldier falls beyond its Climb when a
 * shove drops it off an edge. Authored balance inspired by the risk of being
 * driven from high ground (mapping §12, "Cavalry impact, explosions"); safe to
 * retune without touching the rules.
 */
export const FALL_DAMAGE_PER_LEVEL = 5;

/* --------------------------------------------------------------------------
 * Context, request and result
 * ------------------------------------------------------------------------ */

/**
 * The battlefield facts a shove needs: the terrain/elevation map and the
 * deployed soldiers. `tick` stamps the emitted events (defaults to `0`).
 * Immutable — nothing here is written.
 */
export interface ShoveContext {
  readonly map: TerrainMap;
  readonly units: readonly Unit[];
  /** Orders Tempo tick the shove resolves on; defaults to `0`. */
  readonly tick?: number;
}

/** What a caller asks a shove to do. */
export interface ShoveRequest {
  /** The soldier being displaced. */
  readonly unitId: UnitId;
  /**
   * The direction from the shover towards the target. A `push` continues along
   * it; a `pull` reverses it. Must be a cardinal {@link Facing}.
   */
  readonly direction: Facing;
  /** How many tiles to attempt to move; `0` is a no-op. `>= 0`. */
  readonly distance: number;
  /** Push away (default) or pull closer. */
  readonly mode?: ShoveMode;
  /**
   * Whether a blocking soldier is shoved too, so a line of troops moves
   * together. Defaults to `false` (the target stops at the blocker).
   */
  readonly chain?: boolean;
  /**
   * Whether a downhill drop steeper than Climb becomes a fall (with damage)
   * instead of stopping the shove. Defaults to `false`.
   */
  readonly allowFall?: boolean;
}

/** The net displacement of one soldier over a resolved shove. */
export interface ShoveStep {
  readonly unitId: UnitId;
  /** Tile the soldier started on. */
  readonly from: Coord;
  /** Tile the soldier ended on (may equal `from` when it could not move). */
  readonly to: Coord;
  /** Number of tiles actually crossed. */
  readonly tiles: number;
  /** Elevation levels fallen beyond Climb across the whole displacement. */
  readonly fallen: number;
}

/** The outcome of {@link resolveShove}. */
export interface ShoveResult {
  /** A new roster with the displaced soldiers re-positioned (and hurt). */
  readonly units: readonly Unit[];
  /**
   * Ordered events: one `shoved` per tile crossed (the far end of a chain
   * first), with a `damaged`/`outOfAction` pair after any falling step.
   */
  readonly events: readonly BattleEvent[];
  /**
   * Net displacement per moved soldier, in resolution order (chain leader
   * first, then each blocker nearer the target, then the target itself).
   * Unmoved soldiers are omitted.
   */
  readonly moved: readonly ShoveStep[];
}

/* --------------------------------------------------------------------------
 * Internal working state
 * ------------------------------------------------------------------------ */

/** One single-tile displacement, used to merge into a net {@link ShoveStep}. */
interface TileMove {
  readonly unitId: UnitId;
  readonly from: Coord;
  readonly to: Coord;
  /** Elevation levels fallen on this step (0 for a safe step). */
  readonly fall: number;
}

/** Mutable scratch state for one resolution. Never leaves this module. */
interface Work {
  readonly map: TerrainMap;
  readonly unitById: ReadonlyMap<string, Unit>;
  readonly positions: Map<string, Coord>;
  readonly moves: TileMove[];
  readonly chain: boolean;
  readonly allowFall: boolean;
}

/* --------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------ */

function assertTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new RangeError(`shove.tick must be a non-negative integer, received ${String(tick)}`);
  }
}

function assertDistance(distance: number): void {
  if (!Number.isInteger(distance) || distance < 0) {
    throw new RangeError(
      `shove.distance must be a non-negative integer, received ${String(distance)}`,
    );
  }
}

/* --------------------------------------------------------------------------
 * Collision helpers
 * ------------------------------------------------------------------------ */

/**
 * The soldier standing on `at`, ignoring `ignoreId`, or `undefined`. Iterates
 * the roster in its stable insertion order so equal situations always resolve
 * the same way (determinism).
 */
function occupantAt(work: Work, at: Coord, ignoreId: string): UnitId | undefined {
  for (const unit of work.unitById.values()) {
    if (unit.id === ignoreId) continue;
    const position = work.positions.get(unit.id);
    if (position !== undefined && coordEquals(position, at)) return unit.id;
  }
  return undefined;
}

/* --------------------------------------------------------------------------
 * The step rule
 * ------------------------------------------------------------------------ */

/**
 * Attempt to move `unitId` one tile in `dir`, recursively displacing a blocker
 * when chaining is on. Returns whether the soldier actually moved.
 *
 * Legality mirrors movement (T025/T015): in bounds, passable terrain, and a
 * height change no greater than the shovee's Climb. A downhill drop beyond
 * Climb is either refused or resolved as a fall, depending on `allowFall`.
 *
 * The recursion moves the **far end of the chain first**, so a blocker vacates
 * its tile before the soldier behind claims it. This is what makes a row of
 * troops peel away as one.
 */
function shoveTile(work: Work, unitId: UnitId, dir: Facing, depth: number): boolean {
  const unit = work.unitById.get(unitId);
  const from = work.positions.get(unitId);
  if (unit === undefined || from === undefined) return false;

  const to = addCoords(from, FACING_OFFSETS[dir]);
  if (!inBounds(work.map.grid, to)) return false;

  const fromTile = terrainTileAt(work.map, from);
  const toTile = terrainTileAt(work.map, to);
  if (!getTerrainDef(toTile.terrain).passable) return false;

  const climb = unit.stats.jump;
  const delta = toTile.height - fromTile.height;
  if (delta > climb) return false; // too steep to shove uphill

  let fall = 0;
  if (delta < -climb) {
    if (!work.allowFall) return false;
    fall = -delta - climb; // the part of the drop beyond a safe descent
  }

  const occupant = occupantAt(work, to, unitId);
  if (occupant !== undefined) {
    if (!work.chain || depth >= MAX_SHOVE_CHAIN) return false;
    if (!shoveTile(work, occupant, dir, depth + 1)) return false;
  }

  work.positions.set(unitId, { x: to.x, y: to.y });
  work.moves.push({ unitId, from: { ...from }, to: { ...to }, fall });
  return true;
}

/* --------------------------------------------------------------------------
 * Resolution
 * ------------------------------------------------------------------------ */

/** Fold the ordered tile moves into one net {@link ShoveStep} per soldier. */
function mergeMoves(moves: readonly TileMove[]): ShoveStep[] {
  const steps: ShoveStep[] = [];
  const indexByUnit = new Map<string, number>();

  for (const move of moves) {
    const index = indexByUnit.get(move.unitId);
    if (index === undefined) {
      indexByUnit.set(move.unitId, steps.length);
      steps.push({
        unitId: move.unitId,
        from: move.from,
        to: move.to,
        tiles: 1,
        fallen: move.fall,
      });
      continue;
    }
    const previous = steps[index];
    steps[index] = {
      unitId: previous.unitId,
      from: previous.from,
      to: move.to,
      tiles: previous.tiles + 1,
      fallen: previous.fallen + move.fall,
    };
  }

  return steps;
}

/**
 * Resolve a shove: displace the target (and, when chaining, the soldiers in its
 * way), applying fall damage, and return the new roster plus the ordered
 * events.
 *
 * ```ts
 * const { units, events } = resolveShove(
 *   { map, units: battle.units, tick: battle.tempo.tick },
 *   { unitId: foeId, direction: "east", distance: 2, chain: true },
 * );
 * ```
 *
 * The input context is never mutated. Throws a `RangeError` when the request is
 * malformed (an unknown direction/mode, a non-integer distance, a negative
 * tick) or names a soldier who is not on the field — those are programmer or
 * stale-command faults, not in-world outcomes. A shove that is fully blocked is
 * a valid result with no `moved` entries.
 */
export function resolveShove(context: ShoveContext, request: ShoveRequest): ShoveResult {
  const tick = context.tick ?? 0;
  assertTick(tick);
  if (!isFacing(request.direction)) {
    throw new RangeError(
      `shove.direction must be a cardinal direction, received ${String(request.direction)}`,
    );
  }
  assertDistance(request.distance);
  const mode = request.mode ?? "push";
  if (!isShoveMode(mode)) {
    throw new RangeError(
      `shove.mode must be one of ${SHOVE_MODES.join(", ")}, received ${String(request.mode)}`,
    );
  }

  const unitById = new Map<string, Unit>();
  const positions = new Map<string, Coord>();
  for (const unit of context.units) {
    unitById.set(unit.id, unit);
    positions.set(unit.id, unit.at);
  }
  if (!unitById.has(request.unitId)) {
    throw new RangeError(`no soldier ${request.unitId} is deployed on this field`);
  }

  const work: Work = {
    map: context.map,
    unitById,
    positions,
    moves: [],
    chain: request.chain ?? false,
    allowFall: request.allowFall ?? false,
  };

  // A push continues along the shover → target vector; a pull reverses it.
  const dir = mode === "pull" ? oppositeFacing(request.direction) : request.direction;
  for (let step = 0; step < request.distance; step++) {
    if (!shoveTile(work, request.unitId, dir, 0)) break;
  }

  const moved = mergeMoves(work.moves);

  // Apply fall damage and emit events in resolution order.
  const events: BattleEvent[] = [];
  const hpById = new Map<string, number>();
  for (const unit of context.units) hpById.set(unit.id, unit.hp);

  for (const move of work.moves) {
    events.push({
      kind: "shoved",
      tick,
      unitId: move.unitId,
      from: move.from,
      to: move.to,
    });

    if (move.fall <= 0) continue;
    const before = hpById.get(move.unitId) ?? 0;
    if (before <= 0) continue; // a downed soldier takes no further harm
    const damage = move.fall * FALL_DAMAGE_PER_LEVEL;
    const after = Math.max(0, before - damage);
    hpById.set(move.unitId, after);
    events.push({
      kind: "damaged",
      tick,
      unitId: move.unitId,
      amount: before - after,
      hpAfter: after,
      damageType: "none",
      critical: false,
      fatal: after <= 0,
    });
    if (after <= 0) {
      events.push({ kind: "outOfAction", tick, unitId: move.unitId });
    }
  }

  const units = context.units.map((unit) => {
    const at = positions.get(unit.id);
    const hp = hpById.get(unit.id) ?? unit.hp;
    let updated = unit;
    if (at !== undefined && !coordEquals(at, unit.at)) updated = withPosition(updated, at);
    if (hp !== unit.hp) updated = withHp(updated, hp);
    return updated;
  });

  return { units, events, moved };
}
