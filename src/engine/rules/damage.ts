/**
 * Steel (physical) damage (T033) — FFTA's physical damage formula, rethemed.
 *
 * The retheme renames FFTA's physical/magical split to **Steel** and **Powder**
 * (mapping §12, `docs/NAPOLEONIC_MAPPING.md`): Steel is sabre, lance, bayonet
 * and small-arms fire; Powder is artillery, medicine and signals (T034). The
 * maths is unchanged. This module owns both the **Steel** (T033) and **Powder**
 * (T034) formulas; weapon-family variants arrive with T035, reusing the
 * {@link DamageFormula} shape and the {@link computeBaseDamage} /
 * {@link applyPower} kernel defined here.
 *
 * ## The formula
 *
 * Per `docs/wiki/pages/Attack_(command).md` (FFTA section), for the majority of
 * physical attacks:
 *
 * ```text
 * base   = Attacker's Weapon Attack − floor(Target's Weapon Def / 2)
 * damage = base × Power / 100
 * ```
 *
 * Both steps truncate (FFTA works in integer arithmetic) and the result is
 * floored at zero. In Tactica's naming, `Weapon Attack` is the attacker's
 * **effective weapon attack** (kit Weapon Power plus the equipment `EqAtk`
 * bonus) and `Weapon Def` is the target's effective `def` stat — both derived by
 * `stats.ts` (T018). `Power` is the data-driven ability term: for weapon-based
 * actions content authors take it from the equipment `EqAtt` bonus, otherwise
 * from the ability's own `power` field (schema `AbilityDef.power`).
 *
 * ## Resolving the wiki's ambiguous "final formula"
 *
 * The scraped page states the step-wise version above, then adds a one-line
 * "final formula":
 *
 * ```text
 * (caster strength + weapon attack) − (target defence / 2) × (weapon att / 100)
 * ```
 *
 * That line is internally inconsistent with the prose and is treated as garbled
 * reference text (see `agents.md` §10, which flags it). Two conflicts:
 *
 * 1. **The multiplier.** The prose says the multiplier is `Power/100`; the
 *    one-liner substitutes `weapon att/100`. We keep `Power/100`, because the
 *    prose explicitly defines Power ("the strength of the ability being used",
 *    or the equipment `EqAtt` bonus for weapon actions) and a weapon-attack
 *    multiplier would double-count the weapon already in the base term.
 * 2. **The Strength term.** The one-liner adds `caster strength` to the base;
 *    the step-wise formula does not. We do **not** add a separate Strength term:
 *    the attacker's Strength (`atk`) already feeds the equipment-derived Weapon
 *    Attack upstream in `stats.ts`, so adding it again here would double-count
 *    it. This keeps the formula a single, data-driven pipeline.
 *
 * Net resolution: **trust the step-wise version** and model it as data. The
 * {@link DamageFormula} coefficients are exported so T034 (Powder) and T035
 * (weapon-family variants) can supply their own without touching this logic.
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Pure and deterministic** — plain integer arithmetic, no DOM, no I/O, no
 *   `Math.random`, no `Date`. Identical inputs always yield an identical
 *   integer, so a replay reproduces every hit.
 * - **No mutation** — the input object is only read, never written.
 * - **Data-driven** — no ability, weapon or unit is special-cased. The offense,
 *   defense and power terms arrive as arguments (or as a {@link DamageFormula}
 *   supplied by content), and the only literals are the exported reference
 *   coefficients.
 * - **Integer in, integer out** — the engine speaks whole numbers, so negative
 *   or fractional inputs are rejected at the boundary rather than silently
 *   rounded.
 *
 * ## Powder (magical) damage (T034)
 *
 * The same shape with different named stats. Per
 * `docs/wiki/pages/Magic_(command).md` (FFTA section):
 *
 * ```text
 * base   = Caster's Magic Power − floor(Target's Magic Resistance / 2)
 * damage = base × Power / 100
 * ```
 *
 * Here `Caster's Magic Power` is the attacker's effective `mag` stat and
 * `Target's Magic Resistance` is the target's effective `res` stat (both from
 * `stats.ts`, T018). Powder covers artillery, medicine, signals and morale
 * (mapping §7, §12) — the mundane causes behind FFTA's "magic". The `Power`
 * term follows the same rule as Steel: the equipment `EqAtt` bonus for
 * weapon-based actions, otherwise the ability's `power` field.
 *
 * The wiki gives no ambiguous secondary line for the magical formula, so it is
 * taken verbatim. The coefficients still live in {@link POWDER_FORMULA} as our
 * re-authored balance data, so it can diverge from Steel later without touching
 * the arithmetic.
 *
 * Reference: `docs/wiki/pages/Attack_(command).md` (Steel),
 * `docs/wiki/pages/Magic_(command).md` (Powder). Fiction:
 * `docs/NAPOLEONIC_MAPPING.md` §12 ("Physical and magical damage formulas from
 * the wiki become Steel and Powder formulas").
 */

/* --------------------------------------------------------------------------
 * Formula shape (shared by Steel and Powder)
 * ------------------------------------------------------------------------ */

/**
 * The two coefficients that shape the common offense − defense÷N, ×Power÷M
 * damage formula. Kept as a plain object so T034 (Powder) and T035
 * (weapon-family variants) can pass their own authored coefficients without
 * changing the arithmetic here — the definition of "data-driven" for damage.
 */
export interface DamageFormula {
  /**
   * Divisor applied to the target's defense stat before subtraction. The FFTA
   * reference is `2` ("[Target's Weapon Def / 2]").
   */
  readonly defenseDivisor: number;
  /**
   * Divisor applied to the ability's Power term. The FFTA reference is `100`
   * ("damage is multiplied by Power/100").
   */
  readonly powerDivisor: number;
}

/**
 * The authored Steel (physical) formula coefficients. These mirror the scraped
 * FFTA values (`defenseDivisor: 2`, `powerDivisor: 100`) but are **our** balance
 * data — re-authored, not wiki gospel (`agents.md` §3, §10).
 */
export const STEEL_FORMULA: DamageFormula = {
  defenseDivisor: 2,
  powerDivisor: 100,
};

/**
 * The authored Powder (magical) formula coefficients. Structurally identical to
 * {@link STEEL_FORMULA} — the FFTA magical formula also halves the defence stat
 * and scales by `Power/100` — but kept as separate balance data so the two
 * damage channels can be tuned independently (`agents.md` §3, §10).
 */
export const POWDER_FORMULA: DamageFormula = {
  defenseDivisor: 2,
  powerDivisor: 100,
};

/**
 * Input to {@link computeSteelDamage}: the two combat stats and the ability's
 * power term. All three are plain integers; the caller (the action executor,
 * T041) resolves them from the derived stat blocks and the authored ability /
 * equipment data.
 */
export interface SteelDamageInput {
  /**
   * The attacker's effective Weapon Attack (FFTA "Weapon Attack"): kit Weapon
   * Power plus the equipment `EqAtk` bonus. `>= 0`.
   */
  readonly weaponAtk: number;
  /**
   * The target's effective Weapon Def (FFTA "Weapon Def"): its `def` stat after
   * equipment and conditions. `>= 0`.
   */
  readonly targetWeaponDef: number;
  /**
   * The ability's Power term (FFTA "Power"): the equipment `EqAtt` bonus for
   * weapon-based actions, otherwise the ability's own `power` field. May be
   * negative for unusual actions; the result is still floored at zero.
   */
  readonly power: number;
}

/**
 * Input to {@link computePowderDamage}: the two magical combat stats and the
 * ability's power term. All three are plain integers; the caller (the action
 * executor, T041) resolves them from the derived stat blocks and the authored
 * ability / equipment data.
 */
export interface PowderDamageInput {
  /**
   * The attacker's effective Magic Power (FFTA "Caster's Magic Power"): the
   * `mag` stat after equipment and conditions. `>= 0`.
   */
  readonly magicPower: number;
  /**
   * The target's effective Magic Resistance (FFTA "Target's Magic
   * Resistance"): the `res` stat after equipment and conditions. `>= 0`.
   */
  readonly targetMagicRes: number;
  /**
   * The ability's Power term (FFTA "Power"): the equipment `EqAtt` bonus for
   * weapon-based actions, otherwise the ability's own `power` field. May be
   * negative for unusual actions; the result is still floored at zero.
   */
  readonly power: number;
}

/* --------------------------------------------------------------------------
 * Validation (fail fast at the content/battle boundary)
 * ------------------------------------------------------------------------ */

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, received ${String(value)}`);
  }
}

function assertInteger(value: number, label: string): void {
  if (!Number.isInteger(value)) {
    throw new RangeError(`${label} must be an integer, received ${String(value)}`);
  }
}

/**
 * Reject a malformed {@link DamageFormula}. Formulas are code/authored data, so
 * an invalid coefficient is a programming or content error, not player input.
 */
function assertFormula(formula: DamageFormula): void {
  if (!Number.isInteger(formula.defenseDivisor) || formula.defenseDivisor < 1) {
    throw new RangeError(
      `damage formula defenseDivisor must be an integer >= 1, received ${String(
        formula.defenseDivisor,
      )}`,
    );
  }
  if (!Number.isInteger(formula.powerDivisor) || formula.powerDivisor < 1) {
    throw new RangeError(
      `damage formula powerDivisor must be an integer >= 1, received ${String(formula.powerDivisor)}`,
    );
  }
}

/* --------------------------------------------------------------------------
 * The formula
 * ------------------------------------------------------------------------ */

/**
 * The first half of the formula: `offense − floor(defense / defenseDivisor)`,
 * floored at zero. Exposed separately because it is the piece the weapon-family
 * variants (T035) and the Powder formula (T034) both reuse.
 *
 * ```ts
 * computeBaseDamage(20, 10); // 20 − floor(10/2) = 15
 * computeBaseDamage(3, 20);  // 3 − 10 = −7 → 0
 * ```
 *
 * This helper performs no validation: it is the shared arithmetic kernel.
 * Callers that accept untrusted numbers should validate first, as
 * {@link computeSteelDamage} does.
 */
export function computeBaseDamage(
  offense: number,
  defense: number,
  formula: DamageFormula = STEEL_FORMULA,
): number {
  assertFormula(formula);
  return Math.max(0, offense - Math.floor(defense / formula.defenseDivisor));
}

/**
 * Apply the ability's Power term to a base damage value:
 * `floor(base × power / powerDivisor)`, floored at zero. Split out so the
 * executor (T041) can apply situational multipliers between the two steps
 * without duplicating the arithmetic.
 */
export function applyPower(
  baseDamage: number,
  power: number,
  formula: DamageFormula = STEEL_FORMULA,
): number {
  assertFormula(formula);
  return Math.max(0, Math.floor((baseDamage * power) / formula.powerDivisor));
}

/**
 * Compute Steel (physical) damage: `WeaponAtk − TargetWeaponDef/2`, then
 * `× Power/100`, truncated and floored at zero. See the module header for how
 * the wiki's ambiguous secondary line was resolved.
 *
 * ```ts
 * computeSteelDamage({ weaponAtk: 20, targetWeaponDef: 10, power: 100 }); // 15
 * computeSteelDamage({ weaponAtk: 20, targetWeaponDef: 10, power: 50 });  // 7
 * computeSteelDamage({ weaponAtk: 3,  targetWeaponDef: 20, power: 100 }); // 0
 * ```
 *
 * Throws a `RangeError` when `weaponAtk`/`targetWeaponDef` are not
 * non-negative integers or `power` is not an integer. The result is always a
 * non-negative integer, so it can be placed straight into a `DamagedEvent`
 * (`events.ts`).
 */
export function computeSteelDamage(
  input: SteelDamageInput,
  formula: DamageFormula = STEEL_FORMULA,
): number {
  const { weaponAtk, targetWeaponDef, power } = input;
  assertNonNegativeInteger(weaponAtk, "steel damage.weaponAtk");
  assertNonNegativeInteger(targetWeaponDef, "steel damage.targetWeaponDef");
  assertInteger(power, "steel damage.power");
  assertFormula(formula);

  const base = computeBaseDamage(weaponAtk, targetWeaponDef, formula);
  return applyPower(base, power, formula);
}

/**
 * Compute Powder (magical) damage: `MagicPower − TargetMagicRes/2`, then
 * `× Power/100`, truncated and floored at zero. See the module header for the
 * formula's reference. Powder covers artillery, medicine, signals and morale
 * (mapping §7, §12).
 *
 * ```ts
 * computePowderDamage({ magicPower: 30, targetMagicRes: 12, power: 100 }); // 24
 * computePowderDamage({ magicPower: 30, targetMagicRes: 12, power: 50 });  // 12
 * computePowderDamage({ magicPower: 4,  targetMagicRes: 20, power: 100 }); // 0
 * ```
 *
 * Throws a `RangeError` when `magicPower`/`targetMagicRes` are not
 * non-negative integers or `power` is not an integer. The result is always a
 * non-negative integer, so it can be placed straight into a `DamagedEvent`
 * (`events.ts`).
 */
export function computePowderDamage(
  input: PowderDamageInput,
  formula: DamageFormula = POWDER_FORMULA,
): number {
  const { magicPower, targetMagicRes, power } = input;
  assertNonNegativeInteger(magicPower, "powder damage.magicPower");
  assertNonNegativeInteger(targetMagicRes, "powder damage.targetMagicRes");
  assertInteger(power, "powder damage.power");
  assertFormula(formula);

  const base = computeBaseDamage(magicPower, targetMagicRes, formula);
  return applyPower(base, power, formula);
}

/* --------------------------------------------------------------------------
 * Weapon-family variants (T035)
 *
 * FFTA's own physical section gives one shared formula, so the weapon-type
 * variants come from the **Final Fantasy Tactics** list on the same page
 * (`docs/wiki/pages/Attack_(command).md`), the tactical series FFTA descends
 * from. There, the damage is `offense(attacker stats) × weapon power`, with the
 * offense factor differing per weapon family:
 *
 * - Swords / spears / knightswords → `PA × WP`
 * - Knives / longbows → `(PA + Spd) / 2 × WP`
 * - Staves → `MA × WP`
 * - Instruments → `(PA + MA) / 2 × WP`
 * - Physical guns → `WP²` (no attacker stat)
 *
 * Tactica re-authors those shapes as **data-driven coefficients** rather than a
 * hard-coded switch. A {@link WeaponFormula} extends the shared
 * {@link DamageFormula} with an integer-weighted **offense basis** (how the
 * attacker's `atk`/`spd`/`mag` and the weapon's own power combine) plus a
 * `weaponPowerMode` for the gun's square term. Everything else — the halved
 * defence subtraction and the `Power/100` multiplier — is the same kernel used
 * by Steel and Powder, so a variant cannot silently diverge from the core
 * maths.
 *
 * The concrete coefficients are **authored balance data** in
 * `src/data/weapons.ts` (one entry per {@link WeaponType}), inspired by but not
 * copied from the reference (`agents.md` §3, §10). This module knows nothing
 * about specific weapon ids: callers pass the family's formula in.
 * ------------------------------------------------------------------------ */

/** How a weapon family combines its offense factor with the weapon's power. */
export type WeaponPowerMode = "multiply" | "square";

/**
 * A weapon family's damage recipe: the shared {@link DamageFormula} kernel plus
 * an integer-weighted offense basis.
 *
 * ```text
 * statTerm = atkWeight×atk + spdWeight×spd + magWeight×mag
 * factor   = trunc(statTerm / offenseDivisor)
 * offense  = factor × weaponPower            (mode "multiply")
 *          = weaponPower × weaponPower       (mode "square")
 * damage   = SteelKernel(offense, targetWeaponDef, power)
 * ```
 *
 * Weight `0` means the family ignores that stat; `offenseDivisor: 1` means no
 * averaging. The gun's `WP²` term is expressed with all weights `0` and
 * `weaponPowerMode: "square"`, so no ability or weapon id is special-cased.
 */
export interface WeaponFormula extends DamageFormula {
  /** Weight on the attacker's `atk` (FFTA physical attack / `PA`). */
  readonly atkWeight: number;
  /** Weight on the attacker's `spd` (FFTA speed / `Sp`). */
  readonly spdWeight: number;
  /** Weight on the attacker's `mag` (FFTA magic attack / `MA`). */
  readonly magWeight: number;
  /** Divisor applied to the weighted stat sum (the `/2` in `(PA+Spd)/2`). */
  readonly offenseDivisor: number;
  /** Whether the offense factor multiplies weapon power, or is squared power. */
  readonly weaponPowerMode: WeaponPowerMode;
}

/**
 * Input to {@link computeWeaponOffense}: the attacker's three offensive stats
 * and the equipped weapon's power. All four are non-negative integers.
 */
export interface WeaponOffenseInput {
  /** The attacker's effective `atk` (`PA`) stat. `>= 0`. */
  readonly atk: number;
  /** The attacker's effective `spd` (`Sp`) stat. `>= 0`. */
  readonly spd: number;
  /** The attacker's effective `mag` (`MA`) stat. `>= 0`. */
  readonly mag: number;
  /** The equipped weapon's Weapon Power (`WP`). `>= 0`. */
  readonly weaponPower: number;
}

/**
 * Input to {@link computeWeaponDamage}: a {@link WeaponOffenseInput} plus the
 * defender's Weapon Def and the action's Power term, exactly as Steel expects.
 */
export interface WeaponDamageInput extends WeaponOffenseInput {
  /** The target's effective Weapon Def (`def`). `>= 0`. */
  readonly targetWeaponDef: number;
  /** The action's Power term; see {@link SteelDamageInput.power}. */
  readonly power: number;
}

function assertWeaponFormula(formula: WeaponFormula): void {
  assertFormula(formula);
  for (const [label, value] of [
    ["atkWeight", formula.atkWeight],
    ["spdWeight", formula.spdWeight],
    ["magWeight", formula.magWeight],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new RangeError(`weapon formula ${label} must be a non-negative integer`);
    }
  }
  if (!Number.isInteger(formula.offenseDivisor) || formula.offenseDivisor < 1) {
    throw new RangeError(
      `weapon formula offenseDivisor must be an integer >= 1, received ${String(
        formula.offenseDivisor,
      )}`,
    );
  }
  if (formula.weaponPowerMode !== "multiply" && formula.weaponPowerMode !== "square") {
    throw new RangeError(
      `weapon formula weaponPowerMode must be "multiply" or "square", received ${String(
        formula.weaponPowerMode,
      )}`,
    );
  }
}

/**
 * Resolve a weapon family's effective Weapon Attack from the attacker's stats
 * and the equipped weapon's power. This is the only step that differs between
 * weapon types; it is split out so targeting/forecast UI (T086) can preview the
 * offense term without running the full damage kernel.
 *
 * ```ts
 * // sabre: PA × WP
 * computeWeaponOffense({ atk: 20, spd: 9, mag: 4, weaponPower: 5 }, sabre); // 100
 * // rifle: (PA + Spd) / 2 × WP, truncated
 * computeWeaponOffense({ atk: 20, spd: 9, mag: 4, weaponPower: 5 }, rifle); // 70
 * // gun: WP²
 * computeWeaponOffense({ atk: 20, spd: 9, mag: 4, weaponPower: 7 }, gun);   // 49
 * ```
 *
 * Throws a `RangeError` for malformed inputs; returns a non-negative integer.
 * The caller's input and formula are never mutated.
 */
export function computeWeaponOffense(input: WeaponOffenseInput, formula: WeaponFormula): number {
  const { atk, spd, mag, weaponPower } = input;
  assertNonNegativeInteger(atk, "weapon offense.atk");
  assertNonNegativeInteger(spd, "weapon offense.spd");
  assertNonNegativeInteger(mag, "weapon offense.mag");
  assertNonNegativeInteger(weaponPower, "weapon offense.weaponPower");
  assertWeaponFormula(formula);

  if (formula.weaponPowerMode === "square") {
    return weaponPower * weaponPower;
  }

  const statTerm = formula.atkWeight * atk + formula.spdWeight * spd + formula.magWeight * mag;
  const factor = Math.floor(statTerm / formula.offenseDivisor);
  return factor * weaponPower;
}

/**
 * Compute Steel damage for a specific weapon family: resolve the family's
 * offense term with {@link computeWeaponOffense}, then run the shared
 * {@link computeSteelDamage} kernel.
 *
 * ```ts
 * const sabre = { ...WeaponFormula, atkWeight: 1, spdWeight: 0, magWeight: 0,
 *                 offenseDivisor: 1, weaponPowerMode: "multiply" };
 * computeWeaponDamage(
 *   { atk: 20, spd: 9, mag: 4, weaponPower: 5, targetWeaponDef: 10, power: 100 },
 *   sabre,
 * ); // (20×5 − 10/2) × 100/100 = 95
 * ```
 *
 * Throws a `RangeError` for malformed inputs or formulas; returns a
 * non-negative integer.
 */
export function computeWeaponDamage(input: WeaponDamageInput, formula: WeaponFormula): number {
  const { targetWeaponDef, power, ...offense } = input;
  const weaponAtk = computeWeaponOffense(offense, formula);
  return computeSteelDamage({ weaponAtk, targetWeaponDef, power }, formula);
}
