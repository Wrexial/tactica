/**
 * Action resolution pipeline (T024) — the **declare → charge → resolve** life
 * cycle of an action, expressed entirely as {@link BattleEvent}s.
 *
 * The battle state machine (T022) knows how to run a turn; this module knows
 * what happens *inside* one. When a soldier receives an `act` command the
 * pipeline:
 *
 * 1. **Declares** the action — emits `abilityUsed` and pays its **Élan** cost
 *    (`mpChanged`, mapping §5).
 * 2. **Charges** it — an action with `chargeTime > 0` (mapping §12, Orders
 *    Tempo) is scheduled in the {@link OrdersTempo} scheduler and recorded as a
 *    {@link PendingAction}; `chargeStarted` announces the wind-up. An instant
 *    action (`chargeTime === 0`) skips straight to resolution.
 * 3. **Resolves** it — the effect lands and `abilityResolved` (and, for a
 *    charged action, `chargeResolved`) is emitted.
 *
 * The battle layer owns the rest of the turn: it ends the soldier's turn
 * (`turnEnded`), advances Orders Tempo, drains any charges whose timer elapsed
 * while waiting ({@link resolveCompletedCharges}) and starts the next turn
 * (`turnStarted`). This module is the **orchestration seam** between the battle
 * state machine and the combat rules: it owns the pipeline bookkeeping (Élan,
 * charge timing, events) and now composes the action executor (T041) and the
 * reaction hooks (T042) into it, applying the acting soldier's support traits
 * (T043) first. Targeting is resolved by the executor through the authored
 * {@link ActionSpec} fields, and every random draw comes from the battle's
 * seeded PRNG stream ({@link import("../turn").OrdersTempo.rng}) so a replay
 * stays byte-identical.
 *
 * Contract (`agents.md` §2, §7, §9):
 * - **Pure & deterministic** — no DOM, no I/O, no `Math.random`, no `Date`.
 *   Charge ids are minted from the actor, ability and integer Orders Tempo
 *   tick, so a replay from a seed reproduces every id and event exactly.
 * - **State in, state out** — nothing here mutates its inputs; every helper
 *   returns a new {@link BattleState} (structural sharing is fine).
 * - **Data-driven** — the numbers a pipeline run needs (`mpCost`, `chargeTime`,
 *   `range`, `power`) arrive as an {@link ActionSpec}, not as branches. Content
 *   authors own the values (`src/data/`, T041).
 *
 * Reference: `docs/wiki/pages/Charge_time.md` (charge windows) and
 * `docs/wiki/pages/Battle_system.md` (turn flow). Fiction follows
 * `docs/NAPOLEONIC_MAPPING.md`: Élan is morale (D4), Orders Tempo is the CTB
 * scheduler (mapping §12).
 */

import {
  ABILITY_TARGETS,
  AOE_SHAPES,
  type AbilityTarget,
  type AoeShape,
} from "../../data/schema";
import type { BattleState } from "../battle";
import type { Target } from "../commands";
import type { BattleEvent } from "../events";
import { coordEquals, inBounds, type Coord } from "../grid";
import { isValidId, type AbilityId, type UnitId } from "../ids";
import { Rng } from "../rng";
import { reactionKindOf, resolveReactionResponses, type ReactionOptions } from "../reactions";
import { spendElan } from "../rules/elan";
import type { RangeMetric } from "../targeting";
import { traitKindOf, withTraits, type TraitOptions } from "../traits";
import { scheduleCharge, type ResolvedCharge } from "../turn";
import { isOutOfAction, type Unit } from "../unit";
import { executeAbility, type AbilityEffect, type AbilitySpec } from "./ability";

/* --------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------ */

/**
 * Thrown when a charge the Orders Tempo scheduler reports cannot be matched to a
 * {@link PendingAction}. That can only happen if the scheduler and the battle's
 * pending list have diverged, which is an engine bug — so it fails loudly
 * rather than silently dropping an effect.
 */
export class ActionResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ActionResolutionError";
  }
}

/* --------------------------------------------------------------------------
 * Action data
 * ------------------------------------------------------------------------ */

/**
 * The subset of an authored ability (`AbilityDef`, `src/data/schema.ts`) the
 * resolution pipeline needs. Keeping it a structural interface (rather than the
 * full Zod shape) means the engine owns *behaviour* while content owns the
 * numbers, and the executor (T041) can map data to it without leaking display
 * fields (names, flavour) into the simulation.
 */
export interface ActionSpec {
  /** The ability this run invokes. */
  readonly id: AbilityId;
  /** **Élan** (FFTA MP) paid on declaration; `>= 0`. */
  readonly mpCost: number;
  /** Orders Tempo ticks the action winds up for; `0` = instant. */
  readonly chargeTime: number;
  /** Targeting reach in tiles (enforced by T028). */
  readonly range: number;
  /** Formula power term (used by T033/T034). */
  readonly power: number;
  /**
   * Area-of-effect footprint shape (mapping §12). Omitted means a
   * single-target action; the targeting overlay (T085) reads this to preview
   * the footprint under the cursor.
   */
  readonly aoeShape?: AoeShape;
  /** Area-of-effect radius in tiles. Defaults to `0` (the centre tile only). */
  readonly aoeSize?: number;
  /**
   * Who the action may legally include (self / ally / enemy / any / tile),
   * resolved by the executor's targeting pass (T028). Defaults to `"enemy"`,
   * so a legacy minimal spec still resolves as a simple hostile Steel blow.
   */
  readonly target?: AbilityTarget;
  /** Minimum reach in tiles; defaults to `1` (or `0` for a self-target action). */
  readonly minRange?: number;
  /** Base accuracy percentage fed to the T037 hit roll; defaults to `100`. */
  readonly hitRate?: number;
  /** Critical-hit chance percentage; defaults to `0`. */
  readonly critRate?: number;
  /** Distance metric for range; defaults to `"manhattan"` (T028). */
  readonly rangeMetric?: RangeMetric;
  /** Whether high ground extends range downhill; defaults to `false`. */
  readonly elevationBonus?: boolean;
  /** Whether line of sight is required; defaults to `true`. */
  readonly requiresLineOfSight?: boolean;
  /**
   * The effects the executor applies, in order (T041). Omitted or empty means
   * the action falls back to a single **Steel** blow at `power`, so a legacy
   * catalogue entry still lands a hit rather than resolving into a no-op.
   */
  readonly effects?: readonly AbilityEffect[];
}

/** An id-keyed catalogue of the actions a battle can resolve. */
export type ActionCatalogue = Readonly<Record<string, ActionSpec>>;

/** Validate and index a list of specs by id. Throws on duplicates/malformed. */
export function buildActionCatalogue(specs: readonly ActionSpec[] = []): ActionCatalogue {
  const catalogue: Record<string, ActionSpec> = {};
  for (const spec of specs) {
    if (!isValidId(spec.id)) {
      throw new RangeError("action spec must have a non-empty id");
    }
    if (catalogue[spec.id] !== undefined) {
      throw new RangeError(`duplicate action spec id: ${spec.id}`);
    }
    assertNonNegativeInteger(spec.mpCost, `action ${spec.id} mpCost`);
    assertNonNegativeInteger(spec.chargeTime, `action ${spec.id} chargeTime`);
    assertNonNegativeInteger(spec.range, `action ${spec.id} range`);
    if (!Number.isInteger(spec.power)) {
      throw new RangeError(`action ${spec.id} power must be an integer`);
    }
    if (spec.aoeShape !== undefined && !(AOE_SHAPES as readonly string[]).includes(spec.aoeShape)) {
      throw new RangeError(`action ${spec.id} aoeShape is invalid: ${String(spec.aoeShape)}`);
    }
    if (spec.aoeSize !== undefined) {
      assertNonNegativeInteger(spec.aoeSize, `action ${spec.id} aoeSize`);
    }
    if (spec.target !== undefined && !(ABILITY_TARGETS as readonly string[]).includes(spec.target)) {
      throw new RangeError(`action ${spec.id} target is invalid: ${String(spec.target)}`);
    }
    for (const [label, value] of [
      ["minRange", spec.minRange],
      ["hitRate", spec.hitRate],
      ["critRate", spec.critRate],
    ] as const) {
      if (value !== undefined) assertNonNegativeInteger(value, `action ${spec.id} ${label}`);
    }
    if (
      spec.rangeMetric !== undefined &&
      spec.rangeMetric !== "manhattan" &&
      spec.rangeMetric !== "chebyshev"
    ) {
      throw new RangeError(`action ${spec.id} rangeMetric is invalid: ${String(spec.rangeMetric)}`);
    }
    if (spec.elevationBonus !== undefined && typeof spec.elevationBonus !== "boolean") {
      throw new RangeError(`action ${spec.id} elevationBonus must be a boolean`);
    }
    if (spec.requiresLineOfSight !== undefined && typeof spec.requiresLineOfSight !== "boolean") {
      throw new RangeError(`action ${spec.id} requiresLineOfSight must be a boolean`);
    }
    if (spec.effects !== undefined && !Array.isArray(spec.effects)) {
      throw new RangeError(`action ${spec.id} effects must be an array`);
    }
    // Copy so callers cannot alias a spec back into battle state. Optional
    // fields are copied only when authored, keeping legacy specs byte-identical.
    catalogue[spec.id] = {
      id: spec.id,
      mpCost: spec.mpCost,
      chargeTime: spec.chargeTime,
      range: spec.range,
      power: spec.power,
      ...(spec.aoeShape === undefined ? {} : { aoeShape: spec.aoeShape }),
      ...(spec.aoeSize === undefined ? {} : { aoeSize: spec.aoeSize }),
      ...(spec.target === undefined ? {} : { target: spec.target }),
      ...(spec.minRange === undefined ? {} : { minRange: spec.minRange }),
      ...(spec.hitRate === undefined ? {} : { hitRate: spec.hitRate }),
      ...(spec.critRate === undefined ? {} : { critRate: spec.critRate }),
      ...(spec.rangeMetric === undefined ? {} : { rangeMetric: spec.rangeMetric }),
      ...(spec.elevationBonus === undefined ? {} : { elevationBonus: spec.elevationBonus }),
      ...(spec.requiresLineOfSight === undefined
        ? {}
        : { requiresLineOfSight: spec.requiresLineOfSight }),
      ...(spec.effects === undefined ? {} : { effects: [...spec.effects] }),
    };
  }
  return catalogue;
}

/* --------------------------------------------------------------------------
 * Pending (charging) actions
 * ------------------------------------------------------------------------ */

/**
 * An action that has been declared but whose effect has not yet landed because
 * it is charging (mapping §12). The battle state keeps these so a deferred
 * resolution can be reconstructed from a save/replay without re-reading the
 * command that created it.
 *
 * `chargeId` links this record to the {@link import("../turn").TempoCharge} in
 * the Orders Tempo scheduler.
 */
export interface PendingAction {
  /** Correlates with the matching `TempoCharge`. */
  readonly chargeId: string;
  /** The soldier whose action is in flight. */
  readonly unitId: UnitId;
  /** The action being charged. */
  readonly abilityId: AbilityId;
  /** Resolved centre tile the effect will land on. */
  readonly at: Coord;
  /** The named target, when the action was single-target. */
  readonly targetId?: UnitId;
  /** The Orders Tempo tick the action was declared on. */
  readonly declaredTick: number;
}

/* --------------------------------------------------------------------------
 * Validation helpers
 * ------------------------------------------------------------------------ */

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, received ${String(value)}`);
  }
}

/** A resolved target: the centre tile plus the named soldier, when any. */
interface ResolvedTarget {
  readonly at: Coord;
  readonly targetId?: UnitId;
}

/**
 * Turn a {@link Target} into the tile the effect is centred on and, for a
 * single-target action, the soldier it names. The command layer has already
 * validated the target's *shape*; the battle layer validates reachability
 * (T028). A unit target the engine cannot find is a rules error, so it throws.
 */
function resolveTarget(state: BattleState, actor: Unit, target: Target): ResolvedTarget {
  switch (target.kind) {
    case "self":
      return { at: { x: actor.at.x, y: actor.at.y } };
    case "tile":
      return { at: { x: target.at.x, y: target.at.y } };
    case "unit": {
      const named = state.units.find((unit) => unit.id === target.unitId);
      if (named === undefined) {
        throw new ActionResolutionError(
          `action targets "${target.unitId}", who is not deployed in this battle`,
        );
      }
      return { at: { x: named.at.x, y: named.at.y }, targetId: named.id };
    }
  }
}

/** Replace one soldier in the deployed list, preserving order. */
function replaceUnit(units: readonly Unit[], updated: Unit): readonly Unit[] {
  return units.map((unit) => (unit.id === updated.id ? updated : unit));
}

/**
 * A deterministic, collision-free charge id for `unitId` using `abilityId` at
 * `tick`. `#n` disambiguates the rare case (very high Speed) where the same
 * soldier declares the same action twice on one tick.
 */
function uniqueChargeId(
  state: BattleState,
  unitId: UnitId,
  abilityId: AbilityId,
  tick: number,
): string {
  const base = `${unitId}:${abilityId}:${tick}`;
  let candidate = base;
  let suffix = 1;
  while (state.pendingActions.some((pending) => pending.chargeId === candidate)) {
    candidate = `${base}#${suffix}`;
    suffix += 1;
  }
  return candidate;
}

/** Attach the optional `targetId` only when present, keeping events canonical. */
function targetFields(target: ResolvedTarget): { targetId?: UnitId } {
  return target.targetId === undefined ? {} : { targetId: target.targetId };
}

/* --------------------------------------------------------------------------
 * Effect execution (T041), reactions (T042) and traits (T043)
 * ------------------------------------------------------------------------ */

/**
 * The executable shape a minimal {@link ActionSpec} describes. A spec that
 * authors no `effects` falls back to a single **Steel** blow at its `power`, so
 * a legacy catalogue entry still deals damage through `executeAbility` (T041)
 * rather than resolving into nothing.
 */
function executableSpec(spec: ActionSpec): AbilitySpec {
  const effects: readonly AbilityEffect[] =
    spec.effects !== undefined && spec.effects.length > 0
      ? spec.effects
      : [{ kind: "steel", power: spec.power }];
  return {
    id: spec.id,
    mpCost: spec.mpCost,
    chargeTime: spec.chargeTime,
    range: spec.range,
    power: spec.power,
    target: spec.target ?? "enemy",
    effects,
    ...(spec.minRange === undefined ? {} : { minRange: spec.minRange }),
    ...(spec.aoeShape === undefined ? {} : { aoeShape: spec.aoeShape }),
    ...(spec.aoeSize === undefined ? {} : { aoeSize: spec.aoeSize }),
    ...(spec.hitRate === undefined ? {} : { hitRate: spec.hitRate }),
    ...(spec.critRate === undefined ? {} : { critRate: spec.critRate }),
    ...(spec.rangeMetric === undefined ? {} : { rangeMetric: spec.rangeMetric }),
    ...(spec.elevationBonus === undefined ? {} : { elevationBonus: spec.elevationBonus }),
    ...(spec.requiresLineOfSight === undefined
      ? {}
      : { requiresLineOfSight: spec.requiresLineOfSight }),
  };
}

/**
 * The single reaction each deployed soldier has mastered, keyed by unit id.
 * FFTA grants one R-Ability slot; the engine reads it from the soldier's
 * mastered Drill (`Unit.abilities`, T048/T051), so a battle state carries
 * everything `step` needs without a separate loadout table.
 */
function reactionOptionsOf(state: BattleState): ReactionOptions {
  const loadout: Record<string, AbilityId> = {};
  for (const unit of state.units) {
    const learned = unit.abilities.find(
      (ability) => ability.mastered && reactionKindOf(ability.abilityId) !== undefined,
    );
    if (learned !== undefined) loadout[unit.id] = learned.abilityId;
  }
  return { loadout };
}

/** The single support trait each deployed soldier has mastered, keyed by unit id. */
function traitOptionsOf(state: BattleState): TraitOptions {
  const loadout: Record<string, AbilityId> = {};
  for (const unit of state.units) {
    const learned = unit.abilities.find(
      (ability) => ability.mastered && traitKindOf(ability.abilityId) !== undefined,
    );
    if (learned !== undefined) loadout[unit.id] = learned.abilityId;
  }
  return { loadout };
}

/** An action spec with the acting soldier's support traits already applied. */
function effectiveSpecOf(state: BattleState, actor: Unit, spec: ActionSpec): AbilitySpec {
  return withTraits(executableSpec(spec), actor, traitOptionsOf(state));
}

/** Whether an action carries a revival effect (a downed target is then legal). */
function hasReviveEffect(spec: ActionSpec): boolean {
  return (spec.effects ?? []).some((effect) => effect.kind === "revive");
}

/**
 * Reconstruct the {@link Target} a pending charge should resolve against.
 *
 * Charged abilities are **tile-anchored** (peer lesson L4, `docs/PEER_COMBAT_
 * LESSONS.md`): the effect lands on the tile recorded when the action was
 * declared, not on wherever the named soldier has since marched. A unit target
 * therefore resolves against the **living occupant of that tile** at maturity —
 * if the soldier walked off, the charge whiffs (or catches whoever now stands
 * there), which is what makes charge timing a real tactical risk.
 *
 * A ground (`"tile"`) action stays aimed at the recorded ground, and a
 * self-target action stays anchored to the caster. Returns `undefined` when the
 * recorded tile holds nobody the action can land on, so the caller records the
 * whiff without running the executor.
 */
function pendingTargetOf(
  pending: PendingAction,
  spec: ActionSpec,
  state: BattleState,
): Target | undefined {
  const declared = spec.target ?? "enemy";
  if (declared === "self") return { kind: "self" };
  const at = { x: pending.at.x, y: pending.at.y };
  if (declared === "tile") return { kind: "tile", at };

  const occupant = state.units.find((unit) => coordEquals(unit.at, at));
  if (occupant === undefined) return undefined;
  // A downed soldier can still be the target of a charge meant to save them
  // (a revival); every other effect needs a living body on the tile.
  if (isOutOfAction(occupant) && !hasReviveEffect(spec)) return undefined;
  return { kind: "unit", unitId: occupant.id };
}

/**
 * Run the action executor (T041) and then the reaction hooks (T042), appending
 * every effect event to `events` in order. Reactions fire off the events the
 * executor produced, so a Riposte or Return Fire answers exactly the blows that
 * landed. The same seeded {@link Rng} drives both phases, keeping the whole
 * resolution byte-identical for a fixed seed.
 */
function applyAbilityEffects(
  state: BattleState,
  actor: Unit,
  spec: AbilitySpec,
  target: Target,
  rng: Rng,
  events: BattleEvent[],
): BattleState {
  const execution = executeAbility(state, actor, spec, target, rng);
  events.push(...execution.events);

  const reaction = resolveReactionResponses(
    execution.state,
    execution.events,
    rng,
    reactionOptionsOf(execution.state),
  );
  events.push(...reaction.events);
  return reaction.state;
}

/* --------------------------------------------------------------------------
 * Pipeline
 * ------------------------------------------------------------------------ */

/**
 * **Declare** and (if instant) **resolve** an action. This is the pipeline's
 * entry point; the battle layer calls it once per accepted `act` command,
 * before it ends the turn and advances Orders Tempo.
 *
 * Events emitted, in order:
 * - `abilityUsed` — the declaration, carrying its charge time;
 * - `mpChanged` — the Élan cost, when non-zero;
 * - then either `chargeStarted` (charging) **or** `abilityResolved` (instant).
 *
 * Returns a new state. A charging action adds a {@link PendingAction} and a
 * matching charge to the Orders Tempo scheduler; an instant action applies its
 * (currently empty) effect immediately.
 *
 * The caller is responsible for validating that the actor may act and can
 * afford the Élan cost (see `validateCommand` in `battle.ts`).
 */
export function declareOrResolveAction(
  state: BattleState,
  actor: Unit,
  spec: ActionSpec,
  target: Target,
  events: BattleEvent[],
): BattleState {
  const tick = state.tempo.tick;
  const resolvedTarget = resolveTarget(state, actor, target);
  const effective = effectiveSpecOf(state, actor, spec);

  events.push({
    kind: "abilityUsed",
    tick,
    unitId: actor.id,
    abilityId: spec.id,
    at: resolvedTarget.at,
    ...targetFields(resolvedTarget),
    chargeTime: spec.chargeTime,
  });

  let units = state.units;
  if (effective.mpCost > 0) {
    const spent = spendElan(actor, effective.mpCost, tick);
    units = replaceUnit(units, spent.unit);
    events.push(...spent.events);
  }

  if (spec.chargeTime > 0) {
    const chargeId = uniqueChargeId(state, actor.id, spec.id, tick);
    const pending: PendingAction = {
      chargeId,
      unitId: actor.id,
      abilityId: spec.id,
      at: resolvedTarget.at,
      ...targetFields(resolvedTarget),
      declaredTick: tick,
    };
    const tempo = scheduleCharge(state.tempo, {
      chargeId,
      unitId: actor.id,
      remaining: spec.chargeTime,
    });
    events.push({
      kind: "chargeStarted",
      tick,
      unitId: actor.id,
      chargeId,
      abilityId: spec.id,
      ticks: spec.chargeTime,
    });
    return {
      ...state,
      units,
      tempo,
      pendingActions: [...state.pendingActions, pending],
    };
  }

  events.push({
    kind: "abilityResolved",
    tick,
    unitId: actor.id,
    abilityId: spec.id,
    at: resolvedTarget.at,
    ...targetFields(resolvedTarget),
  });

  // The effect lands immediately: run the executor (T041), then any reactions
  // (T042), consuming the battle's seeded PRNG stream so the whole resolution
  // is deterministic from the seed.
  const rng = Rng.fromState(state.tempo.rng);
  const resolved = applyAbilityEffects({ ...state, units }, actor, effective, target, rng, events);
  return { ...resolved, tempo: { ...resolved.tempo, rng: rng.getState() } };
}

/**
 * **Resolve** every charge the Orders Tempo scheduler reports as elapsed while
 * the battle waited for the next actor. For each one this emits
 * `chargeResolved` (the wind-up finished) followed by `abilityResolved` (the
 * effect lands), drops the matching {@link PendingAction} and returns the new
 * state.
 *
 * `resolved` comes from `advanceToNextTurn(...).resolved` (T019) and is in
 * resolution order. A charge with no pending action is an engine fault and
 * throws {@link ActionResolutionError}.
 *
 * Each elapsed charge runs the action executor (T041) and its reactions
 * (T042) in resolution order, then drops the matching pending entry.
 */
export function resolveCompletedCharges(
  state: BattleState,
  resolved: readonly ResolvedCharge[],
  events: BattleEvent[],
): BattleState {
  if (resolved.length === 0) return state;

  const byChargeId = new Map(state.pendingActions.map((pending) => [pending.chargeId, pending]));
  const consumed = new Set<string>();
  const tick = state.tempo.tick;
  const rng = Rng.fromState(state.tempo.rng);
  let working = state;

  for (const charge of resolved) {
    const pending = byChargeId.get(charge.chargeId);
    if (pending === undefined) {
      throw new ActionResolutionError(
        `Orders Tempo resolved charge "${charge.chargeId}", but no action is pending for it`,
      );
    }
    consumed.add(charge.chargeId);

    events.push({
      kind: "chargeResolved",
      tick,
      unitId: pending.unitId,
      chargeId: pending.chargeId,
      abilityId: pending.abilityId,
    });
    events.push({
      kind: "abilityResolved",
      tick,
      unitId: pending.unitId,
      abilityId: pending.abilityId,
      at: pending.at,
      ...(pending.targetId === undefined ? {} : { targetId: pending.targetId }),
    });

    // The wind-up is done: land the effect and any reactions. The caster must
    // still be standing, and the recorded tile must still hold a soldier the
    // action can land on — otherwise the charge whiffs (peer lesson L4).
    const spec = working.abilities[pending.abilityId];
    const actor = working.units.find((unit) => unit.id === pending.unitId);
    if (spec !== undefined && actor !== undefined && !isOutOfAction(actor)) {
      const target = pendingTargetOf(pending, spec, working);
      if (target !== undefined) {
        const effective = effectiveSpecOf(working, actor, spec);
        working = applyAbilityEffects(working, actor, effective, target, rng, events);
      }
    }
  }

  return {
    ...working,
    tempo: { ...working.tempo, rng: rng.getState() },
    pendingActions: working.pendingActions.filter(
      (pending) => !consumed.has(pending.chargeId),
    ),
  };
}

/**
 * Look up an action spec in a battle's catalogue. Returns `undefined` when the
 * battle does not know the ability — the battle layer turns that into an
 * `unknown-ability` rejection.
 */
export function actionSpecOf(state: BattleState, abilityId: AbilityId): ActionSpec | undefined {
  return state.abilities[abilityId];
}

/**
 * Whether a unit can afford an action's Élan cost. Exposed so command
 * validation and (later) the AI share one definition of "affordable".
 */
export function canAfford(unit: Unit, spec: ActionSpec): boolean {
  return unit.mp >= spec.mpCost;
}

/**
 * Whether `at` is a tile a ground-targeted action may be aimed at. Reach and
 * line of sight are the targeting system's job (T028); this only rejects tiles
 * outside the battlefield.
 */
export function isTargetableTile(state: BattleState, at: Coord): boolean {
  return inBounds(state.map.grid, at);
}
