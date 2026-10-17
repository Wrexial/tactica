/**
 * Move command resolution (T025) — validate and apply a soldier's march along
 * a tile path.
 *
 * Movement is the first *positional* command the battle can resolve. A
 * {@link MoveCommand} (`commands.ts`) carries the sequence of tiles a soldier
 * intends to step through, normally produced by the A* pathfinder (T015). This
 * module is the **rules gate** between that intent and the world: it re-checks
 * the path against terrain, elevation (FFTA "Jump" → **Climb**) and occupied
 * tiles, prices it with the same edge weights A* used, and hands the battle
 * layer a new state plus a `moved` event.
 *
 * FFTA's model (mapping §12; `docs/wiki/pages/Move_(stat).md`) is kept intact:
 *
 * - a unit travels tile-by-tile along the four cardinal directions (D10 — no
 *   diagonals, no hex);
 * - entering a tile spends that tile's terrain move cost;
 * - climbing uphill adds a premium per elevation level, while level and
 *   downhill steps do not;
 * - a step may cross at most the mover's **Climb** (`unit.stats.jump`), up or
 *   down;
 * - impassable terrain (river, wall) and tiles another soldier stands on are
 *   walls; the mover may always leave the tile it starts on;
 * - the whole march must fit the mover's **Move** budget (`unit.stats.move`).
 *
 * Contract (`agents.md` §2, §7, §9):
 * - **Pure & deterministic** — no DOM, no I/O, no `Math.random`, no `Date`.
 *   The same state and path always yield the same verdict, cost and event.
 * - **State in, state out** — nothing here mutates its inputs; {@link applyMove}
 *   returns a new {@link BattleState} (structural sharing is fine).
 * - **Renderer-free** — the isometric look is a presentation concern; geometry
 *   stays in grid space (`grid.ts`).
 *
 * The pawn-shaped helper {@link validateMove} is exported so the battle layer
 * (T022), the AI (T095) and the move-range overlay (T027/T030) can all ask "is
 * this march legal, and what does it cost?" without duplicating the rules.
 */

import type { BattleState } from "../battle";
import type { BattleEvent } from "../events";
import {
  coordEquals,
  coordKey,
  facingTo,
  inBounds,
  type Coord,
  type Facing,
} from "../grid";
import { canClimb, getTerrainDef, stepCost, terrainTileAt } from "../terrain";
import { withPosition, type Unit } from "../unit";

/* --------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------ */

/**
 * Thrown by {@link applyMove} when it is handed a path that fails validation.
 * The battle layer (T022) validates before applying, so this only fires if the
 * two disagree — an engine fault, and therefore loud rather than silent.
 */
export class MoveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MoveError";
  }
}

/* --------------------------------------------------------------------------
 * Verdicts
 * ------------------------------------------------------------------------ */

/**
 * Why a proposed march was refused. A closed set so callers (and the AI) can
 * branch on the cause without parsing messages. Kept separate from the battle
 * layer's {@link import("../battle").BattleRejectionReason} so movement rules
 * can grow without widening the command-level vocabulary.
 */
export const MOVE_REJECTION_REASONS = [
  "malformed-path",
  "empty-path",
  "not-from-origin",
  "not-contiguous",
  "out-of-bounds",
  "impassable",
  "beyond-climb",
  "occupied",
  "exceeds-move",
] as const;
export type MoveRejectionReason = (typeof MOVE_REJECTION_REASONS)[number];

/** A refused march: the reason plus a human-readable explanation for logs. */
export interface MoveRejection {
  readonly reason: MoveRejectionReason;
  readonly message: string;
  /** The offending tile, when one is identifiable. */
  readonly at?: Coord;
}

/**
 * A march the rules allow. Carries everything {@link applyMove} and the caller
 * need so the path never has to be re-derived: the normalised route, the
 * endpoints, the total cost and the facing the soldier ends with.
 */
export interface AcceptedMove {
  readonly valid: true;
  /** Full route, origin first and destination last. */
  readonly path: readonly Coord[];
  readonly from: Coord;
  readonly to: Coord;
  /** Total movement cost, the same edge weights A* used (T015). */
  readonly cost: number;
  /** Facing after the march (the final step's direction, else unchanged). */
  readonly facing: Facing;
}

/** A refused march. */
export interface RejectedMove {
  readonly valid: false;
  readonly rejection: MoveRejection;
}

/** The result of {@link validateMove}. Narrow on `valid`. */
export type MoveValidation = AcceptedMove | RejectedMove;

/* --------------------------------------------------------------------------
 * Validation helpers
 * ------------------------------------------------------------------------ */

/** Throw unless `value` is an integer (coordinates are exact). */
function isCoordLike(value: unknown): value is Coord {
  if (typeof value !== "object" || value === null) return false;
  const at = value as { x?: unknown; y?: unknown };
  return Number.isInteger(at.x) && Number.isInteger(at.y);
}

function reject(
  reason: MoveRejectionReason,
  message: string,
  at?: Coord,
): RejectedMove {
  return { valid: false, rejection: at === undefined ? { reason, message } : { reason, message, at } };
}

/** Every tile of the map another soldier currently stands on. */
function occupiedTiles(state: BattleState, mover: Unit): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const unit of state.units) {
    if (unit.id !== mover.id) keys.add(coordKey(unit.at));
  }
  return keys;
}

/* --------------------------------------------------------------------------
 * Validation
 * ------------------------------------------------------------------------ */

/**
 * Check whether `unit` may march along `path` in `state`, and price it.
 *
 * A path is legal when it:
 * 1. is a non-empty array of integer tiles;
 * 2. starts on the mover's own tile;
 * 3. is contiguous under cardinal adjacency;
 * 4. stays in bounds and off impassable terrain and occupied tiles for every
 *    tile after the origin;
 * 5. never crosses an elevation change greater than `unit.stats.jump`; and
 * 6. costs no more than `unit.stats.move`.
 *
 * A single-tile path (`[origin]`) is a legal **no-op**: it costs `0` and faces
 * unchanged, so a destination equal to the origin need not be special-cased by
 * callers. {@link applyMove} emits no `moved` event for it.
 */
export function validateMove(
  state: BattleState,
  unit: Unit,
  path: readonly Coord[],
): MoveValidation {
  if (!Array.isArray(path) || !path.every(isCoordLike)) {
    return reject("malformed-path", "a move path must be an array of integer tiles");
  }
  if (path.length === 0) {
    return reject("empty-path", "a move path must name at least the origin tile");
  }

  const from: Coord = { x: unit.at.x, y: unit.at.y };
  if (!coordEquals(path[0], from)) {
    return reject(
      "not-from-origin",
      `${unit.name} stands at { x: ${from.x}, y: ${from.y} } but the path starts at { x: ${path[0].x}, y: ${path[0].y} }`,
      path[0],
    );
  }
  if (path.length === 1) {
    return { valid: true, path: [{ ...from }], from, to: from, cost: 0, facing: unit.facing };
  }

  const occupied = occupiedTiles(state, unit);
  const climb = unit.stats.jump;
  const budget = unit.stats.move;

  let cost = 0;
  let previous = from;
  let facing = unit.facing;

  for (let i = 1; i < path.length; i++) {
    const at = path[i];

    const stepFacing = facingTo(previous, at);
    if (stepFacing === undefined) {
      return reject(
        "not-contiguous",
        `a move must step to an orthogonally adjacent tile; { x: ${previous.x}, y: ${previous.y} } → { x: ${at.x}, y: ${at.y} } is not`,
        at,
      );
    }
    if (!inBounds(state.map.grid, at)) {
      return reject(
        "out-of-bounds",
        `{ x: ${at.x}, y: ${at.y} } is outside the ${state.map.grid.width}×${state.map.grid.height} battlefield`,
        at,
      );
    }
    if (occupied.has(coordKey(at))) {
      return reject(
        "occupied",
        `${unit.name} cannot enter { x: ${at.x}, y: ${at.y} }: another soldier holds it`,
        at,
      );
    }

    const fromTile = terrainTileAt(state.map, previous);
    const toTile = terrainTileAt(state.map, at);
    if (!getTerrainDef(toTile.terrain).passable) {
      return reject(
        "impassable",
        `${getTerrainDef(toTile.terrain).name} at { x: ${at.x}, y: ${at.y} } cannot be crossed on foot`,
        at,
      );
    }
    if (!canClimb(climb, fromTile.height, toTile.height)) {
      return reject(
        "beyond-climb",
        `${unit.name} has Climb ${climb} but the step to { x: ${at.x}, y: ${at.y} } changes elevation by ${Math.abs(toTile.height - fromTile.height)}`,
        at,
      );
    }

    cost += stepCost(fromTile, toTile);
    if (cost > budget) {
      return reject(
        "exceeds-move",
        `${unit.name} has Move ${budget} but the path to { x: ${at.x}, y: ${at.y} } costs ${cost}`,
        at,
      );
    }

    previous = at;
    facing = stepFacing;
  }

  return {
    valid: true,
    path: path.map((at) => ({ x: at.x, y: at.y })),
    from,
    to: previous,
    cost,
    facing,
  };
}

/* --------------------------------------------------------------------------
 * Application
 * ------------------------------------------------------------------------ */

/** Replace one soldier in the deployed list, preserving order. */
function replaceUnit(units: readonly Unit[], updated: Unit): readonly Unit[] {
  return units.map((unit) => (unit.id === updated.id ? updated : unit));
}

/**
 * Apply a validated march to the battle, pushing a `moved` event and returning
 * the **new** state. A no-op path (`[origin]`) leaves the state untouched and
 * emits nothing.
 *
 * The event carries the full origin-first route so the renderer (T082) can
 * animate each step without consulting state, and the final {@link Facing} so
 * the sprite turns the way it travelled.
 *
 * Throws {@link MoveError} when `path` fails {@link validateMove}; the battle
 * layer validates first, so this is an engine-invariant guard.
 */
export function applyMove(
  state: BattleState,
  unit: Unit,
  path: readonly Coord[],
  events: BattleEvent[],
): BattleState {
  const validation = validateMove(state, unit, path);
  if (!validation.valid) {
    throw new MoveError(validation.rejection.message);
  }
  if (validation.path.length === 1) return state;

  events.push({
    kind: "moved",
    tick: state.tempo.tick,
    unitId: unit.id,
    from: { x: validation.from.x, y: validation.from.y },
    to: { x: validation.to.x, y: validation.to.y },
    path: validation.path.map((at) => ({ x: at.x, y: at.y })),
    facing: validation.facing,
  });

  const moved = withPosition(unit, validation.to, validation.facing);
  return { ...state, units: replaceUnit(state.units, moved) };
}
