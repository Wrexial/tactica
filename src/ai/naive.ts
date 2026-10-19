/**
 * Naive deterministic AI (T132, peer lesson L15) — a small, inspectable policy
 * kept alongside the utility AI (`./utility.ts`, T095).
 *
 * fft-phaser's enemy brain is roughly forty lines (provoked → best ability →
 * weakest foe → advance); it is not clever, but it is trivial to read and
 * adequate for the opening encounters. That makes it an ideal **oracle**: if a
 * fixture misbehaves, the naive brain narrows the fault to the plumbing
 * (deployment, Orders Tempo, targeting, command legality) rather than to a
 * weight table (`docs/PEER_COMBAT_LESSONS.md` §L15).
 *
 * It is **not** the default. The utility AI remains the production brain; this
 * policy exists for tests, cold-start skirmishes and allied auto-battle
 * (T098).
 *
 * ## The policy
 *
 * One actor, one Orders Tempo turn, decided in strict priority order:
 *
 * 1. **Provoked** — if the caller names a provoker (or the actor carries a
 *    condition whose `sourceId` is a living foe), move into reach of that
 *    soldier and strike it.
 * 2. **Best affordable action in range** — otherwise, from where the actor
 *    stands, use the strongest affordable offensive action that can legally
 *    name a foe (lethal blows first, then raw `power`).
 * 3. **Weakest reachable foe** — otherwise, march into reach of the living foe
 *    with the fewest current hit points and strike it.
 * 4. **Advance** — otherwise, march toward the nearest foe.
 * 5. **Wait** — otherwise close the turn.
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Deterministic** — no `Math.random`, no clock, no I/O. Every list is
 *   walked in a stable order (catalogue insertion order, field order, cheapest
 *   destination first) and ties keep the first candidate seen, so the same
 *   state always yields the same plan.
 * - **Pure** — the input {@link BattleState} is only read; the plan is a fresh
 *   value.
 * - **Same front door** — the plan is an ordinary `[move?] + act|wait` command
 *   log, the exact shapes the utility AI emits, so the engine accepts it and a
 *   replay reproduces it.
 *
 * Reference: `docs/PEER_COMBAT_LESSONS.md` §L15; `agents.md` §2 (determinism),
 * §7 (commands as the only mutation path), §9 (branded ids, no `any`). The
 * policy is authored for this project, not scraped.
 */

import type { ActionSpec } from "../engine/actions/resolve";
import { findUnit, step, type BattleState } from "../engine/battle";
import type { Command, Target } from "../engine/commands";
import { coordEquals, type Coord } from "../engine/grid";
import type { AbilityId, UnitId } from "../engine/ids";
import { findPath, reachableWithin } from "../engine/pathfinding";
import { canTarget, canTargetUnit, type RangeProfile } from "../engine/targeting";
import { isOutOfAction, type Unit } from "../engine/unit";
import type { AbilityTarget } from "../data/schema";

/* --------------------------------------------------------------------------
 * Errors and public shapes
 * ------------------------------------------------------------------------ */

/**
 * Thrown when the naive AI is asked to plan a turn it cannot: the soldier is
 * not deployed, or the battle is already over. These are caller/programming
 * faults, not in-world illegal orders — the policy only ever proposes orders
 * the engine accepts.
 */
export class NaiveAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NaiveAiError";
  }
}

/** What the naive plan intends to do, mirroring the utility AI's intent names. */
export const NAIVE_INTENTS = ["attack", "advance", "wait"] as const;
export type NaiveIntent = (typeof NAIVE_INTENTS)[number];

/**
 * Options for {@link chooseNaiveTurn}.
 *
 * Everything is optional: with no options the policy reads the battle's own
 * action catalogue and derives provocation from the actor's conditions.
 */
export interface NaiveAiOptions {
  /**
   * The soldier who provoked the actor this turn (for example, the attacker
   * from the most recent `damaged` event). When omitted, the policy infers a
   * provoker from the first active condition whose `sourceId` is a living foe.
   * An explicit id always wins; an id that names nobody, an ally or a casualty
   * is ignored.
   */
  readonly provokedBy?: UnitId | null;
  /**
   * Richer action data than the battle's minimal catalogue, mirroring
   * {@link UtilityOptions.abilities}. Falls back to `state.abilities`.
   */
  readonly abilities?: Readonly<Record<string, ActionSpec>>;
}

/**
 * A complete naive turn: the orders to issue and why. Deliberately smaller than
 * the utility AI's {@link TurnPlan} — there are no weights or scores to carry,
 * because there are none.
 */
export interface NaiveTurnPlan {
  /** The soldier the plan is for. */
  readonly unitId: UnitId;
  /** The replayable command log, always legal for the current state. */
  readonly commands: readonly Command[];
  /** What the plan intends to do. */
  readonly intent: NaiveIntent;
  /** The order to use, or `null` for an advance/wait. */
  readonly abilityId: AbilityId | null;
  /** The order's target, when {@link abilityId} is set. */
  readonly target: Target | null;
  /** Where the plan would leave the soldier standing. */
  readonly destination: Coord;
  /** Movement points spent reaching {@link destination}. */
  readonly moveCost: number;
}

/* --------------------------------------------------------------------------
 * Targeting helpers
 * ------------------------------------------------------------------------ */

/** The affiliation rule an action declares, defaulting to `"enemy"`. */
function targetFilterOf(spec: ActionSpec): AbilityTarget {
  return spec.target ?? "enemy";
}

/** Whether the policy will ever consider this action (it only strikes foes). */
function isOffensive(spec: ActionSpec): boolean {
  const filter = targetFilterOf(spec);
  return filter === "enemy" || filter === "any" || filter === "tile";
}

/** The engine range profile an action's authored fields describe. */
function rangeProfileOf(spec: ActionSpec): RangeProfile {
  const filter = targetFilterOf(spec);
  const min = spec.minRange ?? (filter === "self" ? 0 : 1);
  return {
    min,
    max: spec.range,
    ...(spec.rangeMetric === undefined ? {} : { metric: spec.rangeMetric }),
    ...(spec.elevationBonus === undefined ? {} : { elevationBonus: spec.elevationBonus }),
    ...(spec.requiresLineOfSight === undefined
      ? {}
      : { requiresLineOfSight: spec.requiresLineOfSight }),
  };
}

/** Whether the actor could legally name `foe` with `spec` from tile `at`. */
function canStrikeFrom(
  state: BattleState,
  actor: Unit,
  at: Coord,
  foe: Unit,
  spec: ActionSpec,
): boolean {
  const filter = targetFilterOf(spec);
  if (filter === "self" || filter === "ally") return false;
  const profile = rangeProfileOf(spec);
  if (filter === "tile") return canTarget(state.map, at, foe.at, profile).ok;
  return canTargetUnit(state.map, { id: actor.id, side: actor.side, at }, foe, filter, profile).ok;
}

/** The command-layer target that aims `spec` at `foe`. */
function targetFor(spec: ActionSpec, foe: Unit): Target {
  return targetFilterOf(spec) === "tile"
    ? { kind: "tile", at: { x: foe.at.x, y: foe.at.y } }
    : { kind: "unit", unitId: foe.id };
}

/* --------------------------------------------------------------------------
 * Candidate selection
 * ------------------------------------------------------------------------ */

/** One possible "move here, strike that foe with this order" plan. */
interface NaiveStrike {
  readonly abilityId: AbilityId;
  readonly target: Target;
  readonly destination: Coord;
  readonly moveCost: number;
  /** The order's formula power — the policy's only measure of strength. */
  readonly power: number;
  /** Whether the order's raw power would take the target out of action. */
  readonly lethal: boolean;
  readonly targetHp: number;
}

/**
 * Whether `a` beats `b`: a lethal blow first, then raw power, then the weakest
 * target, then the shortest march. Strictly-greater only, so a tie keeps the
 * first candidate visited and the choice stays deterministic.
 */
function isBetterStrike(a: NaiveStrike, b: NaiveStrike): boolean {
  if (a.lethal !== b.lethal) return a.lethal;
  if (a.power !== b.power) return a.power > b.power;
  if (a.targetHp !== b.targetHp) return a.targetHp < b.targetHp;
  if (a.moveCost !== b.moveCost) return a.moveCost < b.moveCost;
  return false;
}

/**
 * The best order to use on one named foe from any reachable destination.
 * Destinations arrive cheapest-first, so the shortest march wins a tie.
 */
function bestStrikeForFoe(
  state: BattleState,
  actor: Unit,
  destinations: readonly { at: Coord; cost: number }[],
  foe: Unit,
  specs: readonly ActionSpec[],
): NaiveStrike | null {
  let best: NaiveStrike | null = null;
  for (const destination of destinations) {
    for (const spec of specs) {
      if (spec.mpCost > actor.mp) continue; // unaffordable
      if (!canStrikeFrom(state, actor, destination.at, foe, spec)) continue;
      const candidate: NaiveStrike = {
        abilityId: spec.id,
        target: targetFor(spec, foe),
        destination: destination.at,
        moveCost: destination.cost,
        power: spec.power,
        lethal: spec.power >= foe.hp,
        targetHp: foe.hp,
      };
      if (best === null || isBetterStrike(candidate, best)) best = candidate;
    }
  }
  return best;
}

/** The best affordable strike against any of `foes` from `destinations`. */
function bestStrike(
  state: BattleState,
  actor: Unit,
  destinations: readonly { at: Coord; cost: number }[],
  foes: readonly Unit[],
  specs: readonly ActionSpec[],
): NaiveStrike | null {
  let best: NaiveStrike | null = null;
  for (const foe of foes) {
    const candidate = bestStrikeForFoe(state, actor, destinations, foe, specs);
    if (candidate !== null && (best === null || isBetterStrike(candidate, best))) {
      best = candidate;
    }
  }
  return best;
}

/**
 * The best strike on the **weakest** foe that can be reached: house the
 * per-foe best, then take the one whose target has the fewest hit points
 * (ties keep field order, so it is deterministic).
 */
function weakestReachableStrike(
  state: BattleState,
  actor: Unit,
  destinations: readonly { at: Coord; cost: number }[],
  foes: readonly Unit[],
  specs: readonly ActionSpec[],
): NaiveStrike | null {
  let chosen: NaiveStrike | null = null;
  for (const foe of foes) {
    const candidate = bestStrikeForFoe(state, actor, destinations, foe, specs);
    if (candidate === null) continue;
    if (chosen === null || candidate.targetHp < chosen.targetHp) chosen = candidate;
  }
  return chosen;
}

/* --------------------------------------------------------------------------
 * Reach, provocation and the march
 * ------------------------------------------------------------------------ */

/** Tiles the actor may end its march on, origin included, cheapest first. */
function destinationsFor(state: BattleState, actor: Unit): { at: Coord; cost: number }[] {
  if (state.hasMovedThisTurn) return [{ at: { x: actor.at.x, y: actor.at.y }, cost: 0 }];
  return reachableWithin(state.map, actor.at, actor.stats.move, {
    climb: actor.stats.jump,
    occupied: occupiedByOthers(state, actor),
  }).map((tile) => ({ at: { x: tile.at.x, y: tile.at.y }, cost: tile.cost }));
}

/** Every living foe of `actor`, in field order. */
function hostileTargets(state: BattleState, actor: Unit): Unit[] {
  return state.units.filter(
    (unit) =>
      !isOutOfAction(unit) &&
      ((actor.side === "company" && unit.side === "enemy") ||
        (actor.side === "enemy" && unit.side === "company")),
  );
}

/** Tiles occupied by any soldier other than `actor`. */
function occupiedByOthers(state: BattleState, actor: Unit): Coord[] {
  return state.units
    .filter((unit) => unit.id !== actor.id)
    .map((unit) => ({ x: unit.at.x, y: unit.at.y }));
}

/**
 * The provoker this turn, if any: an explicit id when it names a living foe,
 * otherwise the source of the actor's first active condition that is a living
 * foe. A stale or friendly id is ignored.
 */
function provokerOf(
  actor: Unit,
  foes: readonly Unit[],
  explicit: UnitId | null | undefined,
): Unit | null {
  if (explicit !== undefined && explicit !== null) {
    return foes.find((foe) => foe.id === explicit) ?? null;
  }
  for (const condition of actor.conditions) {
    if (condition.sourceId === undefined) continue;
    const source = foes.find((foe) => foe.id === condition.sourceId);
    if (source !== undefined) return source;
  }
  return null;
}

/** The reachable tile closest to any foe, or `null` when the actor cannot move. */
function advanceDestination(
  actor: Unit,
  destinations: readonly { at: Coord; cost: number }[],
  foes: readonly Unit[],
): { at: Coord; cost: number } | null {
  let best: { at: Coord; cost: number; distance: number } | null = null;
  for (const destination of destinations) {
    if (coordEquals(destination.at, actor.at)) continue;
    let distance = Infinity;
    for (const foe of foes) {
      const d = Math.abs(destination.at.x - foe.at.x) + Math.abs(destination.at.y - foe.at.y);
      if (d < distance) distance = d;
    }
    if (best === null || distance < best.distance) {
      best = { at: destination.at, cost: destination.cost, distance };
    }
  }
  return best === null ? null : { at: best.at, cost: best.cost };
}

/* --------------------------------------------------------------------------
 * Command assembly
 * ------------------------------------------------------------------------ */

/** Build the `[move?] + act|wait` commands for a strike. */
function strikeCommands(state: BattleState, actor: Unit, strike: NaiveStrike): Command[] {
  const commands: Command[] = [];
  if (!coordEquals(strike.destination, actor.at)) {
    const route = findPath(state.map, actor.at, strike.destination, {
      climb: actor.stats.jump,
      occupied: occupiedByOthers(state, actor),
      maxCost: actor.stats.move,
    });
    if (!route.found) return [{ kind: "wait", unitId: actor.id }];
    commands.push({
      kind: "move",
      unitId: actor.id,
      path: route.path.map((at) => ({ x: at.x, y: at.y })),
    });
  }
  commands.push({
    kind: "act",
    unitId: actor.id,
    abilityId: strike.abilityId,
    target: strike.target,
  });
  return commands;
}

/** An advancing plan: march to `destination`, then close the turn. */
function advancePlan(state: BattleState, actor: Unit, at: Coord, cost: number): NaiveTurnPlan {
  const route = findPath(state.map, actor.at, at, {
    climb: actor.stats.jump,
    occupied: occupiedByOthers(state, actor),
    maxCost: actor.stats.move,
  });
  const commands: Command[] =
    route.found && route.path.length > 1
      ? [
          {
            kind: "move",
            unitId: actor.id,
            path: route.path.map((point) => ({ x: point.x, y: point.y })),
          },
          { kind: "wait", unitId: actor.id },
        ]
      : [{ kind: "wait", unitId: actor.id }];
  return {
    unitId: actor.id,
    commands,
    intent: "advance",
    abilityId: null,
    target: null,
    destination: { x: at.x, y: at.y },
    moveCost: cost,
  };
}

/** A plan that does nothing but close the turn. */
function waitPlan(actor: Unit): NaiveTurnPlan {
  return {
    unitId: actor.id,
    commands: [{ kind: "wait", unitId: actor.id }],
    intent: "wait",
    abilityId: null,
    target: null,
    destination: { x: actor.at.x, y: actor.at.y },
    moveCost: 0,
  };
}

/**
 * Guarantee the plan is one the engine accepts, mirroring the utility AI's
 * safety net: when the soldier holds the turn, replay the orders through `step`
 * on a throwaway state and fall back to a plain `wait` the moment one is
 * refused. Planning for another soldier returns the commands untouched.
 */
function ensureLegal(state: BattleState, actorId: UnitId, plan: NaiveTurnPlan): NaiveTurnPlan {
  if (state.currentActorId !== actorId) return plan;
  let working = state;
  for (const command of plan.commands) {
    const result = step(working, command);
    if (result.rejection !== undefined) return waitPlan(requireActor(state, actorId));
    working = result.state;
  }
  return plan;
}

/** The soldier named by `unitId`, or a loud failure. */
function requireActor(state: BattleState, unitId: UnitId): Unit {
  const actor = findUnit(state, unitId);
  if (actor === undefined) {
    throw new NaiveAiError(`soldier "${unitId}" is not deployed in this battle`);
  }
  return actor;
}

/* --------------------------------------------------------------------------
 * The decision
 * ------------------------------------------------------------------------ */

/**
 * Plan one soldier's Orders Tempo turn with the naive policy.
 *
 * Ties are resolved by the order the candidates are visited: actions in
 * catalogue order, foes in field order, destinations cheapest-first. The result
 * is fully deterministic and consumes no randomness.
 *
 * ```ts
 * const plan = chooseNaiveTurn(battle, battle.currentActorId!);
 * for (const command of plan.commands) battle = step(battle, command).state;
 * ```
 *
 * @throws NaiveAiError when `unitId` is not deployed or is already out of
 *   action (a caller bug, not an in-world rejection).
 */
export function chooseNaiveTurn(
  state: BattleState,
  unitId: UnitId,
  options: NaiveAiOptions = {},
): NaiveTurnPlan {
  const actor = requireActor(state, unitId);
  if (isOutOfAction(actor)) {
    throw new NaiveAiError(`soldier "${unitId}" is out of action and cannot be ordered`);
  }
  if (state.phase !== "active") return ensureLegal(state, unitId, waitPlan(actor));

  const foes = hostileTargets(state, actor);
  if (foes.length === 0) return ensureLegal(state, unitId, waitPlan(actor));

  const origin: Coord = { x: actor.at.x, y: actor.at.y };
  const source: Readonly<Record<string, ActionSpec>> = options.abilities ?? state.abilities;
  const specs = Object.values(source).filter(isOffensive);
  const reachable = destinationsFor(state, actor);

  // 1. Provoked — go for the soldier who drew first.
  const provoker = provokerOf(actor, foes, options.provokedBy);
  if (provoker !== null) {
    const strike = bestStrikeForFoe(state, actor, reachable, provoker, specs);
    if (strike !== null) {
      return ensureLegal(state, unitId, {
        unitId: actor.id,
        commands: strikeCommands(state, actor, strike),
        intent: "attack",
        abilityId: strike.abilityId,
        target: strike.target,
        destination: strike.destination,
        moveCost: strike.moveCost,
      });
    }
  }

  // 2. Best affordable action that already reaches a foe from where we stand.
  const standing = bestStrike(state, actor, [{ at: origin, cost: 0 }], foes, specs);
  if (standing !== null) {
    return ensureLegal(state, unitId, {
      unitId: actor.id,
      commands: strikeCommands(state, actor, standing),
      intent: "attack",
      abilityId: standing.abilityId,
      target: standing.target,
      destination: standing.destination,
      moveCost: standing.moveCost,
    });
  }

  // 3. Strike the weakest foe we can march into reach of.
  const weakest = weakestReachableStrike(state, actor, reachable, foes, specs);
  if (weakest !== null) {
    return ensureLegal(state, unitId, {
      unitId: actor.id,
      commands: strikeCommands(state, actor, weakest),
      intent: "attack",
      abilityId: weakest.abilityId,
      target: weakest.target,
      destination: weakest.destination,
      moveCost: weakest.moveCost,
    });
  }

  // 4. Advance toward the nearest foe.
  const advance = advanceDestination(actor, reachable, foes);
  if (advance !== null) {
    return ensureLegal(state, unitId, advancePlan(state, actor, advance.at, advance.cost));
  }

  // 5. Nothing to do but close the turn.
  return ensureLegal(state, unitId, waitPlan(actor));
}

/**
 * The single next order for a soldier: the first command of its
 * {@link chooseNaiveTurn} plan. Because a turn's commands are `[move, act]`,
 * the first command is always legal in the current state, which makes this a
 * safe one-step-at-a-time API for a controller loop.
 *
 * ```ts
 * let battle = state;
 * while (battle.phase === "active") {
 *   const command = chooseNaiveCommand(battle, battle.currentActorId!);
 *   battle = step(battle, command).state;
 * }
 * ```
 */
export function chooseNaiveCommand(
  state: BattleState,
  unitId: UnitId,
  options: NaiveAiOptions = {},
): Command {
  return chooseNaiveTurn(state, unitId, options).commands[0] ?? { kind: "wait", unitId };
}
