/**
 * Action executor (T041) — the **effect dispatcher** that turns a declared,
 * data-defined action into battlefield consequences.
 *
 * The resolution pipeline (`./resolve.ts`, T024) already owns the *lifecycle*
 * of an action: when a soldier receives an `act` command it is **declared**
 * (`abilityUsed`), pays its **Élan** cost, optionally **charges** for some
 * Orders Tempo ticks, and finally **resolves** (`abilityResolved`). What it
 * deliberately did *not* do was decide what "resolving" meant — that is this
 * module's job. Given the battle, the acting {@link Unit}, an authored
 * {@link AbilitySpec} and the chosen {@link Target}, {@link executeAbility}
 * resolves targeting (T028), rolls to hit where a blow can miss (T037), then
 * applies every authored effect in order and reports the ordered
 * {@link BattleEvent}s.
 *
 * ## The effect vocabulary
 *
 * An action is a list of {@link AbilityEffect}s, not a hard-coded branch. Each
 * affected target receives the whole list, in authored order. The union covers
 * the FFTA action families the retheme keeps (mapping §6, §12), each with its
 * mundane Napoleonic cause (D9: no literal magic):
 *
 * | Effect kind | Fiction (mapping)                           | Formula |
 * | ----------- | ------------------------------------------- | ------- |
 * | `steel`     | sabre, bayonet, musket ball                 | Steel (T033) |
 * | `powder`    | artillery, incendiaries, signals            | Powder (T034) |
 * | `weapon`    | a specific weapon family (rifle, lance, …)  | weapon variant (T035, `src/data/weapons.ts`) |
 * | `heal`      | medicine, bandages, a dressing station      | Medicine (T036) |
 * | `drain`     | plunder, capture, cutting off supplies      | Powder + transfer |
 * | `revive`    | bringing a casualty back to the line        | Medicine (T036) |
 * | `condition` | **buff** on an ally / **debuff** on a foe   | condition engine (T039) |
 * | `cleanse`   | an antidote, a surgeon's knife, orders      | condition engine (T039) |
 *
 * A single action can combine several: a canister round deals `powder` damage
 * *and* inflicts **Pinned**; a charge deals `steel` and applies **Shaken**.
 * Conditions attached to a damaging effect ride its `inflicts`/`cleanses`
 * lists, so on-hit status never needs its own effect.
 *
 * ## Targeting and the hit roll
 *
 * {@link executeAbility} resolves the command's `Target` through
 * {@link resolveTargeting} (T028): affiliation, range, line of sight and the
 * area footprint all come from the authored data (`target`, `range`,
 * `aoeShape`, `aoeSize`). A **ground** action (`target: "tile"`) affects
 * everyone standing in its footprint, friend and foe alike (FFTA areas do the
 * same); every other rule uses the occupants that satisfy the affiliation
 * filter.
 *
 * A strike against a **hostile** target rolls once per target (not per effect)
 * using the seeded PRNG and the T037 model — accuracy from the action's
 * `hitRate` plus the attacker's **Dazed**-style condition modifier, evasion
 * from the defender, and the front/side/rear facing bonus. A miss emits
 * `missed` and applies nothing. Support on an ally never rolls: a bandage does
 * not miss its patient.
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Pure & deterministic** — no DOM, no I/O, no `Math.random`, no `Date`.
 *   All randomness is drawn from the caller-supplied {@link Rng} (T011); the
 *   same state, ability, target and seed always produce byte-identical events.
 * - **State in, state out** — inputs are never mutated; a new
 *   {@link BattleState} is returned (structural sharing is fine).
 * - **Data-driven** — no ability, post, weapon or condition id is
 *   special-cased. Numbers arrive from the {@link AbilitySpec} and the rules
 *   modules own the arithmetic.
 * - **Integer only** — every combat value stays a whole number, so a replay
 *   never drifts on floating point.
 *
 * Reference: `docs/wiki/pages/Attack_(command).md` (Steel/Powder/weapon
 * variants), `Magic_(command).md` (Powder), `White_Magic_(Tactics_Advance).md`
 * (the Medicine power values). Fiction follows `docs/NAPOLEONIC_MAPPING.md`
 * §6–§8, §12 and decision D9 ("magic" = artillery, medicine, signals, morale).
 */

import type { AbilityTarget, AoeShape, ElementKey } from "../../data/schema";
import type { BattleState } from "../battle";
import type { Target } from "../commands";
import type { BattleEvent, DamageType } from "../events";
import type { AbilityId, ConditionId, UnitId } from "../ids";
import type { Rng } from "../rng";
import type { RangeMetric, RangeProfile, TargetingResolution } from "../targeting";
import { areHostile, resolveTargeting } from "../targeting";
import {
  computeHealing,
  computePowderDamage,
  computeSteelDamage,
  computeWeaponDamage,
  type WeaponFormula,
} from "../rules/damage";
import { applyElementToDamage, type ElementAffinityMap } from "../rules/elements";
import { rollHit } from "../rules/hit";
import {
  activeConditionKeys,
  applyCondition,
  applyConditions,
  conditionHitModifier,
  conditionStatMods,
  cureCondition,
} from "../rules/conditions";
import { withHp, withMp, type Unit } from "../unit";

/* --------------------------------------------------------------------------
 * Authored action data
 * ------------------------------------------------------------------------ */

/**
 * A damaging effect delivered through the **Steel** (physical) channel (T033):
 * blades, bayonets and small-arms fire. `power` is the authored formula term
 * (`AbilityDef.power`), `element` the reflavoured damage type (mapping §7) and
 * `inflicts` / `cleanses` any conditions the blow carries.
 */
export interface SteelEffect {
  readonly kind: "steel";
  /** Ability power term fed to the Steel formula. */
  readonly power: number;
  /** Elemental property of the blow (mapping §7, D5). */
  readonly element?: ElementKey;
  /** Conditions applied on a hit (mapping §8). */
  readonly inflicts?: readonly ConditionId[];
  /** Conditions removed on a hit. */
  readonly cleanses?: readonly ConditionId[];
  /** Override duration for every `inflicts` condition, in tempo ticks. */
  readonly conditionDuration?: number;
}

/**
 * A damaging effect delivered through the **Powder** (magical) channel (T034):
 * artillery, incendiaries and signals. Powder uses the caster's Magic Power
 * against the target's Magic Resistance.
 */
export interface PowderEffect {
  readonly kind: "powder";
  /** Ability power term fed to the Powder formula. */
  readonly power: number;
  /** Elemental property of the shell (mapping §7, D5). */
  readonly element?: ElementKey;
  /** Conditions applied on a hit (mapping §8). */
  readonly inflicts?: readonly ConditionId[];
  /** Conditions removed on a hit. */
  readonly cleanses?: readonly ConditionId[];
  /** Override duration for every `inflicts` condition, in tempo ticks. */
  readonly conditionDuration?: number;
}

/**
 * A damaging effect delivered through a specific **weapon family** formula
 * (T035): a rifle averages `(atk + spd)/2`, a lance uses `atk`, a gun squares
 * its power, and so on. The family coefficients live in `src/data/weapons.ts`;
 * `weaponPower` is the equipped weapon's own power, which the executor cannot
 * read off the unit (the loadout stores ids, not definitions).
 */
export interface WeaponEffect {
  readonly kind: "weapon";
  /** Ability power term fed to the shared Steel kernel. */
  readonly power: number;
  /** The weapon family's authored recipe (`src/data/weapons.ts`). */
  readonly formula: WeaponFormula;
  /** The equipped weapon's Weapon Power term. */
  readonly weaponPower: number;
  /** Elemental property of the blow (mapping §7, D5). */
  readonly element?: ElementKey;
  /** Conditions applied on a hit (mapping §8). */
  readonly inflicts?: readonly ConditionId[];
  /** Conditions removed on a hit. */
  readonly cleanses?: readonly ConditionId[];
  /** Override duration for every `inflicts` condition, in tempo ticks. */
  readonly conditionDuration?: number;
}

/**
 * A **Medicine** effect (T036): hit points restored to an ally. Healing never
 * rolls to hit and has no defence term — nothing opposes a bandage.
 */
export interface HealEffect {
  readonly kind: "heal";
  /** Ability power term fed to the Medicine formula. */
  readonly power: number;
  /** Conditions removed as the dressing is applied. */
  readonly cleanses?: readonly ConditionId[];
}

/**
 * A drain: harm one target and transfer the result to the caster. `hp` drains
 * hit points (healing the caster by what was actually taken); `mp` drains
 * **Élan** (mapping §5), the FFTA Osmose/Drain pair.
 */
export interface DrainEffect {
  readonly kind: "drain";
  /** Which pool is stolen. */
  readonly resource: "hp" | "mp";
  /** Ability power term (hit points) or flat amount (Élan). */
  readonly power: number;
  /** Elemental property of an HP drain, defaulting to Terror (mapping §7). */
  readonly element?: ElementKey;
}

/**
 * A **revival**: bring an out-of-action soldier (FFTA KO, mapping §8) back to
 * the line at a Medicine-derived amount. A no-op on anyone still standing.
 */
export interface ReviveEffect {
  readonly kind: "revive";
  /** Ability power term fed to the Medicine formula. */
  readonly power: number;
}

/**
 * Apply a condition (mapping §8). Aimed at an ally this is a **buff**
 * (Formed, Rallied, Double-Quick); aimed at a foe it is a **debuff** (Bogged,
 * Dazed, Bleeding). The authored `ConditionDef` decides its mechanical shape.
 */
export interface ConditionEffect {
  readonly kind: "condition";
  /** The condition to apply. */
  readonly conditionId: ConditionId;
  /** Override the definition's duration, in tempo ticks (`0` = indefinite). */
  readonly duration?: number;
}

/**
 * Remove a condition. With `conditionId` it is a targeted cleanse (an
 * antidote); without it the effect strips every active condition (a general
 * surgeon's round).
 */
export interface CleanseEffect {
  readonly kind: "cleanse";
  /** The single condition to cure, or `undefined` to cure them all. */
  readonly conditionId?: ConditionId;
}

/**
 * Every effect an action may carry. The union is discriminated on `kind`, so
 * adding a family is a compile error everywhere it must be handled.
 */
export type AbilityEffect =
  | SteelEffect
  | PowderEffect
  | WeaponEffect
  | HealEffect
  | DrainEffect
  | ReviveEffect
  | ConditionEffect
  | CleanseEffect;

/**
 * The executable shape of an authored action. It extends the minimal
 * {@link import("./resolve").ActionSpec} the declare → charge → resolve
 * pipeline needs (`id`, `mpCost`, `chargeTime`, `range`, `power`) with the
 * targeting and effect data the executor reads. Content maps its validated
 * `AbilityDef` (`src/data/schema.ts`) onto this type.
 */
export interface AbilitySpec {
  /** Ability identity, as stored in the battle's action catalogue. */
  readonly id: AbilityId;
  /** Élan paid on declaration; mirrors `AbilityDef.mpCost`. */
  readonly mpCost: number;
  /** Orders Tempo wind-up in ticks; `0` = instant. */
  readonly chargeTime: number;
  /** Maximum reach in tiles. */
  readonly range: number;
  /** Minimum reach; defaults to `1` (or `0` for a self-target action). */
  readonly minRange?: number;
  /** Ability power term; individual effects may override it. */
  readonly power: number;
  /** Who the action may legally include (mapping §6). */
  readonly target: AbilityTarget;
  /** Area footprint; defaults to `"single"`. */
  readonly aoeShape?: AoeShape;
  /** Area radius in tiles; defaults to `0`. */
  readonly aoeSize?: number;
  /** Base accuracy percentage; defaults to `100`. */
  readonly hitRate?: number;
  /** Critical-hit chance percentage; defaults to `0`. */
  readonly critRate?: number;
  /** Distance metric for range; defaults to `"manhattan"` (T028). */
  readonly rangeMetric?: RangeMetric;
  /** Whether high ground extends range downhill; defaults to `false`. */
  readonly elevationBonus?: boolean;
  /** Whether line of sight is required; defaults to `true`. */
  readonly requiresLineOfSight?: boolean;
  /** The effects applied to every affected target, in order. */
  readonly effects: readonly AbilityEffect[];
}

/* --------------------------------------------------------------------------
 * Tunable balance data (Phase 13 owns the final pass)
 * ------------------------------------------------------------------------ */

/**
 * Divisor that turns a soldier's Speed into a defensive evasion term. FFTA has
 * no evasion column in its job tables (`docs/wiki/pages/Final_Fantasy_Tactics_
 * Advance_jobs.md`), so the retheme authors one (`agents.md` §3, §10): a quick
 * skirmisher is harder to hit. Exported so content and tests can retune it.
 */
export const SPEED_EVASION_DIVISOR = 2;

/**
 * The default evasion term for a target: `floor(spd / div)`. Replaced wholesale
 * by {@link AbilityExecutionOptions.evasionOf} when content later adds a real
 * evasion stat or a Trait.
 */
export function evasionOf(unit: Unit): number {
  return Math.max(0, Math.floor(unit.stats.spd / SPEED_EVASION_DIVISOR));
}

/** A neutral affinity map: every element reads as `"neutral"` (T038). */
export function neutralAffinities(): ElementAffinityMap {
  return {};
}

/* --------------------------------------------------------------------------
 * Options and results
 * ------------------------------------------------------------------------ */

/**
 * Injectable hooks for the executor. All are optional; the defaults keep the
 * engine self-contained while letting content supply data the {@link Unit}
 * model does not yet carry (enemy elemental affinities, a dedicated evasion
 * stat).
 */
export interface AbilityExecutionOptions {
  /** The target's per-element defensive affinities (mapping §7, T038). */
  readonly affinitiesOf?: (unit: Unit) => ElementAffinityMap;
  /** The target's evasion term; see {@link evasionOf}. */
  readonly evasionOf?: (unit: Unit) => number;
}

/** The outcome of one {@link executeAbility} call. */
export interface AbilityExecution {
  /**
   * `false` when the aim was illegal (out of range, blocked, wrong
   * affiliation). In that case `state` is the input unchanged and `events` is
   * empty, but `targeting` still carries the geometry for a UI/forecast.
   */
  readonly ok: boolean;
  /** The battle after the effects landed (or the input on rejection). */
  readonly state: BattleState;
  /** Ordered events describing what happened; empty on rejection. */
  readonly events: readonly BattleEvent[];
  /** Full targeting resolution, exposed for the AI and forecast UI (T086). */
  readonly targeting: TargetingResolution<Unit>;
}

/* --------------------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------------------ */

/** Whether an effect is resolved against a hostile target with a hit roll. */
function isOpposedEffect(effect: AbilityEffect): boolean {
  return (
    effect.kind === "steel" ||
    effect.kind === "powder" ||
    effect.kind === "weapon" ||
    effect.kind === "drain" ||
    effect.kind === "condition"
  );
}

/** An effective stat: the base block plus active condition modifiers (T018/T039). */
function effectiveStat(unit: Unit, key: "atk" | "def" | "mag" | "res" | "spd"): number {
  return Math.max(0, unit.stats[key] + conditionStatMods(unit)[key]);
}

/** The Steel/Powder/weapon damage type reported on a `damaged` event. */
function damageTypeOf(effect: SteelEffect | PowderEffect | WeaponEffect): DamageType {
  return effect.kind === "powder" ? "powder" : "steel";
}

/** Build the range profile an action's authored reach describes (T028). */
export function abilityRangeProfile(spec: AbilitySpec): RangeProfile {
  const min = spec.minRange ?? (spec.target === "self" ? 0 : 1);
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

/** Compute the raw (pre-element) damage of a Steel/Powder/weapon effect. */
function computeRawDamage(
  effect: SteelEffect | PowderEffect | WeaponEffect,
  attacker: Unit,
  target: Unit,
): number {
  switch (effect.kind) {
    case "steel":
      return computeSteelDamage({
        weaponAtk: effectiveStat(attacker, "atk"),
        targetWeaponDef: effectiveStat(target, "def"),
        power: effect.power,
      });
    case "powder":
      return computePowderDamage({
        magicPower: effectiveStat(attacker, "mag"),
        targetMagicRes: effectiveStat(target, "res"),
        power: effect.power,
      });
    case "weapon":
      return computeWeaponDamage(
        {
          atk: effectiveStat(attacker, "atk"),
          spd: effectiveStat(attacker, "spd"),
          mag: effectiveStat(attacker, "mag"),
          weaponPower: effect.weaponPower,
          targetWeaponDef: effectiveStat(target, "def"),
          power: effect.power,
        },
        effect.formula,
      );
  }
}

/** Apply an `inflicts`/`cleanses` list carried by a damaging effect. */
function applyOnHit(
  target: Unit,
  effect: SteelEffect | PowderEffect | WeaponEffect,
  attacker: Unit,
  context: EffectContext,
): Unit {
  let updated = target;
  if (effect.inflicts !== undefined && effect.inflicts.length > 0 && updated.hp > 0) {
    const applied = applyConditions(updated, effect.inflicts, {
      tick: context.tick,
      sourceId: attacker.id,
      ...(effect.conditionDuration === undefined ? {} : { duration: effect.conditionDuration }),
    });
    context.events.push(...applied.events);
    updated = applied.unit;
  }
  if (effect.cleanses !== undefined && effect.cleanses.length > 0) {
    updated = applyCleanses(updated, effect.cleanses, context);
  }
  return updated;
}

/** Cure an explicit list of conditions, emitting each `conditionRemoved`. */
function applyCleanses(unit: Unit, ids: readonly ConditionId[], context: EffectContext): Unit {
  let updated = unit;
  for (const id of ids) {
    const result = cureCondition(updated, id, { tick: context.tick, reason: "cured" });
    context.events.push(...result.events);
    updated = result.unit;
  }
  return updated;
}

/** Cure one condition, or every active condition when no id is named. */
function applyCleanse(
  unit: Unit,
  conditionId: ConditionId | undefined,
  context: EffectContext,
): Unit {
  if (conditionId !== undefined) {
    const result = cureCondition(unit, conditionId, { tick: context.tick, reason: "cured" });
    context.events.push(...result.events);
    return result.unit;
  }
  let updated = unit;
  for (const key of activeConditionKeys(unit)) {
    const result = cureCondition(updated, key, { tick: context.tick, reason: "cured" });
    context.events.push(...result.events);
    updated = result.unit;
  }
  return updated;
}

/** Per-target context shared by the effect helpers. */
interface EffectContext {
  /** Orders Tempo tick the resolution happened on. */
  readonly tick: number;
  /** The action being resolved (for event attribution). */
  readonly abilityId: AbilityId;
  /** Whether the hit was a critical strike. */
  readonly critical: boolean;
  /** Elemental affinity lookup for the target. */
  readonly affinitiesOf: (unit: Unit) => ElementAffinityMap;
  /** The event sink; helpers append to it in resolution order. */
  readonly events: BattleEvent[];
}

/** One effect applied on behalf of an actor to one target. */
interface EffectOutcome {
  readonly attacker: Unit;
  readonly target: Unit;
}

/**
 * Apply one effect. The effect may change the target only, the attacker only
 * (a drain), or both; the caller stores whichever changed. Every event is
 * pushed onto `context.events` in order.
 */
function applyEffect(
  effect: AbilityEffect,
  attacker: Unit,
  target: Unit,
  context: EffectContext,
): EffectOutcome {
  const { tick, abilityId, critical, affinitiesOf, events } = context;

  switch (effect.kind) {
    case "steel":
    case "powder":
    case "weapon": {
      const raw = computeRawDamage(effect, attacker, target);
      const elemental = applyElementToDamage(raw, effect.element, affinitiesOf(target));
      let updated = target;

      if (elemental.damage > 0) {
        const hpAfter = Math.max(0, target.hp - elemental.damage);
        updated = withHp(target, hpAfter);
        events.push({
          kind: "damaged",
          tick,
          unitId: target.id,
          sourceId: attacker.id,
          abilityId,
          amount: elemental.damage,
          hpAfter,
          damageType: damageTypeOf(effect),
          ...(effect.element === undefined ? {} : { element: effect.element }),
          critical,
          fatal: hpAfter <= 0,
        });
      } else if (elemental.healing > 0) {
        // Absorb: the element turns the blow into medicine (mapping §7).
        const hpAfter = Math.min(target.stats.hp, target.hp + elemental.healing);
        updated = withHp(target, hpAfter);
        events.push({
          kind: "healed",
          tick,
          unitId: target.id,
          sourceId: attacker.id,
          abilityId,
          amount: hpAfter - target.hp,
          hpAfter,
        });
      }

      return { attacker, target: applyOnHit(updated, effect, attacker, context) };
    }

    case "heal": {
      const amount = computeHealing({
        medicalPower: effectiveStat(attacker, "mag"),
        power: effect.power,
      });
      const hpAfter = Math.min(target.stats.hp, target.hp + amount);
      const updated = withHp(target, hpAfter);
      events.push({
        kind: "healed",
        tick,
        unitId: target.id,
        sourceId: attacker.id,
        abilityId,
        amount: hpAfter - target.hp,
        hpAfter,
      });
      const cleansed =
        effect.cleanses === undefined || effect.cleanses.length === 0
          ? updated
          : applyCleanses(updated, effect.cleanses, context);
      return { attacker, target: cleansed };
    }

    case "drain": {
      if (effect.resource === "mp") {
        const taken = Math.min(target.mp, effect.power);
        if (taken <= 0) return { attacker, target };
        const drained = withMp(target, target.mp - taken);
        const replenished = withMp(attacker, attacker.mp + taken);
        events.push({
          kind: "mpChanged",
          tick,
          unitId: target.id,
          delta: -taken,
          mpAfter: drained.mp,
          reason: "drained",
        });
        events.push({
          kind: "mpChanged",
          tick,
          unitId: attacker.id,
          delta: taken,
          mpAfter: replenished.mp,
          reason: "drained",
        });
        return { attacker: replenished, target: drained };
      }

      // HP drain: Powder-channel harm, then transfer what was actually taken.
      const raw = computePowderDamage({
        magicPower: effectiveStat(attacker, "mag"),
        targetMagicRes: effectiveStat(target, "res"),
        power: effect.power,
      });
      const element: ElementKey = effect.element ?? "dark";
      const elemental = applyElementToDamage(raw, element, affinitiesOf(target));
      const dealt = Math.min(target.hp, elemental.damage);
      if (dealt <= 0) return { attacker, target };
      const drained = withHp(target, target.hp - dealt);
      const replenished = withHp(attacker, attacker.hp + dealt);
      events.push({
        kind: "damaged",
        tick,
        unitId: target.id,
        sourceId: attacker.id,
        abilityId,
        amount: dealt,
        hpAfter: drained.hp,
        damageType: "powder",
        element,
        critical,
        fatal: drained.hp <= 0,
      });
      events.push({
        kind: "healed",
        tick,
        unitId: attacker.id,
        sourceId: target.id,
        abilityId,
        amount: replenished.hp - attacker.hp,
        hpAfter: replenished.hp,
      });
      return { attacker: replenished, target: drained };
    }

    case "revive": {
      if (target.hp > 0) return { attacker, target };
      const amount = computeHealing({
        medicalPower: effectiveStat(attacker, "mag"),
        power: effect.power,
      });
      const hpAfter = Math.min(target.stats.hp, Math.max(1, amount));
      const revived = withHp(target, hpAfter);
      events.push({
        kind: "revived",
        tick,
        unitId: target.id,
        sourceId: attacker.id,
        hpAfter,
      });
      return { attacker, target: revived };
    }

    case "condition": {
      const applied = applyCondition(target, effect.conditionId, {
        tick,
        sourceId: attacker.id,
        ...(effect.duration === undefined ? {} : { duration: effect.duration }),
      });
      events.push(...applied.events);
      return { attacker, target: applied.unit };
    }

    case "cleanse": {
      return { attacker, target: applyCleanse(target, effect.conditionId, context) };
    }
  }
}

/* --------------------------------------------------------------------------
 * The executor
 * ------------------------------------------------------------------------ */

/**
 * Resolve a declared action against the battlefield and return the new state
 * plus its ordered events.
 *
 * The steps, in order:
 * 1. **Target** — resolve affiliation, range, line of sight and the area
 *    footprint (T028). An illegal aim returns `ok: false` with the input
 *    untouched.
 * 2. **Select** — a ground action (`"tile"`) affects every occupant of its
 *    footprint; every other rule uses the occupants that satisfy the
 *    affiliation filter.
 * 3. **Roll** — for each hostile target, one seeded to-hit roll (T037) using
 *    the action's accuracy, the target's evasion and the facing bonus. A miss
 *    emits `missed` and skips that target. Support on allies never rolls.
 * 4. **Apply** — run every {@link AbilityEffect} in authored order, emitting
 *    `damaged`, `healed`, `revived`, `mpChanged`, `conditionApplied` and
 *    `conditionRemoved` as they land, and a final `outOfAction` for anyone the
 *    action knocked down.
 *
 * The executor emits only *effect* events; the pipeline that declared the
 * action owns `abilityUsed` / `abilityResolved` (`./resolve.ts`, T024).
 *
 * ```ts
 * const rng = new Rng(state.seed);
 * const { state: next, events } = executeAbility(state, actor, ability, target, rng);
 * ```
 *
 * Throws a `RangeError` only for malformed authored data (a negative power, an
 * unknown condition id, a non-integer stat) — the same fail-fast boundary the
 * rules modules use.
 */
export function executeAbility(
  state: BattleState,
  actor: Unit,
  ability: AbilitySpec,
  target: Target,
  rng: Rng,
  options: AbilityExecutionOptions = {},
): AbilityExecution {
  const tick = state.tempo.tick;
  const events: BattleEvent[] = [];

  const targeting = resolveTargeting<Unit>(state.map, actor, state.units, target, {
    target: ability.target,
    range: abilityRangeProfile(ability),
    aoeShape: ability.aoeShape ?? "single",
    aoeSize: ability.aoeSize ?? 0,
  });

  if (!targeting.ok) {
    return { ok: false, state, events, targeting };
  }

  // A ground action sweeps its whole footprint (FFTA areas hit friend and foe
  // alike); every other rule uses only the occupants its filter admits.
  const affected = ability.target === "tile" ? targeting.affected : targeting.matched;
  const opposed = ability.effects.some(isOpposedEffect);
  const accuracy = (ability.hitRate ?? 100) + conditionHitModifier(actor);
  const critRate = ability.critRate ?? 0;
  const evasion = options.evasionOf ?? evasionOf;
  const affinities = options.affinitiesOf ?? neutralAffinities;

  let units = state.units;
  const get = (id: UnitId): Unit | undefined => units.find((unit) => unit.id === id);
  const put = (updated: Unit): void => {
    units = units.map((unit) => (unit.id === updated.id ? updated : unit));
  };

  for (const candidate of affected) {
    let attacker = get(actor.id);
    let defender = get(candidate.id);
    if (attacker === undefined || defender === undefined) continue;

    const hostile = areHostile(attacker.side, defender.side);
    let critical = false;

    if (hostile && opposed) {
      const shot = rollHit(rng, {
        accuracy,
        evasion: evasion(defender),
        attackerAt: attacker.at,
        defenderAt: defender.at,
        defenderFacing: defender.facing,
      });
      if (!shot.hit) {
        events.push({
          kind: "missed",
          tick,
          unitId: defender.id,
          sourceId: attacker.id,
          abilityId: ability.id,
        });
        continue;
      }
      if (critRate > 0) {
        critical = rng.nextInt(100) < critRate;
      }
    }

    const hpBefore = defender.hp;

    for (const effect of ability.effects) {
      // A drain can change the attacker mid-target, so refresh both from the
      // working list before each effect.
      attacker = get(actor.id) ?? attacker;
      defender = get(defender.id) ?? defender;

      const context: EffectContext = {
        tick,
        abilityId: ability.id,
        critical,
        affinitiesOf: affinities,
        events,
      };
      const outcome = applyEffect(effect, attacker, defender, context);
      put(outcome.target);
      if (outcome.attacker.id !== outcome.target.id) put(outcome.attacker);

      attacker = get(actor.id) ?? attacker;
      defender = get(defender.id) ?? defender;
    }

    if (hpBefore > 0 && defender.hp <= 0) {
      events.push({
        kind: "outOfAction",
        tick,
        unitId: defender.id,
        sourceId: attacker.id,
      });
    }
  }

  return { ok: true, state: { ...state, units }, events, targeting };
}
