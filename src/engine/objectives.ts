/**
 * Win/lose objectives (T031) — when a detachment action is **won**, **lost** or
 * **drawn**, expressed as pure, data-driven rules.
 *
 * FFTA missions are not all "kill everyone": the reference mirror lists
 * annihilation, boss/target kills, survival, protection and area-holding
 * (see `docs/wiki/pages/Mission.md`). The retheme keeps those shapes at
 * **detachment scale** (mapping §0): a company seizes a bridge, holds a
 * farmhouse for a few turns, breaks an enemy picket line, or simply survives
 * until relief arrives. The battle layer (T022) owns the turn loop; this module
 * owns *whether the action is over and who won*.
 *
 * The design splits cleanly in two:
 *
 * - An {@link Objective} is the **authored condition** — immutable, serialisable
 *   data describing the mission's goal. Content and scenarios author these.
 * - An {@link ObjectiveTracker} is the **live progress** — the objective plus
 *   the integer counters that make "survive N turns" and "hold for N turns"
 *   meaningful. It travels inside {@link BattleState} so a save/replay resumes
 *   mid-objective.
 *
 * Each completed Orders Tempo turn, the battle layer calls
 * {@link resolveObjectiveTurn}: progress advances by one turn and the condition
 * is re-checked. When it fires, the battle records a {@link BattleOutcome} from
 * the **company's** point of view and emits a single `battleEnded` event
 * (`agents.md` §7). Nothing here mutates its inputs, reads the DOM/clock or
 * draws randomness — the same `(tracker, units)` always yields the same
 * `(tracker', result)` (`agents.md` §2).
 *
 * Loss is uniform: whatever the mission, if every `"company"` soldier is out of
 * action the company is defeated (and a defending company that loses its
 * ground fails as well). Neutral soldiers — the Provost Marshal and other
 * arbiters (mapping §9) — never count toward either side.
 *
 * Fiction follows `docs/NAPOLEONIC_MAPPING.md`: a **soldier** is a stand
 * (mapping §0), a battle is a **detachment action**, and orders-tempo turns are
 * the integer CTB clock (mapping §12). Keys stay FFTA-shaped (`kind`,
 * `turnsElapsed`) while names are our own.
 */

import type { BattleOutcome } from "./events";
import { coordEquals, type Coord } from "./grid";
import { isOutOfAction, type Unit } from "./unit";

/* --------------------------------------------------------------------------
 * Objective definitions (authored data)
 * ------------------------------------------------------------------------ */

/** Every objective kind the engine understands. */
export const OBJECTIVE_KINDS = ["annihilation", "rout", "survive", "capture", "defend"] as const;
export type ObjectiveKind = (typeof OBJECTIVE_KINDS)[number];

/**
 * **Annihilation** — carry the field by putting every enemy soldier out of
 * action (FFTA "defeat all enemies"). The company wins the moment no enemy
 * stands; it loses if it is wiped out first.
 */
export interface AnnihilationObjective {
  readonly kind: "annihilation";
}

/**
 * **Rout** — break the enemy before annihilating it (FFTA "defeat the
 * commander"/morale-collapse variants). Victory once at least `defeated` enemy
 * soldiers have been put out of action, letting a shaken line quit the field.
 *
 * `defeated` is an integer count, not a fraction, so a replay never depends on
 * floating-point comparison.
 */
export interface RoutObjective {
  readonly kind: "rout";
  /** Enemy soldiers that must be out of action for the enemy line to break. */
  readonly defeated: number;
}

/**
 * **Survive** — hold out for `turns` Orders Tempo turns (FFTA "survive N
 * turns"), e.g. covering a withdrawal until relief arrives. The clock counts
 * completed soldier-turns, the engine's only unit of time (mapping §12).
 */
export interface SurviveObjective {
  readonly kind: "survive";
  /** Completed Orders Tempo turns the company must endure (`>= 1`). */
  readonly turns: number;
}

/**
 * **Capture** — seize a point on the field: a bridge, a crossroads, a gun
 * emplacement. The company wins as soon as one of its soldiers (in action)
 * stands on `at`; it loses only by being wiped out first.
 */
export interface CaptureObjective {
  readonly kind: "capture";
  /** The tile the company must occupy. */
  readonly at: Coord;
}

/**
 * **Defend** — hold a point against the enemy for `turns` Orders Tempo turns.
 * A completed turn with a company soldier on `at` counts toward the total; if
 * an enemy ever stands on `at` the position is lost and the company is
 * defeated. (An empty tile is neutral: it neither counts nor fails.)
 */
export interface DefendObjective {
  readonly kind: "defend";
  /** The tile the company must hold. */
  readonly at: Coord;
  /** Consecutive held turns required (`>= 1`). */
  readonly turns: number;
}

/**
 * The complete objective union. Narrow on `kind` to read the payload; because
 * the shapes are disjoint, exhaustive `switch` handling is a compile error
 * everywhere it must be updated when a new objective is added.
 */
export type Objective =
  AnnihilationObjective | RoutObjective | SurviveObjective | CaptureObjective | DefendObjective;

/* --------------------------------------------------------------------------
 * Objective progress (live state)
 * ------------------------------------------------------------------------ */

/**
 * The live state of an objective inside a battle: the authored condition plus
 * the integer counters that give it memory. Serialises straight into
 * {@link import("./battle").BattleState} and back.
 */
export interface ObjectiveTracker {
  /** The authored condition this tracker is scoring. */
  readonly objective: Objective;
  /** Orders Tempo turns completed since the action began (`>= 0`). */
  readonly turnsElapsed: number;
  /** Completed turns a company soldier held a `defend` tile (`>= 0`). */
  readonly heldTurns: number;
}

/* --------------------------------------------------------------------------
 * Validation (trust boundary: saves, replays, authored scenarios)
 * ------------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function isPositiveInteger(value: unknown): value is number {
  return isInteger(value) && value >= 1;
}

function isCoord(value: unknown): value is Coord {
  return isRecord(value) && isInteger(value.x) && isInteger(value.y);
}

/**
 * Whether `value` is a structurally valid {@link Objective}. Checks shape and
 * strictly positive counts; it cannot know whether the objective is *winnable*,
 * only that the engine can score it.
 */
export function isObjective(value: unknown): value is Objective {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "annihilation":
      return true;
    case "rout":
      return isPositiveInteger(value.defeated);
    case "survive":
      return isPositiveInteger(value.turns);
    case "capture":
      return isCoord(value.at);
    case "defend":
      return isCoord(value.at) && isPositiveInteger(value.turns);
    default:
      return false;
  }
}

/** Throwing form of {@link isObjective}, for the setup/save boundary. */
export function assertObjective(value: unknown, label = "objective"): Objective {
  if (!isObjective(value)) {
    throw new RangeError(`${label} is not a valid objective`);
  }
  return value;
}

/** Whether `value` is a structurally valid {@link ObjectiveTracker}. */
export function isObjectiveTracker(value: unknown): value is ObjectiveTracker {
  return (
    isRecord(value) &&
    isObjective(value.objective) &&
    isInteger(value.turnsElapsed) &&
    value.turnsElapsed >= 0 &&
    isInteger(value.heldTurns) &&
    value.heldTurns >= 0
  );
}

/* --------------------------------------------------------------------------
 * Construction
 * ------------------------------------------------------------------------ */

/**
 * Deep-copy an authored objective so no two trackers alias the same nested
 * `Coord`. Used by {@link createObjectiveTracker} and the serialiser.
 */
export function copyObjective(objective: Objective): Objective {
  switch (objective.kind) {
    case "annihilation":
      return { kind: "annihilation" };
    case "rout":
      return { kind: "rout", defeated: objective.defeated };
    case "survive":
      return { kind: "survive", turns: objective.turns };
    case "capture":
      return { kind: "capture", at: { x: objective.at.x, y: objective.at.y } };
    case "defend":
      return {
        kind: "defend",
        at: { x: objective.at.x, y: objective.at.y },
        turns: objective.turns,
      };
  }
}

/**
 * Wrap an authored {@link Objective} in a fresh tracker with zeroed progress.
 * Validates the objective so a malformed scenario fails at creation rather than
 * mid-battle, and copies it so the tracker cannot alias authored data.
 */
export function createObjectiveTracker(objective: Objective): ObjectiveTracker {
  return { objective: copyObjective(assertObjective(objective)), turnsElapsed: 0, heldTurns: 0 };
}

/* --------------------------------------------------------------------------
 * Scoring
 * ------------------------------------------------------------------------ */

/** Side tallies the objective rules read every turn. */
interface SideCounts {
  readonly companyTotal: number;
  readonly companyRemaining: number;
  readonly enemiesTotal: number;
  readonly enemiesRemaining: number;
}

function countSides(units: readonly Unit[]): SideCounts {
  let companyTotal = 0;
  let companyRemaining = 0;
  let enemiesTotal = 0;
  let enemiesRemaining = 0;
  for (const unit of units) {
    if (unit.side === "company") {
      companyTotal += 1;
      if (!isOutOfAction(unit)) companyRemaining += 1;
    } else if (unit.side === "enemy") {
      enemiesTotal += 1;
      if (!isOutOfAction(unit)) enemiesRemaining += 1;
    }
    // Neutral soldiers (Provost Marshal, mapping §9) never count.
  }
  return { companyTotal, companyRemaining, enemiesTotal, enemiesRemaining };
}

/** Whether an in-action soldier of `side` stands on `at`. */
function standsOn(units: readonly Unit[], at: Coord, side: Unit["side"]): boolean {
  return units.some(
    (unit) => unit.side === side && !isOutOfAction(unit) && coordEquals(unit.at, at),
  );
}

/** Clamp a fraction into `[0, 1]` for UI progress bars. */
function fraction(numerator: number, denominator: number): number {
  if (denominator <= 0) return 1;
  return Math.min(1, Math.max(0, numerator / denominator));
}

/**
 * Progress of an objective as a fraction in `[0, 1]`, for a HUD progress bar or
 * an AI heuristic. Purely derived from the tracker and the field; it never
 * decides the outcome.
 */
export function objectiveProgress(tracker: ObjectiveTracker, units: readonly Unit[]): number {
  const counts = countSides(units);
  switch (tracker.objective.kind) {
    case "annihilation":
      return fraction(counts.enemiesTotal - counts.enemiesRemaining, counts.enemiesTotal);
    case "rout":
      return fraction(counts.enemiesTotal - counts.enemiesRemaining, tracker.objective.defeated);
    case "survive":
      return fraction(tracker.turnsElapsed, tracker.objective.turns);
    case "capture":
      return standsOn(units, tracker.objective.at, "company") ? 1 : 0;
    case "defend":
      return fraction(tracker.heldTurns, tracker.objective.turns);
  }
}

/**
 * Advance the objective by one completed Orders Tempo turn, returning a new
 * tracker. This is the only place the mission clock moves:
 *
 * - `turnsElapsed` always increments;
 * - for a `defend` objective `heldTurns` increments while a company soldier
 *   holds the tile and resets to zero if an enemy takes it (an empty tile is
 *   neutral).
 *
 * It does **not** decide victory — call {@link evaluateObjective} for that.
 */
export function advanceObjective(
  tracker: ObjectiveTracker,
  units: readonly Unit[],
): ObjectiveTracker {
  const turnsElapsed = tracker.turnsElapsed + 1;
  if (tracker.objective.kind !== "defend") {
    return { ...tracker, turnsElapsed };
  }
  const at = tracker.objective.at;
  const contested = standsOn(units, at, "enemy");
  const held = standsOn(units, at, "company");
  const heldTurns = contested ? 0 : held ? tracker.heldTurns + 1 : tracker.heldTurns;
  return { ...tracker, turnsElapsed, heldTurns };
}

/** Shared, derived figures both the evaluation and the UI consume. */
interface ObjectiveProgress {
  readonly progress: number;
  readonly companyRemaining: number;
  readonly companyTotal: number;
  readonly enemiesRemaining: number;
  readonly enemiesTotal: number;
}

/**
 * The scored result of an objective. A discriminated union on `finished` makes
 * the invariant "a finished battle always has an outcome" a type fact, so the
 * battle layer cannot forget to record one.
 */
export type ObjectiveEvaluation =
  | (ObjectiveProgress & { readonly finished: false; readonly outcome: null })
  | (ObjectiveProgress & { readonly finished: true; readonly outcome: BattleOutcome });

/**
 * Score an objective against the current field **without advancing the
 * mission clock**. Pure: the same tracker and units always produce the same
 * result.
 *
 * Victory depends on the objective; defeat is shared (every company soldier is
 * out of action, or a defended point has fallen). If a turn satisfies both —
 * the last enemies and last company soldiers fall together — the result is a
 * {@link BattleOutcome} of `"draw"`.
 */
export function evaluateObjective(
  tracker: ObjectiveTracker,
  units: readonly Unit[],
): ObjectiveEvaluation {
  const counts = countSides(units);
  // A roster with no company soldiers at all is not a battle the company can
  // lose (it is simply not the company's action); only an actual wipe counts.
  const companyWiped = counts.companyTotal > 0 && counts.companyRemaining === 0;

  let victory = false;
  let defeat = companyWiped;

  switch (tracker.objective.kind) {
    case "annihilation":
      victory = counts.enemiesRemaining === 0;
      break;
    case "rout":
      victory = counts.enemiesTotal - counts.enemiesRemaining >= tracker.objective.defeated;
      break;
    case "survive":
      victory = tracker.turnsElapsed >= tracker.objective.turns;
      break;
    case "capture":
      victory = standsOn(units, tracker.objective.at, "company");
      break;
    case "defend":
      if (standsOn(units, tracker.objective.at, "enemy")) defeat = true;
      victory = tracker.heldTurns >= tracker.objective.turns;
      break;
  }

  const progress = objectiveProgress(tracker, units);
  const base: ObjectiveProgress = {
    progress,
    companyRemaining: counts.companyRemaining,
    companyTotal: counts.companyTotal,
    enemiesRemaining: counts.enemiesRemaining,
    enemiesTotal: counts.enemiesTotal,
  };

  if (!victory && !defeat) {
    return { ...base, finished: false, outcome: null };
  }
  const outcome: BattleOutcome =
    victory && defeat ? "draw" : victory ? "companyVictory" : "companyDefeat";
  return { ...base, finished: true, outcome };
}

/**
 * The combined per-turn step the battle layer takes: advance the mission clock
 * by one turn, then score the objective against the resulting board.
 * {@link ObjectiveResolution.tracker} is the tracker to store back into
 * {@link import("./battle").BattleState}.
 */
export type ObjectiveResolution = ObjectiveEvaluation & {
  readonly tracker: ObjectiveTracker;
};

/** Advance one turn and score. See {@link advanceObjective} / {@link evaluateObjective}. */
export function resolveObjectiveTurn(
  tracker: ObjectiveTracker,
  units: readonly Unit[],
): ObjectiveResolution {
  const advanced = advanceObjective(tracker, units);
  return { ...evaluateObjective(advanced, units), tracker: advanced };
}
