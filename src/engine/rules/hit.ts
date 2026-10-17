/**
 * Hit, evasion & facing (T037) — the retheme's to-hit model.
 *
 * Every strike in *Lines of Glory* follows the tactical-series pattern the
 * retheme preserves (mapping §12, "Facing (front/side/back) — flank/rear
 * bonuses are very Napoleonic"): first decide **whether** the blow connects,
 * then compute its damage (T033–T036). This module owns that first decision.
 * It answers two questions, both seeded and deterministic:
 *
 * - *What are the odds?* — {@link computeHitChance} resolves the attacker's
 *   **accuracy** minus the defender's **evasion**, adds a **facing** modifier
 *   for a frontal, flanking or rear strike, and clamps the result into the
 *   authored band. No randomness is consumed, so the forecast UI (T086) can
 *   preview it.
 * - *Did it land?* — {@link rollHit} draws exactly one value from the battle's
 *   seeded PRNG ({@link Rng}, T011) and compares it with that chance, returning
 *   the outcome alongside the forecast for the event log.
 *
 * ## Where the formula comes from
 *
 * FFTA does not document its own to-hit formula in the mirror — the
 * FFTA section of `docs/wiki/pages/Attack_(command).md` covers damage only, and
 * `docs/wiki/pages/Final_Fantasy_Tactics_Advance_jobs.md` has no accuracy or
 * evasion column (this is the same kind of gap `agents.md` §10 flags for MP
 * regeneration). The **facing** rule, however, is stated for the series:
 *
 * > "An action's chance of success is best when attacking an opponent from the
 * > rear and is least likely to succeed in frontal assaults."
 * > — `docs/wiki/pages/Final_Fantasy_Tactics.md` (Gameplay)
 *
 * So the shape is **authored** here as balance data, not scraped gospel
 * (`agents.md` §3, §10). It follows the tactical-series convention that the
 * attacker's hit term and the defender's evasion term are the two sides of the
 * equation (`docs/wiki/pages/Final_Fantasy_Tactics_stats.md` §"Physical
 * Evasion" — evasion "sums up their base evasion rate and any bonuses from a
 * job, equipment, or ability"), and that accuracy grows with the attacker
 * (`docs/wiki/pages/Attack_(command).md`, FFIV section: `Weapon's Hit Rate +
 * Level/4`). Content resolves `accuracy` and `evasion` from stats, kit and
 * conditions; this module never special-cases a weapon, post or ability.
 *
 * ```text
 * base   = accuracy − evasion
 * chance = clamp(base + facingModifier[relativeFacing], minChance, maxChance)
 * hit    = roll < chance            (roll drawn uniformly from [0, 100))
 * ```
 *
 * ## Contracts (`agents.md` §2, §7, §9)
 *
 * - **Pure & deterministic** — geometry and integer arithmetic only. All
 *   randomness goes through the seeded {@link Rng}; `Math.random` is rejected by
 *   ESLint and swept by `tests/unit/rng.test.ts`.
 * - **No mutation** — inputs are read, never written; results are fresh values.
 * - **Data-driven** — the clamp band ({@link HIT_FORMULA}) and the facing
 *   bonuses ({@link FACING_HIT_MODIFIERS}) are exported balance data that
 *   content may override, so no number is buried in the logic.
 * - **One draw per roll** — {@link rollHit} always consumes exactly one PRNG
 *   value, even when the chance is `0` or `100`. A replay therefore stays in
 *   lockstep regardless of the outcome.
 */

import {
  FACING_OFFSETS,
  isFacing,
  type Coord,
  type Facing,
} from "../grid";
import { Rng } from "../rng";

/* --------------------------------------------------------------------------
 * Facing (front / side / rear)
 * ------------------------------------------------------------------------ */

/**
 * How a strike arrives relative to the defender's facing (FFTA "facing",
 * mapping §12). `"front"` is a frontal assault, `"side"` is a flank, `"rear"` is
 * a strike from behind — the most successful, per the series rule quoted above.
 */
export const RELATIVE_FACINGS = ["front", "side", "rear"] as const;
export type RelativeFacing = (typeof RELATIVE_FACINGS)[number];

/** Runtime guard for untrusted relative-facing strings (saves, network). */
export function isRelativeFacing(value: unknown): value is RelativeFacing {
  return typeof value === "string" && (RELATIVE_FACINGS as readonly string[]).includes(value);
}

/** Reject a coordinate that is not a pair of integers (fail fast at the boundary). */
function assertCoord(at: Coord, label: string): void {
  if (!Number.isInteger(at.x) || !Number.isInteger(at.y)) {
    throw new RangeError(
      `${label} must be integer coordinates, received { x: ${at.x}, y: ${at.y} }`,
    );
  }
}

/**
 * Classify a strike from `attackerAt` against a defender standing on
 * `defenderAt` and looking toward `defenderFacing`.
 *
 * The defender's forward axis is compared with the vector to the attacker. The
 * **dominant** component decides the bin:
 *
 * - forward-dominant and positive → `"front"`;
 * - forward-dominant and negative → `"rear"`;
 * - otherwise (perpendicular-dominant, including exact diagonals) → `"side"`.
 *
 * Breaking exact diagonals toward `"side"` keeps the flank bonus for a
 * rear-quarter approach; on a four-way grid a diagonal is genuinely ambiguous
 * between front/rear and flank, and treating it as a flank is both intuitive
 * and the more tactical read (`agents.md` §9, mapping §12). A strike from the
 * defender's own tile is `"front"` — there is no direction to flank from.
 *
 * ```ts
 * // Defender faces north (0, -1), standing at (5, 5):
 * relativeFacing({ x: 5, y: 5 }, "north", { x: 5, y: 3 }); // "front"
 * relativeFacing({ x: 5, y: 5 }, "north", { x: 5, y: 8 }); // "rear"
 * relativeFacing({ x: 5, y: 5 }, "north", { x: 8, y: 5 }); // "side"
 * ```
 */
export function relativeFacing(
  defenderAt: Coord,
  defenderFacing: Facing,
  attackerAt: Coord,
): RelativeFacing {
  assertCoord(defenderAt, "defenderAt");
  assertCoord(attackerAt, "attackerAt");
  if (!isFacing(defenderFacing)) {
    throw new RangeError(
      `defenderFacing must be a cardinal direction, received ${String(defenderFacing)}`,
    );
  }

  const dx = attackerAt.x - defenderAt.x;
  const dy = attackerAt.y - defenderAt.y;
  if (dx === 0 && dy === 0) return "front";

  const forward = FACING_OFFSETS[defenderFacing];
  // Signed component along the way the defender looks...
  const along = dx * forward.x + dy * forward.y;
  // ...and along its clockwise perpendicular (north's "right" is east).
  const lateral = dx * -forward.y + dy * forward.x;

  const alongAbs = Math.abs(along);
  const lateralAbs = Math.abs(lateral);
  if (alongAbs > lateralAbs) return along > 0 ? "front" : "rear";
  return "side";
}

/* --------------------------------------------------------------------------
 * Authored balance data
 * ------------------------------------------------------------------------ */

/**
 * The clamp band for a resolved hit chance, in whole percent. A battle always
 * leaves a sliver of hope and a chance of a clean miss, so a hopeless shot is
 * not a guaranteed blank and a perfect shot is not a guaranteed hit.
 *
 * **Authored balance data**, not a scraped reference (`agents.md` §3, §10). The
 * tactical series folds hit and evasion into a single percentage; the retheme
 * keeps the result inside this band so the seeded roll always has room to move.
 * Content may supply its own band (an aimed shot, a canister blast) without
 * touching the arithmetic.
 */
export interface HitFormula {
  /** Lowest possible chance after clamping, `0..100`. */
  readonly minChance: number;
  /** Highest possible chance after clamping, `0..100`. */
  readonly maxChance: number;
}

/**
 * The default clamp band: at least `5%` to land a blow, never above `100%`.
 * Re-authored balance data (`agents.md` §3, §10), inspired by the tactical
 * series' percentage-based to-hit model rather than copied from it.
 */
export const HIT_FORMULA: HitFormula = {
  minChance: 5,
  maxChance: 100,
};

/**
 * The authored front/side/rear bonuses, added to `accuracy − evasion`. A
 * frontal assault gets no bonus, a flank `+15`, a rear strike `+30` — the
 * series rule that "chance of success is best … from the rear"
 * (`docs/wiki/pages/Final_Fantasy_Tactics.md`). Content may re-author these
 * numbers without touching the arithmetic.
 */
export interface FacingHitModifiers {
  /** Bonus for a frontal strike (FFTA "front"). */
  readonly front: number;
  /** Bonus for a flank strike (FFTA "side"). */
  readonly side: number;
  /** Bonus for a rear strike (FFTA "back"). */
  readonly rear: number;
}

/**
 * The default facing bonuses. Rear (`+30`) beats flank (`+15`) beats front
 * (`0`), encoding the Napoleonic and series preference for taking an enemy in
 * the flank or from behind (mapping §12).
 */
export const FACING_HIT_MODIFIERS: FacingHitModifiers = {
  front: 0,
  side: 15,
  rear: 30,
};

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
 * Reject a malformed {@link HitFormula}. A bad band is a programming/content
 * error, not player input.
 */
function assertHitFormula(formula: HitFormula): void {
  for (const [label, value] of [
    ["minChance", formula.minChance],
    ["maxChance", formula.maxChance],
  ] as const) {
    if (!Number.isInteger(value) || value < 0 || value > 100) {
      throw new RangeError(
        `hit formula ${label} must be an integer within [0, 100], received ${String(value)}`,
      );
    }
  }
  if (formula.maxChance < formula.minChance) {
    throw new RangeError(
      `hit formula maxChance (${formula.maxChance}) must not be less than minChance (${formula.minChance})`,
    );
  }
}

/** Reject a malformed {@link FacingHitModifiers} block (integrals only). */
function assertFacingModifiers(modifiers: FacingHitModifiers): void {
  for (const label of RELATIVE_FACINGS) {
    assertInteger(modifiers[label], `facing hit modifier.${label}`);
  }
}

/** Clamp an integer into the inclusive `[min, max]` band. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/* --------------------------------------------------------------------------
 * Hit chance (forecast)
 * ------------------------------------------------------------------------ */

/**
 * Input to {@link computeHitChance} / {@link rollHit}: the two combat terms,
 * the two soldiers' geometry, and optional authored balance data.
 *
 * `accuracy` is the attacker's offensive hit term — the retheme resolves it
 * from the weapon's Hit Rate and the attacker's level (the FFIV convention
 * `Weapon's Hit Rate + Level/4` cited above), or from an ability's
 * `AbilityDef.hitRate` (`src/data/schema.ts`). `evasion` is the defender's
 * summed evasion from base, post, kit, conditions and Traits
 * (`docs/wiki/pages/Final_Fantasy_Tactics_stats.md` §"Physical Evasion"). Both
 * arrive as plain integers: this module never reads a unit, an item or an
 * ability directly.
 */
export interface HitChanceInput {
  /** The attacker's offensive hit term (weapon/ability hit rate + level term). `>= 0`. */
  readonly accuracy: number;
  /** The defender's summed evasion after equipment and conditions. `>= 0`. */
  readonly evasion: number;
  /** Where the attacker stands (used only for the facing classification). */
  readonly attackerAt: Coord;
  /** Where the defender stands. */
  readonly defenderAt: Coord;
  /** The direction the defender is looking (front/side/rear maths). */
  readonly defenderFacing: Facing;
  /** Clamp band; defaults to {@link HIT_FORMULA}. */
  readonly formula?: HitFormula;
  /** Front/side/rear bonuses; defaults to {@link FACING_HIT_MODIFIERS}. */
  readonly facingModifiers?: FacingHitModifiers;
}

/**
 * The deterministic outcome of {@link computeHitChance}: everything the forecast
 * UI (T086) and the event log need, with no randomness consumed.
 */
export interface HitChanceResult {
  /** Final chance in whole percent, after the facing bonus and the clamp. */
  readonly chance: number;
  /** `accuracy − evasion`, before the facing bonus and before clamping. */
  readonly baseChance: number;
  /** How the strike arrives relative to the defender's facing. */
  readonly facing: RelativeFacing;
  /** The facing bonus that was added (from {@link FacingHitModifiers}). */
  readonly facingModifier: number;
  /** `baseChance + facingModifier`, before the clamp (may be < 0 or > 100). */
  readonly rawChance: number;
}

/**
 * Resolve a strike's hit chance from accuracy, evasion and facing. Pure integer
 * arithmetic; no RNG is drawn, so the same inputs always give the same result
 * and the forecast is safe to call from the UI.
 *
 * ```ts
 * // Frontal: base = 80 − 20 = 60, +0 → 60.
 * computeHitChance({ accuracy: 80, evasion: 20, attackerAt: { x: 5, y: 3 },
 *                    defenderAt: { x: 5, y: 5 }, defenderFacing: "north" }).chance; // 60
 * // Flank: base = 60, +15 → 75.
 * computeHitChance({ accuracy: 80, evasion: 20, attackerAt: { x: 8, y: 5 },
 *                    defenderAt: { x: 5, y: 5 }, defenderFacing: "north" }).chance; // 75
 * // Rear: base = 60, +30 → 90.
 * computeHitChance({ accuracy: 80, evasion: 20, attackerAt: { x: 5, y: 8 },
 *                    defenderAt: { x: 5, y: 5 }, defenderFacing: "north" }).chance; // 90
 * ```
 *
 * Throws a `RangeError` for malformed combat terms, coordinates, facing or
 * authored balance data.
 */
export function computeHitChance(input: HitChanceInput): HitChanceResult {
  const { accuracy, evasion, attackerAt, defenderAt, defenderFacing } = input;
  const formula = input.formula ?? HIT_FORMULA;
  const facingModifiers = input.facingModifiers ?? FACING_HIT_MODIFIERS;

  assertNonNegativeInteger(accuracy, "hit chance.accuracy");
  assertNonNegativeInteger(evasion, "hit chance.evasion");
  assertHitFormula(formula);
  assertFacingModifiers(facingModifiers);

  const facing = relativeFacing(defenderAt, defenderFacing, attackerAt);
  const baseChance = accuracy - evasion;
  const facingModifier = facingModifiers[facing];
  const rawChance = baseChance + facingModifier;
  const chance = clamp(rawChance, formula.minChance, formula.maxChance);

  return { chance, baseChance, facing, facingModifier, rawChance };
}

/* --------------------------------------------------------------------------
 * Seeded roll
 * ------------------------------------------------------------------------ */

/**
 * The result of a seeded to-hit roll: the {@link HitChanceResult} forecast plus
 * the raw draw and the outcome. Carrying the `roll` makes a replay's event log
 * self-describing — a reviewer can see *why* a strike missed without replaying
 * the PRNG stream.
 */
export interface HitRollResult extends HitChanceResult {
  /** `true` when the strike connects. */
  readonly hit: boolean;
  /** The PRNG draw, an integer in `[0, 100)`. */
  readonly roll: number;
}

/**
 * Roll to hit using the battle's seeded {@link Rng}. The chance is resolved by
 * {@link computeHitChance}, then compared with a uniform integer draw in
 * `[0, 100)`:
 *
 * ```text
 * hit = roll < chance
 * ```
 *
 * The generator is advanced by **exactly one** draw on every call, whether the
 * result is a hit or a miss and even when `chance` is `0` or `100`. That keeps
 * the PRNG stream, and therefore the whole replay, independent of outcomes
 * (`agents.md` §2).
 *
 * ```ts
 * const rng = new Rng("bridge-at-sainte-colombe");
 * const shot = rollHit(rng, { accuracy: 80, evasion: 20,
 *                             attackerAt: { x: 8, y: 5 },
 *                             defenderAt: { x: 5, y: 5 },
 *                             defenderFacing: "north" });
 * shot.hit;   // true/false
 * shot.roll;  // 0..99
 * shot.chance; // 75
 * ```
 *
 * Throws the same `RangeError`s as {@link computeHitChance}; on error no draw is
 * consumed, because validation happens before the roll.
 */
export function rollHit(rng: Rng, input: HitChanceInput): HitRollResult {
  const forecast = computeHitChance(input);
  const roll = rng.nextInt(100);
  return { ...forecast, roll, hit: roll < forecast.chance };
}
