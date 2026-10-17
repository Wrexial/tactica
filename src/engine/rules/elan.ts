/**
 * Élan resource and morale (T040) — spend the ability resource, regenerate it
 * on a tunable schedule, and derive the **Shaken** / **Routed** morale states
 * from the pool (mapping §5, decision D4).
 *
 * FFTA's **MP** becomes **Élan** (mapping §5): the per-unit resource actions
 * cost (`AbilityDef.mpCost`, `src/data/schema.ts`). On top of that the retheme
 * makes it double as **morale** (decision D4): a soldier whose Élan runs low
 * loses their nerve, and at zero they are **Routed**. This module is the pure,
 * deterministic state machine for both halves of that rule.
 *
 * ```text
 *   spendElan(unit, cost, tick)          // actions pay their cost
 *        │  clamps at 0, emits mpChanged("spent")
 *        ▼
 *   regenerateElan(unit, tick, schedule) // end-of-turn recovery
 *        │  only on schedule ticks, clamps at stats.mp
 *        │  emits mpChanged("regenerated")
 *        ▼
 *   applyMorale(unit, tick)              // pool → condition
 *        │  mp ≤ floor(max × SHAKEN_ELAN_RATIO) → Shaken
 *        │  mp === 0                            → Routed (outranks Shaken)
 *        │  recovered                           → both cured
 *        ▼
 *   settleElan(unit, tick)               // regen + morale in one call
 * ```
 *
 * The two morale conditions are authored like every other condition
 * (`src/data/conditions.ts`): **Shaken** is a debuff (`hitModifier`, small
 * attack/resistance penalties) and **Routed** a special state that bars action
 * abilities. Because they go through the condition engine (T039), their
 * modifiers, stacking and expiry work exactly like the FFTA statuses.
 *
 * ## Contract (`agents.md` §2, §7, §9)
 *
 * - **Pure & deterministic** — no DOM, no I/O, no `Math.random`, no `Date`.
 *   Time is the integer Orders Tempo tick; the same unit and tick always yield
 *   a byte-identical unit and event list.
 * - **State in, state out** — inputs are never mutated; every helper returns a
 *   new unit plus the ordered {@link BattleEvent}s describing the change.
 * - **Data-driven** — the regeneration amount, interval and morale threshold
 *   live here as named constants ({@link ElanRegenSchedule},
 *   {@link SHAKEN_ELAN_RATIO}) rather than being buried in logic, per the
 *   "all tunables in data" rule. Phase 13 owns the final balance pass.
 * - **Integer in, integer out** — malformed costs, amounts and ticks are
 *   rejected at the boundary rather than silently rounded.
 *
 * Reference: `docs/wiki/pages/MP_(stat).md` (whose FFTA section is a stub, so
 * the schedule below is authored balance data, noted as such) and
 * `docs/NAPOLEONIC_MAPPING.md` §5 / D4.
 */

import { applyCondition, cureCondition, hasActiveCondition } from "./conditions";
import type { BattleEvent } from "../events";
import { asConditionId, type ConditionId } from "../ids";
import { withMp, type Unit } from "../unit";

/* --------------------------------------------------------------------------
 * Morale conditions (T040)
 * ------------------------------------------------------------------------ */

/**
 * The condition applied while a soldier's Élan is at or below the **Shaken**
 * threshold. Exposed so the battle layer, the UI and tests share one key.
 */
export const SHAKEN_CONDITION: ConditionId = asConditionId("shaken");

/**
 * The condition applied when a soldier's Élan hits zero. It outranks
 * {@link SHAKEN_CONDITION}: a routed soldier is never also merely shaken.
 */
export const ROUTED_CONDITION: ConditionId = asConditionId("routed");

/* --------------------------------------------------------------------------
 * Tunables (Phase 13 owns the final balance pass)
 * ------------------------------------------------------------------------ */

/**
 * Élan restored each regeneration step. Authored balance data: the scraped
 * `MP_(stat)` page does not document FFTA's regeneration rule, so this is our
 * own value, kept deliberately small so Élan is a real constraint.
 */
export const ELAN_REGEN_AMOUNT = 5;

/**
 * Tempo ticks between regeneration steps. Together with
 * {@link ELAN_REGEN_AMOUNT} this is the "tunable schedule" the task calls for:
 * a battle calls {@link regenerateElan} every tick and recovery lands only on
 * the interval.
 */
export const ELAN_REGEN_INTERVAL_TICKS = 10;

/**
 * Fraction of a unit's maximum Élan at or below which it becomes **Shaken**.
 * `0.5` means half the pool. Only whole points count, so a 20-Élan soldier is
 * Shaken at 10 and below.
 */
export const SHAKEN_ELAN_RATIO = 0.5;

/**
 * The regeneration schedule. Passing a schedule (rather than reading the
 * constants directly) keeps the balance numbers swappable in tests and future
 * content without touching this module.
 */
export interface ElanRegenSchedule {
  /** Élan restored per regeneration step (`>= 0`). */
  readonly amount: number;
  /** Ticks between regeneration steps (`>= 1`). */
  readonly intervalTicks: number;
}

/** The default schedule: {@link ELAN_REGEN_AMOUNT} every {@link ELAN_REGEN_INTERVAL_TICKS} ticks. */
export const DEFAULT_ELAN_REGEN_SCHEDULE: ElanRegenSchedule = {
  amount: ELAN_REGEN_AMOUNT,
  intervalTicks: ELAN_REGEN_INTERVAL_TICKS,
};

/* --------------------------------------------------------------------------
 * Morale states
 * ------------------------------------------------------------------------ */

/** The three morale states Élan can produce, from steady to broken. */
export const MORALE_STATES = ["steady", "shaken", "routed"] as const;
export type MoraleState = (typeof MORALE_STATES)[number];

/** Runtime guard for untrusted morale-state strings (UI, saves). */
export function isMoraleState(value: unknown): value is MoraleState {
  return typeof value === "string" && (MORALE_STATES as readonly string[]).includes(value);
}

/**
 * The Élan value at or below which `unit` is **Shaken**: `floor(max × ratio)`.
 * A unit with no Élan pool is never shaken (see {@link moraleStateOf}).
 */
export function shakenThreshold(unit: Unit): number {
  return Math.floor(unit.stats.mp * SHAKEN_ELAN_RATIO);
}

/**
 * Derive a soldier's morale from its current Élan.
 *
 * - a unit with **no Élan pool** (`stats.mp === 0`) is always `"steady"` — a
 *   soldier who never had morale points cannot lose them;
 * - `mp === 0` → `"routed"`;
 * - `mp <= shakenThreshold(unit)` → `"shaken"`;
 * - otherwise `"steady"`.
 *
 * Morale is a *read* of the pool, never stored on the unit: `applyMorale`
 * turns it into the matching condition, so the two can never drift apart.
 */
export function moraleStateOf(unit: Unit): MoraleState {
  if (unit.stats.mp <= 0) return "steady";
  if (unit.mp <= 0) return "routed";
  if (unit.mp <= shakenThreshold(unit)) return "shaken";
  return "steady";
}

/** Whether the soldier's current Élan leaves them **Shaken**. */
export function isShaken(unit: Unit): boolean {
  return moraleStateOf(unit) === "shaken";
}

/** Whether the soldier's current Élan has broken and left them **Routed**. */
export function isRouted(unit: Unit): boolean {
  return moraleStateOf(unit) === "routed";
}

/* --------------------------------------------------------------------------
 * Result shapes
 * ------------------------------------------------------------------------ */

/** The result of one resource change (spend or regenerate). */
export interface ElanChangeResult {
  readonly unit: Unit;
  /** The amount actually removed/restored (`>= 0`), after clamping. */
  readonly amount: number;
  readonly events: readonly BattleEvent[];
}

/** The result of settling morale: the conditions added and removed. */
export interface MoraleResult {
  readonly unit: Unit;
  /** The morale state the Élan pool maps to after settling. */
  readonly state: MoraleState;
  /** Condition ids newly applied, in order. */
  readonly applied: readonly ConditionId[];
  /** Condition ids removed, in order. */
  readonly removed: readonly ConditionId[];
  readonly events: readonly BattleEvent[];
}

/** The result of a full end-of-turn Élan step. */
export interface ElanSettleResult {
  readonly unit: Unit;
  /** Élan restored by regeneration (`>= 0`). */
  readonly regenerated: number;
  /** The morale state after regeneration. */
  readonly morale: MoraleState;
  readonly events: readonly BattleEvent[];
}

/* --------------------------------------------------------------------------
 * Spending
 * ------------------------------------------------------------------------ */

/**
 * Pay `cost` Élan for an action, clamping at zero and reporting what was
 * actually spent. Emits `mpChanged` with reason `"spent"` when any Élan left
 * the pool; a zero cost (or an already-empty pool) is a no-op returning the
 * same unit and no events.
 *
 * Command validation (`battle.ts`) refuses an action the actor cannot afford,
 * so an over-spend here only occurs for non-action drains; clamping keeps the
 * pool inside `[0, stats.mp]` regardless.
 *
 * ```ts
 * const { unit, amount, events } = spendElan(actor, spec.mpCost, battle.tempo.tick);
 * ```
 */
export function spendElan(unit: Unit, cost: number, tick = 0): ElanChangeResult {
  assertAmount(cost, "elan.cost");
  assertTick(tick);

  const spent = Math.min(cost, unit.mp);
  if (spent <= 0) return { unit, amount: 0, events: [] };

  const updated = withMp(unit, unit.mp - spent);
  return {
    unit: updated,
    amount: spent,
    events: [
      {
        kind: "mpChanged",
        tick,
        unitId: unit.id,
        delta: -spent,
        mpAfter: updated.mp,
        reason: "spent",
      },
    ],
  };
}

/* --------------------------------------------------------------------------
 * Regeneration
 * ------------------------------------------------------------------------ */

/**
 * Whether `tick` falls on the schedule's regeneration step. Tick `0` never
 * regenerates, so a battle's opening state is stable.
 */
export function isRegenTick(
  tick: number,
  schedule: ElanRegenSchedule = DEFAULT_ELAN_REGEN_SCHEDULE,
): boolean {
  assertSchedule(schedule);
  return Number.isInteger(tick) && tick > 0 && tick % schedule.intervalTicks === 0;
}

/**
 * Restore Élan on the schedule, clamped to `stats.mp`. Emits `mpChanged` with
 * reason `"regenerated"` only when points are actually restored: an off-cycle
 * tick, a full pool or a zero-amount schedule is a no-op that returns the same
 * unit.
 *
 * ```ts
 * const { unit, events } = regenerateElan(actor, battle.tempo.tick);
 * ```
 */
export function regenerateElan(
  unit: Unit,
  tick = 0,
  schedule: ElanRegenSchedule = DEFAULT_ELAN_REGEN_SCHEDULE,
): ElanChangeResult {
  assertTick(tick);
  assertSchedule(schedule);
  if (!isRegenTick(tick, schedule)) return { unit, amount: 0, events: [] };

  const room = unit.stats.mp - unit.mp;
  const gained = Math.min(schedule.amount, room);
  if (gained <= 0) return { unit, amount: 0, events: [] };

  const updated = withMp(unit, unit.mp + gained);
  return {
    unit: updated,
    amount: gained,
    events: [
      {
        kind: "mpChanged",
        tick,
        unitId: unit.id,
        delta: gained,
        mpAfter: updated.mp,
        reason: "regenerated",
      },
    ],
  };
}

/* --------------------------------------------------------------------------
 * Morale conditions
 * ------------------------------------------------------------------------ */

/**
 * Reconcile a soldier's morale conditions with its current Élan:
 *
 * - **Routed** when the pool is empty — Shaken is cured first and Routed
 *   applied, so the states are mutually exclusive;
 * - **Shaken** when the pool is at or below the threshold — Routed is cured
 *   and Shaken applied;
 * - **Steady** otherwise — both conditions are cured.
 *
 * Conditions already in the correct state are left untouched (and emit
 * nothing), so calling this every turn is idempotent. The input unit is never
 * mutated.
 *
 * ```ts
 * const { unit, state, events } = applyMorale(actor, battle.tempo.tick);
 * ```
 */
export function applyMorale(unit: Unit, tick = 0): MoraleResult {
  assertTick(tick);
  const state = moraleStateOf(unit);
  let current = unit;
  const applied: ConditionId[] = [];
  const removed: ConditionId[] = [];
  const events: BattleEvent[] = [];

  const apply = (id: ConditionId): void => {
    if (hasActiveCondition(current, id)) return;
    const result = applyCondition(current, id, { tick });
    current = result.unit;
    applied.push(id);
    events.push(...result.events);
  };

  const cure = (id: ConditionId): void => {
    if (!hasActiveCondition(current, id)) return;
    const result = cureCondition(current, id, { tick, reason: "cured" });
    current = result.unit;
    removed.push(id);
    events.push(...result.events);
  };

  switch (state) {
    case "routed":
      cure(SHAKEN_CONDITION);
      apply(ROUTED_CONDITION);
      break;
    case "shaken":
      cure(ROUTED_CONDITION);
      apply(SHAKEN_CONDITION);
      break;
    case "steady":
      cure(ROUTED_CONDITION);
      cure(SHAKEN_CONDITION);
      break;
  }

  return { unit: current, state, applied, removed, events };
}

/* --------------------------------------------------------------------------
 * End-of-turn convenience
 * ------------------------------------------------------------------------ */

/**
 * The full end-of-turn Élan step: regenerate on the schedule, then reconcile
 * morale against the new pool. Events are ordered regeneration first, morale
 * second, so a UI bar fills before the Shaken/Routed popup appears.
 */
export function settleElan(
  unit: Unit,
  tick = 0,
  schedule: ElanRegenSchedule = DEFAULT_ELAN_REGEN_SCHEDULE,
): ElanSettleResult {
  const regen = regenerateElan(unit, tick, schedule);
  const morale = applyMorale(regen.unit, tick);
  return {
    unit: morale.unit,
    regenerated: regen.amount,
    morale: morale.state,
    events: [...regen.events, ...morale.events],
  };
}

/* --------------------------------------------------------------------------
 * Validation helpers
 * ------------------------------------------------------------------------ */

function assertTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new RangeError(`elan.tick must be a non-negative integer, received ${String(tick)}`);
  }
}

function assertAmount(amount: number, label: string): void {
  if (!Number.isInteger(amount) || amount < 0) {
    throw new RangeError(`${label} must be a non-negative integer, received ${String(amount)}`);
  }
}

function assertSchedule(schedule: ElanRegenSchedule): void {
  assertAmount(schedule.amount, "elan.schedule.amount");
  if (!Number.isInteger(schedule.intervalTicks) || schedule.intervalTicks < 1) {
    throw new RangeError(
      `elan.schedule.intervalTicks must be a positive integer, received ${String(schedule.intervalTicks)}`,
    );
  }
}
