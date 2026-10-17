/**
 * Experience and level growth (T049) — award **Experience** for battlefield
 * actions and knockouts, and grow a soldier's stats along its **post** growth
 * profile (mapping §1/§3/§5, decision D3).
 *
 * FFTA keeps character **Level** separate from the **job**: a soldier earns
 * Experience by acting, and each level-up applies the *current post's* growth
 * table (`docs/wiki/pages/Level.md`). The retheme keeps that exactly:
 *
 * ```
 *   action / KO  ──►  experienceForAction / experienceForKo
 *                          │  (FFTA: 10 XP at equal level, ±2 per level, 1..99)
 *                          ▼
 *   awardExperience(unit, amount, post.growth)  ──►  { unit', events[] }
 *                          │
 *                          ├─ experienceGained   (progress toward next level)
 *                          └─ levelUp × N        (one per level crossed)
 * ```
 *
 * ## Where growth comes from
 *
 * Growth is the seven-column {@link StatGrowth} block authored on every
 * {@link PostDef} (`src/data/posts/`). It is the same block `deriveStats`
 * (T018) reads. A level-up therefore has to stay **consistent** with the
 * truncating formula T018 uses (`floor(growth × level)`), so this module grows
 * a unit by the *increment* between two adjacent levels:
 *
 * ```
 *   gain[stat] = floor(growth[stat] × (level + 1)) − floor(growth[stat] × level)
 * ```
 *
 * Summed over levels this telescopes to `floor(growth × level)`, so a soldier
 * leveled here matches one derived at the same level by `deriveStats`. Working
 * incrementally (rather than re-deriving from scratch) also preserves any flat
 * modifiers the soldier already carries — a post baseline, a prior post's
 * legacy, kit and attached-post deltas — without this module needing to know
 * where they came from.
 *
 * ## Contract (`agents.md` §2, §3, §7, §9)
 *
 * - **Pure & deterministic** — no DOM, no I/O, no `Math.random`, no `Date`.
 *   Time is the integer Orders Tempo tick; the same inputs always produce a
 *   byte-identical unit and ordered event list.
 * - **State in, state out** — the input unit is never mutated; every helper
 *   returns a **new** unit plus the ordered {@link BattleEvent}s describing the
 *   change.
 * - **Data-driven** — the Experience threshold, the action/KO formula weights
 *   and the level cap live here as named constants; the growth numbers are
 *   authored content, never baked into logic.
 * - **Integer in, integer out** — malformed amounts, levels and ticks are
 *   rejected at the boundary rather than silently rounded.
 *
 * Reference: `docs/wiki/pages/Level.md` (FFTA: level 50 cap, 100-Experience
 * threshold, action XP = 10 ± 2 per level of difference, clamped 1..99) and
 * `docs/wiki/pages/Experience_points.md`. The FFTA-specific *stat* growth
 * formula is **not** documented in the mirror, so the increment above is
 * re-authored balance data that stays consistent with T018; see the open
 * question in `todo.md`.
 */

import type { StatBlock, StatGrowth, StatMods } from "../../data/schema";
import type { BattleEvent } from "../events";
import { zeroStatMods } from "../stats";
import type { Unit } from "../unit";

/* --------------------------------------------------------------------------
 * Tunables (Phase 13 owns the final balance pass)
 * ------------------------------------------------------------------------ */

/**
 * Highest level a soldier may reach. FFTA caps characters at 50
 * (`docs/wiki/pages/Level.md`); we keep the reference value.
 */
export const MAX_LEVEL = 50;

/**
 * Experience needed to cross from one level to the next. FFTA levels a
 * character "after exceeding 100 experience" (`docs/wiki/pages/Level.md`), so
 * the threshold is a flat 100 at every level.
 */
export const EXPERIENCE_PER_LEVEL = 100;

/**
 * Experience a successful action awards when the actor and target are the same
 * level (FFTA's base 10, `docs/wiki/pages/Level.md`).
 */
export const ACTION_EXPERIENCE = 10;

/**
 * Experience added (or removed) per level of difference between the actor and
 * the target. FFTA uses 2 (the original *Final Fantasy Tactics* used 1).
 */
export const EXPERIENCE_PER_LEVEL_DIFFERENCE = 2;

/** Smallest single award (FFTA clamps an action to at least 1). */
export const MIN_EXPERIENCE_AWARD = 1;

/** Largest single award (FFTA clamps an action to at most 99). */
export const MAX_EXPERIENCE_AWARD = 99;

/**
 * The seven stats that grow with level — the keys of {@link StatGrowth}.
 * `move`/`jump` are fixed movement rates and never grow (T018).
 */
const GROWTH_STAT_KEYS = [
  "hp",
  "mp",
  "atk",
  "def",
  "mag",
  "res",
  "spd",
] as const satisfies readonly (keyof StatGrowth)[];

/* --------------------------------------------------------------------------
 * Result shape
 * ------------------------------------------------------------------------ */

/** The outcome of awarding Experience to a soldier. */
export interface ExperienceAwardResult {
  /** The soldier after the award: new Experience, level and (on level-up) stats. */
  readonly unit: Unit;
  /** Experience actually applied (`>= 0`). */
  readonly gained: number;
  /** How many levels were crossed (`>= 0`). */
  readonly levelsGained: number;
  /** `experienceGained` first, then one `levelUp` per crossed level. */
  readonly events: readonly BattleEvent[];
}

/* --------------------------------------------------------------------------
 * The Experience curve
 * ------------------------------------------------------------------------ */

/**
 * Experience required to advance from `level` to `level + 1`. Always
 * {@link EXPERIENCE_PER_LEVEL} below the cap and `0` at {@link MAX_LEVEL}, so a
 * level-up loop naturally terminates at the cap.
 *
 * ```ts
 * experienceToNextLevel(1);  // 100
 * experienceToNextLevel(50); // 0
 * ```
 */
export function experienceToNextLevel(level: number): number {
  assertLevel(level);
  return level >= MAX_LEVEL ? 0 : EXPERIENCE_PER_LEVEL;
}

/** Whether `level` is the cap, beyond which no Experience is gained. */
export function isMaxLevel(level: number): boolean {
  assertLevel(level);
  return level >= MAX_LEVEL;
}

/* --------------------------------------------------------------------------
 * Award formulas (FFTA)
 * ------------------------------------------------------------------------ */

/** Clamp a raw award into the FFTA `[1, 99]` band. */
function clampAward(raw: number): number {
  return Math.min(MAX_EXPERIENCE_AWARD, Math.max(MIN_EXPERIENCE_AWARD, raw));
}

/**
 * Experience a soldier earns for acting against a target of `targetLevel`
 * (`docs/wiki/pages/Level.md`): 10 at equal level, ± 2 per level of
 * difference, clamped to `[1, 99]`. A higher-level target is worth more; a
 * trivial target still grants the minimum 1.
 *
 * ```ts
 * experienceForAction(20, 20); // 10
 * experienceForAction(20, 30); // 30
 * experienceForAction(50, 1);  // 1
 * ```
 */
export function experienceForAction(actorLevel: number, targetLevel: number): number {
  assertLevel(actorLevel);
  assertLevel(targetLevel);
  return clampAward(
    ACTION_EXPERIENCE + (targetLevel - actorLevel) * EXPERIENCE_PER_LEVEL_DIFFERENCE,
  );
}

/**
 * Experience a soldier earns for knocking out a target. The target's authored
 * reward (`EnemyDef.exp`, `src/data/schema.ts`) is the base, adjusted by the
 * same ± 2-per-level rule and clamped to `[1, 99]`. Defaults the base to
 * {@link ACTION_EXPERIENCE} for a plain target with no authored reward.
 *
 * ```ts
 * experienceForKo(20, 20, 40); // 40
 * experienceForKo(20, 30, 40); // 60
 * ```
 */
export function experienceForKo(
  actorLevel: number,
  targetLevel: number,
  baseExperience: number = ACTION_EXPERIENCE,
): number {
  assertLevel(actorLevel);
  assertLevel(targetLevel);
  assertNonNegativeInteger(baseExperience, "experience.baseExperience");
  return clampAward(baseExperience + (targetLevel - actorLevel) * EXPERIENCE_PER_LEVEL_DIFFERENCE);
}

/* --------------------------------------------------------------------------
 * Growth
 * ------------------------------------------------------------------------ */

/**
 * The per-stat gain from advancing `level` → `level + 1` along a post's growth
 * profile. Only the seven growing stats change; `move`/`jump` are `0`.
 *
 * The increment is the difference of the truncating `floor(growth × level)`
 * terms used by `deriveStats` (T018), so a soldier leveled here is
 * indistinguishable from one derived at the same level:
 *
 * ```ts
 * levelUpStatGains({ hp: 8.4, ... }, 1).hp; // floor(16.8) − floor(8.4) = 8
 * ```
 */
export function levelUpStatGains(growth: StatGrowth, level: number): StatMods {
  assertLevel(level);
  assertGrowth(growth);

  const gains = zeroStatMods();
  for (const key of GROWTH_STAT_KEYS) {
    gains[key] = Math.floor(growth[key] * (level + 1)) - Math.floor(growth[key] * level);
  }
  return gains;
}

/**
 * Apply a {@link StatMods} gain block to a stat block, clamping every value at
 * zero and keeping at least one point of maximum HP (a fielded soldier). The
 * input block is not mutated.
 */
function applyStatGains(stats: StatBlock, gains: StatMods): StatBlock {
  return {
    hp: Math.max(1, stats.hp + gains.hp),
    mp: Math.max(0, stats.mp + gains.mp),
    atk: Math.max(0, stats.atk + gains.atk),
    def: Math.max(0, stats.def + gains.def),
    mag: Math.max(0, stats.mag + gains.mag),
    res: Math.max(0, stats.res + gains.res),
    spd: Math.max(0, stats.spd + gains.spd),
    move: stats.move + gains.move,
    jump: stats.jump + gains.jump,
  };
}

/**
 * Grow one level: add the level gain to the unit's stats and its current HP and
 * Élan (so a fortuitous soldier keeps the same wounds, and a full-strength one
 * tops up). Current pools are clamped to the new maxima; the input is never
 * mutated.
 */
function applyLevelUp(unit: Unit, gains: StatMods): Unit {
  const stats = applyStatGains(unit.stats, gains);
  const hp = Math.min(stats.hp, unit.hp + Math.max(0, gains.hp));
  const mp = Math.min(stats.mp, unit.mp + Math.max(0, gains.mp));
  return { ...unit, stats, hp, mp };
}

/* --------------------------------------------------------------------------
 * Awarding Experience
 * ------------------------------------------------------------------------ */

/**
 * Add `amount` Experience to `unit`, applying **every** level-up the award
 * crosses along the supplied `growth` profile. Returns the updated soldier and
 * the ordered events: a single `experienceGained`, then one `levelUp` per
 * crossed level.
 *
 * Experience carries across a level-up (the threshold is subtracted and the
 * remainder kept), so a single large award can advance several levels at once.
 * Experience is discarded at {@link MAX_LEVEL}, where no further progress is
 * possible.
 *
 * ```ts
 * const { unit: veteran, events } = awardExperience(recruit, 150, post.growth, tick);
 * // 50 Experience toward level 3, one level-up event.
 * ```
 *
 * @throws RangeError when `amount` is not a non-negative integer, `tick` is
 * not a non-negative integer, or `growth` carries a negative/non-finite value.
 */
export function awardExperience(
  unit: Unit,
  amount: number,
  growth: StatGrowth,
  tick = 0,
): ExperienceAwardResult {
  assertNonNegativeInteger(amount, "experience.amount");
  assertTick(tick);
  assertGrowth(growth);

  if (amount === 0 || unit.level >= MAX_LEVEL) {
    return { unit, gained: 0, levelsGained: 0, events: [] };
  }

  let current = unit;
  let level = unit.level;
  let experience = unit.experience + amount;
  const events: BattleEvent[] = [];

  while (level < MAX_LEVEL && experience >= experienceToNextLevel(level)) {
    experience -= experienceToNextLevel(level);
    current = applyLevelUp(current, levelUpStatGains(growth, level));
    level += 1;
    events.push({ kind: "levelUp", tick, unitId: unit.id, level });
  }

  // At the cap there is no next level to progress toward.
  if (level >= MAX_LEVEL) experience = 0;

  current = { ...current, level, experience };
  events.unshift({
    kind: "experienceGained",
    tick,
    unitId: unit.id,
    amount,
    experienceAfter: experience,
  });

  return { unit: current, gained: amount, levelsGained: level - unit.level, events };
}

/**
 * Award the FFTA action Experience for `actor` acting against `target` and
 * apply any resulting level-ups along the actor's post growth. Convenience
 * wrapper over {@link experienceForAction} + {@link awardExperience}.
 */
export function awardActionExperience(
  actor: Unit,
  target: Unit,
  growth: StatGrowth,
  tick = 0,
): ExperienceAwardResult {
  return awardExperience(actor, experienceForAction(actor.level, target.level), growth, tick);
}

/**
 * Award the KO Experience for `actor` defeating `target`, using the target's
 * authored `baseExperience` reward (FFTA `EnemyDef.exp`). Convenience wrapper
 * over {@link experienceForKo} + {@link awardExperience}.
 */
export function awardKoExperience(
  actor: Unit,
  target: Unit,
  baseExperience: number,
  growth: StatGrowth,
  tick = 0,
): ExperienceAwardResult {
  return awardExperience(
    actor,
    experienceForKo(actor.level, target.level, baseExperience),
    growth,
    tick,
  );
}

/* --------------------------------------------------------------------------
 * Validation helpers
 * ------------------------------------------------------------------------ */

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError(`level must be an integer >= 1, received ${String(level)}`);
  }
}

function assertTick(tick: number): void {
  if (!Number.isInteger(tick) || tick < 0) {
    throw new RangeError(
      `experience.tick must be a non-negative integer, received ${String(tick)}`,
    );
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, received ${String(value)}`);
  }
}

function assertGrowth(growth: StatGrowth): void {
  for (const key of GROWTH_STAT_KEYS) {
    const value = growth[key];
    if (!Number.isFinite(value) || value < 0) {
      throw new RangeError(`growth.${key} must be a finite number >= 0, received ${String(value)}`);
    }
  }
}
