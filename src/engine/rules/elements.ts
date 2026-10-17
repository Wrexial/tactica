/**
 * Elements (T038) — the eight reflavoured FFTA elements, their defensive
 * affinities, and the damage modification they apply.
 *
 * A battle resolves an action in stages (mapping §12): decide **whether** it
 * connects ({@link rollHit}, T037), compute its raw damage (Steel / Powder,
 * T033–T036), and only then apply the target's **elemental affinity**. This
 * module owns that final stage. FFTA checks elemental properties last and in a
 * fixed order — `docs/wiki/pages/Attack_(command).md`:
 *
 * > - If the target **absorbs** the element, the attack heals the target by the
 *   >   amount it would have dealt as damage.
 * > - If the target is **immune**, the damage reduces to 0.
 * > - If the target **resists**, the damage is halved.
 * > - If the target is **weak**, the damage doubles.
 * > - Otherwise, the damage remains the same.
 *
 * The retheme keeps that maths exactly and renames the causes around the
 * Napoleonic theatre (mapping §7, decision D5): Incendiary shells, Cold,
 * Shock, Siege, Deluge, Smoke, Colours and Terror. The eight definitions are
 * authored in `src/data/elements.ts`; affinities are carried by the target
 * (enemy `affinities` in `src/data/schema.ts`, or gear), never hard-coded here.
 *
 * ## The affinity lookup
 *
 * A combatant stores at most one affinity per element — `weak`, `resist`,
 * `immune` or `absorb` (`AffinitySchema`, `src/data/schema.ts`). An absent
 * entry is **neutral**: the attack lands unmodified. {@link
 * resolveElementAffinity} performs that lookup, defaulting to `neutral` so a
 * caller never has to branch on an undefined map or a non-elemental action.
 *
 * ## The damage modification
 *
 * {@link modifyElementalDamage} turns a neutral raw damage figure plus an
 * affinity into the pair of values the action executor (T041) needs: HP
 * **damage** to subtract and HP **healing** to add. Absorb is the only affinity
 * that produces healing; immune produces neither. The weak and resist factors
 * are {@link ELEMENT_DAMAGE_FORMULA} — **authored balance data** — so the cycle
 * can be retuned without touching the arithmetic (`agents.md` §3, §9, §10).
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Pure and deterministic** — plain integer arithmetic, no DOM, no I/O, no
 *   `Math.random`, no `Date`. The same raw damage and affinity always yield the
 *   same result, so a replay reproduces every elemental interaction.
 * - **No mutation** — inputs are read, never written; results are fresh values.
 * - **Data-driven** — no ability, weapon or element is special-cased. The
 *   affinity arrives as a value, and the balance factors are exported constants.
 * - **Integer in, integer out** — the engine speaks whole numbers, so negative
 *   or fractional raw damage is rejected at the boundary.
 *
 * Reference: `docs/wiki/pages/Attack_(command).md` (elemental properties),
 * `docs/wiki/pages/Final_Fantasy_Tactics_Advance_elements.md` (the eight
 * elements). Fiction: `docs/NAPOLEONIC_MAPPING.md` §7.
 */

import type { Affinity, ElementKey } from "../../data/schema";

/* --------------------------------------------------------------------------
 * Affinities
 * ------------------------------------------------------------------------ */

/**
 * The four non-neutral elemental affinities FFTA assigns, matching
 * `AffinitySchema` (`src/data/schema.ts`). Declared as a tuple for runtime
 * iteration and guards; the `satisfies` clause keeps it in lockstep with the
 * schema's union.
 */
export const ELEMENT_AFFINITIES = [
  "weak",
  "resist",
  "immune",
  "absorb",
] as const satisfies readonly Affinity[];

/** One of the four authored affinities, without the implicit neutral default. */
export type ElementAffinityKey = (typeof ELEMENT_AFFINITIES)[number];

/**
 * A resolved elemental affinity: one of the four authored affinities, or
 * `"neutral"` when the target has no entry for the element (the common case).
 */
export type ElementAffinity = ElementAffinityKey | "neutral";

/**
 * A combatant's per-element defensive affinities, keyed by the stable FFTA
 * element id. Only the non-neutral entries need to appear; every omitted
 * element reads as `"neutral"`. Structurally compatible with the `affinities`
 * field of `EnemyDef` (`src/data/schema.ts`).
 */
export type ElementAffinityMap = Partial<Record<ElementKey, Affinity>>;

/**
 * Runtime guard for untrusted affinity strings (saves, network, content).
 * Accepts the four authored affinities and the engine's `"neutral"` default.
 */
export function isElementAffinity(value: unknown): value is ElementAffinity {
  return (
    value === "neutral" ||
    (typeof value === "string" && (ELEMENT_AFFINITIES as readonly string[]).includes(value))
  );
}

/* --------------------------------------------------------------------------
 * Authored balance data
 * ------------------------------------------------------------------------ */

/**
 * The factors that turn a raw damage figure into an elemental result. Kept as a
 * plain object so content can supply its own without changing the arithmetic —
 * the definition of "data-driven" for the element cycle.
 */
export interface ElementDamageFormula {
  /**
   * Multiplier applied for a **weakness**. The FFTA reference doubles the
   * damage (`2`).
   */
  readonly weakMultiplier: number;
  /**
   * Divisor applied for a **resistance**. The FFTA reference halves the damage
   * (`2`).
   */
  readonly resistDivisor: number;
}

/**
 * The authored element-cycle coefficients. These mirror the scraped FFTA
 * behaviour ("weak ... doubles", "resists ... halved") but are **our** balance
 * data — re-authored, not wiki gospel (`agents.md` §3, §10).
 */
export const ELEMENT_DAMAGE_FORMULA: ElementDamageFormula = {
  weakMultiplier: 2,
  resistDivisor: 2,
};

/* --------------------------------------------------------------------------
 * Validation (fail fast at the content/battle boundary)
 * ------------------------------------------------------------------------ */

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, received ${String(value)}`);
  }
}

/**
 * Reject a malformed {@link ElementDamageFormula}. A bad factor is a
 * programming or content error, not player input.
 */
function assertElementDamageFormula(formula: ElementDamageFormula): void {
  if (!Number.isInteger(formula.weakMultiplier) || formula.weakMultiplier < 0) {
    throw new RangeError(
      `element formula weakMultiplier must be a non-negative integer, received ${String(
        formula.weakMultiplier,
      )}`,
    );
  }
  if (!Number.isInteger(formula.resistDivisor) || formula.resistDivisor < 1) {
    throw new RangeError(
      `element formula resistDivisor must be an integer >= 1, received ${String(
        formula.resistDivisor,
      )}`,
    );
  }
}

/* --------------------------------------------------------------------------
 * The affinity lookup
 * ------------------------------------------------------------------------ */

/**
 * Resolve the affinity a target applies to an incoming element. Returns
 * `"neutral"` when the action is non-elemental, the target carries no affinity
 * map, or the map has no entry for that element.
 *
 * ```ts
 * resolveElementAffinity({ fire: "weak" }, "fire");   // "weak"
 * resolveElementAffinity({ fire: "weak" }, "ice");    // "neutral"
 * resolveElementAffinity(undefined, "fire");          // "neutral"
 * resolveElementAffinity({ fire: "weak" }, undefined); // "neutral"
 * ```
 */
export function resolveElementAffinity(
  affinities: ElementAffinityMap | undefined,
  element: ElementKey | undefined,
): ElementAffinity {
  if (element === undefined || affinities === undefined) return "neutral";
  return affinities[element] ?? "neutral";
}

/* --------------------------------------------------------------------------
 * The damage modification
 * ------------------------------------------------------------------------ */

/**
 * The result of applying an element's affinity to a raw damage figure. Absorb
 * yields **healing** rather than damage; immune yields neither; the caller
 * (T041) turns these into `DamagedEvent` / `HealedEvent` (`events.ts`).
 */
export interface ElementalDamageResult {
  /** The affinity that was applied. */
  readonly affinity: ElementAffinity;
  /** Hit points to subtract from the target (`>= 0`; `0` when absorbed/nullified). */
  readonly damage: number;
  /** Hit points to restore to the target (`>= 0`; only `absorb` heals). */
  readonly healing: number;
}

/**
 * Apply an affinity to a raw damage figure, following FFTA's elemental rules
 * (`docs/wiki/pages/Attack_(command).md`):
 *
 * ```text
 * weak    → damage × weakMultiplier, no healing
 * resist  → floor(damage / resistDivisor), no healing
 * immune  → no damage, no healing
 * absorb  → no damage, healing = raw damage
 * neutral → damage unchanged
 * ```
 *
 * Because a target carries a single affinity per element, FFTA's "first
 * matching check wins" ordering collapses to one factor here; the absorb →
 * immune → resist → weak priority is preserved in {@link resolveElementAffinity}
 * solely by the fact that only one may be authored.
 *
 * ```ts
 * modifyElementalDamage(20, "weak").damage;     // 40
 * modifyElementalDamage(21, "resist").damage;   // 10
 * modifyElementalDamage(20, "immune").damage;   // 0
 * modifyElementalDamage(20, "absorb").healing;  // 20
 * modifyElementalDamage(20, "neutral").damage;  // 20
 * ```
 *
 * Throws a `RangeError` when `rawDamage` is not a non-negative integer, the
 * affinity is not a known value, or the formula is malformed.
 */
export function modifyElementalDamage(
  rawDamage: number,
  affinity: ElementAffinity,
  formula: ElementDamageFormula = ELEMENT_DAMAGE_FORMULA,
): ElementalDamageResult {
  assertNonNegativeInteger(rawDamage, "elemental damage.rawDamage");
  assertElementDamageFormula(formula);
  if (!isElementAffinity(affinity)) {
    throw new RangeError(`unknown elemental affinity: ${String(affinity)}`);
  }

  switch (affinity) {
    case "weak":
      return { affinity, damage: rawDamage * formula.weakMultiplier, healing: 0 };
    case "resist":
      return { affinity, damage: Math.floor(rawDamage / formula.resistDivisor), healing: 0 };
    case "immune":
      return { affinity, damage: 0, healing: 0 };
    case "absorb":
      return { affinity, damage: 0, healing: rawDamage };
    case "neutral":
      return { affinity, damage: rawDamage, healing: 0 };
  }
}

/**
 * Convenience pipeline for the action executor: resolve a target's affinity for
 * an incoming element and immediately apply the damage modification.
 *
 * ```ts
 * const target = { fire: "weak", water: "resist" } as const;
 * applyElementToDamage(20, "fire", target); // { affinity: "weak", damage: 40, healing: 0 }
 * applyElementToDamage(20, "water", target); // { affinity: "resist", damage: 10, healing: 0 }
 * applyElementToDamage(20, "ice", target);   // { affinity: "neutral", damage: 20, healing: 0 }
 * ```
 *
 * Throws the same `RangeError`s as {@link modifyElementalDamage}.
 */
export function applyElementToDamage(
  rawDamage: number,
  element: ElementKey | undefined,
  affinities: ElementAffinityMap | undefined,
  formula: ElementDamageFormula = ELEMENT_DAMAGE_FORMULA,
): ElementalDamageResult {
  const affinity = resolveElementAffinity(affinities, element);
  return modifyElementalDamage(rawDamage, affinity, formula);
}
