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
 * Scope of T022 was the create/step skeleton and the **turn lifecycle**
 * (start the battle, announce the acting soldier, end the turn, advance Orders
 * Tempo). T024 adds the **action resolution pipeline** (`act` commands:
 * declare → charge → resolve) via `./actions/resolve.ts`, T025 adds the
 * **Move** command via `./actions/move.ts` (path validation against terrain,
 * elevation/Climb, occupancy and the Move budget), and T026 adds the basic
 * **Wait / Face / Hold** commands via `./actions/basic.ts`. T115 makes the
 * turn **native move-and-act**: a `move` leaves the actor's Orders Tempo turn
 * open (recording {@link BattleState.hasMovedThisTurn}), so an `act`, `wait`
 * or `hold` closes it without the caller composing the free move by hand. The
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
import { coordKey, inBounds } from "./grid";
import { isValidId, type UnitId } from "./ids";
import {
  assertObjective,
  createObjectiveTracker,
  resolveObjectiveTurn,
  type Objective,
  type ObjectiveTracker,
} from "./objectives";
import type { Seed } from "./rng";
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
   * and is cleared when the turn ends.
   */
  readonly hasMovedThisTurn: boolean;
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
  }
  return null;
}

/* --------------------------------------------------------------------------
 * Turn lifecycle
 * ------------------------------------------------------------------------ */

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
  if (state.currentActorId !== null) {
    events.push({ kind: "turnStarted", tick: state.tempo.tick, unitId: state.currentActorId });
  }
  return { ...state, started: true };
}

/**
 * Announce the battle's opening events — `battleStarted`, one `unitDeployed`
 * per soldier and the first `turnStarted` — **without** spending a turn.
 * Returns the started state plus those events in order.
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

/**
 * Spend the acting soldier's Orders Tempo charge and advance to the next
 * actor. `spendTurn` keeps any charge overshoot as progress toward the next
 * turn (`docs/wiki/pages/Charge_time.md`). Any charges that elapse while the
 * clock runs are returned so the caller can resolve them (`next.resolved`).
 *
 * The next actor starts a fresh turn, so `hasMovedThisTurn` is cleared here —
 * the only place the flag is reset.
 */
function endTurn(state: BattleState, actorId: UnitId): EndTurnResult {
  const speedOf = battleSpeedOf(state);
  const isDowned = (id: UnitId): boolean => {
    const unit = state.units.find((candidate) => candidate.id === id);
    return unit === undefined || isOutOfAction(unit);
  };

  let tempo = spendTurn(state.tempo, actorId);
  let next = advanceToNextTurn(tempo, speedOf);
  const resolved: ResolvedCharge[] = [];

  // A casualty can still be holding a ready turn — killed by a charge or a
  // reaction that landed on somebody else's turn — and the engine refuses to
  // order an out-of-action soldier. Spend that turn and advance again so the
  // battle never soft-locks on a downed officer.
  while (next !== null && isDowned(next.actorId)) {
    resolved.push(...next.resolved);
    tempo = spendTurn(next.state, next.actorId);
    next = advanceToNextTurn(tempo, speedOf);
  }

  if (next === null) {
    return {
      state: { ...state, tempo, currentActorId: null, hasMovedThisTurn: false },
      actorId: null,
      resolved,
    };
  }
  return {
    state: {
      ...state,
      tempo: next.state,
      currentActorId: next.actorId,
      hasMovedThisTurn: false,
    },
    actorId: next.actorId,
    resolved: [...resolved, ...next.resolved],
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
      return declareOrResolveAction(state, actor, spec, command.target, events);
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
 * Apply one command to a battle and return the new state plus its events.
 *
 * The lifecycle of a single successful step is:
 * 1. on the very first step, announce `battleStarted`, every `unitDeployed`
 *    and the opening `turnStarted`;
 * 2. resolve the command's effect (for `act`, declare → charge → resolve,
 *    T024); then
 * 3. either **keep the turn open** — a `move` records that the march is spent
 *    and returns so a later `act` / `wait` / `hold` can close it (T115) — or
 *    end the turn: `turnEnded` for the actor, advance Orders Tempo (resolving
 *    any charges that elapse while waiting) and `turnStarted` for the next
 *    soldier; if a win/lose objective is met (T031) the battle instead emits a
 *    single `battleEnded`, freezes and admits no further commands.
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
  const rejection = validateCommand(state, command);
  if (rejection !== null) {
    return { state, events: [], rejection };
  }

  const events: BattleEvent[] = [];
  let working = state.started ? state : announceStart(state, events);

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
  working = resolveCommand(working, command, actor, events);

  if (!commandEndsTurn(command.kind)) {
    // A native free move leaves the actor's Orders Tempo turn open: record the
    // spent march and return, so an `act` / `wait` / `hold` closes the turn and
    // the move stays a real command in the replay log (T115).
    return { state: { ...working, hasMovedThisTurn: true }, events };
  }

  events.push({ kind: "turnEnded", tick, unitId: actor.id });
  const next = endTurn(working, actor.id);
  working = resolveCompletedCharges(next.state, next.resolved, events);
  // Charges resolved above may have downed the soldier who was just handed the
  // turn; skip any that are, so the battle keeps moving (T117/playability).
  working = skipDownedActors(working, events);

  // Score the win/lose objective (T031) before opening the next turn. When it
  // fires, the battle freezes, records the outcome and emits `battleEnded`
  // instead of a `turnStarted` for a turn that will never be taken.
  working = settleObjective(working, events);
  if (working.phase === "finished") {
    return { state: working, events };
  }

  if (next.actorId !== null) {
    events.push({ kind: "turnStarted", tick: working.tempo.tick, unitId: next.actorId });
  }

  return { state: working, events };
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
