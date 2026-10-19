/**
 * Battle state machine (T022) — `createBattle` and `step`.
 *
 * This is the hinge of the whole engine (`agents.md` §7):
 *
 * ```
 *   Command ──► step(state, command) ──► { state', events[] }
 *                                            │
 *                                            ├─► renderer animates (T082)
 *                                            └─► UI reads state (T071+)
 * ```
 *
 * A battle is a pure, deterministic value: a {@link TerrainMap}, the deployed
 * {@link Unit}s, an Orders Tempo scheduler (T019) and the current actor. The
 * **only** way to change it is {@link step}, which consumes one serialisable
 * {@link Command} (T020) and returns a **new** state plus the ordered
 * {@link BattleEvent}s (T021) that describe what happened. Nothing in here
 * mutates its inputs, reads the DOM, uses `Math.random` or consults a clock —
 * time is the integer Orders Tempo tick.
 *
 * T123 (peer lesson L2) splits that one entry point into two pure primitives a
 * headless AI lookahead or balance harness can reuse:
 * {@link applyCommand} validates and applies exactly one command, and
 * {@link advanceToDecision} runs the clock to the next living actor. {@link step}
 * is the ergonomic wrapper that composes them (`docs/PEER_COMBAT_LESSONS.md` §L2).
 *
 * Scope of T022 was the create/step skeleton and the **turn lifecycle**
 * (start the battle, announce the acting soldier, end the turn, advance Orders
 * Tempo). T024 adds the **action resolution pipeline** (`act` commands:
 * declare → charge → resolve) via `./actions/resolve.ts`, T025 adds the
 * **Move** command via `./actions/move.ts` (path validation against terrain,
 * elevation/Climb, occupancy and the Move budget), and T026 adds the basic
 * **Wait / Face / Hold** commands via `./actions/basic.ts`. T115 makes the
 * turn **native move-and-act**: a `move` leaves the actor's Orders Tempo turn
 * open (recording {@link BattleState.hasMovedThisTurn}), so an `act`, `wait`
 * or `hold` closes it without the caller composing the free move by hand. T127
 * tracks the second half of that budget too
 * ({@link BattleState.hasActedThisTurn}), so the engine knows which slot a
 * closing order spent: an `act` uses the act slot, while `wait` / `face` /
 * `hold` are free and leave it untouched. T124
 * (peer lesson L3) additionally lets an `act` fold that free move into itself
 * via an optional `move { to, order }` clause, so a full move-and-act turn can
 * be one atomically validated command that settles Orders Tempo exactly once;
 * the two-step UI composes the same turn from a separate `move` + `act`. The
 * remaining commands (`volley`, `guardSortie`) are still refused with a
 * {@link BattleRejection} until their tasks land (T061–T062), so a caller can
 * never mistake "not implemented" for a silent success.
 *
 * Invalid commands are **rejected without mutation**: {@link step} returns the
 * *same* state object, an empty event list and a populated
 * {@link BattleStepResult.rejection}. Setup errors (an empty roster, duplicate
 * ids, two soldiers on one tile, a tile off the map) throw a
 * {@link BattleSetupError} from {@link createBattle}, because those are
 * authoring/programmer mistakes rather than in-world illegal orders.
 *
 * Reference: `docs/wiki/pages/Battle_system.md` and
 * `docs/wiki/pages/Charge_time.md` for the underlying FFTA behaviour. Fiction
 * follows `docs/NAPOLEONIC_MAPPING.md` (a **soldier** acts on its Orders Tempo
 * turn; **Élan** is morale; the **Provost Marshal** enforces Articles later).
 */

import { applyFace, applyHold, applyWait } from "./actions/basic";
import { applyMove, validateMove } from "./actions/move";
import {
  actionSpecOf,
  buildActionCatalogue,
  canAfford,
  declareOrResolveAction,
  isTargetableTile,
  resolveCompletedCharges,
  type ActionCatalogue,
  type ActionSpec,
  type PendingAction,
} from "./actions/resolve";
import { isCommand, type Command } from "./commands";
import type { BattleEvent, BattleOutcome } from "./events";
import { coordKey, inBounds, type Coord } from "./grid";
import { isValidId, type UnitId } from "./ids";
import {
  assertObjective,
  createObjectiveTracker,
  resolveObjectiveTurn,
  type Objective,
  type ObjectiveTracker,
} from "./objectives";
import { findPath } from "./pathfinding";
import type { Seed } from "./rng";
import { tickConditions } from "./rules/conditions";
import { settleElan } from "./rules/elan";
import type { TerrainMap } from "./terrain";
import {
  TEMPO_THRESHOLD,
  advanceToNextTurn,
  createOrdersTempo,
  spendTurn,
  type OrdersTempo,
  type ResolvedCharge,
  type TempoSpeedOf,
} from "./turn";
import { isOutOfAction, type Unit } from "./unit";

/* --------------------------------------------------------------------------
 * Errors and rejections
 * ------------------------------------------------------------------------ */

/**
 * Thrown by {@link createBattle} when the authored setup is malformed. These
 * are data/authoring faults (a tile outside the map, two soldiers stacked on
 * one square, a duplicate id), not in-world illegal orders — those are
 * returned as a {@link BattleRejection} instead.
 */
export class BattleSetupError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BattleSetupError";
  }
}

/**
 * Why {@link step} refused a command. A closed set so callers and the AI (T095)
 * can branch on the cause without parsing messages.
 */
export const BATTLE_REJECTION_REASONS = [
  "malformed",
  "battle-over",
  "no-actor",
  "unknown-unit",
  "not-your-turn",
  "unit-out-of-action",
  "unsupported",
  "unknown-ability",
  "insufficient-elan",
  "invalid-target",
  "illegal-move",
  "already-moved",
] as const;
export type BattleRejectionReason = (typeof BATTLE_REJECTION_REASONS)[number];

/** A refused command: never applied, and the input state is left untouched. */
export interface BattleRejection {
  readonly reason: BattleRejectionReason;
  /** Human-readable explanation, suitable for a log or an AI trace. */
  readonly message: string;
}

/* --------------------------------------------------------------------------
 * Setup and state
 * ------------------------------------------------------------------------ */

/**
 * Authoring input for {@link createBattle}. `seed` is passed separately so the
 * whole battle — including combat/effect rolls — replays from one value.
 */
export interface BattleSetup {
  /** The battlefield: a grid plus per-tile terrain and elevation (T014). */
  readonly map: TerrainMap;
  /** Every soldier on the field, already validated by `createUnit` (T017). */
  readonly units: readonly Unit[];
  /**
   * Charge needed to take a turn. Defaults to {@link TEMPO_THRESHOLD}; a
   * scenario may lower it for a faster skirmish.
   */
  readonly threshold?: number;
  /**
   * Optional starting Orders Tempo charge per unit id. Lets a scenario open
   * mid-battle or grant an ambusher the first move.
   */
  readonly initialCharge?: Readonly<Partial<Record<string, number>>>;
  /**
   * The action catalogue this battle can resolve, keyed by ability id (T024).
   * Content maps its full authored `AbilityDef`s to {@link ActionSpec}s and
   * passes them here; a battle with no catalogue can still move, face, hold and
   * wait, but every `act` command is refused with `unknown-ability`.
   */
  readonly abilities?: readonly ActionSpec[];
  /**
   * Optional win/lose objective (T031). When present, the battle concludes with
   * a single `battleEnded` event as soon as the objective is met or the company
   * is wiped out. Omit it for a sandbox action that only ends when a caller
   * says so.
   */
  readonly objective?: Objective;
}

/** Whether the battle is still being fought or has concluded. */
export const BATTLE_PHASES = ["active", "finished"] as const;
export type BattlePhase = (typeof BATTLE_PHASES)[number];

/**
 * The complete, serialisable battle value. Treat it as immutable: {@link step}
 * returns a new state; nothing else writes to it (`agents.md` §7).
 */
export interface BattleState {
  /** The seed the battle was created from (for replays and debugging). */
  readonly seed: Seed;
  /** The battlefield terrain and geometry. */
  readonly map: TerrainMap;
  /** Deployed soldiers, in stable insertion order (deterministic iteration). */
  readonly units: readonly Unit[];
  /** The Orders Tempo scheduler, carrying its own seeded effect-roll stream. */
  readonly tempo: OrdersTempo;
  /** The actions this battle can resolve, keyed by ability id (T024). */
  readonly abilities: ActionCatalogue;
  /**
   * Actions that are currently charging and have not yet resolved (T024).
   * Kept in declaration order; each entry links to a `TempoCharge` via its
   * `chargeId`.
   */
  readonly pendingActions: readonly PendingAction[];
  /** Whose turn it is, or `null` before the first turn / once nobody can act. */
  readonly currentActorId: UnitId | null;
  /**
   * Whether the current actor has already spent this turn's **Move**. A `move`
   * command leaves the actor's Orders Tempo turn open so it can be followed by
   * an `act` (the FFTA free-move turn, T115); this flag blocks a second march
   * and is cleared by the ordered upkeep pipeline when the next turn opens.
   */
  readonly hasMovedThisTurn: boolean;
  /**
   * Whether the current actor has already spent this turn's **Act**. An `act`
   * command — standalone or folded (T124) — sets it; the free orders `wait`,
   * `face` and `hold` do **not**, so they never consume the act slot (T127,
   * peer lesson L6). This makes the per-turn move/act budget explicit instead
   * of implied by "the turn ended", which is what free actions, Volleys and
   * reaction-driven extra actions will read. Cleared with
   * {@link hasMovedThisTurn} when the turn advances.
   */
  readonly hasActedThisTurn: boolean;
  /** `active` while fighting; `finished` once a win/lose rule fires (T031). */
  readonly phase: BattlePhase;
  /** Set when {@link phase} is `finished`; otherwise `null`. */
  readonly outcome: BattleOutcome | null;
  /**
   * Live win/lose objective progress (T031), or `null` for a sandbox battle
   * with no automatic ending. Scored once per completed Orders Tempo turn by
   * {@link settleObjective}.
   */
  readonly objective: ObjectiveTracker | null;
  /**
   * Whether the opening events (`battleStarted`, `unitDeployed`) and the first
   * `turnStarted` have been emitted. The first {@link step} announces the
   * battle; later steps only close and open turns.
   */
  readonly started: boolean;
}

/* --------------------------------------------------------------------------
 * Setup validation
 * ------------------------------------------------------------------------ */

function assertSetup(setup: BattleSetup): void {
  if (setup === null || typeof setup !== "object") {
    throw new BattleSetupError("battle setup must be an object");
  }
  const { map, units } = setup;

  if (map === null || typeof map !== "object" || map.grid === undefined) {
    throw new BattleSetupError("battle setup must provide a terrain map");
  }
  if (!Array.isArray(map.tiles)) {
    throw new BattleSetupError("battle map must provide a tile array");
  }
  const expectedTiles = map.grid.width * map.grid.height;
  if (map.tiles.length !== expectedTiles) {
    throw new BattleSetupError(
      `battle map has ${map.tiles.length} tiles but its ${map.grid.width}×${map.grid.height} grid needs ${expectedTiles}`,
    );
  }

  if (!Array.isArray(units)) {
    throw new BattleSetupError("battle setup must provide an array of units");
  }
  if (units.length === 0) {
    throw new BattleSetupError("a battle needs at least one soldier");
  }

  if (setup.objective !== undefined) {
    try {
      assertObjective(setup.objective, "battle objective");
    } catch (error) {
      throw new BattleSetupError(
        error instanceof Error ? error.message : "battle objective is malformed",
      );
    }
  }

  const seenIds = new Set<string>();
  const seenTiles = new Set<string>();
  for (const unit of units) {
    if (unit === null || typeof unit !== "object" || !isValidId(unit.id)) {
      throw new BattleSetupError("every soldier must have a non-empty id");
    }
    if (seenIds.has(unit.id)) {
      throw new BattleSetupError(`duplicate soldier id: ${unit.id}`);
    }
    if (!inBounds(map.grid, unit.at)) {
      throw new BattleSetupError(
        `soldier ${unit.id} stands at { x: ${unit.at.x}, y: ${unit.at.y} }, outside the ${map.grid.width}×${map.grid.height} map`,
      );
    }
    const key = coordKey(unit.at);
    if (seenTiles.has(key)) {
      throw new BattleSetupError(
        `two soldiers may not share tile { x: ${unit.at.x}, y: ${unit.at.y} }`,
      );
    }
    seenIds.add(unit.id);
    seenTiles.add(key);
  }
}

/* --------------------------------------------------------------------------
 * Queries
 * ------------------------------------------------------------------------ */

/** The deployed soldier with `unitId`, or `undefined` when not on the field. */
export function findUnit(state: BattleState, unitId: UnitId): Unit | undefined {
  return state.units.find((unit) => unit.id === unitId);
}

/**
 * Effective Orders Tempo Speed for every deployed soldier: base Speed, or `0`
 * for anyone out of action (a downed soldier does not charge). Haste/Slow and
 * other modifiers will layer on here as their abilities land (T039/T040).
 */
export function battleSpeedOf(state: BattleState): TempoSpeedOf {
  const speeds = new Map<string, number>();
  for (const unit of state.units) {
    speeds.set(unit.id, isOutOfAction(unit) ? 0 : unit.stats.spd);
  }
  return (unitId: UnitId): number => {
    const speed = speeds.get(unitId);
    if (speed === undefined) {
      throw new RangeError(`no soldier named ${unitId} is deployed in this battle`);
    }
    return speed;
  };
}

/* --------------------------------------------------------------------------
 * Creation
 * ------------------------------------------------------------------------ */

/**
 * Build a ready-to-play battle from a `seed` and an authored {@link BattleSetup}.
 *
 * The first Orders Tempo actor is chosen straight away (so
 * {@link BattleState.currentActorId} names the fastest soldier from the start)
 * and the scheduler advances its integer clock to that soldier's turn. The
 * opening events are emitted by the first {@link step}, not here, so creation
 * stays a pure value constructor like `createUnit` / `createOrdersTempo`.
 *
 * Throws a {@link BattleSetupError} on malformed setup.
 *
 * ```ts
 * const battle = createBattle(1815, {
 *   map: createTerrainMap(12, 8, "field"),
 *   units: [fusilier, rifleman, irregular],
 * });
 * ```
 */
export function createBattle(seed: Seed, setup: BattleSetup): BattleState {
  assertSetup(setup);

  const units = setup.units.slice();
  const abilities = buildActionCatalogue(setup.abilities);
  const tempo = createOrdersTempo(
    units.map((unit) => unit.id),
    {
      seed,
      threshold: setup.threshold ?? TEMPO_THRESHOLD,
      initialCharge: setup.initialCharge,
    },
  );

  const base: BattleState = {
    seed,
    map: setup.map,
    units,
    tempo,
    abilities,
    pendingActions: [],
    currentActorId: null,
    hasMovedThisTurn: false,
    hasActedThisTurn: false,
    phase: "active",
    outcome: null,
    objective:
      setup.objective === undefined ? null : createObjectiveTracker(setup.objective),
    started: false,
  };

  const first = advanceToNextTurn(tempo, battleSpeedOf(base));
  if (first === null) {
    // Nobody can ever act (every soldier has Speed 0). Leave the battle active
    // with no actor; `step` will report `no-actor` rather than spin.
    return base;
  }
  return { ...base, tempo: first.state, currentActorId: first.actorId };
}

/* --------------------------------------------------------------------------
 * Command validation
 * ------------------------------------------------------------------------ */

/**
 * Whether a command kind can be resolved by this phase of the engine. `wait`
 * (T022), `act` (the T024 resolution pipeline), `move` (T025) and the basic
 * `face` / `hold` orders (T026) are live; Volley and Guard Sortie follow in
 * T061–T062.
 */
function isSupportedCommandKind(kind: Command["kind"]): boolean {
  return (
    kind === "wait" ||
    kind === "move" ||
    kind === "act" ||
    kind === "face" ||
    kind === "hold"
  );
}

/**
 * Derive the least-cost path for a folded `act` move clause, using the same
 * A* rules the standalone Move range uses (`src/engine/pathfinding.ts`). Returns
 * `null` when the destination is off the map or unreachable within the
 * soldier's Move budget, so the caller can refuse the whole command with
 * `illegal-move`.
 */
function foldedMovePath(state: BattleState, unit: Unit, to: Coord): Coord[] | null {
  if (!inBounds(state.map.grid, to)) return null;
  const occupied = state.units
    .filter((candidate) => candidate.id !== unit.id)
    .map((candidate) => ({ x: candidate.at.x, y: candidate.at.y }));
  const result = findPath(state.map, unit.at, to, {
    climb: unit.stats.jump,
    occupied,
    maxCost: unit.stats.move,
  });
  return result.found ? result.path.map((at) => ({ x: at.x, y: at.y })) : null;
}

/**
 * Check a command against `state` **without changing anything**. Returns
 * `null` when the command may be applied, otherwise a {@link BattleRejection}
 * carrying the reason.
 *
 * Accepts `unknown` so it doubles as the trust-boundary validator for replay
 * logs and network input (`isCommand` performs the structural check first).
 */
export function validateCommand(state: BattleState, command: unknown): BattleRejection | null {
  if (!isCommand(command)) {
    return { reason: "malformed", message: "command is not a well-formed battle command" };
  }
  if (state.phase === "finished") {
    return { reason: "battle-over", message: "the battle has already ended" };
  }

  const unit = findUnit(state, command.unitId);
  if (unit === undefined) {
    return { reason: "unknown-unit", message: `no soldier "${command.unitId}" is deployed` };
  }
  if (state.currentActorId === null) {
    return { reason: "no-actor", message: "no soldier is ready to act" };
  }
  if (command.unitId !== state.currentActorId) {
    return {
      reason: "not-your-turn",
      message: `it is ${state.currentActorId}'s turn, not ${command.unitId}'s`,
    };
  }
  if (isOutOfAction(unit)) {
    return { reason: "unit-out-of-action", message: `${unit.name} is out of action` };
  }
  if (!isSupportedCommandKind(command.kind)) {
    return {
      reason: "unsupported",
      message: `the "${command.kind}" command is not resolved until its action lands (T026+)`,
    };
  }

  if (command.kind === "move") {
    if (state.hasMovedThisTurn) {
      return {
        reason: "already-moved",
        message: `${unit.name} has already marched this turn`,
      };
    }
    const validation = validateMove(state, unit, command.path);
    if (!validation.valid) {
      return { reason: "illegal-move", message: validation.rejection.message };
    }
  }

  if (command.kind === "act") {
    const spec = actionSpecOf(state, command.abilityId);
    if (spec === undefined) {
      return {
        reason: "unknown-ability",
        message: `this battle has no action "${command.abilityId}"`,
      };
    }
    if (!canAfford(unit, spec)) {
      return {
        reason: "insufficient-elan",
        message: `${unit.name} needs ${spec.mpCost} Élan but has ${unit.mp}`,
      };
    }
    if (command.target.kind === "unit" && findUnit(state, command.target.unitId) === undefined) {
      return {
        reason: "invalid-target",
        message: `no soldier "${command.target.unitId}" is deployed`,
      };
    }
    if (command.target.kind === "tile" && !isTargetableTile(state, command.target.at)) {
      return {
        reason: "invalid-target",
        message: `the target tile is outside the battlefield`,
      };
    }
    if (command.move !== undefined) {
      if (state.hasMovedThisTurn) {
        return {
          reason: "already-moved",
          message: `${unit.name} has already marched this turn`,
        };
      }
      const path = foldedMovePath(state, unit, command.move.to);
      if (path === null) {
        return {
          reason: "illegal-move",
          message: `${unit.name} cannot reach { x: ${command.move.to.x}, y: ${command.move.to.y} } with Move ${unit.stats.move}`,
        };
      }
      // Re-check with the same gate a standalone `move` uses, so a folded
      // march can never slip past the movement rules (T124).
      const validation = validateMove(state, unit, path);
      if (!validation.valid) {
        return { reason: "illegal-move", message: validation.rejection.message };
      }
    }
  }
  return null;
}

/* --------------------------------------------------------------------------
 * Turn lifecycle
 * ------------------------------------------------------------------------ */

/**
 * The ordered per-turn upkeep phases (T129, peer lessons L10/L14).
 *
 * Peer engines make the start-of-turn sequence explicit because *order
 * matters*: fft-phaser runs `ct -= 100` → `resetTurnFlags()` → `tickStatuses()`
 * → `regenMp()` the moment a soldier is granted a turn, and TinyWars lists its
 * whole phase table. Before T129 our equivalent work was scattered — the charge
 * was spent in `applyCommand`, the flags were cleared in `advanceToDecision`,
 * conditions and Élan were never ticked at all, and the objective was scored
 * somewhere else again. This tuple names the one order the engine promises.
 */
export const TURN_UPKEEP_PHASES = [
  "spendCharge",
  "resetTurnFlags",
  "tickConditions",
  "regenerateElan",
  "scoreObjective",
] as const;
export type TurnUpkeepPhase = (typeof TURN_UPKEEP_PHASES)[number];

/** Options for {@link runTurnUpkeep}. */
export interface TurnUpkeepOptions {
  /**
   * Whether to score the win/lose objective as the final phase. Defaults to
   * `true`; the opening turn passes `false` because no turn has completed yet.
   */
  readonly scoreObjective?: boolean;
}

/** The state, events and executed phases of one {@link runTurnUpkeep} pass. */
export interface TurnUpkeepResult {
  readonly state: BattleState;
  readonly events: readonly BattleEvent[];
  /**
   * The phases that ran, in order. A soldier whose condition ticks knock them
   * out mid-upkeep makes the loop repeat the leading phases, so this is a
   * faithful trace rather than a copy of {@link TURN_UPKEEP_PHASES}.
   */
  readonly phases: readonly TurnUpkeepPhase[];
}

/** Replace one soldier in a battle state, leaving every other entry shared. */
function withUnit(state: BattleState, unit: Unit): BattleState {
  return {
    ...state,
    units: state.units.map((candidate) => (candidate.id === unit.id ? unit : candidate)),
  };
}

/**
 * Run the complete, ordered upkeep for the soldier whose Orders Tempo turn is
 * beginning (T129, peer lesson L14):
 *
 * 1. **spendCharge** — deduct the incoming soldier's charge, keeping any
 *    overshoot as progress toward their next turn (`./turn.ts`).
 * 2. **resetTurnFlags** — clear {@link BattleState.hasMovedThisTurn} and
 *    {@link BattleState.hasActedThisTurn} for the fresh turn.
 * 3. **tickConditions** — advance every status on the soldier (Bleeding,
 *    Steadied, Mortally Wounded), which can knock them out.
 * 4. **regenerateElan** — restore Élan on the authored schedule and reconcile
 *    the Shaken/Routed morale conditions with the new pool (`./rules/elan.ts`).
 * 5. **scoreObjective** — advance the mission clock by one completed turn and
 *    check the win/lose condition. Skipped for the opening turn via
 *    {@link TurnUpkeepOptions.scoreObjective}.
 *
 * If a condition tick downs the incoming soldier, the leading phases repeat
 * for the next living actor (a dead soldier loses their turn), so the pipeline
 * always finishes on a living actor or a stalled/ finished battle. Pure and
 * deterministic: no DOM, no `Math.random`, no clock — time is the integer
 * Orders Tempo tick.
 */
export function runTurnUpkeep(
  state: BattleState,
  options: TurnUpkeepOptions = {},
): TurnUpkeepResult {
  const events: BattleEvent[] = [];
  const phases: TurnUpkeepPhase[] = [];
  let working = state;

  // Phases 1-4 repeat only if a condition tick downs the incoming soldier.
  for (let guard = 0; guard < 64; guard++) {
    const actorId = working.currentActorId;

    // 1. Charge spend.
    if (actorId !== null) {
      working = { ...working, tempo: spendTurn(working.tempo, actorId) };
    }
    phases.push("spendCharge");

    // 2. Per-turn flag reset.
    working = { ...working, hasMovedThisTurn: false, hasActedThisTurn: false };
    phases.push("resetTurnFlags");

    // 3 & 4. Condition ticks, then Élan regeneration, for the incoming actor.
    if (actorId !== null) {
      const actor = findUnit(working, actorId);
      if (actor !== undefined && !isOutOfAction(actor)) {
        const ticked = tickConditions(actor, working.tempo.tick);
        working = withUnit(working, ticked.unit);
        events.push(...ticked.events);
        phases.push("tickConditions");

        // A tick can knock the soldier out; a dead soldier does not regenerate.
        if (!isOutOfAction(ticked.unit)) {
          const settled = settleElan(ticked.unit, working.tempo.tick);
          working = withUnit(working, settled.unit);
          events.push(...settled.events);
        }
        phases.push("regenerateElan");
      }
    }

    if (actorId === null) break;
    const actor = findUnit(working, actorId);
    if (actor === undefined || isOutOfAction(actor)) {
      // Upkeep downed the incoming soldier: skip their lost turn and open the
      // next one. `skipDownedActors` resolves any charges their skipped turns
      // elapse and re-runs until a living actor (or none) remains.
      working = skipDownedActors(working, events);
      if (working.phase === "finished" || working.currentActorId === null) break;
      continue;
    }
    break;
  }

  // 5. Objective scoring.
  if (options.scoreObjective !== false) {
    working = settleObjective(working, events);
  }
  phases.push("scoreObjective");

  return { state: working, events, phases };
}

/** Emit the opening events and hand the first turn to the current actor. */
function announceStart(state: BattleState, events: BattleEvent[]): BattleState {
  events.push({ kind: "battleStarted", tick: 0 });
  for (const unit of state.units) {
    events.push({
      kind: "unitDeployed",
      tick: 0,
      unitId: unit.id,
      at: { x: unit.at.x, y: unit.at.y },
      side: unit.side,
    });
  }
  // The opening soldier's turn begins here: run the same ordered upkeep as
  // every later turn, but do not score the objective — no turn has completed
  // yet, so a `survive` objective must not tick on turn zero (T129).
  const begun = runTurnUpkeep(state, { scoreObjective: false });
  const working: BattleState = { ...begun.state, started: true };
  events.push(...begun.events);
  if (working.currentActorId !== null) {
    events.push({ kind: "turnStarted", tick: working.tempo.tick, unitId: working.currentActorId });
  }
  return working;
}

/**
 * Announce the battle's opening events — `battleStarted`, one `unitDeployed`
 * per soldier and the first `turnStarted` — running the opening soldier's
 * ordered upkeep (T129) but **without completing a turn** or scoring the
 * objective. Returns the started state plus those events in order.
 *
 * {@link step} performs this implicitly on its first call; exposing it lets a
 * UI paint deployment and the opening turn before the first order, and lets
 * composition layers (such as the battle controller in `src/app`) emit the
 * opening events in the right order when they resolve a turn from several
 * engine operations.
 *
 * Idempotent: a battle that is already {@link BattleState.started} is returned
 * unchanged with an empty event list.
 */
export function beginBattle(state: BattleState): {
  readonly state: BattleState;
  readonly events: readonly BattleEvent[];
} {
  if (state.started) return { state, events: [] };
  const events: BattleEvent[] = [];
  return { state: announceStart(state, events), events };
}

/** The scheduler after one soldier has finished acting, plus the next actor. */
interface EndTurnResult {
  readonly state: BattleState;
  /** The next actor, or `null` when the Orders Tempo order has stalled. */
  readonly actorId: UnitId | null;
  /** Effects whose charge elapsed while waiting for the next actor (T024). */
  readonly resolved: readonly ResolvedCharge[];
}

/** Result of {@link advancePastCasualties}. */
interface AdvanceFromTempo {
  readonly tempo: OrdersTempo;
  readonly actorId: UnitId | null;
  readonly resolved: readonly ResolvedCharge[];
}

/**
 * From a scheduler whose previous turn has already been spent, advance tick by
 * tick until a soldier is ready, **skipping and spending** any ready casualty
 * on the way. A casualty can still be holding a ready turn — downed by a charge
 * or reaction that landed on somebody else's turn — and the engine refuses to
 * order an out-of-action soldier, so those turns are consumed here to stop the
 * battle soft-locking.
 *
 * `state` supplies the effective speeds and liveness; `tempo` is the scheduler
 * to advance (it may already carry one spent charge). Pure.
 */
function advancePastCasualties(state: BattleState, tempo: OrdersTempo): AdvanceFromTempo {
  const speedOf = battleSpeedOf(state);
  const isDowned = (id: UnitId): boolean => {
    const unit = state.units.find((candidate) => candidate.id === id);
    return unit === undefined || isOutOfAction(unit);
  };

  let current = tempo;
  let next = advanceToNextTurn(current, speedOf);
  const resolved: ResolvedCharge[] = [];

  while (next !== null && isDowned(next.actorId)) {
    resolved.push(...next.resolved);
    current = spendTurn(next.state, next.actorId);
    next = advanceToNextTurn(current, speedOf);
  }

  if (next === null) return { tempo: current, actorId: null, resolved };
  return { tempo: next.state, actorId: next.actorId, resolved: [...resolved, ...next.resolved] };
}

/**
 * Spend the acting soldier's Orders Tempo charge and advance to the next
 * actor. `spendTurn` keeps any charge overshoot as progress toward the next
 * turn (`docs/wiki/pages/Charge_time.md`). Any charges that elapse while the
 * clock runs are returned so the caller can resolve them (`next.resolved`).
 *
 * The next actor starts a fresh turn, so both per-turn flags are cleared here —
 * advancing the turn is the only thing that resets them.
 */
function endTurn(state: BattleState, actorId: UnitId): EndTurnResult {
  const advanced = advancePastCasualties(state, spendTurn(state.tempo, actorId));
  return {
    state: {
      ...state,
      tempo: advanced.tempo,
      currentActorId: advanced.actorId,
      hasMovedThisTurn: false,
      hasActedThisTurn: false,
    },
    actorId: advanced.actorId,
    resolved: advanced.resolved,
  };
}

/**
 * Skip any **out-of-action** soldier that still holds the turn, resolving the
 * charges their skipped turns elapse on the way. `endTurn` already skips
 * casualties present when the turn advances; this catches the ones made by a
 * charge that resolved *after* the next actor was chosen, so `step` can never
 * park the battle on a soldier nobody may command. Pure and loop-guarded.
 */
function skipDownedActors(state: BattleState, events: BattleEvent[]): BattleState {
  let working = state;
  for (let guard = 0; guard < 64; guard++) {
    if (working.phase === "finished" || working.currentActorId === null) break;
    const actor = working.units.find((unit) => unit.id === working.currentActorId);
    if (actor === undefined || !isOutOfAction(actor)) break;
    events.push({ kind: "turnEnded", tick: working.tempo.tick, unitId: actor.id });
    const next = endTurn(working, actor.id);
    working = resolveCompletedCharges(next.state, next.resolved, events);
  }
  return working;
}

/**
 * Whether a command closes the actor's Orders Tempo turn. A native **move**
 * keeps the turn open so the soldier may follow it with an `act` (the FFTA
 * move-and-act turn, T115); every other order ends the turn. `wait` is the
 * explicit way to close a move-only turn.
 */
function commandEndsTurn(kind: Command["kind"]): boolean {
  return kind !== "move";
}

/**
 * Apply an accepted command to a soldier's state. `wait`, `face` and `hold`
 * run through `./actions/basic.ts` (T026); `act` runs the T024 resolution
 * pipeline and `move` the T025 march. The remaining kinds are refused by
 * {@link validateCommand} before this point, and their cases below are the
 * extension points for T061/T062 (Volley, Guard Sortie).
 */
function resolveCommand(
  state: BattleState,
  command: Command,
  actor: Unit,
  events: BattleEvent[],
): BattleState {
  switch (command.kind) {
    case "wait":
      return applyWait(state, actor, events);
    case "face":
      return applyFace(state, actor, command.facing, events);
    case "hold":
      return applyHold(state, actor, events);
    case "act": {
      // `validateCommand` guarantees the spec exists for this phase.
      const spec = actionSpecOf(state, command.abilityId);
      if (spec === undefined) return state;
      const clause = command.move;
      if (clause === undefined) {
        return declareOrResolveAction(state, actor, spec, command.target, events);
      }
      // `validateCommand` proved the path legal; derive it again here so the
      // command carries only a destination (T124).
      const path = foldedMovePath(state, actor, clause.to);
      if (path === null) return state;
      if (clause.order === "before") {
        // Close and strike: march first, then resolve the action from there.
        const moved = applyMove(state, actor, path, events);
        const movedActor = moved.units.find((unit) => unit.id === actor.id) ?? actor;
        return declareOrResolveAction(moved, movedActor, spec, command.target, events);
      }
      // Hit and retreat: resolve from the origin, then march.
      const resolved = declareOrResolveAction(state, actor, spec, command.target, events);
      const afterActor = resolved.units.find((unit) => unit.id === actor.id) ?? actor;
      return applyMove(resolved, afterActor, path, events);
    }
    case "move":
      // `validateCommand` re-validates; `applyMove` repeats the check as an
      // invariant guard and emits the `moved` event.
      return applyMove(state, actor, command.path, events);
    case "volley":
    case "guardSortie":
      // Unreachable: validateCommand rejects unsupported kinds first.
      return state;
  }
}

/* --------------------------------------------------------------------------
 * Stepping
 * ------------------------------------------------------------------------ */

/** What one {@link step} produced. */
export interface BattleStepResult {
  /**
   * The resulting battle. On rejection this is the **same object** that was
   * passed in — no mutation, not even a structural copy.
   */
  readonly state: BattleState;
  /** Events in resolution order; empty when the command was rejected. */
  readonly events: readonly BattleEvent[];
  /** Present only when the command was refused; see {@link BattleRejection}. */
  readonly rejection?: BattleRejection;
}

/**
 * The result of {@link advanceToDecision}: the next **decision point** (or a
 * terminal state) plus the events emitted on the way there.
 */
export interface BattleAdvanceResult {
  /**
   * The battle at the next decision point. At a decision point this is the
   * **same object** that was passed in, so a no-op is cheap to detect.
   */
  readonly state: BattleState;
  /** Events emitted while advancing (charges, turn ends/starts, battle end). */
  readonly events: readonly BattleEvent[];
  /** The living soldier to command, or `null` when the battle is terminal. */
  readonly actorId: UnitId | null;
  /** `true` once the battle has finished or nobody can ever act. */
  readonly terminal: boolean;
}

/**
 * Validate and apply **exactly one** command to a battle, without advancing the
 * Orders Tempo clock. This is the "apply" half of {@link step} (T123, peer
 * lesson L2); call {@link advanceToDecision} afterwards to reach the next
 * decision point.
 *
 * The lifecycle of one successful application is:
 * 1. on the very first call, announce `battleStarted`, every `unitDeployed`
 *    and the opening `turnStarted`;
 * 2. resolve the command's effect (for `act`, declare → charge → resolve,
 *    T024); then
 * 3. either **keep the turn open** — a `move` records that the march is spent
 *    and returns so a later `act` / `wait` / `hold` can close it (T115) — or
 *    close it: emit `turnEnded`, spend the actor's Orders Tempo charge and
 *    leave `currentActorId` cleared. {@link advanceToDecision} then picks the
 *    next living actor and resolves any charges that elapse while waiting.
 *
 * If {@link validateCommand} refuses the command, this returns immediately with
 * the input state unchanged, no events and a {@link BattleStepResult.rejection}.
 */
export function applyCommand(state: BattleState, command: Command): BattleStepResult {
  const rejection = validateCommand(state, command);
  if (rejection !== null) {
    return { state, events: [], rejection };
  }

  const events: BattleEvent[] = [];
  const working = state.started ? state : announceStart(state, events);

  const actor = working.units.find((unit) => unit.id === command.unitId);
  // `validateCommand` guarantees the actor is deployed; this narrows the type.
  if (actor === undefined) {
    return {
      state,
      events: [],
      rejection: { reason: "unknown-unit", message: `no soldier "${command.unitId}" is deployed` },
    };
  }

  const tick = working.tempo.tick;
  const applied = resolveCommand(working, command, actor, events);

  if (!commandEndsTurn(command.kind)) {
    // A native free move leaves the actor's Orders Tempo turn open: record the
    // spent march and return, so an `act` / `wait` / `hold` closes the turn and
    // the move stays a real command in the replay log (T115). The act slot is
    // untouched by a march.
    return { state: { ...applied, hasMovedThisTurn: true }, events };
  }

  events.push({ kind: "turnEnded", tick, unitId: actor.id });
  // Record which slot the closing order spent: an `act` uses the act slot,
  // while `wait` / `face` / `hold` are free and leave it alone (T127). The
  // flags are not reset here — `advanceToDecision` clears them, and spends the
  // next soldier's charge, through the ordered `runTurnUpkeep` pipeline (T129),
  // so a caller can still inspect the completed turn's budget in this state.
  return {
    state: {
      ...applied,
      hasMovedThisTurn:
        applied.hasMovedThisTurn || (command.kind === "act" && command.move !== undefined),
      hasActedThisTurn: command.kind === "act",
      // Clearing `currentActorId` marks the state as mid-advance so
      // `advanceToDecision` surfaces the next actor and runs its upkeep.
      currentActorId: null,
    },
    events,
  };
}

/**
 * Advance a battle to its next **decision point** — the state where a living
 * soldier holds the turn and a command may be issued — without applying any
 * order. This is the "advance" half of {@link step} (T123, peer lesson L2) and
 * the primitive an AI lookahead or balance harness drives.
 *
 * It advances the Orders Tempo clock, resolves every charge that matures while
 * waiting, **skips and spends** any out-of-action soldier still holding a turn
 * and scores the win/lose objective, then opens the next turn (`turnStarted`)
 * for the surfaced actor.
 *
 * **Idempotent at a decision point**: when a living soldier already holds the
 * turn this returns the same state object, no events and no actor change, so it
 * is always safe to call before asking for a command.
 *
 * `terminal: true` (with `actorId: null`) means the battle has finished or the
 * Orders Tempo order has stalled with nobody able to act again.
 */
export function advanceToDecision(state: BattleState): BattleAdvanceResult {
  const events: BattleEvent[] = [];

  if (state.phase === "finished") {
    return { state, events, actorId: null, terminal: true };
  }

  // Already at a decision point: a living soldier holds the turn. Return the
  // *same* object so callers can cheaply detect the no-op.
  if (state.currentActorId !== null) {
    const actor = findUnit(state, state.currentActorId);
    if (actor !== undefined && !isOutOfAction(actor)) {
      return { state, events, actorId: actor.id, terminal: false };
    }
  }

  let working = state;
  let tempo = working.tempo;
  const resolved: ResolvedCharge[] = [];

  // An out-of-action soldier still holds the turn: announce and spend it, the
  // same way `skipDownedActors` does inside a step. (A turn-ending command has
  // already spent its actor and cleared `currentActorId`, so this is only hit by
  // an external caller handing us a casualty-held turn.)
  if (working.currentActorId !== null) {
    events.push({ kind: "turnEnded", tick: working.tempo.tick, unitId: working.currentActorId });
    tempo = spendTurn(tempo, working.currentActorId);
  }

  const advanced = advancePastCasualties(working, tempo);
  resolved.push(...advanced.resolved);
  working = {
    ...working,
    tempo: advanced.tempo,
    currentActorId: advanced.actorId,
  };

  working = resolveCompletedCharges(working, resolved, events);

  // One explicit, ordered upkeep pipeline for the soldier whose turn begins
  // (T129, peer lesson L14): spend charge, reset per-turn flags, tick
  // conditions, regenerate Élan, then score the objective. The pipeline also
  // skips and spends any casualty it hands the turn to, so the battle keeps
  // moving (T117/playability). When the objective fires, the battle freezes and
  // emits `battleEnded` instead of a `turnStarted` for a turn never taken.
  const upkeep = runTurnUpkeep(working);
  working = upkeep.state;
  events.push(...upkeep.events);

  if (working.phase === "finished") {
    return { state: working, events, actorId: null, terminal: true };
  }

  if (working.currentActorId !== null) {
    events.push({ kind: "turnStarted", tick: working.tempo.tick, unitId: working.currentActorId });
  }

  return {
    state: working,
    events,
    actorId: working.currentActorId,
    terminal: working.currentActorId === null,
  };
}

/**
 * Apply one command to a battle and return the new state plus its events.
 *
 * Ergonomic wrapper over the two T123 primitives: {@link applyCommand} validates
 * and applies the command (keeping a native free `move`'s turn open, T115), then
 * {@link advanceToDecision} runs the clock to the next living actor and opens
 * its turn — which is a no-op after a `move`, so the same composition is safe
 * for every command kind.
 *
 * If {@link validateCommand} refuses the command, this returns immediately with
 * the input state unchanged, no events and a {@link BattleStepResult.rejection}.
 *
 * ```ts
 * let state = createBattle(seed, setup);
 * const first = step(state, { kind: "wait", unitId: state.currentActorId! });
 * state = first.state;
 * ```
 */
export function step(state: BattleState, command: Command): BattleStepResult {
  const applied = applyCommand(state, command);
  if (applied.rejection !== undefined) {
    return { state: applied.state, events: applied.events, rejection: applied.rejection };
  }

  const advanced = advanceToDecision(applied.state);
  return { state: advanced.state, events: [...applied.events, ...advanced.events] };
}

/**
 * Advance the battle's win/lose objective by one completed Orders Tempo turn
 * (T031). Returns the state unchanged for a sandbox battle (`objective === null`)
 * or one that has already finished; otherwise it stores the advanced tracker
 * and, once the objective is met or the company is wiped out, freezes the
 * battle and appends the single `battleEnded` event.
 */
function settleObjective(state: BattleState, events: BattleEvent[]): BattleState {
  if (state.objective === null || state.phase === "finished") return state;

  const resolution = resolveObjectiveTurn(state.objective, state.units);
  if (!resolution.finished) {
    return { ...state, objective: resolution.tracker };
  }

  events.push({ kind: "battleEnded", tick: state.tempo.tick, outcome: resolution.outcome });
  return {
    ...state,
    objective: resolution.tracker,
    phase: "finished",
    outcome: resolution.outcome,
  };
}
