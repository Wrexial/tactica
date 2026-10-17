/**
 * Condition (status) engine (T039) — apply, stack, tick, expire and read the
 * FFTA statuses the retheme calls **conditions** (mapping §8).
 *
 * A condition is a timed effect on a {@link Unit}: **Bleeding** drains hit
 * points, **Dazed** spoils the aim, **Pinned** nails a soldier in place,
 * **Formed** and **Braced** harden them against Steel and Powder, **Mortally
 * Wounded** counts down to a knockout, and so on. The authored definitions and
 * their numbers live in `src/data/conditions.ts`; this module is the pure,
 * deterministic state machine that turns those definitions into unit changes
 * and {@link BattleEvent}s.
 *
 * ## The lifecycle
 *
 * ```text
 *   applyCondition(unit, id, { duration, sourceId, tick })
 *        │  resolve definition → Adjutant's Orders shield → cancel rivals
 *        │  → stack/refresh → conditionApplied
 *        ▼
 *   tickConditions(unit, tick)          (once per Orders Tempo turn)
 *        │  Bleeding → damaged     Steadied → healed
 *        │  Mortally Wounded → countdown → outOfAction
 *        │  finite duration − 1 → conditionRemoved("expired") at zero
 *        ▼
 *   cureCondition / removeConditionsOnHit   (Esuna, waking on a hit, ...)
 * ```
 *
 * Everything funnels through the unit's `conditions` list
 * ({@link ActiveCondition}, T017) so a save, a replay and the UI all see the
 * same plain-data shape. At most one instance per condition is kept: applying
 * an active condition **refreshes** it instead of stacking a second copy.
 *
 * ## Ids and aliases
 *
 * The canonical key of every condition is FFTA-shaped (`poison`, `shell`,
 * `immobilize`) so the reference mirror maps 1:1 (`src/data/README.md`). The
 * engine also accepts the condition's **Napoleonic name** as an alias
 * (`bleeding`, `braced`, `pinned`), derived deterministically from its display
 * name. That keeps the older `Hold` order — which spells its stance `braced` —
 * and hand-authored content working, while the canonical key is what gets
 * stored, queried and serialised.
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Pure & deterministic** — no DOM, no I/O, no `Math.random`, no `Date`.
 *   Time is the integer Orders Tempo tick. The same unit, condition and tick
 *   always yield a byte-identical unit and event list.
 * - **State in, state out** — the input unit is never mutated; every helper
 *   returns a new unit and the ordered events describing what happened.
 * - **Data-driven** — no condition id is special-cased. Durations, tick
 *   amounts, gates and stat modifiers all arrive from the parsed
 *   {@link ConditionDef}; this module only knows the *shape* of a condition.
 * - **Integer in, integer out** — malformed durations and modifier values are
 *   rejected at the boundary rather than silently rounded.
 *
 * Reference: `docs/wiki/pages/Final_Fantasy_Tactics_Advance_statuses.md` (the
 * FFTA status list) and mapping §8 (the Napoleonic re-skin).
 */

import {
  CONDITION_KEYS,
  CONDITIONS,
  getCondition as getConditionDef,
  isConditionKey,
  type ConditionKey,
} from "../../data/conditions";
import type { ConditionDef, StatMods } from "../../data/schema";
import type { BattleEvent, ConditionRemovalReason } from "../events";
import { assertId, asConditionId, type ConditionId, type UnitId } from "../ids";
import { STAT_KEYS, zeroStatMods } from "../stats";
import { addCondition, removeCondition, withHp, type ActiveCondition, type Unit } from "../unit";

/* --------------------------------------------------------------------------
 * Ids and aliases
 * ------------------------------------------------------------------------ */

/**
 * The canonical id of **Adjutant's Orders** (FFTA "Astra"), the one-time shield
 * that absorbs the next hostile condition. Exposed so content and tests share
 * one key.
 */
export const ADJUTANTS_ORDERS: ConditionId = asConditionId("astra");

/**
 * Normalise a condition's display name into its addressable alias:
 * `"Adjutant's Orders"` → `"adjutants-orders"`, `"Double-Quick"` →
 * `"double-quick"`. Pure and deterministic, so aliases need no authored table.
 */
export function conditionAlias(displayName: string): string {
  return displayName
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Alias → canonical key, computed once from the authored names. */
const CONDITION_ALIASES: ReadonlyMap<string, ConditionKey> = new Map(
  CONDITION_KEYS.map((id) => [conditionAlias(CONDITIONS[id].name), id]),
);

/**
 * Resolve any accepted condition address — the canonical FFTA key or the
 * Napoleonic alias — to the canonical {@link ConditionKey}. Throws a
 * `RangeError` for an unknown condition, so bad content fails at the boundary.
 *
 * ```ts
 * resolveConditionKey(asConditionId("poison"));   // "poison"
 * resolveConditionKey(asConditionId("bleeding")); // "poison"
 * resolveConditionKey(asConditionId("braced"));   // "shell"
 * ```
 */
export function resolveConditionKey(id: ConditionId | string): ConditionKey {
  if (isConditionKey(id)) return id;
  const alias = CONDITION_ALIASES.get(id);
  if (alias !== undefined) return alias;
  throw new RangeError(`unknown condition: ${String(id)}`);
}

/** Like {@link resolveConditionKey}, but returns `undefined` for an unknown id. */
export function tryResolveConditionKey(id: ConditionId | string): ConditionKey | undefined {
  if (isConditionKey(id)) return id;
  return CONDITION_ALIASES.get(id);
}

/** The authored definition for a condition, by canonical key or alias. */
export function conditionDefOf(id: ConditionId | string): ConditionDef {
  return getConditionDef(resolveConditionKey(id));
}

/* --------------------------------------------------------------------------
 * Reading active conditions
 * ------------------------------------------------------------------------ */

/** A unit's active definitions, skipping any id the content layer no longer knows. */
function activeDefs(unit: Unit): readonly ConditionDef[] {
  const defs: ConditionDef[] = [];
  for (const active of unit.conditions) {
    const key = tryResolveConditionKey(active.conditionId);
    if (key !== undefined) defs.push(CONDITIONS[key]);
  }
  return defs;
}

/**
 * The index of the active instance matching `key`, whether it was stored under
 * the canonical id or its Napoleonic alias. `-1` when the unit does not carry it.
 */
function activeConditionIndex(unit: Unit, key: ConditionKey): number {
  const alias = conditionAlias(CONDITIONS[key].name);
  return unit.conditions.findIndex(
    (active) => active.conditionId === key || active.conditionId === alias,
  );
}

/** Whether the unit currently carries the condition (canonical key or alias). */
export function hasActiveCondition(unit: Unit, id: ConditionId | string): boolean {
  return activeConditionIndex(unit, resolveConditionKey(id)) !== -1;
}

/**
 * The canonical keys of every condition on the unit, in list order. Unknown ids
 * are skipped so a forward-compatible save never crashes a query.
 */
export function activeConditionKeys(unit: Unit): readonly ConditionKey[] {
  const keys: ConditionKey[] = [];
  for (const active of unit.conditions) {
    const key = tryResolveConditionKey(active.conditionId);
    if (key !== undefined) keys.push(key);
  }
  return keys;
}

/* --------------------------------------------------------------------------
 * Applying conditions
 * ------------------------------------------------------------------------ */

/** Options shared by every application of a condition. */
export interface ApplyConditionOptions {
  /** Duration in tempo ticks; defaults to the definition's own. `0` = indefinite. */
  readonly duration?: number;
  /** Who applied it (kill credit / cure attribution). */
  readonly sourceId?: UnitId;
  /** Orders Tempo tick the application happened on. Defaults to `0`. */
  readonly tick?: number;
}

/** The result of applying one condition. */
export interface ConditionApplyResult {
  readonly unit: Unit;
  /** `false` when Adjutant's Orders absorbed the condition. */
  readonly applied: boolean;
  readonly events: readonly BattleEvent[];
}

/** The result of applying several conditions in order. */
export interface ConditionApplyManyResult {
  readonly unit: Unit;
  /** The canonical ids that actually took hold, in application order. */
  readonly applied: readonly ConditionId[];
  readonly events: readonly BattleEvent[];
}

/** A generic "new unit plus the events it produced" result. */
export interface ConditionChangeResult {
  readonly unit: Unit;
  readonly events: readonly BattleEvent[];
}

/** Whether a condition is hostile (blocked by Adjutant's Orders). */
function isHostile(def: ConditionDef): boolean {
  return def.kind === "ailment" || def.kind === "debuff";
}

/**
 * Merge an existing condition's remaining duration with a fresh application:
 * any **indefinite** span (`0`) wins, otherwise the longer span is kept. This is
 * the stacking rule — one instance per condition, refreshed rather than added.
 */
function mergeDuration(previous: number, incoming: number): number {
  if (previous === 0 || incoming === 0) return 0;
  return Math.max(previous, incoming);
}

/** Replace the duration of the active instance of `key`, if any. */
function replaceDuration(unit: Unit, key: ConditionKey, duration: number): Unit {
  const index = activeConditionIndex(unit, key);
  if (index === -1) return unit;
  const conditions = unit.conditions.slice();
  conditions[index] = { ...conditions[index], duration };
  return { ...unit, conditions };
}

/** Remove the active instance of `key` (canonical or alias); a no-op when absent. */
function removeActiveCondition(unit: Unit, key: ConditionKey): Unit {
  const index = activeConditionIndex(unit, key);
  if (index === -1) return unit;
  return removeCondition(unit, unit.conditions[index].conditionId);
}

/**
 * Apply a condition to a soldier and report what happened.
 *
 * The rules, in order:
 * 1. **Adjutant's Orders** — a hostile (ailment/debuff) condition is absorbed
 *    and the shield is consumed, emitting `conditionRemoved`.
 * 2. **Cancels** — each condition named by the definition's `cancels` (Haste ↔
 *    Slow, the stat up/down pairs) is removed and reported as `replaced`.
 * 3. **Stacking** — if the soldier already carries it, the span is refreshed
 *    (indefinite wins, otherwise the longer); the instance is never duplicated.
 * 4. **Application** — the canonical key is stored and `conditionApplied` is
 *    emitted.
 *
 * ```ts
 * const { unit, events } = applyCondition(soldier, asConditionId("poison"), {
 *   duration: 4,
 *   sourceId: enemyId,
 *   tick: 12,
 * });
 * ```
 *
 * The input unit is never mutated. Throws a `RangeError` for an unknown
 * condition, a malformed duration or a malformed source id.
 */
export function applyCondition(
  unit: Unit,
  id: ConditionId | string,
  options: ApplyConditionOptions = {},
): ConditionApplyResult {
  const key = resolveConditionKey(id);
  const def = CONDITIONS[key];
  const tick = options.tick ?? 0;
  const duration = options.duration ?? def.duration;

  assertTick(tick);
  assertDuration(duration, "condition.duration");
  if (options.sourceId !== undefined) assertId(options.sourceId, "condition.sourceId");

  const events: BattleEvent[] = [];
  let current = unit;

  // 1. Adjutant's Orders shields against one hostile condition.
  if (isHostile(def) && activeConditionIndex(current, "astra") !== -1) {
    current = removeActiveCondition(current, "astra");
    events.push({
      kind: "conditionRemoved",
      tick,
      unitId: unit.id,
      conditionId: ADJUTANTS_ORDERS,
      reason: "cured",
    });
    return { unit: current, applied: false, events };
  }

  // 2. Cancel the conditions this one replaces.
  for (const cancelId of def.cancels) {
    const cancelKey = resolveConditionKey(cancelId);
    const index = activeConditionIndex(current, cancelKey);
    if (index === -1) continue;
    const removedId = current.conditions[index].conditionId;
    current = removeActiveCondition(current, cancelKey);
    events.push({
      kind: "conditionRemoved",
      tick,
      unitId: unit.id,
      conditionId: removedId,
      reason: "replaced",
    });
  }

  // 3. Stack/refresh: one instance, indefinite wins, otherwise the longer span.
  const existingIndex = activeConditionIndex(current, key);
  let mergedDuration = duration;
  if (existingIndex !== -1) {
    mergedDuration = mergeDuration(current.conditions[existingIndex].duration, duration);
    current = removeActiveCondition(current, key);
  }

  const active: ActiveCondition = {
    conditionId: asConditionId(key),
    duration: mergedDuration,
    ...(options.sourceId === undefined ? {} : { sourceId: options.sourceId }),
  };
  current = addCondition(current, active);
  events.push({
    kind: "conditionApplied",
    tick,
    unitId: unit.id,
    conditionId: active.conditionId,
    duration: mergedDuration,
    ...(options.sourceId === undefined ? {} : { sourceId: options.sourceId }),
  });

  return { unit: current, applied: true, events };
}

/**
 * Apply several conditions in order (an ability's `inflicts` list). Each goes
 * through {@link applyCondition}, so shields, cancels and stacking all apply.
 */
export function applyConditions(
  unit: Unit,
  ids: readonly (ConditionId | string)[],
  options: ApplyConditionOptions = {},
): ConditionApplyManyResult {
  let current = unit;
  const applied: ConditionId[] = [];
  const events: BattleEvent[] = [];
  for (const id of ids) {
    const result = applyCondition(current, id, options);
    current = result.unit;
    events.push(...result.events);
    if (result.applied) applied.push(asConditionId(resolveConditionKey(id)));
  }
  return { unit: current, applied, events };
}

/* --------------------------------------------------------------------------
 * Curing and waking
 * ------------------------------------------------------------------------ */

/** Options for curing a condition. */
export interface CureConditionOptions {
  /** Orders Tempo tick the cure happened on. Defaults to `0`. */
  readonly tick?: number;
  /** Why it left; defaults to `"cured"`. */
  readonly reason?: ConditionRemovalReason;
}

/** The result of a cure: whether it removed anything, plus the events. */
export interface CureConditionResult extends ConditionChangeResult {
  readonly cured: boolean;
}

/**
 * Remove an active condition (a Surgeon's cleanse, an antidote, a waking hit)
 * and report it. A no-op that returns the same unit when it is not present.
 *
 * ```ts
 * const cured = cureCondition(soldier, asConditionId("poison"), { tick: 8 });
 * ```
 */
export function cureCondition(
  unit: Unit,
  id: ConditionId | string,
  options: CureConditionOptions = {},
): CureConditionResult {
  const key = resolveConditionKey(id);
  const tick = options.tick ?? 0;
  assertTick(tick);
  const index = activeConditionIndex(unit, key);
  if (index === -1) return { unit, cured: false, events: [] };

  const removed = unit.conditions[index].conditionId;
  const updated = removeActiveCondition(unit, key);
  return {
    unit: updated,
    cured: true,
    events: [
      {
        kind: "conditionRemoved",
        tick,
        unitId: unit.id,
        conditionId: removed,
        reason: options.reason ?? "cured",
      },
    ],
  };
}

/** The result of waking conditions after a hit. */
export interface WakeResult extends ConditionChangeResult {
  /** The canonical keys that were removed, in list order. */
  readonly removed: readonly ConditionId[];
}

/**
 * Remove every condition flagged `removedOnHit` (Sleep → **Unconscious**),
 * which is how a waking hit resolves. Conditions without the flag (Braced,
 * Bleeding, ...) survive the blow.
 */
export function removeConditionsOnHit(unit: Unit, tick = 0): WakeResult {
  assertTick(tick);
  let current = unit;
  const removed: ConditionId[] = [];
  const events: BattleEvent[] = [];

  for (const active of unit.conditions.slice()) {
    const key = tryResolveConditionKey(active.conditionId);
    if (key === undefined || !CONDITIONS[key].removedOnHit) continue;
    current = removeCondition(current, active.conditionId);
    removed.push(active.conditionId);
    events.push({
      kind: "conditionRemoved",
      tick,
      unitId: unit.id,
      conditionId: active.conditionId,
      reason: "removed",
    });
  }
  return { unit: current, removed, events };
}

/* --------------------------------------------------------------------------
 * Ticking
 * ------------------------------------------------------------------------ */

/** The result of one Orders Tempo tick over a soldier's conditions. */
export type ConditionTickResult = ConditionChangeResult;

/**
 * Advance every condition on a soldier by one Orders Tempo tick:
 *
 * - **tick effects** — `tickDamage` (Bleeding) deals damage, `tickHealing`
 *   (Steadied, Bivouacked) restores hit points, and `countdown` (Mortally
 *   Wounded) runs down to a knockout;
 * - **expiry** — a finite `duration` loses one tick each pass and is removed
 *   with `conditionRemoved("expired")` at zero; an indefinite span (`0`) stays
 *   until cured.
 *
 * Tick effects are emitted as `damaged` / `healed` with `damageType: "none"`
 * (`DAMAGE_TYPES`, events.ts) because condition damage is neither Steel nor
 * Powder. A knockout emits `outOfAction` after the fatal `damaged`. A soldier
 * already out of action ticks nothing.
 *
 * ```ts
 * const { unit, events } = tickConditions(soldier, battle.tempo.tick);
 * ```
 */
export function tickConditions(unit: Unit, tick = 0): ConditionTickResult {
  assertTick(tick);
  if (unit.hp <= 0) return { unit, events: [] };

  let current = unit;
  const events: BattleEvent[] = [];
  const snapshot = unit.conditions.slice();

  for (const active of snapshot) {
    const key = tryResolveConditionKey(active.conditionId);
    if (key === undefined) continue;
    const def = CONDITIONS[key];

    if (def.countdown) {
      const remaining = active.duration - 1;
      if (remaining <= 0) {
        const before = current.hp;
        current = withHp(current, 0);
        events.push({
          kind: "damaged",
          tick,
          unitId: unit.id,
          amount: before,
          hpAfter: 0,
          damageType: "none",
          critical: false,
          fatal: true,
        });
        events.push({ kind: "outOfAction", tick, unitId: unit.id });
        current = removeActiveCondition(current, key);
        events.push({
          kind: "conditionRemoved",
          tick,
          unitId: unit.id,
          conditionId: active.conditionId,
          reason: "expired",
        });
        break;
      }
      current = replaceDuration(current, key, remaining);
      continue;
    }

    if (def.ticks && def.tickDamage > 0) {
      const before = current.hp;
      const after = Math.max(0, before - def.tickDamage);
      if (after !== before) {
        current = withHp(current, after);
        events.push({
          kind: "damaged",
          tick,
          unitId: unit.id,
          amount: before - after,
          hpAfter: after,
          damageType: "none",
          critical: false,
          fatal: after <= 0,
        });
        if (after <= 0) {
          events.push({ kind: "outOfAction", tick, unitId: unit.id });
        }
      }
    }

    if (def.ticks && def.tickHealing > 0 && current.hp > 0) {
      const before = current.hp;
      const after = Math.min(current.stats.hp, before + def.tickHealing);
      if (after !== before) {
        current = withHp(current, after);
        events.push({
          kind: "healed",
          tick,
          unitId: unit.id,
          amount: after - before,
          hpAfter: after,
        });
      }
    }

    if (current.hp <= 0) break;

    // A finite duration loses one tick; at zero the condition expires.
    if (active.duration > 0) {
      const remaining = active.duration - 1;
      if (remaining === 0) {
        current = removeActiveCondition(current, key);
        events.push({
          kind: "conditionRemoved",
          tick,
          unitId: unit.id,
          conditionId: active.conditionId,
          reason: "expired",
        });
      } else {
        current = replaceDuration(current, key, remaining);
      }
    }
  }

  return { unit: current, events };
}

/* --------------------------------------------------------------------------
 * Queries — what the rest of the engine asks of a soldier's conditions
 * ------------------------------------------------------------------------ */

/**
 * The summed effective-stat modifiers of every active condition. The stat
 * layer (T018 / T041) adds this on top of the derived block: **Formed** raises
 * Weapon Def, **Braced** raises Magic Resistance, **Rallied** raises Weapon
 * Attack, and the stat up/down conditions move their stat by ±20.
 */
export function conditionStatMods(unit: Unit): StatMods {
  const total = zeroStatMods();
  for (const def of activeDefs(unit)) {
    for (const key of STAT_KEYS) {
      total[key] += def.statMods[key];
    }
  }
  return total;
}

/** The summed to-hit modifier of active conditions (**Dazed** is `-30`). */
export function conditionHitModifier(unit: Unit): number {
  let total = 0;
  for (const def of activeDefs(unit)) total += def.hitModifier;
  return total;
}

/** The summed critical-hit modifier of active conditions (**Counsel** is `+20`). */
export function conditionCritModifier(unit: Unit): number {
  let total = 0;
  for (const def of activeDefs(unit)) total += def.critModifier;
  return total;
}

/** Whether an active condition pins the soldier in place (**Pinned**). */
export function isMoveBlocked(unit: Unit): boolean {
  return activeDefs(unit).some((def) => def.blocksMove);
}

/** Whether an active condition stops every order (**Stunned**, **Unconscious**). */
export function isActBlocked(unit: Unit): boolean {
  return activeDefs(unit).some((def) => def.blocksAct);
}

/**
 * Whether an active condition bars action abilities. True for the ability-only
 * conditions (**Deafened**, **Disarmed**, **Bewildered**) and for anything that
 * stops the turn outright (`blocksAct`).
 */
export function isAbilityBlocked(unit: Unit): boolean {
  return activeDefs(unit).some((def) => def.blocksAbilities || def.blocksAct);
}

/** Whether the soldier may change tile this turn (not Pinned, not stopped). */
export function canMove(unit: Unit): boolean {
  return !isMoveBlocked(unit) && !isActBlocked(unit);
}

/** Whether the soldier may take a turn at all (not Stunned/Unconscious/Broken). */
export function canAct(unit: Unit): boolean {
  return !isActBlocked(unit);
}

/** Whether the soldier may use action abilities (not Deafened/Disarmed/Lamed). */
export function canUseAbilities(unit: Unit): boolean {
  return !isAbilityBlocked(unit);
}

/* --------------------------------------------------------------------------
 * Validation helpers
 * ------------------------------------------------------------------------ */

function assertTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new RangeError(`condition.tick must be a non-negative integer, received ${String(tick)}`);
  }
}

function assertDuration(duration: number, label: string): void {
  if (!Number.isInteger(duration) || duration < 0) {
    throw new RangeError(`${label} must be a non-negative integer, received ${String(duration)}`);
  }
}
