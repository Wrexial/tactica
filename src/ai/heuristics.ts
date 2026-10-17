/**
 * Ability & item heuristics (T097) — the small, tunable value functions the
 * utility AI (T095) uses to judge **support** orders: healing, buffs,
 * cleanses, revivals, limited-use **consumables** and the **Élan** economy.
 *
 * The utility scorer in `./utility.ts` already knows how to value a blow:
 * expected damage, kill potential, threat and ground. What it cannot do well
 * with its raw terms is decide *when a bandage is worth a volley*, *whether an
 * ally needs the same buff twice*, *whether a one-shot item should be spent
 * now or saved*, or *whether spending the last of a soldier's Élan will break
 * their nerve*. This module supplies exactly those judgements, as pure
 * functions over the engine's own forecast (T086) and unit model (T017). The
 * scorer multiplies the returned priority figures by its weights, so the
 * behaviour stays data-driven (`agents.md` §2) and the final numbers belong to
 * the Phase 13 balance pass.
 *
 * ## What "sensible" means here
 *
 * - **Healing** — medicine past the patient's missing hit points is wasted, so
 *   only the *effective* restore counts. A patient near death is worth far
 *   more than one scratched at full strength, so {@link healUrgency} scales the
 *   value from 0 (unharmed) to 100 (critical). See {@link healNeed}.
 * - **Buffs** — a fresh beneficial condition is worth a fixed priority plus a
 *   share of the recipient's combat value; a condition the ally already carries
 *   is redundant and scores nothing. See {@link evaluateAbility}.
 * - **Consumables** — a single-use item is real kit spent from the company's
 *   stores, so it carries a scarcity penalty (bigger when few charges remain).
 *   A consumable still wins when the need is urgent — a last dressing that
 *   saves a comrade beats hoarding it.
 * - **Élan** — Élan doubles as morale (mapping §5, decision D4), so an order
 *   that empties the pool **Routs** its soldier and one that crosses the
 *   **Shaken** threshold trades the rest of their turn for the action. See
 *   {@link elanCostPenalty}.
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Pure and deterministic** — no DOM, no I/O, no `Math.random`, no `Date`.
 *   Every function reads its inputs and returns a fresh value; the same facts
 *   always yield the same numbers.
 * - **No engine writes** — the heuristics only *read* `BattleState` and
 *   `Unit`; they never mutate the battle.
 * - **Data-driven** — every priority is a named constant, not a branch buried
 *   in the scorer, so content can retune it and the tests can pin it.
 *
 * Reference: `docs/wiki/pages/White_Magic_(Tactics_Advance).md` (support
 * actions), `docs/wiki/pages/MP_(stat).md` (the resource, an authored
 * regeneration schedule), mapping §5–§6, §8 and decision D4 (Élan as morale).
 */

import { getCondition, isConditionKey } from "../data/conditions";
import type { ElementKey } from "../data/schema";
import type { BattleState } from "../engine/battle";
import { moraleStateOf, shakenThreshold, type MoraleState } from "../engine/rules/elan";
import { isOutOfAction, type Unit } from "../engine/unit";
import type { BattleForecast, ForecastAbilitySpec } from "../ui/battleForecast";

/* --------------------------------------------------------------------------
 * Tunables (authored balance data; Phase 13 owns the final pass)
 * ------------------------------------------------------------------------ */

/**
 * Hit-point fraction at or below which a wounded ally is treated as
 * **critical**: the urgency bonus jumps by {@link CRITICAL_URGENCY_BONUS}, so a
 * soldier who could be finished next turn outranks one merely bloodied.
 */
export const CRITICAL_HP_RATIO = 0.3;

/** Urgency bonus added at or below {@link CRITICAL_HP_RATIO}. */
export const CRITICAL_URGENCY_BONUS = 40;

/** Highest urgency {@link healNeed} can report (a patient about to fall). */
export const HEAL_URGENCY_MAX = 100;

/** Priority of placing one fresh beneficial condition on an ally. */
export const BUFF_PRIORITY = 10;

/** Priority of lifting one harmful condition from an ally. */
export const CLEANSE_PRIORITY = 12;

/** Priority of bringing a fallen ally back to the line. */
export const REVIVE_PRIORITY = 80;

/**
 * Divisor that turns an ally's offensive value into a small bonus on the
 * buff/revive they receive, so a battery is a more attractive rallying point
 * than a lone picket without dwarfing the base priority.
 */
export const COMBAT_VALUE_DIVISOR = 4;

/** Scarcity penalty carried by a one-charge consumable. */
export const CONSUMABLE_SCARCITY_BASE = 24;

/** Assumed stock for a consumable whose `charges` is left unspecified. */
export const CONSUMABLE_DEFAULT_CHARGES = 3;

/** Penalty for an order that would leave its soldier **Routed** (0 Élan). */
export const ELAN_ROUTED_PENALTY = 100;

/** Penalty for an order that first drops its soldier to **Shaken**. */
export const ELAN_SHAKEN_PENALTY = 40;

/** Mild per-point cost of spending Élan at all, so equal plans favour thrift. */
export const ELAN_SPEND_PENALTY = 1;

/* --------------------------------------------------------------------------
 * Reading an action
 * ------------------------------------------------------------------------ */

/**
 * The minimal action facts the heuristics read. It is structurally every
 * {@link ForecastAbilitySpec} (so a battle's minimal catalogue works) plus the
 * top-level `inflicts`/`cleanses` an authored `AbilityDef` carries and the
 * consumable bookkeeping the campaign layer adds. A full authored ability is
 * assignable, which keeps content and tests on the same shape.
 */
export interface HeuristicAbility extends ForecastAbilitySpec {
  /** Elemental property declared at the action level (`AbilityDef.element`). */
  readonly element?: ElementKey;
  /** Conditions the action applies (`AbilityDef.inflicts`). */
  readonly inflicts?: readonly string[];
  /** Conditions the action removes (`AbilityDef.cleanses`). */
  readonly cleanses?: readonly string[];
  /** A single-use item: spending it consumes limited stores, not just Élan. */
  readonly consumable?: boolean;
  /** Remaining charges for a consumable; omitted treats it as in stock. */
  readonly charges?: number;
}

/** The roles an action can play from the AI's point of view. */
export const ABILITY_ROLES = [
  "damage",
  "heal",
  "revive",
  "buff",
  "debuff",
  "cleanse",
  "utility",
] as const;
export type AbilityRole = (typeof ABILITY_ROLES)[number];

/** Everything {@link classifyAbility} works out about an action. */
export interface AbilityClassification {
  /** What the action primarily does. */
  readonly role: AbilityRole;
  /** Conditions the action applies, in first-seen order. */
  readonly inflicts: readonly string[];
  /** Conditions the action removes, in first-seen order. */
  readonly cleanses: readonly string[];
  /** Elements the action carries, in first-seen order. */
  readonly elements: readonly ElementKey[];
  /** `true` when the action spends a limited item rather than only Élan. */
  readonly isConsumable: boolean;
  /** Charges remaining (`null` for a non-consumable). */
  readonly charges: number | null;
  /** `false` when an out-of-stock consumable cannot be used at all. */
  readonly usable: boolean;
}

/** The facts gathered from an action's effects and top-level fields. */
interface AbilityFacts {
  readonly inflicts: readonly string[];
  readonly cleanses: readonly string[];
  readonly elements: readonly ElementKey[];
  readonly hasHeal: boolean;
  readonly hasRevive: boolean;
  readonly hasDamage: boolean;
  /** A cleanse effect with no named condition strips every active condition. */
  readonly generalCleanse: boolean;
}

/** Collect conditions, elements and effect families from an action. */
function gatherFacts(spec: HeuristicAbility): AbilityFacts {
  const inflicts = new Set<string>();
  const cleanses = new Set<string>();
  const elements = new Set<ElementKey>();
  let hasHeal = false;
  let hasRevive = false;
  let hasDamage = false;
  let generalCleanse = false;

  const addAll = (sink: Set<string>, ids: readonly string[] | undefined): void => {
    for (const id of ids ?? []) sink.add(id);
  };

  if (spec.element !== undefined) elements.add(spec.element);
  addAll(inflicts, spec.inflicts);
  addAll(cleanses, spec.cleanses);

  for (const effect of spec.effects ?? []) {
    switch (effect.kind) {
      case "steel":
      case "powder":
      case "weapon":
        hasDamage = true;
        if (effect.element !== undefined) elements.add(effect.element);
        addAll(inflicts, effect.inflicts);
        addAll(cleanses, effect.cleanses);
        break;
      case "heal":
        hasHeal = true;
        addAll(cleanses, effect.cleanses);
        break;
      case "revive":
        hasRevive = true;
        break;
      case "drain":
        if (effect.resource === "hp") hasDamage = true;
        if (effect.element !== undefined) elements.add(effect.element);
        break;
      case "condition":
        inflicts.add(effect.conditionId);
        break;
      case "cleanse":
        if (effect.conditionId === undefined) generalCleanse = true;
        else cleanses.add(effect.conditionId);
        break;
    }
  }

  return {
    inflicts: [...inflicts],
    cleanses: [...cleanses],
    elements: [...elements],
    hasHeal,
    hasRevive,
    hasDamage,
    generalCleanse,
  };
}

/**
 * Decide whether a set of conditions placed on `target` is friendly (a
 * **buff**) or hostile (a **debuff**). Affiliation settles an ally/enemy
 * action; a `"self"` action is always a buff and a `"tile"`/`"any"` action
 * falls back to the authored condition kinds.
 */
function supportPolarity(
  target: HeuristicAbility["target"],
  inflicts: readonly string[],
): AbilityRole {
  if (target === "ally" || target === "self") return "buff";
  if (target === "enemy") return "debuff";
  let buffs = 0;
  let debuffs = 0;
  for (const id of inflicts) {
    if (!isConditionKey(id)) continue;
    const kind = getCondition(id).kind;
    if (kind === "buff") buffs += 1;
    else if (kind === "debuff" || kind === "ailment") debuffs += 1;
  }
  return debuffs > buffs ? "debuff" : "buff";
}

/**
 * Classify an action into a single {@link AbilityRole} for the AI, and report
 * the facts the scorer needs (conditions, elements, consumable stock).
 *
 * Precedence is deliberate: a revival outranks a plain heal, a heal outranks
 * raw damage (a dressing that also cleanses is a heal), damage outranks a pure
 * debuff, and a cleanse outranks a buff. A one-charge item is only marked
 * unusable when its stock has run out, so the AI can never try to spend an
 * empty pouch.
 */
export function classifyAbility(spec: HeuristicAbility): AbilityClassification {
  const facts = gatherFacts(spec);

  let role: AbilityRole;
  if (facts.hasRevive && !facts.hasHeal) role = "revive";
  else if (facts.hasHeal) role = "heal";
  else if (facts.hasDamage) role = "damage";
  else if (facts.cleanses.length > 0 || facts.generalCleanse) role = "cleanse";
  else if (facts.inflicts.length > 0) role = supportPolarity(spec.target, facts.inflicts);
  else role = "utility";

  const isConsumable = spec.consumable === true;
  const charges = isConsumable ? (spec.charges ?? CONSUMABLE_DEFAULT_CHARGES) : null;
  const usable = !isConsumable || (charges ?? 0) > 0;

  return {
    role,
    inflicts: facts.inflicts,
    cleanses: facts.cleanses,
    elements: facts.elements,
    isConsumable,
    charges,
    usable,
  };
}

/* --------------------------------------------------------------------------
 * Combat value & healing
 * ------------------------------------------------------------------------ */

/**
 * An ally's offensive worth as a single integer: `atk + mag`, the same
 * yardstick T095's `targetThreat` uses. A soldier out of action is worth
 * nothing as a rally point or healer target (though reviving still has value).
 */
export function combatValue(unit: Unit): number {
  if (isOutOfAction(unit)) return 0;
  return Math.max(0, unit.stats.atk) + Math.max(0, unit.stats.mag);
}

/** How badly a soldier needs medicine, from 0 (unharmed) to 100 (critical). */
export interface HealNeed {
  /** Hit points the soldier is missing. */
  readonly missingHp: number;
  /** Current hit points as a fraction of maximum (`0..1`). */
  readonly hpFraction: number;
  /** Urgency from 0 to {@link HEAL_URGENCY_MAX}. */
  readonly urgency: number;
}

/**
 * Measure a soldier's need for medicine. Urgency rises as hit points fall and
 * jumps at {@link CRITICAL_HP_RATIO}, so the AI favours a dying ally over one
 * who is merely hurt. An unharmed soldier has zero urgency; a casualty is
 * treated as maximally critical.
 */
export function healNeed(target: Unit): HealNeed {
  const maxHp = Math.max(1, target.stats.hp);
  const hp = Math.max(0, Math.min(target.hp, maxHp));
  const missingHp = maxHp - hp;
  const hpFraction = hp / maxHp;

  let urgency = Math.round((1 - hpFraction) * 60);
  if (hp > 0 && hpFraction <= CRITICAL_HP_RATIO) urgency += CRITICAL_URGENCY_BONUS;
  urgency = Math.max(0, Math.min(HEAL_URGENCY_MAX, urgency));

  return { missingHp, hpFraction, urgency };
}

/**
 * The hit points a heal of `amount` actually restores once the target's
 * missing pool is taken into account. Overheal is discarded, so the AI never
 * values a bandage by the number printed on it.
 */
export function effectiveHeal(target: Unit, amount: number): number {
  if (amount <= 0) return 0;
  return Math.min(Math.floor(amount), Math.max(0, target.stats.hp - target.hp));
}

/**
 * The urgency-weighted bonus a heal earns on top of its raw restored hit
 * points: `floor(urgency × restored / 100)`. A critical patient at 0 urgency
 * contributes nothing; an emergency dressing can roughly double its value.
 */
export function healUrgencyBonus(target: Unit, amount: number): number {
  const restored = effectiveHeal(target, amount);
  if (restored <= 0) return 0;
  return Math.floor((healNeed(target).urgency * restored) / 100);
}

/* --------------------------------------------------------------------------
 * Consumables
 * ------------------------------------------------------------------------ */

/**
 * The scarcity penalty carried by spending a consumable with `charges` left.
 * A single remaining charge is penalised heavily; a deep pouch only lightly.
 * A non-consumable (`null`) carries no penalty.
 */
export function consumableScarcity(charges: number | null): number {
  if (charges === null) return 0;
  const stock = Math.max(1, charges);
  return Math.ceil(CONSUMABLE_SCARCITY_BASE / stock);
}

/* --------------------------------------------------------------------------
 * Élan & morale
 * ------------------------------------------------------------------------ */

/**
 * The morale a soldier would hold after spending `cost` Élan. Pure: the unit
 * is never mutated, and the projected pool is clamped at zero exactly as
 * {@link import("../engine/rules/elan").spendElan} would clamp it.
 */
export function projectedMorale(unit: Unit, cost: number): MoraleState {
  const mp = Math.max(0, unit.mp - Math.max(0, cost));
  return moraleStateOf({ ...unit, mp });
}

/**
 * The Élan a soldier can spend without dropping to or below the **Shaken**
 * threshold — their safe budget for an optional action. A soldier already at
 * or below the threshold has no budget left.
 */
export function elanBudget(unit: Unit): number {
  return Math.max(0, unit.mp - shakenThreshold(unit));
}

/**
 * The score penalty for spending `cost` Élan. It blends a mild thrift cost
 * ({@link ELAN_SPEND_PENALTY} per point) with a morale penalty: an order that
 * first crosses into **Shaken** adds {@link ELAN_SHAKEN_PENALTY}, and one that
 * empties the pool to **Routed** adds {@link ELAN_ROUTED_PENALTY}. A soldier
 * already shaken or routed pays only the thrift cost, so a broken unit is not
 * punished twice for acting.
 */
export function elanCostPenalty(unit: Unit, cost: number): number {
  if (cost <= 0) return 0;
  const before = moraleStateOf(unit);
  const after = projectedMorale(unit, cost);

  let penalty = cost * ELAN_SPEND_PENALTY;
  if (after === "routed" && before !== "routed") penalty += ELAN_ROUTED_PENALTY;
  else if (after === "shaken" && before === "steady") penalty += ELAN_SHAKEN_PENALTY;
  return penalty;
}

/* --------------------------------------------------------------------------
 * The evaluation
 * ------------------------------------------------------------------------ */

/** The support-priority breakdown behind one action, for the scorer. */
export interface HeuristicEvaluation {
  /** What the action primarily does. */
  readonly role: AbilityRole;
  /** `true` when the action spends a limited item. */
  readonly isConsumable: boolean;
  /** Charges remaining (`null` for a non-consumable). */
  readonly charges: number | null;
  /** Medicine the action actually restores (no overheal). */
  readonly effectiveHealing: number;
  /** Medicine the action would waste on already-healthy allies. */
  readonly wastedHealing: number;
  /** Urgency-weighted bonus on top of {@link effectiveHealing}. */
  readonly healUrgency: number;
  /** Priority for fresh buffs applied to allies. */
  readonly buffValue: number;
  /** Priority for harmful conditions lifted from allies. */
  readonly cleanseValue: number;
  /** Priority for reviving fallen allies. */
  readonly reviveValue: number;
  /** How many buffs would duplicate a condition the ally already carries. */
  readonly redundantBuffs: number;
  /** Scarcity penalty for spending a consumable. */
  readonly consumablePenalty: number;
}

/** Whether a condition is hostile to its bearer (worth cleansing). */
function isHarmfulCondition(id: string): boolean {
  if (!isConditionKey(id)) return false;
  const kind = getCondition(id).kind;
  return kind === "ailment" || kind === "debuff";
}

/** Priority for the harmful conditions `facts` would lift from `target`. */
function cleansePriority(target: Unit, facts: AbilityFacts): number {
  const named = new Set<string>(facts.cleanses);
  let count = 0;
  for (const condition of target.conditions) {
    if (named.has(condition.conditionId)) {
      count += 1;
    } else if (facts.generalCleanse && isHarmfulCondition(condition.conditionId)) {
      count += 1;
    }
  }
  return count * CLEANSE_PRIORITY;
}

/**
 * Judge one action against the battle's forecast and return the support
 * priorities the utility scorer adds to its total. Only allies are considered
 * for healing, buffs, cleanses and revives — a hostile target's damage is the
 * scorer's own business (`./utility.ts`) — and every term is `0` when the
 * action does not apply.
 *
 * The function reads the forecast computed by the caller and the units still
 * standing in `state` (which must be the same state the forecast was made
 * against), so no work is duplicated and no randomness is drawn.
 */
export function evaluateAbility(
  state: BattleState,
  spec: HeuristicAbility,
  forecast: BattleForecast,
): HeuristicEvaluation {
  const classification = classifyAbility(spec);
  const facts = gatherFacts(spec);
  const byId = new Map(state.units.map((unit) => [unit.id, unit]));

  let effectiveHealing = 0;
  let wastedHealing = 0;
  let healUrgency = 0;
  let buffValue = 0;
  let cleanseValue = 0;
  let reviveValue = 0;
  let redundantBuffs = 0;

  for (const entry of forecast.targets) {
    // Support heuristics only see the actor's own side; hostile entries are
    // scored as damage by the utility scorer.
    if (entry.hostile) continue;
    const target = byId.get(entry.unitId);
    if (target === undefined) continue;

    const restored = effectiveHeal(target, entry.healing);
    effectiveHealing += restored;
    wastedHealing += Math.max(0, Math.floor(entry.healing) - restored);
    healUrgency += Math.floor((healNeed(target).urgency * restored) / 100);

    if (classification.role === "buff") {
      const scale = Math.floor(combatValue(target) / COMBAT_VALUE_DIVISOR);
      for (const id of facts.inflicts) {
        if (target.conditions.some((condition) => condition.conditionId === id)) {
          redundantBuffs += 1;
        } else {
          buffValue += BUFF_PRIORITY + scale;
        }
      }
    }

    if (
      classification.role === "cleanse" ||
      facts.cleanses.length > 0 ||
      facts.generalCleanse
    ) {
      cleanseValue += cleansePriority(target, facts);
    }

    if (classification.role === "revive" && isOutOfAction(target)) {
      reviveValue += REVIVE_PRIORITY + combatValue(target);
    }
  }

  return {
    role: classification.role,
    isConsumable: classification.isConsumable,
    charges: classification.charges,
    effectiveHealing,
    wastedHealing,
    healUrgency,
    buffValue,
    cleanseValue,
    reviveValue,
    redundantBuffs,
    consumablePenalty: consumableScarcity(classification.charges),
  };
}
