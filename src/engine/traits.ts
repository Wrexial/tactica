/**
 * Support traits (T043) — the **passive modifiers** a soldier carries through
 * combat, expressed as composable hooks rather than hard-coded branches.
 *
 * FFTA gives every unit one support slot (an *S-Ability*). Unlike an action
 * (T041) or a reaction (T042), a trait never opens a turn and never emits an
 * event: it **adjusts** the numbers other modules already compute. The retheme
 * keeps the mechanic and renames the classic list
 * (`docs/wiki/pages/Final_Fantasy_Tactics_Advance_support_abilities.md`,
 * mapping §6):
 *
 * | FFTA | Tactica | Fiction | Hook |
 * | ---- | ------- | ------- | ---- |
 * | Half MP | **Thrift** | Stretch the powder and rations | `elanCost` |
 * | Weapon Def+ | **Drilled Guards** | Fight behind a wall of bayonets | `damageTaken` |
 * | Doublehand | **Two-Handed Grip** | Both hands on a one-handed piece | `power` |
 * | Concentrate | **Steady Aim** | Breathe, then fire | `hitRate` |
 * | Weapon Atk+ | **Cold Steel** | Sharpen the blade, drive it home | `power` |
 * | Magic Pow+ | **Powder Discipline** | Measure the charge, not the guess | `power` |
 * | Turbo MP | **Death or Glory** | Double the powder, risk the barrel | `elanCost` + `power` + `hitRate` |
 * | Immunity | **Constitution** | Shrug off the camp fevers | `resistsCondition` |
 * | Geomancy | **Elemental Knowledge** | Know how a target's cover burns | `elementAffinity` |
 * | Double Sword | **Twin Blades** | Two blades, two strokes | `extraAttacks` |
 * | Maintenance | **Kit Care** | Your kit is never stolen or ruined | `protectsEquipment` |
 * | Shieldbearer | **Shield Drill** | Carry a shield whatever the post | `allowsEquip` |
 * | Monkey Grip | **Light Grip** | One hand on a two-handed piece | `allowsEquip` |
 * | Learning | **Foreign Drill** | Study the enemy and copy them | `learnsAbility` |
 *
 * ## Composable hooks
 *
 * A {@link TraitDef} owns a {@link TraitHooks} bag. Every hook is a pure
 * value-to-value function; the resolvers in this module thread a base value
 * through **every equipped trait's** hook in order, so two traits that touch
 * the same domain stack predictably. Content may override or extend any hook
 * through {@link TraitOptions.overrides}, and a unit may carry a list of traits
 * (equipment-granted, scenario buffs) rather than FFTA's single slot — the
 * composition machinery does not care how many traits apply.
 *
 * ```text
 *   base value ──► trait A hook ──► trait B hook ──► … ──► clamped result
 * ```
 *
 * The hooks map onto the seam points the other combat modules expose:
 *
 * - **Declaring an action** (`./actions/resolve.ts`, T024) pays `mpCost`; run
 *   it through {@link applyElanCost} first (Thrift, Death or Glory).
 * - **The action executor** (`./actions/ability.ts`, T041) reads a spec's
 *   `hitRate`, `critRate` and each effect's `power`; {@link withTraits}
 *   returns a copy with those terms already adjusted (Steady Aim, Cold Steel,
 *   Powder Discipline, Two-Handed Grip).
 * - **After a blow lands**, a defender's incoming damage is passed through
 *   {@link applyDamageTaken} (Drilled Guards).
 * - **Conditions** (T039) consult {@link resistsCondition} before applying an
 *   ailment (Constitution); elements (T038) consult
 *   {@link applyElementAffinity} (Elemental Knowledge).
 * - **Weapon exchanges** ask {@link applyExtraAttacks} how many strikes land
 *   (Twin Blades); the equipment screen (T050/T052) asks {@link allowsEquip};
 *   the Blue-Magic analogue (T078) asks {@link learnsAbility}.
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Engine purity** — no DOM, no I/O, no `Math.random`, no `Date`. Every
 *   function is deterministic and total over well-formed inputs.
 * - **Pure & immutable** — inputs are read, never written; `withTraits` returns
 *   a fresh {@link AbilitySpec} rather than mutating the original.
 * - **Data-driven** — the numbers are exported balance constants (Phase 13 owns
 *   the final pass), not literals buried in branches.
 * - **Integer in, integer out** — combat values stay whole numbers so a replay
 *   never drifts on floating point.
 * - **Equipped, not hard-coded** — which trait a soldier carries arrives via
 *   {@link TraitOptions}, mirroring FFTA's single S-Ability slot. The unit model
 *   gains that slot in T051; until then the caller (or a test) supplies a
 *   loadout.
 *
 * Reference: `docs/wiki/pages/Final_Fantasy_Tactics_Advance_support_abilities.md`
 * (the ability table) and mapping §6. Fiction follows
 * `docs/NAPOLEONIC_MAPPING.md` ("Half MP → Thrift; Weapon Def+ → Drilled
 * Guards; Doublehand → Two-Handed Grip; etc.").
 */

import type { ElementKey, EquipSlot, WeaponType } from "../data/schema";
import type { AbilityEffect, AbilitySpec } from "./actions/ability";
import type { DamageType } from "./events";
import { asAbilityId, asConditionId, type AbilityId, type ConditionId } from "./ids";
import type { ElementAffinity } from "./rules/elements";
import type { Unit } from "./unit";

/* --------------------------------------------------------------------------
 * Trait identity
 * ------------------------------------------------------------------------ */

/** The support traits the retheme keeps (mapping §6). */
export const TRAIT_KINDS = [
  "thrift",
  "drilledGuards",
  "twoHandedGrip",
  "steadyAim",
  "coldSteel",
  "powderDiscipline",
  "deathOrGlory",
  "constitution",
  "elementalKnowledge",
  "twinBlades",
  "kitCare",
  "shieldDrill",
  "lightGrip",
  "foreignDrill",
] as const;
export type TraitKind = (typeof TRAIT_KINDS)[number];

/** Runtime guard for untrusted trait-kind strings (UI, saves). */
export function isTraitKind(value: unknown): value is TraitKind {
  return typeof value === "string" && (TRAIT_KINDS as readonly string[]).includes(value);
}

/**
 * The FFTA-shaped ability id of each trait. They are authored as engine
 * constants because the mechanical identity is fixed; display text (name,
 * flavour) belongs to `src/data/` when the full ability catalogue lands (T089).
 */
export const TRAIT_IDS: Readonly<Record<TraitKind, AbilityId>> = {
  thrift: asAbilityId("thrift"),
  drilledGuards: asAbilityId("drilled-guards"),
  twoHandedGrip: asAbilityId("two-handed-grip"),
  steadyAim: asAbilityId("steady-aim"),
  coldSteel: asAbilityId("cold-steel"),
  powderDiscipline: asAbilityId("powder-discipline"),
  deathOrGlory: asAbilityId("death-or-glory"),
  constitution: asAbilityId("constitution"),
  elementalKnowledge: asAbilityId("elemental-knowledge"),
  twinBlades: asAbilityId("twin-blades"),
  kitCare: asAbilityId("kit-care"),
  shieldDrill: asAbilityId("shield-drill"),
  lightGrip: asAbilityId("light-grip"),
  foreignDrill: asAbilityId("foreign-drill"),
};

/** Resolve an equipped ability id to a trait kind, or `undefined`. */
export function traitKindOf(id: AbilityId | string): TraitKind | undefined {
  for (const kind of TRAIT_KINDS) {
    if (TRAIT_IDS[kind] === id) return kind;
  }
  return undefined;
}

/* --------------------------------------------------------------------------
 * Authored balance data (Phase 13 owns the final pass)
 * ------------------------------------------------------------------------ */

/**
 * Divisor applied to an action's Élan cost by **Thrift** (FFTA Half MP). The
 * half-cost rule is kept but authored as a divisor so content can retune it
 * (`agents.md` §3, §10).
 */
export const THRIFT_COST_DIVISOR = 2;

/**
 * Percentage reduction **Drilled Guards** applies to incoming Steel damage
 * (FFTA Weapon Def+). Authored balance data: the reference only says "reduces
 * damage", so the exact figure is ours.
 */
export const DRILLED_GUARDS_REDUCTION = 25;

/**
 * Percentage increase **Two-Handed Grip** applies to a Steel action's power
 * when the bearer's offhand is empty (FFTA Doublehand). Authored balance data.
 */
export const TWO_HANDED_GRIP_BONUS = 50;

/** Flat to-hit bonus **Steady Aim** grants (FFTA Concentrate), in percent. */
export const STEADY_AIM_BONUS = 20;

/** Percentage increase **Cold Steel** applies to a Steel action's power. */
export const COLD_STEEL_BONUS = 25;

/** Percentage increase **Powder Discipline** applies to a Powder power term. */
export const POWDER_DISCIPLINE_BONUS = 25;

/** Élan cost multiplier **Death or Glory** imposes (FFTA Turbo MP doubles it). */
export const DEATH_OR_GLORY_COST_MULTIPLIER = 2;

/** Percentage power increase **Death or Glory** grants on damaging actions. */
export const DEATH_OR_GLORY_POWER_BONUS = 50;

/** Flat to-hit increase **Death or Glory** grants, in percent. */
export const DEATH_OR_GLORY_HIT_BONUS = 20;

/** Extra weapon strokes **Twin Blades** lands (FFTA Double Sword). */
export const TWIN_BLADES_EXTRA_ATTACKS = 1;

/**
 * The ailments **Constitution** shrugs off entirely (FFTA Immunity resists
 * "some status ailments"). The set is authored balance data: it names the
 * physical/mental afflictions a hardened soldier endures, not every debuff, so
 * a Constitution soldier can still be pinned or broken.
 */
export const CONSTITUTION_RESISTS: readonly ConditionId[] = [
  asConditionId("bleeding"),
  asConditionId("dazed"),
  asConditionId("deafened"),
  asConditionId("unconscious"),
  asConditionId("panicked"),
  asConditionId("frenzied"),
];

/**
 * How far **Elemental Knowledge** pushes a target's resistance down the ladder
 * (FFTA Geomancy: "reduces resistance to elements by one level"). A `weak`
 * target cannot fall further; a `neutral` target becomes `weak`.
 */
export const ELEMENT_AFFINITY_DOWNGRADE: Readonly<Record<ElementAffinity, ElementAffinity>> = {
  absorb: "immune",
  immune: "resist",
  resist: "weak",
  weak: "weak",
  neutral: "weak",
};

/* --------------------------------------------------------------------------
 * Hook context
 * ------------------------------------------------------------------------ */

/**
 * Which side of an exchange the trait bearer is on. An offensive trait
 * (Cold Steel, Two-Handed Grip) only fires `"attacker"`; a defensive one
 * (Drilled Guards) only fires `"defender"`.
 */
export const TRAIT_ROLES = ["attacker", "defender"] as const;
export type TraitRole = (typeof TRAIT_ROLES)[number];

/**
 * Everything a hook needs to decide whether it applies and by how much. Built
 * from the exchange in progress: the bearer, its role, the damage channel and
 * element, the action and effect involved, and the opposing soldier.
 *
 * Hooks are pure and receive this value; they must not mutate it or reach for
 * global state (`agents.md` §2).
 */
export interface TraitContext {
  /** The soldier who carries the trait(s) being resolved. */
  readonly unit: Unit;
  /** Whether the bearer is delivering or receiving the effect. */
  readonly role: TraitRole;
  /** Steel / Powder / none channel of the effect under consideration. */
  readonly channel: DamageType;
  /** Element of the effect, when elemental (mapping §7). */
  readonly element?: ElementKey;
  /** The action being used, when known. */
  readonly abilityId?: AbilityId;
  /** The opposing soldier, when known. */
  readonly target?: Unit;
  /** The exact effect kind, for hooks that care about the action family. */
  readonly effectKind?: AbilityEffect["kind"];
}

/** Authoring shape for {@link makeTraitContext}: only `unit` is required. */
export interface TraitContextInput {
  readonly unit: Unit;
  readonly role?: TraitRole;
  readonly channel?: DamageType;
  readonly element?: ElementKey;
  readonly abilityId?: AbilityId;
  readonly target?: Unit;
  readonly effectKind?: AbilityEffect["kind"];
}

/**
 * Build a {@link TraitContext}, defaulting to an `"attacker"` on the `"none"`
 * channel. Keeping the defaults here (rather than at every call site) is what
 * lets a caller ask a one-off question — "what does Thrift make this cost?" —
 * without spelling out an entire exchange.
 */
export function makeTraitContext(input: TraitContextInput): TraitContext {
  return {
    unit: input.unit,
    role: input.role ?? "attacker",
    channel: input.channel ?? "none",
    ...(input.element === undefined ? {} : { element: input.element }),
    ...(input.abilityId === undefined ? {} : { abilityId: input.abilityId }),
    ...(input.target === undefined ? {} : { target: input.target }),
    ...(input.effectKind === undefined ? {} : { effectKind: input.effectKind }),
  };
}

/**
 * A hypothetical equipment request, asked of the `allowsEquip` hook before the
 * full evidence model lands (T050). The post's own legality is the caller's
 * baseline; a trait may *grant* an exception on top.
 */
export interface EquipRequest {
  /** The slot the item would fill. */
  readonly slot: EquipSlot;
  /** The weapon family, for weapon slots. */
  readonly weaponType?: WeaponType;
  /** Whether the item needs both hands to use. */
  readonly twoHanded?: boolean;
  /** Whether the item is a shield. */
  readonly shield?: boolean;
}

/* --------------------------------------------------------------------------
 * Hooks
 * ------------------------------------------------------------------------ */

/**
 * The passive adjustments a trait may make. Every hook is optional; a trait
 * supplies only the ones it cares about. Each takes the value another module
 * computed and returns the adjusted value, so traits compose by threading a
 * base through them in order.
 *
 * A hook must be **pure** and **total**: same context in, same value out, and
 * never a throw for well-formed input.
 */
export interface TraitHooks {
  /** Adjust the Élan cost of an action the bearer declares (Thrift...). */
  readonly elanCost?: (base: number, ctx: TraitContext) => number;
  /** Adjust the to-hit rate of an action the bearer uses (Steady Aim...). */
  readonly hitRate?: (base: number, ctx: TraitContext) => number;
  /** Adjust the critical-hit rate of an action the bearer uses. */
  readonly critRate?: (base: number, ctx: TraitContext) => number;
  /**
   * Adjust an effect's **Power** term before the damage formula runs. Applies
   * to the bearer as the *attacker* (Cold Steel, Two-Handed Grip...).
   */
  readonly power?: (base: number, ctx: TraitContext) => number;
  /**
   * Adjust damage the bearer is about to *take*, after the formula. Applies to
   * the bearer as the *defender* (Drilled Guards...).
   */
  readonly damageTaken?: (base: number, ctx: TraitContext) => number;
  /** Adjust the bearer's evasion term while defending. */
  readonly evasion?: (base: number, ctx: TraitContext) => number;
  /** Adjust how many weapon strokes the bearer lands (Twin Blades...). */
  readonly extraAttacks?: (base: number, ctx: TraitContext) => number;
  /**
   * Whether the bearer shrugs off `conditionId` entirely (Constitution). A
   * `true` from any equipped trait means the condition does not apply.
   */
  readonly resistsCondition?: (conditionId: ConditionId, ctx: TraitContext) => boolean;
  /**
   * Adjust a target's elemental affinity during the bearer's attack (Elemental
   * Knowledge). `ctx.target` is the soldier whose affinity is being read.
   */
  readonly elementAffinity?: (
    base: ElementAffinity,
    element: ElementKey,
    ctx: TraitContext,
  ) => ElementAffinity;
  /**
   * Whether the bearer may bypass a normal equipment restriction. A `true` from
   * any equipped trait *grants* the use; the caller ORs this with the post's
   * baseline legality.
   */
  readonly allowsEquip?: (request: EquipRequest, ctx: TraitContext) => boolean;
  /** Whether the bearer may learn a foreign (enemy) action (Foreign Drill). */
  readonly learnsAbility?: (abilityId: AbilityId, ctx: TraitContext) => boolean;
  /** Whether the bearer's kit is protected from theft or destruction (Kit Care). */
  readonly protectsEquipment?: (ctx: TraitContext) => boolean;
}

/**
 * One support trait: its stable identity, Napoleonic display text and the bag
 * of hooks it contributes. The definition is a plain value so
 * {@link TraitOptions.overrides} can extend it without a subclass.
 */
export interface TraitDef {
  /** Which of the fourteen hooks this is. */
  readonly kind: TraitKind;
  /** FFTA-shaped ability id the unit equips. */
  readonly id: AbilityId;
  /** Napoleonic display name (mapping §6). */
  readonly name: string;
  /** One-line mechanical description for menus and the combat log. */
  readonly description: string;
  /** The passive adjustments this trait makes. */
  readonly hooks: TraitHooks;
}

/* --------------------------------------------------------------------------
 * Hook helpers
 * ------------------------------------------------------------------------ */

/** Whether the soldier has no offhand item, so a weapon can be gripped two-handed. */
function hasFreeOffhand(unit: Unit): boolean {
  return unit.equipment.offhand === null;
}

/** Increase an integer value by a whole percentage, truncating toward zero. */
function boostByPercent(base: number, percent: number): number {
  return Math.trunc((base * (100 + percent)) / 100);
}

/** Reduce an integer value by a whole percentage, never below zero. */
function reduceByPercent(base: number, percent: number): number {
  return Math.max(0, base - Math.trunc((base * percent) / 100));
}

/** Halve an Élan cost, keeping a positive cost at 1 (Thrift). */
function halveElanCost(base: number): number {
  if (base <= 0) return 0;
  return Math.max(1, Math.floor(base / THRIFT_COST_DIVISOR));
}

/** Whether a damaging effect carries a Power term. */
function isDamagePowerEffect(
  effect: AbilityEffect,
): effect is Extract<AbilityEffect, { kind: "steel" | "powder" | "weapon" }> {
  return effect.kind === "steel" || effect.kind === "powder" || effect.kind === "weapon";
}

/* --------------------------------------------------------------------------
 * Trait definitions
 * ------------------------------------------------------------------------ */

/**
 * The fourteen support traits, keyed by kind. Definitions are immutable values;
 * {@link TraitOptions.overrides} layers content-specific changes on top at
 * resolution time (see {@link traitDefinitionFor}).
 */
export const TRAITS: Readonly<Record<TraitKind, TraitDef>> = {
  thrift: {
    kind: "thrift",
    id: TRAIT_IDS.thrift,
    name: "Thrift",
    description: "Stretch the powder and rations: Élan costs are halved.",
    hooks: {
      elanCost: (base) => halveElanCost(base),
    },
  },
  drilledGuards: {
    kind: "drilledGuards",
    id: TRAIT_IDS.drilledGuards,
    name: "Drilled Guards",
    description: "Discipline behind the guard reduces incoming Steel damage.",
    hooks: {
      damageTaken: (base, ctx) =>
        ctx.role === "defender" && ctx.channel === "steel"
          ? reduceByPercent(base, DRILLED_GUARDS_REDUCTION)
          : base,
    },
  },
  twoHandedGrip: {
    kind: "twoHandedGrip",
    id: TRAIT_IDS.twoHandedGrip,
    name: "Two-Handed Grip",
    description: "Both hands on a one-handed piece: more power when the offhand is empty.",
    hooks: {
      power: (base, ctx) =>
        ctx.role === "attacker" && ctx.channel === "steel" && hasFreeOffhand(ctx.unit)
          ? boostByPercent(base, TWO_HANDED_GRIP_BONUS)
          : base,
    },
  },
  steadyAim: {
    kind: "steadyAim",
    id: TRAIT_IDS.steadyAim,
    name: "Steady Aim",
    description: "Breathe, then fire: a steadier attack improves the to-hit rate.",
    hooks: {
      hitRate: (base, ctx) => (ctx.role === "attacker" ? base + STEADY_AIM_BONUS : base),
    },
  },
  coldSteel: {
    kind: "coldSteel",
    id: TRAIT_IDS.coldSteel,
    name: "Cold Steel",
    description: "Sharpen the blade and drive it home: Steel power is increased.",
    hooks: {
      power: (base, ctx) =>
        ctx.role === "attacker" && ctx.channel === "steel"
          ? boostByPercent(base, COLD_STEEL_BONUS)
          : base,
    },
  },
  powderDiscipline: {
    kind: "powderDiscipline",
    id: TRAIT_IDS.powderDiscipline,
    name: "Powder Discipline",
    description: "Measure the charge, not the guess: Powder power is increased.",
    hooks: {
      power: (base, ctx) =>
        ctx.role === "attacker" && ctx.channel === "powder"
          ? boostByPercent(base, POWDER_DISCIPLINE_BONUS)
          : base,
    },
  },
  deathOrGlory: {
    kind: "deathOrGlory",
    id: TRAIT_IDS.deathOrGlory,
    name: "Death or Glory",
    description:
      "Double the powder and risk the barrel: costs twice the Élan for more damage and accuracy.",
    hooks: {
      elanCost: (base) => base * DEATH_OR_GLORY_COST_MULTIPLIER,
      power: (base, ctx) =>
        ctx.role === "attacker" && (ctx.channel === "steel" || ctx.channel === "powder")
          ? boostByPercent(base, DEATH_OR_GLORY_POWER_BONUS)
          : base,
      hitRate: (base, ctx) => (ctx.role === "attacker" ? base + DEATH_OR_GLORY_HIT_BONUS : base),
    },
  },
  constitution: {
    kind: "constitution",
    id: TRAIT_IDS.constitution,
    name: "Constitution",
    description: "Shrug off the camp fevers: resistance to several status ailments.",
    hooks: {
      resistsCondition: (conditionId) => CONSTITUTION_RESISTS.includes(conditionId),
    },
  },
  elementalKnowledge: {
    kind: "elementalKnowledge",
    id: TRAIT_IDS.elementalKnowledge,
    name: "Elemental Knowledge",
    description: "Know how a target's cover burns: reduce its element resistance by one level.",
    hooks: {
      elementAffinity: (base, _element, ctx) =>
        ctx.role === "attacker" ? ELEMENT_AFFINITY_DOWNGRADE[base] : base,
    },
  },
  twinBlades: {
    kind: "twinBlades",
    id: TRAIT_IDS.twinBlades,
    name: "Twin Blades",
    description: "Two blades, two strokes: land an extra weapon attack.",
    hooks: {
      extraAttacks: (base, ctx) =>
        ctx.role === "attacker" ? base + TWIN_BLADES_EXTRA_ATTACKS : base,
    },
  },
  kitCare: {
    kind: "kitCare",
    id: TRAIT_IDS.kitCare,
    name: "Kit Care",
    description: "Look after your kit: gear cannot be stolen or destroyed.",
    hooks: {
      protectsEquipment: () => true,
    },
  },
  shieldDrill: {
    kind: "shieldDrill",
    id: TRAIT_IDS.shieldDrill,
    name: "Shield Drill",
    description: "Carry a shield whatever the post.",
    hooks: {
      allowsEquip: (request) => request.slot === "offhand" && request.shield === true,
    },
  },
  lightGrip: {
    kind: "lightGrip",
    id: TRAIT_IDS.lightGrip,
    name: "Light Grip",
    description: "One hand on a two-handed piece.",
    hooks: {
      allowsEquip: (request) => request.twoHanded === true,
    },
  },
  foreignDrill: {
    kind: "foreignDrill",
    id: TRAIT_IDS.foreignDrill,
    name: "Foreign Drill",
    description: "Study the enemy and copy them: learn actions used against you.",
    hooks: {
      learnsAbility: () => true,
    },
  },
};

/* --------------------------------------------------------------------------
 * Loadout and composition
 * ------------------------------------------------------------------------ */

/**
 * Which traits a soldier carries. FFTA allows one support ability at a time, so
 * {@link loadout} maps a unit id to a single trait; {@link loadoutMany} and
 * {@link traitsOf} exist for content that grants several (equipment, scenario
 * buffs) and are what make the hooks genuinely composable.
 *
 * Precedence: {@link traitsOf} beats {@link loadoutMany} beats {@link loadout}.
 */
export interface TraitOptions {
  /**
   * One equipped support ability per soldier, keyed by unit id (FFTA's single
   * S-Ability slot). Values may be a trait kind or its ability id.
   */
  readonly loadout?: Readonly<Record<string, AbilityId | TraitKind>>;
  /** Several traits per soldier, keyed by unit id. */
  readonly loadoutMany?: Readonly<Record<string, readonly (AbilityId | TraitKind)[]>>;
  /** Alternative lookup; takes precedence over the loadouts when present. */
  readonly traitsOf?: (unit: Unit) => readonly (AbilityId | TraitKind)[] | undefined;
  /**
   * Override or extend a trait's hooks for this resolution. Only the hooks
   * supplied are replaced, so content can retune one number without cloning the
   * whole definition.
   */
  readonly overrides?: Partial<Readonly<Record<TraitKind, TraitHooks>>>;
}

/** Coerce a loadout entry (id or kind) to a trait kind. */
function asTraitKind(value: AbilityId | TraitKind | undefined): TraitKind | undefined {
  if (value === undefined) return undefined;
  return isTraitKind(value) ? value : traitKindOf(value);
}

/** The raw trait entries a soldier carries under `options`, in authored order. */
function traitEntriesFor(unit: Unit, options: TraitOptions): readonly (AbilityId | TraitKind)[] {
  const explicit = options.traitsOf?.(unit);
  if (explicit !== undefined) return explicit;
  const many = options.loadoutMany?.[unit.id];
  if (many !== undefined) return many;
  const single = options.loadout?.[unit.id];
  return single === undefined ? [] : [single];
}

/**
 * The trait kinds a soldier carries, deduplicated and in order. Unknown ids are
 * ignored (a save may reference content that was removed).
 */
export function equippedTraitKinds(unit: Unit, options: TraitOptions = {}): readonly TraitKind[] {
  const kinds: TraitKind[] = [];
  for (const entry of traitEntriesFor(unit, options)) {
    const kind = asTraitKind(entry);
    if (kind !== undefined && !kinds.includes(kind)) kinds.push(kind);
  }
  return kinds;
}

/** Merge a trait's definition with any per-resolution override hooks. */
export function traitDefinitionFor(kind: TraitKind, options: TraitOptions = {}): TraitDef {
  const base = TRAITS[kind];
  const override = options.overrides?.[kind];
  if (override === undefined) return base;
  return { ...base, hooks: { ...base.hooks, ...override } };
}

/**
 * The trait definitions a soldier carries, in authored order, each with its
 * override hooks applied. This is the list every resolver composes over.
 */
export function equippedTraits(unit: Unit, options: TraitOptions = {}): readonly TraitDef[] {
  return equippedTraitKinds(unit, options).map((kind) => traitDefinitionFor(kind, options));
}

/** The first trait a soldier carries, or `undefined` for an empty slot. */
export function equippedTrait(unit: Unit, options: TraitOptions = {}): TraitKind | undefined {
  return equippedTraitKinds(unit, options)[0];
}

/** The full definition of the soldier's first trait, or `undefined`. */
export function traitOf(unit: Unit, options: TraitOptions = {}): TraitDef | undefined {
  const kind = equippedTrait(unit, options);
  return kind === undefined ? undefined : traitDefinitionFor(kind, options);
}

/* --------------------------------------------------------------------------
 * Resolvers
 * ------------------------------------------------------------------------ */

/**
 * Thread `base` through the `elanCost` hook of every trait the *context's
 * soldier* carries. Negative results are clamped to zero.
 */
export function applyElanCost(base: number, ctx: TraitContext, options: TraitOptions = {}): number {
  let value = base;
  for (const def of equippedTraits(ctx.unit, options)) {
    if (def.hooks.elanCost !== undefined) value = def.hooks.elanCost(value, ctx);
  }
  return Math.max(0, Math.trunc(value));
}

/** Thread `base` through the `hitRate` hooks, clamped to `[0, 100]`. */
export function applyHitRate(base: number, ctx: TraitContext, options: TraitOptions = {}): number {
  let value = base;
  for (const def of equippedTraits(ctx.unit, options)) {
    if (def.hooks.hitRate !== undefined) value = def.hooks.hitRate(value, ctx);
  }
  return Math.max(0, Math.min(100, Math.trunc(value)));
}

/** Thread `base` through the `critRate` hooks, clamped to `[0, 100]`. */
export function applyCritRate(base: number, ctx: TraitContext, options: TraitOptions = {}): number {
  let value = base;
  for (const def of equippedTraits(ctx.unit, options)) {
    if (def.hooks.critRate !== undefined) value = def.hooks.critRate(value, ctx);
  }
  return Math.max(0, Math.min(100, Math.trunc(value)));
}

/** Thread an effect's Power term through the `power` hooks (attacker side). */
export function applyPower(base: number, ctx: TraitContext, options: TraitOptions = {}): number {
  let value = base;
  for (const def of equippedTraits(ctx.unit, options)) {
    if (def.hooks.power !== undefined) value = def.hooks.power(value, ctx);
  }
  return Math.trunc(value);
}

/** Thread incoming damage through the `damageTaken` hooks (defender side). */
export function applyDamageTaken(
  base: number,
  ctx: TraitContext,
  options: TraitOptions = {},
): number {
  let value = base;
  for (const def of equippedTraits(ctx.unit, options)) {
    if (def.hooks.damageTaken !== undefined) value = def.hooks.damageTaken(value, ctx);
  }
  return Math.max(0, Math.trunc(value));
}

/** Thread an evasion term through the `evasion` hooks, floored at zero. */
export function applyEvasion(base: number, ctx: TraitContext, options: TraitOptions = {}): number {
  let value = base;
  for (const def of equippedTraits(ctx.unit, options)) {
    if (def.hooks.evasion !== undefined) value = def.hooks.evasion(value, ctx);
  }
  return Math.max(0, Math.trunc(value));
}

/** Thread a stroke count through the `extraAttacks` hooks, floored at zero. */
export function applyExtraAttacks(
  base: number,
  ctx: TraitContext,
  options: TraitOptions = {},
): number {
  let value = base;
  for (const def of equippedTraits(ctx.unit, options)) {
    if (def.hooks.extraAttacks !== undefined) value = def.hooks.extraAttacks(value, ctx);
  }
  return Math.max(0, Math.trunc(value));
}

/**
 * Whether any equipped trait makes the soldier immune to `conditionId`. Pure
 * forecast: the condition engine (T039) skips application when this is `true`.
 */
export function resistsCondition(
  conditionId: ConditionId,
  ctx: TraitContext,
  options: TraitOptions = {},
): boolean {
  for (const def of equippedTraits(ctx.unit, options)) {
    if (def.hooks.resistsCondition?.(conditionId, ctx) === true) return true;
  }
  return false;
}

/**
 * Thread a resolved elemental affinity through the `elementAffinity` hooks.
 * Used by the caster's traits against the target's affinity (Elemental
 * Knowledge).
 */
export function applyElementAffinity(
  base: ElementAffinity,
  element: ElementKey,
  ctx: TraitContext,
  options: TraitOptions = {},
): ElementAffinity {
  let value = base;
  for (const def of equippedTraits(ctx.unit, options)) {
    if (def.hooks.elementAffinity !== undefined) {
      value = def.hooks.elementAffinity(value, element, ctx);
    }
  }
  return value;
}

/**
 * Whether an equipped trait *grants* an otherwise-restricted equipment use.
 * The caller combines this with the post's baseline legality (logical OR): a
 * `false` here never forbids anything, it only declines to grant an exception.
 */
export function allowsEquip(
  request: EquipRequest,
  ctx: TraitContext,
  options: TraitOptions = {},
): boolean {
  for (const def of equippedTraits(ctx.unit, options)) {
    if (def.hooks.allowsEquip?.(request, ctx) === true) return true;
  }
  return false;
}

/** Whether an equipped trait lets the soldier learn a foreign action. */
export function learnsAbility(
  abilityId: AbilityId,
  ctx: TraitContext,
  options: TraitOptions = {},
): boolean {
  for (const def of equippedTraits(ctx.unit, options)) {
    if (def.hooks.learnsAbility?.(abilityId, ctx) === true) return true;
  }
  return false;
}

/** Whether an equipped trait protects the soldier's kit from theft/destruction. */
export function protectsEquipment(ctx: TraitContext, options: TraitOptions = {}): boolean {
  for (const def of equippedTraits(ctx.unit, options)) {
    if (def.hooks.protectsEquipment?.(ctx) === true) return true;
  }
  return false;
}

/* --------------------------------------------------------------------------
 * Applying traits to an action spec
 * ------------------------------------------------------------------------ */

/**
 * Return a copy of `spec` with the caster's traits already applied: the Élan
 * cost through {@link applyElanCost}, the accuracy and crit rate through the
 * respective hooks, and each damaging effect's Power term through
 * {@link applyPower}. Non-damaging effects (a bandage, a cleanse) are copied
 * unchanged — Cold Steel does not mend a wound.
 *
 * This is the one-call integration point for the action executor (T041): map an
 * authored `AbilityDef` to an `AbilitySpec`, pass it here, then hand the result
 * to `executeAbility`. The original spec is never mutated, so a caller can keep
 * using it elsewhere.
 *
 * ```ts
 * const aimed = withTraits(shot, rifleman, { loadout: { [rifleman.id]: "steadyAim" } });
 * const { state: next } = executeAbility(state, rifleman, aimed, target, rng);
 * ```
 */
export function withTraits(
  spec: AbilitySpec,
  caster: Unit,
  options: TraitOptions = {},
): AbilitySpec {
  const base = makeTraitContext({ unit: caster, role: "attacker" });
  const mpCost = applyElanCost(spec.mpCost, base, options);
  const hitRate = applyHitRate(spec.hitRate ?? 100, base, options);
  const critRate = applyCritRate(spec.critRate ?? 0, base, options);

  const effects = spec.effects.map((effect): AbilityEffect => {
    if (!isDamagePowerEffect(effect)) return effect;
    const channel: DamageType = effect.kind === "powder" ? "powder" : "steel";
    const ctx = makeTraitContext({
      unit: caster,
      role: "attacker",
      channel,
      abilityId: spec.id,
      effectKind: effect.kind,
      ...(effect.element === undefined ? {} : { element: effect.element }),
    });
    return { ...effect, power: applyPower(effect.power, ctx, options) };
  });

  return { ...spec, mpCost, hitRate, critRate, effects };
}
