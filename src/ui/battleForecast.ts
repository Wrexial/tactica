/**
 * Battle forecast (T086) — the pure view model behind the confirm prompt.
 *
 * Before a player commits an order (*Lines of Glory*'s FFTA "move + act" turn,
 * mapping §12) they should see what the blow will cost: how likely it is to
 * land, how much damage or medicine it carries, and which **reactions** the
 * target could answer with. This module is that projection — a deterministic
 * read of the engine's existing rules modules. It belongs to `src/ui` because
 * it is presentation, but it is deliberately **React-free** so it can be
 * unit-tested in Node and shared by the AI (T095).
 *
 * ## What it mirrors
 *
 * The forecast must agree with the executor ({@link executeAbility}, T041) or it
 * is worse than useless, so it reuses the same rules rather than re-deriving
 * them:
 *
 * - **Targeting** — {@link resolveTargeting} (T028) decides who the action
 *   catches, honouring affiliation, range, line of sight and the AoE footprint
 *   exactly as resolution will.
 * - **Hit chance** — {@link computeHitChance} (T037) resolves accuracy − evasion
 *   plus the front/side/rear bonus. No randomness is consumed, so the forecast
 *   is safe to call every frame.
 * - **Damage & medicine** — the shared kernels `computeSteelDamage`,
 *   `computePowderDamage`, `computeWeaponDamage` and `computeHealing`
 *   (T033–T036), with elemental affinity applied through
 *   {@link applyElementToDamage} (T038).
 * - **Reaction risk** — the trigger predicates in `engine/reactions.ts` (T042),
 *   asked through {@link incomingTrigger} (Dodge) and {@link triggerFromDamage}
 *   (Riposte / Return Fire / Field Dressing).
 *
 * ## Expected vs. rolled values
 *
 * Nothing here rolls dice. {@link ForecastTarget.damage} is the amount a
 * *successful* hit lands; {@link ForecastTarget.expectedDamage} weights that by
 * the hit chance (`floor(damage × chance / 100)`) for an at-a-glance "roughly
 * how much". A miss still does nothing, so the expected value never exceeds the
 * rolled one.
 *
 * ## The fallback channel
 *
 * The resolution catalogue stores a minimal {@link ActionSpec} (id, cost, reach,
 * power, AoE) and not the full {@link AbilitySpec} effect list. When an action
 * carries no authored `effects`, the forecast falls back to a single **Steel**
 * blow at the spec's `power` — the honest default for a generic order and the
 * only channel that needs no extra authored data. Once content supplies real
 * effects (T089), the exact figures appear with no change here.
 *
 * Contract (`agents.md` §2, §7, §9): pure and deterministic, no DOM, no
 * `Math.random`, no clock; inputs are only read. The returned value is a fresh,
 * serialisable projection, never a reference into the battle.
 */

import type { AbilityTarget, ElementKey } from "../data/schema";
import {
  abilityRangeProfile,
  evasionOf,
  type AbilityEffect,
  type AbilitySpec,
  type SteelEffect,
} from "../engine/actions/ability";
import type { ActionSpec } from "../engine/actions/resolve";
import type { BattleState } from "../engine/battle";
import type { Target } from "../engine/commands";
import type { DamagedEvent } from "../engine/events";
import type { AbilityId, UnitId } from "../engine/ids";
import {
  damageChannelOf,
  equippedReaction,
  incomingTrigger,
  reactionKindsFor,
  REACTIONS,
  triggerFromDamage,
  type ReactionKind,
  type ReactionOptions,
  type ReactionPhase,
  type ReactionTrigger,
} from "../engine/reactions";
import {
  computeHealing,
  computePowderDamage,
  computeSteelDamage,
  computeWeaponDamage,
} from "../engine/rules/damage";
import { conditionHitModifier, conditionStatMods } from "../engine/rules/conditions";
import { applyElementToDamage, type ElementAffinityMap } from "../engine/rules/elements";
import { computeHitChance, type RelativeFacing } from "../engine/rules/hit";
import {
  areHostile,
  resolveTargeting,
  type RangeMetric,
  type TargetingFailReason,
} from "../engine/targeting";
import { isOutOfAction, type Unit, type UnitSide } from "../engine/unit";

/* --------------------------------------------------------------------------
 * Inputs
 * ------------------------------------------------------------------------ */

/**
 * The executable action data the forecast reads. It is an {@link ActionSpec}
 * (so the battle catalogue's minimal specs work unchanged) plus the optional
 * targeting and effect fields a full {@link AbilitySpec} supplies. A
 * `AbilitySpec` is structurally assignable to this type, so callers pass
 * whichever they have.
 */
export interface ForecastAbilitySpec extends ActionSpec {
  /** Affiliation rule; defaults to `"enemy"`. */
  readonly target?: AbilityTarget;
  /** Minimum reach in tiles (defaults to the executor's rule). */
  readonly minRange?: number;
  /** Base accuracy percentage; defaults to `100`. */
  readonly hitRate?: number;
  /** Critical-hit chance percentage; defaults to `0`. */
  readonly critRate?: number;
  /** Distance metric; defaults to `"manhattan"`. */
  readonly rangeMetric?: RangeMetric;
  /** Whether high ground extends range downhill. */
  readonly elevationBonus?: boolean;
  /** Whether a clear sight line is required; defaults to `true`. */
  readonly requiresLineOfSight?: boolean;
  /** Authored effects; when omitted the forecast falls back to a Steel blow. */
  readonly effects?: readonly AbilityEffect[];
}

/**
 * Injectable hooks for the forecast. They mirror the executor's
 * {@link AbilityExecutionOptions} so the preview and the resolution agree, and
 * add the reaction loadout the forecast needs to know whether a threat is
 * *equipped* rather than merely possible.
 */
export interface ForecastOptions {
  /** The target's per-element defensive affinities (mapping §7, T038). */
  readonly affinitiesOf?: (unit: Unit) => ElementAffinityMap;
  /** The target's evasion term; defaults to the executor's Speed-derived term. */
  readonly evasionOf?: (unit: Unit) => number;
  /**
   * Each soldier's equipped reaction (the single R-Ability slot). When
   * supplied, the forecast reports only the reactions the target actually
   * carries; when omitted it reports every reaction whose **trigger** matches,
   * flagged `equipped: false`.
   */
  readonly reactions?: ReactionOptions;
}

/* --------------------------------------------------------------------------
 * Outputs
 * ------------------------------------------------------------------------ */

/** One reaction a target could answer the incoming order with (T042). */
export interface ForecastReaction {
  /** The soldier who would react. */
  readonly unitId: UnitId;
  /** Their display name. */
  readonly unitName: string;
  /** Which of the four hooks fires. */
  readonly kind: ReactionKind;
  /** Napoleonic label, e.g. "Riposte" (mapping §6). */
  readonly label: string;
  /** Whether it fires before or after the damage. */
  readonly phase: ReactionPhase;
  /** `true` when a loadout confirmed the target carries it. */
  readonly equipped: boolean;
}

/** The forecast for one soldier caught by the order. */
export interface ForecastTarget {
  readonly unitId: UnitId;
  readonly name: string;
  readonly side: UnitSide;
  /** Whether the actor and this soldier are hostile. */
  readonly hostile: boolean;
  /** Whether the blow rolls to hit (a hostile, opposed effect does). */
  readonly rollsToHit: boolean;
  /** Current hit points. */
  readonly hpBefore: number;
  /** Maximum hit points (for the lethal / dressing readouts). */
  readonly maxHp: number;
  /** Hit points after one successful blow, clamped into `[0, maxHp]`. */
  readonly hpAfter: number;
  /** Damage a successful hit lands (`0` for support). */
  readonly damage: number;
  /** Medicine a successful use restores (`0` for damage). */
  readonly healing: number;
  /** `damage` weighted by the hit chance; `0` when no roll is made. */
  readonly expectedDamage: number;
  /** Hit chance in whole percent (`100` when the blow never rolls). */
  readonly hitChance: number;
  /** How the strike arrives relative to the defender, when it rolls. */
  readonly facing: RelativeFacing | null;
  /** Whether the blow would take the soldier out of action. */
  readonly lethal: boolean;
  /** Reactions this soldier could answer with, if any. */
  readonly reactions: readonly ForecastReaction[];
}

/** The complete before-you-confirm projection for one order. */
export interface BattleForecast {
  readonly abilityId: AbilityId;
  readonly actorId: UnitId;
  readonly actorName: string;
  /** Whether the aim was `self`, a `unit` or a `tile`. */
  readonly targetKind: Target["kind"];
  /** `false` when the aim is illegal; see {@link reason}. */
  readonly ok: boolean;
  /** The targeting rejection, when the aim is illegal. */
  readonly reason?: TargetingFailReason;
  /** Whether the action delivers an opposed (hostile, rolling) effect. */
  readonly opposed: boolean;
  /** A forecast for every soldier the order catches, in field order. */
  readonly targets: readonly ForecastTarget[];
  /** The primary target's hit chance, or `100` when none rolls. */
  readonly hitChance: number;
  /** The primary target's per-hit damage. */
  readonly damage: number;
  /** The primary target's hit-weighted damage. */
  readonly expectedDamage: number;
  /** The primary target's medicine. */
  readonly healing: number;
  /** Every reaction threat across every caught soldier. */
  readonly reactions: readonly ForecastReaction[];
}

/* --------------------------------------------------------------------------
 * Normalisation
 * ------------------------------------------------------------------------ */

/**
 * Fill in the defaults a minimal {@link ActionSpec} omits and fall back to a
 * Steel blow when no effects are authored. Returns a full {@link AbilitySpec}
 * so the engine helpers (range profile, reaction triggers) can be reused
 * unchanged.
 */
function normalizeAbility(spec: ForecastAbilitySpec): AbilitySpec {
  const effects: readonly AbilityEffect[] =
    spec.effects !== undefined && spec.effects.length > 0
      ? spec.effects
      : [steelFallback(spec.power)];

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

/** The authored-power Steel fallback used when a spec carries no effects. */
function steelFallback(power: number): SteelEffect {
  return { kind: "steel", power };
}

/* --------------------------------------------------------------------------
 * Effect maths (mirrors the executor)
 * ------------------------------------------------------------------------ */

/** An effective stat: the base block plus active condition modifiers (T018/T039). */
function effectiveStat(unit: Unit, key: "atk" | "def" | "mag" | "res" | "spd"): number {
  return Math.max(0, unit.stats[key] + conditionStatMods(unit)[key]);
}

/** Whether an effect is opposed (hostile, rolls to hit) — mirrors the executor. */
function isOpposedEffect(effect: AbilityEffect): boolean {
  return (
    effect.kind === "steel" ||
    effect.kind === "powder" ||
    effect.kind === "weapon" ||
    effect.kind === "drain" ||
    effect.kind === "condition"
  );
}

/** One effect's damage/healing contribution, after elemental affinity. */
interface EffectPreview {
  readonly damage: number;
  readonly healing: number;
}

/** Apply the target's elemental affinity to a raw damage figure (T038). */
function elementalPreview(
  raw: number,
  element: ElementKey | undefined,
  target: Unit,
  options: ForecastOptions,
): EffectPreview {
  const result = applyElementToDamage(raw, element, options.affinitiesOf?.(target));
  return { damage: result.damage, healing: result.healing };
}

/**
 * Resolve one authored effect into a damage/healing preview, using the same
 * formulas the executor will. A drain of Élan deals no damage; a heal on a
 * standing soldier restores medicine, while a revive only counts on a casualty.
 */
function previewEffect(
  effect: AbilityEffect,
  attacker: Unit,
  target: Unit,
  options: ForecastOptions,
): EffectPreview {
  switch (effect.kind) {
    case "steel":
      return elementalPreview(
        computeSteelDamage({
          weaponAtk: effectiveStat(attacker, "atk"),
          targetWeaponDef: effectiveStat(target, "def"),
          power: effect.power,
        }),
        effect.element,
        target,
        options,
      );
    case "powder":
      return elementalPreview(
        computePowderDamage({
          magicPower: effectiveStat(attacker, "mag"),
          targetMagicRes: effectiveStat(target, "res"),
          power: effect.power,
        }),
        effect.element,
        target,
        options,
      );
    case "weapon":
      return elementalPreview(
        computeWeaponDamage(
          {
            atk: effectiveStat(attacker, "atk"),
            spd: effectiveStat(attacker, "spd"),
            mag: effectiveStat(attacker, "mag"),
            weaponPower: effect.weaponPower,
            targetWeaponDef: effectiveStat(target, "def"),
            power: effect.power,
          },
          effect.formula,
        ),
        effect.element,
        target,
        options,
      );
    case "drain":
      if (effect.resource === "mp") return { damage: 0, healing: 0 };
      return elementalPreview(
        computePowderDamage({
          magicPower: effectiveStat(attacker, "mag"),
          targetMagicRes: effectiveStat(target, "res"),
          power: effect.power,
        }),
        effect.element ?? "dark",
        target,
        options,
      );
    case "heal":
      return {
        damage: 0,
        healing: computeHealing({
          medicalPower: effectiveStat(attacker, "mag"),
          power: effect.power,
        }),
      };
    case "revive":
      return target.hp > 0
        ? { damage: 0, healing: 0 }
        : {
            damage: 0,
            healing: computeHealing({
              medicalPower: effectiveStat(attacker, "mag"),
              power: effect.power,
            }),
          };
    case "condition":
    case "cleanse":
      return { damage: 0, healing: 0 };
  }
}

/** The first elemental property the action's effects declare, if any. */
function firstElement(effects: readonly AbilityEffect[]): ElementKey | undefined {
  for (const effect of effects) {
    if ("element" in effect && effect.element !== undefined) return effect.element;
  }
  return undefined;
}

/* --------------------------------------------------------------------------
 * Reaction risk
 * ------------------------------------------------------------------------ */

/**
 * Every reaction the target could answer `trigger` with. When callers supply a
 * reaction loadout, only the soldier's equipped reaction survives; otherwise
 * every matching trigger is reported and flagged as merely possible.
 */
function reactionsFor(
  target: Unit,
  trigger: ReactionTrigger,
  options: ForecastOptions,
): ForecastReaction[] {
  const kinds = reactionKindsFor(trigger);
  if (kinds.length === 0) return [];

  const known = options.reactions !== undefined;
  const equipped = known ? equippedReaction(target, options.reactions) : undefined;

  const threats: ForecastReaction[] = [];
  for (const kind of kinds) {
    if (known && equipped !== kind) continue;
    threats.push({
      unitId: target.id,
      unitName: target.name,
      kind,
      label: REACTIONS[kind].name,
      phase: REACTIONS[kind].phase,
      equipped: known,
    });
  }
  return threats;
}

/** The pre- and post-damage reaction threats for one struck soldier. */
function reactionThreats(
  state: BattleState,
  attacker: Unit,
  target: Unit,
  ability: AbilitySpec,
  damage: number,
  options: ForecastOptions,
): ForecastReaction[] {
  const threats: ForecastReaction[] = [];

  const incoming = incomingTrigger(state, attacker.id, target.id, ability);
  if (incoming !== undefined) threats.push(...reactionsFor(target, incoming, options));

  if (damage <= 0) return threats;

  // Build the synthetic "damaged" event the after-damage hooks will see, so
  // Riposte / Return Fire / Field Dressing are predicted from real geometry.
  const hpAfter = Math.max(0, target.hp - damage);
  const element = firstElement(ability.effects);
  const event: DamagedEvent = {
    kind: "damaged",
    tick: state.tempo.tick,
    unitId: target.id,
    sourceId: attacker.id,
    abilityId: ability.id,
    amount: damage,
    hpAfter,
    damageType: damageChannelOf(ability),
    ...(element === undefined ? {} : { element }),
    critical: false,
    fatal: hpAfter <= 0,
  };
  const after = triggerFromDamage(state, event, "afterDamage");
  if (after !== undefined) threats.push(...reactionsFor(target, after, options));

  return threats;
}

/* --------------------------------------------------------------------------
 * Per-target forecast
 * ------------------------------------------------------------------------ */

/** Project one caught soldier: survival, damage, hit chance and reactions. */
function forecastTarget(
  state: BattleState,
  attacker: Unit,
  ability: AbilitySpec,
  target: Unit,
  options: ForecastOptions,
): ForecastTarget {
  const hostile = areHostile(attacker.side, target.side);
  const opposed = ability.effects.some(isOpposedEffect);
  const rollsToHit = hostile && opposed;

  let damage = 0;
  let healing = 0;
  for (const effect of ability.effects) {
    const preview = previewEffect(effect, attacker, target, options);
    damage += preview.damage;
    healing += preview.healing;
  }

  let hitChance = 100;
  let facing: RelativeFacing | null = null;
  if (rollsToHit) {
    const accuracy = (ability.hitRate ?? 100) + conditionHitModifier(attacker);
    const evasion = (options.evasionOf ?? evasionOf)(target);
    const chance = computeHitChance({
      accuracy,
      evasion,
      attackerAt: attacker.at,
      defenderAt: target.at,
      defenderFacing: target.facing,
    });
    hitChance = chance.chance;
    facing = chance.facing;
  }

  const hpAfter = Math.max(0, Math.min(target.stats.hp, target.hp - damage + healing));
  const lethal = rollsToHit && damage > 0 && hpAfter <= 0;
  const expectedDamage = rollsToHit ? Math.floor((damage * hitChance) / 100) : 0;

  return {
    unitId: target.id,
    name: target.name,
    side: target.side,
    hostile,
    rollsToHit,
    hpBefore: target.hp,
    maxHp: target.stats.hp,
    hpAfter,
    damage,
    healing,
    expectedDamage,
    hitChance,
    facing,
    lethal,
    reactions: rollsToHit ? reactionThreats(state, attacker, target, ability, damage, options) : [],
  };
}

/* --------------------------------------------------------------------------
 * The forecast
 * ------------------------------------------------------------------------ */

/** Find the soldier the ordered `target` names, for the primary readout. */
function primaryTarget(
  target: Target,
  attacker: Unit,
  forecasts: readonly ForecastTarget[],
): ForecastTarget | undefined {
  switch (target.kind) {
    case "unit":
      return forecasts.find((entry) => entry.unitId === target.unitId) ?? forecasts[0];
    case "self":
      return forecasts.find((entry) => entry.unitId === attacker.id) ?? forecasts[0];
    case "tile":
      return forecasts[0];
  }
}

/**
 * Project an order before it is committed: who it catches, the damage and
 * medicine each will take, the to-hit odds and the reactions it may provoke.
 *
 * Pure and deterministic — no randomness is consumed, so it is safe to call on
 * every cursor move. The returned target list mirrors what the executor will
 * resolve (a `"tile"` action sweeps its whole footprint, friend and foe alike;
 * every other rule uses the occupants its affiliation filter admits).
 *
 * ```ts
 * const preview = forecastAbility(battle, rifleman, musket, unitTarget(foe.id));
 * preview.hitChance;      // 75
 * preview.expectedDamage; // floor(damage × 0.75)
 * preview.reactions;      // [{ kind: "dodge", ... }]
 * ```
 */
export function forecastAbility(
  state: BattleState,
  attacker: Unit,
  spec: ForecastAbilitySpec,
  target: Target,
  options: ForecastOptions = {},
): BattleForecast {
  const ability = normalizeAbility(spec);
  const targeting = resolveTargeting<Unit>(state.map, attacker, state.units, target, {
    target: ability.target,
    range: abilityRangeProfile(ability),
    aoeShape: ability.aoeShape ?? "single",
    aoeSize: ability.aoeSize ?? 0,
  });

  // Mirror the executor: a ground action sweeps the whole footprint, every
  // other rule uses only the occupants its affiliation filter admits. An
  // illegal aim projects no targets at all, so the panel never advertises a
  // blow the engine will refuse.
  const affected = targeting.ok
    ? ability.target === "tile"
      ? targeting.affected
      : targeting.matched
    : [];
  const targets = affected.map((unit) => forecastTarget(state, attacker, ability, unit, options));
  const primary = primaryTarget(target, attacker, targets);

  return {
    abilityId: ability.id,
    actorId: attacker.id,
    actorName: attacker.name,
    targetKind: target.kind,
    ok: targeting.ok,
    ...(targeting.reason === undefined ? {} : { reason: targeting.reason }),
    opposed: ability.effects.some(isOpposedEffect),
    targets,
    hitChance: primary?.hitChance ?? 100,
    damage: primary?.damage ?? 0,
    expectedDamage: primary?.expectedDamage ?? 0,
    healing: primary?.healing ?? 0,
    reactions: targets.flatMap((entry) => entry.reactions),
  };
}

/**
 * Build the `Target` a cursor implies: the soldier standing on the tile when
 * there is one, otherwise the ground tile itself. Keeps the aiming cursor and
 * the forecast in agreement without the caller having to know the ability's
 * affiliation rule (targeting reports a mismatch as `wrong-affiliation`).
 */
export function targetForCursor(state: BattleState, at: { x: number; y: number }): Target {
  const occupant = state.units.find(
    (unit) => !isOutOfAction(unit) && unit.at.x === at.x && unit.at.y === at.y,
  );
  if (occupant === undefined) return { kind: "tile", at: { x: at.x, y: at.y } };
  return { kind: "unit", unitId: occupant.id };
}
