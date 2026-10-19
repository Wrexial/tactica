/**
 * Battle UI state machine (T027) — the controller that turns player intent into
 * engine commands and exposes everything the HUD, move overlay and action menu
 * need to render (`agents.md` §7).
 *
 * The engine (`src/engine/battle.ts`) stays the single source of truth: this
 * module never forks the simulation or invents rules. It holds a
 * {@link BattleState}, presents a small, serialisable **UI phase**
 * ({@link BattleUiPhase}) plus the tiles/options relevant to that phase, and —
 * when the player confirms an order — commits it through the engine's
 * `step(state, command)` entry point. Every intent is a pure function returning
 * a **new** {@link BattleController}; nothing mutates its input, so the React
 * overlay can diff state cheaply and tests can replay an intent sequence.
 *
 * ## The supported flow
 *
 * The task's acceptance describes the FFTA turn: **select unit → show move
 * range → move → choose action → target → confirm**. Those map onto the phases:
 *
 * ```
 *   select ──selectUnit──▶ command ──planMove──▶ move
 *                            │                     │
 *                            │                     └── confirmOrder ──▶ command (march committed)
 *                            │
 *                            └── chooseAction ──▶ target ──chooseTarget──▶ confirm
 *                                                                             │
 *                                                                         confirmOrder
 *                                                                             ▼
 *                                                                           select
 * ```
 *
 * A unit's Orders Tempo turn is the FFTA **move + act** pair, and the engine
 * now models it natively (T115): a `move` command leaves the actor's turn open,
 * so the player commits the march on its own (T138), stays in `command` for the
 * same soldier, then chooses an action from the committed tile (T139). The
 * action path is **state-only**: targeting always derives its reach from the
 * soldier's committed `unit.at`, never from a retained preview path, so a turn
 * dispatches `["move"]` and then `["act"]`, never `[move, act]` in one batch.
 * (The engine still understands a folded `ActCommand.move` for AI/replays —
 * `src/engine/commands.ts`, T124 — the human controller just never builds one.)
 * A passing turn is an explicit `wait` (the End Turn control), never a
 * synthetic move closer.
 * The engine owns the turn bookkeeping (declare → charge → resolve → end-turn →
 * advance tempo) and every intent is a replayable command in the log. The
 * engine's per-turn budget (`hasMovedThisTurn` / `hasActedThisTurn`, T127) is
 * read here so the overlay never offers a march the engine would refuse when a
 * partially-spent turn is handed in (e.g. a mid-turn save).
 *
 * ## What the UI gets
 *
 * {@link BattleController} is the one value the overlay reads:
 *
 * - {@link BattleController.phase} — which screen to show;
 * - {@link BattleController.selectedUnitId} / `canAct` — whose turn it is;
 * - {@link BattleController.moveRange} — the blue reachable tiles (T030);
 * - {@link BattleController.pendingPath} — the planned march to preview;
 * - {@link BattleController.actions} — the available action menu, with cost;
 * - {@link BattleController.targetTiles} — the tiles an aimed action can hit;
 * - {@link BattleController.lastCommands} / `lastEvents` / `lastRejection` —
 *   what the last committed order did, for animation and logs.
 *
 * Contract (`agents.md` §2, §7, §9): the controller lives in `src/app`, so it
 * may drive the engine, but it stays framework-free (no DOM, no React) and
 * deterministic (no `Math.random`, no clock). Names follow the retheme: a
 * **soldier** takes an Orders Tempo turn, spends **Élan**, and the UI never
 * leaks the underlying FFTA vocabulary.
 *
 * Reference: `docs/wiki/pages/Move_(stat).md` (the blue move range),
 * `docs/wiki/pages/Charge_time.md` (whose turn it is).
 */

import { actionSpecOf, type ActionSpec } from "../engine/actions/resolve";
import {
  beginBattle,
  findUnit,
  step,
  type BattleRejection,
  type BattleRejectionReason,
  type BattleState,
} from "../engine/battle";
import type { Command, Target } from "../engine/commands";
import type { BattleEvent } from "../engine/events";
import { inBounds, type Coord, type Facing } from "../engine/grid";
import type { AbilityId, UnitId } from "../engine/ids";
import { findPath, reachableWithin, type ReachableTile } from "../engine/pathfinding";
import { tilesInRange } from "../engine/targeting";
import { isOutOfAction, type Unit } from "../engine/unit";

/* --------------------------------------------------------------------------
 * UI phases
 * ------------------------------------------------------------------------ */

/**
 * The screens the battle overlay can be showing. The machine advances through
 * these as the player selects, aims and confirms; `finished` is terminal.
 *
 * - `select` — nobody selected; waiting for the player to pick a soldier.
 * - `command` — a soldier is selected; move range and the action menu are shown.
 * - `move` — a destination is planned; the path is previewed, awaiting confirm.
 * - `target` — an action is chosen; the player is picking who/what to hit.
 * - `confirm` — the turn plan is complete; awaiting the final confirm.
 * - `finished` — the battle is over (T031 will populate `battle.outcome`).
 */
export const BATTLE_UI_PHASES = [
  "select",
  "command",
  "move",
  "target",
  "confirm",
  "finished",
] as const;
export type BattleUiPhase = (typeof BATTLE_UI_PHASES)[number];

/** One entry in the action menu, carrying its engine spec and affordability. */
export interface ActionOption {
  /** The action's id, as stored in the battle's catalogue. */
  readonly id: AbilityId;
  /** The resolved numbers the engine will use (`mpCost`, `chargeTime`, ...). */
  readonly spec: ActionSpec;
  /** Whether the selected soldier can currently pay its Élan cost. */
  readonly affordable: boolean;
}

/**
 * The complete controller value. Treat it as immutable: every intent returns a
 * new controller. The overlay may hold this directly in a store (Zustand) and
 * read fields without further derivation.
 */
export interface BattleController {
  /** The engine state. The controller owns the latest value and never mutates it. */
  readonly battle: BattleState;
  /** Which UI screen is showing. */
  readonly phase: BattleUiPhase;
  /** The soldier the player picked, or `null` before a selection. */
  readonly selectedUnitId: UnitId | null;
  /**
   * Whether the selected soldier currently holds the Orders Tempo turn and is
   * fit to act. A soldier can be selected for *inspection* when this is false,
   * but no orders are offered.
   */
  readonly canAct: boolean;
  /** Every tile the selected soldier can reach, cheapest cost included (T030). */
  readonly moveRange: readonly ReachableTile[];
  /** The action menu for the selected soldier, in catalogue order. */
  readonly actions: readonly ActionOption[];
  /** The planned march (origin first), when a destination has been chosen. */
  readonly pendingPath: readonly Coord[] | null;
  /** The chosen action id, when one is being aimed. */
  readonly pendingActionId: AbilityId | null;
  /** The chosen target, when one has been picked. */
  readonly pendingTarget: Target | null;
  /** Tiles the aimed action can reach; empty outside the `target` phase. */
  readonly targetTiles: readonly Coord[];
  /** The cursor/hover tile, for keyboard and pointer focus. */
  readonly cursor: Coord | null;
  /** The commands the last confirmed order issued, in order (for logs/replays). */
  readonly lastCommands: readonly Command[];
  /** Events the last confirmed order produced, in resolution order. */
  readonly lastEvents: readonly BattleEvent[];
  /** Why the last confirmed order or intent was refused, or `null`. */
  readonly lastRejection: BattleRejection | null;
}

/* --------------------------------------------------------------------------
 * Queries shared with the input/render layers
 * ------------------------------------------------------------------------ */

/** Every tile another soldier currently occupies; the mover's own is ignored. */
function occupiedByOthers(state: BattleState, mover: Unit): Coord[] {
  return state.units
    .filter((unit) => unit.id !== mover.id)
    .map((unit) => ({ x: unit.at.x, y: unit.at.y }));
}

/**
 * The blue movement range (FFTA `Move`, `docs/wiki/pages/Move_(stat).md`): every
 * tile `unit` can reach within its Move budget, respecting terrain, Climb and
 * occupied tiles. Exported so the move overlay (T030) and AI (T095) share one
 * definition.
 */
export function moveRangeFor(state: BattleState, unit: Unit): ReachableTile[] {
  return reachableWithin(state.map, unit.at, unit.stats.move, {
    climb: unit.stats.jump,
    occupied: occupiedByOthers(state, unit),
  });
}

/**
 * The least-cost route from `unit` to `to`, or `null` when the tile is
 * unreachable within the soldier's Move budget. The origin-first path matches
 * what a `move` command expects.
 */
export function pathFor(state: BattleState, unit: Unit, to: Coord): Coord[] | null {
  const result = findPath(state.map, unit.at, to, {
    climb: unit.stats.jump,
    occupied: occupiedByOthers(state, unit),
    maxCost: unit.stats.move,
  });
  return result.found ? result.path.map((at) => ({ x: at.x, y: at.y })) : null;
}

/** The action menu for a soldier: every catalogue action, with affordability. */
export function actionOptionsFor(state: BattleState, unit: Unit): ActionOption[] {
  return Object.values(state.abilities).map((spec) => ({
    id: spec.id,
    spec,
    affordable: unit.mp >= spec.mpCost,
  }));
}

/* --------------------------------------------------------------------------
 * Internal construction helpers
 * ------------------------------------------------------------------------ */

/** A controller with no pending selection, in the phase `battle` implies. */
function idleState(battle: BattleState): BattleController {
  return {
    battle,
    phase: battle.phase === "finished" ? "finished" : "select",
    selectedUnitId: null,
    canAct: false,
    moveRange: [],
    actions: [],
    pendingPath: null,
    pendingActionId: null,
    pendingTarget: null,
    targetTiles: [],
    cursor: null,
    lastCommands: [],
    lastEvents: [],
    lastRejection: null,
  };
}

/** Drop the current verdict so a fresh intent starts from a clean slate. */
function clearVerdict(controller: BattleController): BattleController {
  return controller.lastRejection === null ? controller : { ...controller, lastRejection: null };
}

/** Return `controller` with a typed rejection attached (no other change). */
function withRejection(
  controller: BattleController,
  reason: BattleRejectionReason,
  message: string,
): BattleController {
  return { ...controller, lastRejection: { reason, message } };
}

/** The selected soldier, or `null` when none is selected or it left the field. */
function selectedActor(controller: BattleController): Unit | null {
  if (controller.selectedUnitId === null) return null;
  return findUnit(controller.battle, controller.selectedUnitId) ?? null;
}

/** Reset to the idle screen after an order, preserving the dispatch record. */
function afterDispatch(
  controller: BattleController,
  battle: BattleState,
  commands: readonly Command[],
  events: readonly BattleEvent[],
  rejection: BattleRejection | null,
): BattleController {
  // Keep the opening/previous event stream only if the order dispatched nothing
  // and was refused, so the renderer can still drain it.
  const base = idleState(battle);
  const openingEvents = controller.lastEvents;
  return {
    ...base,
    lastCommands: commands,
    lastEvents: rejection !== null && events.length === 0 ? openingEvents : events,
    lastRejection: rejection,
  };
}

/* --------------------------------------------------------------------------
 * Creation
 * ------------------------------------------------------------------------ */

/**
 * Build the initial controller for a battle, announcing its opening events
 * (`battleStarted`, deployment, first `turnStarted`) up front so the overlay can
 * paint the field immediately. The phase starts at `select` (or `finished` for
 * an already-concluded battle).
 */
export function createBattleController(battle: BattleState): BattleController {
  const begun = beginBattle(battle);
  return { ...idleState(begun.state), lastEvents: begun.events };
}

/* --------------------------------------------------------------------------
 * Selection
 * ------------------------------------------------------------------------ */

/**
 * Select a deployed soldier. Selecting the soldier whose Orders Tempo turn it
 * is unlocks the move range and action menu; selecting anyone else shows their
 * information read-only (`canAct` is `false`).
 *
 * Refuses with `unknown-unit` for an id that is not deployed.
 */
export function selectUnit(controller: BattleController, unitId: UnitId): BattleController {
  if (controller.phase === "finished") return controller;

  const unit = findUnit(controller.battle, unitId);
  if (unit === undefined) {
    return withRejection(controller, "unknown-unit", `no soldier "${unitId}" is deployed`);
  }

  const canAct = controller.battle.currentActorId === unitId && !isOutOfAction(unit);
  return {
    ...clearVerdict(controller),
    phase: "command",
    selectedUnitId: unitId,
    canAct,
    // A turn whose march is already spent can still act, but must not be
    // offered a second move (engine budget, T127).
    moveRange:
      canAct && !controller.battle.hasMovedThisTurn ? moveRangeFor(controller.battle, unit) : [],
    actions: canAct ? actionOptionsFor(controller.battle, unit) : [],
    pendingPath: null,
    pendingActionId: null,
    pendingTarget: null,
    targetTiles: [],
  };
}

/** Move the UI cursor to a tile (ignored when the tile is off the battlefield). */
export function setCursor(controller: BattleController, at: Coord | null): BattleController {
  if (at === null) return { ...controller, cursor: null };
  if (!inBounds(controller.battle.map.grid, at)) return controller;
  return { ...controller, cursor: { x: at.x, y: at.y } };
}

/* --------------------------------------------------------------------------
 * Turn planning
 * ------------------------------------------------------------------------ */

/**
 * Plan a march to `at`, showing the path preview. The destination must be
 * reachable within the selected soldier's Move budget (terrain, Climb and
 * occupied tiles all considered); otherwise the intent is refused with
 * `illegal-move` and the controller is unchanged.
 *
 * The machine always sits in `move` until the march is committed or cancelled:
 * an action can never be staged against a preview, because it must resolve from
 * the soldier's committed tile (T139).
 */
export function planMove(controller: BattleController, at: Coord): BattleController {
  if (controller.phase === "finished") return controller;

  const unit = selectedActor(controller);
  if (unit === null || !controller.canAct) {
    return withRejection(controller, "not-your-turn", "select the soldier whose turn it is first");
  }
  if (controller.battle.hasMovedThisTurn) {
    return withRejection(controller, "already-moved", `${unit.name} has already marched this turn`);
  }
  if (controller.phase !== "command" && controller.phase !== "move") {
    return withRejection(controller, "unsupported", "finish the current order before planning a move");
  }
  if (!inBounds(controller.battle.map.grid, at)) {
    return withRejection(
      controller,
      "invalid-target",
      `{ x: ${at.x}, y: ${at.y} } is outside the battlefield`,
    );
  }

  const path = pathFor(controller.battle, unit, at);
  if (path === null) {
    return withRejection(
      controller,
      "illegal-move",
      `${unit.name} cannot reach { x: ${at.x}, y: ${at.y} } with Move ${unit.stats.move}`,
    );
  }

  const next = clearVerdict(controller);
  return {
    ...next,
    phase: "move",
    pendingPath: path,
    pendingActionId: null,
    pendingTarget: null,
    targetTiles: [],
    cursor: { x: at.x, y: at.y },
  };
}

/**
 * Aim an action from the selected soldier's menu. Its Élan cost is checked
 * immediately (refused with `insufficient-elan`), then the machine enters
 * `target` and exposes {@link BattleController.targetTiles} for the overlay to
 * highlight.
 *
 * Targeting is **state-only** (T139): the reach is computed from the soldier's
 * current `unit.at`, i.e. the tile it actually stands on. A march that is only
 * previewed cannot be folded into the action — the player must commit
 * ({@link commitMarch}) or cancel it first, and the intent is refused with
 * `unsupported` while the machine is in `move`.
 */
export function chooseAction(controller: BattleController, abilityId: AbilityId): BattleController {
  if (controller.phase === "finished") return controller;

  const unit = selectedActor(controller);
  if (unit === null || !controller.canAct) {
    return withRejection(controller, "not-your-turn", "select the soldier whose turn it is first");
  }
  if (controller.phase === "move") {
    return withRejection(
      controller,
      "unsupported",
      "commit or cancel the previewed march before choosing an action",
    );
  }
  if (controller.phase !== "command") {
    return withRejection(controller, "unsupported", "finish the current order before choosing an action");
  }

  const spec = actionSpecOf(controller.battle, abilityId);
  if (spec === undefined) {
    return withRejection(
      controller,
      "unknown-ability",
      `this battle has no action "${abilityId}"`,
    );
  }
  if (unit.mp < spec.mpCost) {
    return withRejection(
      controller,
      "insufficient-elan",
      `${unit.name} needs ${spec.mpCost} Élan but has ${unit.mp}`,
    );
  }

  return {
    ...clearVerdict(controller),
    phase: "target",
    pendingActionId: abilityId,
    pendingTarget: null,
    targetTiles: tilesInRange(controller.battle.map, unit.at, { min: 0, max: spec.range }),
  };
}

/**
 * Pick the target for the aimed action, completing the turn plan. The engine
 * re-validates the target on commit; this only records the player's choice and
 * advances to `confirm`.
 */
export function chooseTarget(controller: BattleController, target: Target): BattleController {
  if (controller.phase !== "target" || controller.pendingActionId === null) {
    return withRejection(
      controller,
      "invalid-target",
      "choose an action before choosing its target",
    );
  }
  return { ...clearVerdict(controller), phase: "confirm", pendingTarget: target };
}

/**
 * Aim and fire an action in one call: `chooseAction` → `chooseTarget` →
 * `confirmOrder`. A convenience for scripted/test play and the AI; the UI uses
 * the three steps so it can show the targeting overlay. Dispatches a single
 * `act` (T139): any march must already be committed, because the action
 * resolves from the soldier's current tile.
 */
export function act(
  controller: BattleController,
  abilityId: AbilityId,
  target: Target = { kind: "self" },
): BattleController {
  const aimed = chooseAction(controller, abilityId);
  if (aimed.lastRejection !== null) return aimed;
  const targeted = chooseTarget(aimed, target);
  if (targeted.lastRejection !== null) return targeted;
  return confirmOrder(targeted);
}

/* --------------------------------------------------------------------------
 * Confirming and dispatching
 * ------------------------------------------------------------------------ */

/**
 * Commit the planned order as real engine commands. A previewed march is
 * committed immediately as a single `move` (T138), leaving the same soldier in
 * `command` with its action menu; a confirmed action is dispatched as a single
 * `act` from the tile the soldier currently occupies (T139). The two halves of
 * a turn are therefore always two separate dispatches — never one bundled
 * `[move, act]`.
 *
 * On success the machine either keeps the soldier selected after a march or
 * returns to `select` after an action, recording the commands and events for
 * the renderer. A rejected order leaves the battle as it was (or as far as it
 * got) and surfaces the engine's {@link BattleRejection}.
 */
export function confirmOrder(controller: BattleController): BattleController {
  if (controller.phase === "move") return commitMarch(controller);
  if (controller.phase !== "confirm") {
    return withRejection(controller, "unsupported", "no order is ready to confirm");
  }
  return dispatchPlan(controller);
}

/**
 * Commit a previewed march and keep the same soldier's turn open (T138). The
 * destination is dispatched through `step` as exactly one `move` command; the
 * engine records `hasMovedThisTurn`, so the controller returns to the same
 * soldier's `command` phase with the march range hidden and the action menu
 * still available. Cancelling a preview never reaches this intent.
 */
export function commitMarch(controller: BattleController): BattleController {
  if (controller.phase === "finished") return controller;
  if (controller.phase !== "move" || controller.pendingPath === null) {
    return withRejection(controller, "unsupported", "no march is ready to commit");
  }

  const actorId = controller.selectedUnitId;
  if (actorId === null) {
    return withRejection(controller, "unknown-unit", "no soldier is selected");
  }

  const command: Command = {
    kind: "move",
    unitId: actorId,
    path: controller.pendingPath.map((at) => ({ x: at.x, y: at.y })),
  };
  const result = step(controller.battle, command);
  if (result.rejection !== undefined) {
    return withRejection(controller, result.rejection.reason, result.rejection.message);
  }

  // Re-select the same soldier from the committed state: `selectUnit` hides the
  // spent move range (`hasMovedThisTurn`) while keeping the action menu up.
  const resumed = selectUnit({ ...controller, battle: result.state }, actorId);
  return {
    ...resumed,
    lastCommands: [command],
    lastEvents: result.events,
    lastRejection: null,
  };
}

/** Apply a single engine command (wait/face/hold) for the selected soldier. */
function dispatchSingle(
  controller: BattleController,
  makeCommand: (unitId: UnitId) => Command,
): BattleController {
  if (controller.phase === "finished") return controller;
  const unit = selectedActor(controller);
  if (unit === null || !controller.canAct) {
    return withRejection(controller, "not-your-turn", "select the soldier whose turn it is first");
  }
  return dispatchCommands(controller, [makeCommand(unit.id)]);
}

/** Dispatch an ordered list of commands through `step`, collecting the result. */
function dispatchCommands(
  controller: BattleController,
  commands: readonly Command[],
): BattleController {
  let battle = controller.battle;
  let events: BattleEvent[] = [];
  let rejection: BattleRejection | null = null;

  for (const command of commands) {
    const result = step(battle, command);
    if (result.rejection !== undefined) {
      rejection = result.rejection;
      break;
    }
    battle = result.state;
    events = [...events, ...result.events];
  }

  return afterDispatch(controller, battle, commands, events, rejection);
}

/**
 * Confirm the staged action and dispatch exactly one `act` command through
 * `step`. The action path is state-only (T139): a previewed march is never
 * folded in here — {@link commitMarch} is the only way to move on the player
 * path, and the action resolves from the tile the soldier already occupies.
 * (The engine still accepts a folded `ActCommand.move` for AI/replay use; the
 * controller simply never builds one.)
 */
function dispatchPlan(controller: BattleController): BattleController {
  const actorId = controller.selectedUnitId;
  if (actorId === null) {
    return withRejection(controller, "unknown-unit", "no soldier is selected");
  }
  const actor = findUnit(controller.battle, actorId);
  if (actor === undefined) {
    return withRejection(controller, "unknown-unit", `no soldier "${actorId}" is deployed`);
  }
  if (controller.pendingPath !== null) {
    return withRejection(
      controller,
      "unsupported",
      "commit or cancel the previewed march before confirming an action",
    );
  }
  if (controller.pendingActionId === null) {
    // A march is committed on its own by `commitMarch`; never close it with a
    // synthetic `wait` on the player path (T138).
    return withRejection(controller, "unsupported", "no order is ready to confirm");
  }

  const command: Command = {
    kind: "act",
    unitId: actorId,
    abilityId: controller.pendingActionId,
    target: controller.pendingTarget ?? { kind: "self" },
  };
  return dispatchCommands(controller, [command]);
}

/* --------------------------------------------------------------------------
 * Orders that need no target
 * ------------------------------------------------------------------------ */

/** Pass the selected soldier's turn (FFTA `Wait`). */
export function waitOrder(controller: BattleController): BattleController {
  return dispatchSingle(controller, (unitId) => ({ kind: "wait", unitId }));
}

/** Brace in place (FFTA `Defend` → **Hold/Braced**, T026). */
export function holdOrder(controller: BattleController): BattleController {
  return dispatchSingle(controller, (unitId) => ({ kind: "hold", unitId }));
}

/** Turn in place to `facing` (mapping §12). */
export function faceOrder(controller: BattleController, facing: Facing): BattleController {
  return dispatchSingle(controller, (unitId) => ({ kind: "face", unitId, facing }));
}

/* --------------------------------------------------------------------------
 * Backing out
 * ------------------------------------------------------------------------ */

/**
 * Back out of the current step, one phase at a time: `target` → `command`,
 * `move` → `command`, `command` → `select`, `confirm` → `target`. A completed
 * order is not undone — use it before confirming. A previewed march is never
 * folded into an action, so backing out of `target` always returns to
 * `command` (T139).
 */
export function cancel(controller: BattleController): BattleController {
  switch (controller.phase) {
    case "target":
      return {
        ...clearVerdict(controller),
        phase: "command",
        pendingActionId: null,
        pendingTarget: null,
        targetTiles: [],
      };
    case "confirm":
      return { ...clearVerdict(controller), phase: "target", pendingTarget: null };
    case "move":
      return { ...clearVerdict(controller), phase: "command", pendingPath: null };
    case "command":
      return {
        ...clearVerdict(controller),
        phase: "select",
        selectedUnitId: null,
        canAct: false,
        moveRange: [],
        actions: [],
      };
    default:
      return controller;
  }
}
