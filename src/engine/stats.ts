/**
 * Derived stats (T018) — turn authored growth + flat modifiers into the
 * effective {@link StatBlock} a unit fights with.
 *
 * The retheme keeps FFTA's two-layer stat model (mapping §3): a **post**
 * (FFTA "job") contributes a per-level **growth** profile, and flat
 * **modifiers** come from the post's baseline, from an attached post, from
 * abilities/conditions and from equipped kit. The effective value of a stat is
 * the sum of those layers:
 *
 * ```
 * effective[stat] = POST_BASELINE_STATS[stat]     // level-1 stat line (T167)
 *                 + floor(growth[stat] × level)   // base growth
 *                 + postMods[stat]                // flat post / attached-post mods
 *                 + Σ equipment[i].stats[stat]    // kit
 * ```
 *
 * `move` and `jump` are movement rates rather than growing attributes (the FFTA
 * job pages list them as fixed rates, not growth table columns), so they are
 * supplied only through `postMods`/`equipment`; the growth profile contributes
 * nothing to them.
 *
 * Contract (agents.md §2, §3, §9):
 * - **Pure & deterministic** — no DOM, no `Math.random`, no mutation of the
 *   caller's data. Every fractional `growth × level` term is truncated once
 *   (FFTA truncates fractional growth), so the same inputs always produce a
 *   byte-identical block.
 * - **Data-driven** — no balance constant is baked in here. Growth and
 *   modifiers arrive as arguments; content authors own the numbers. The only
 *   literals are structural floors (a unit always has at least 1 max HP and no
 *   stat is ever negative).
 * - The growth columns mirror the scraped FFTA job tables
 *   (`docs/wiki/pages/Final_Fantasy_Tactics_Advance_jobs.md`) but are
 *   **re-authored balance data**, not wiki gospel.
 */

import type { StatBlock, StatGrowth, StatMods } from "../data/schema";
import type { Unit } from "./unit";

/**
 * The **level-1 baseline** every post-derived stat block starts from (T167).
 *
 * The growth tables are per-level increments (`src/data/posts/`), so without a
 * base a level-2 soldier has ~16 HP and ~17 ATK — an order of magnitude below
 * the authored irregulars, whose stat lines (including Speed 27–44) are on the
 * Quick Battle scale. FFTA's own level-1 characters likewise start with a real
 * stat line rather than one level's increment. This block puts the derived
 * scale on the same footing:
 *
 * ```
 * effective[stat] = POST_BASELINE_STATS[stat]
 *                 + floor(growth[stat] × level)
 *                 + postMods[stat] + Σ equipment[i].stats[stat]
 * ```
 *
 * Movement rates stay at 0 here: `move`/`jump` are supplied by the post's
 * movement layer at deployment (`derivePostStats`'s `postMods`), not by the
 * baseline, so a unit never gains phantom movement.
 *
 * Authored balance data, like the damage and hit formulas (`agents.md` §3):
 * the numbers are ours, sized against the authored enemy and preset stat lines.
 */
export const POST_BASELINE_STATS: StatBlock = {
  hp: 30,
  mp: 10,
  atk: 10,
  def: 9,
  mag: 5,
  res: 6,
  spd: 26,
  move: 0,
  jump: 0,
};

/* --------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------ */

/** One of the nine effective stats a fielded unit carries. */
export type StatKey = keyof StatBlock;

/**
 * A subset of {@link StatMods}. Any omitted stat counts as `0`, which lets
 * fixtures and content name only the stats they change.
 */
export type StatModifiers = Partial<StatMods>;

/**
 * The seven stats that grow with level (FFTA's job growth-table columns). These
 * are exactly the keys of {@link StatGrowth}; `move`/`jump` are deliberately
 * absent.
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

/** Every effective stat, in a stable order. */
export const STAT_KEYS = [
  "hp",
  "mp",
  "atk",
  "def",
  "mag",
  "res",
  "spd",
  "move",
  "jump",
] as const satisfies readonly StatKey[];

/** Input to {@link deriveStats}: the three layers of the formula. */
export interface DeriveStatsInput {
  /** Character level, an integer `>= 1`. */
  readonly level: number;
  /**
   * Base growth — the per-level increments from the primary post (FFTA "job
   * growth"). Only HP, Élan (MP), atk, def, mag, res and spd grow.
   */
  readonly growth: StatGrowth;
  /**
   * Flat post modifiers: the post's level-1 baseline, an attached-post delta,
   * movement rates (`move`/`jump`) and any other one-off adjustment.
   */
  readonly postMods?: StatModifiers;
  /** Flat modifiers from each equipped item, summed in order. */
  readonly equipment?: readonly StatModifiers[];
}

/* --------------------------------------------------------------------------
 * Modifier helpers
 * ------------------------------------------------------------------------ */

/** An all-zero modifier block. Prefix-roll with `...zeroStatMods()`. */
export function zeroStatMods(): StatMods {
  return {
    hp: 0,
    mp: 0,
    atk: 0,
    def: 0,
    mag: 0,
    res: 0,
    spd: 0,
    move: 0,
    jump: 0,
  };
}

/**
 * Sum any number of (possibly partial) modifier blocks into one full block.
 * Missing stats count as `0`; the caller's inputs are never mutated.
 */
export function sumStatMods(modifiers: readonly StatModifiers[]): StatMods {
  const total = zeroStatMods();
  for (const mods of modifiers) {
    for (const key of STAT_KEYS) {
      total[key] += mods[key] ?? 0;
    }
  }
  return total;
}

/** Combine two modifier blocks into a new one. */
export function addStatMods(a: StatModifiers, b: StatModifiers): StatMods {
  return sumStatMods([a, b]);
}

/* --------------------------------------------------------------------------
 * Validation (fail fast at the content/save boundary)
 * ------------------------------------------------------------------------ */

function assertLevel(level: number): void {
  if (!Number.isInteger(level) || level < 1) {
    throw new RangeError(`level must be an integer >= 1, received ${String(level)}`);
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

function assertModifiers(mods: StatModifiers, label: string): void {
  for (const key of STAT_KEYS) {
    const value = mods[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value)) {
      throw new RangeError(`${label}.${key} must be an integer, received ${String(value)}`);
    }
  }
}

/* --------------------------------------------------------------------------
 * Derivation
 * ------------------------------------------------------------------------ */

/**
 * Compute the effective stat block from growth and flat modifiers.
 *
 * ```ts
 * deriveStats({
 *   level: 10,
 *   growth: { hp: 7.2, mp: 1.1, atk: 7.2, def: 7.2, mag: 6.4, res: 8.1, spd: 1.4 },
 *   postMods: { hp: 50, move: 4, jump: 2 },
 *   equipment: [{ atk: 12 }, { def: 6, spd: 2 }],
 * });
 * // baseline + growth + flats:
 * // { hp: 152, mp: 26, atk: 104, def: 91, mag: 69, res: 90, spd: 40, move: 5, jump: 2 }
 * ```
 *
 * The level-1 baseline ({@link POST_BASELINE_STATS}) is added first, then each
 * growth term is truncated (`Math.floor`), matching FFTA's handling of
 * fractional growth. The result is clamped so no stat is negative and max HP is
 * always at least 1.
 */
export function deriveStats(input: DeriveStatsInput): StatBlock {
  const { level, growth, postMods = {}, equipment = [] } = input;

  assertLevel(level);
  assertGrowth(growth);
  assertModifiers(postMods, "postMods");
  for (const [index, mods] of equipment.entries()) {
    assertModifiers(mods, `equipment[${index}]`);
  }

  const equipmentMods = sumStatMods(equipment);

  // Start from the level-1 baseline, accumulate growth × level, then the flats.
  const totals = zeroStatMods();
  for (const key of STAT_KEYS) {
    totals[key] = POST_BASELINE_STATS[key];
  }
  for (const key of GROWTH_STAT_KEYS) {
    totals[key] += Math.floor(growth[key] * level);
  }
  for (const key of STAT_KEYS) {
    totals[key] += (postMods[key] ?? 0) + equipmentMods[key];
  }

  return {
    hp: Math.max(1, totals.hp),
    mp: Math.max(0, totals.mp),
    atk: Math.max(0, totals.atk),
    def: Math.max(0, totals.def),
    mag: Math.max(0, totals.mag),
    res: Math.max(0, totals.res),
    spd: Math.max(0, totals.spd),
    move: Math.max(0, totals.move),
    jump: Math.max(0, totals.jump),
  };
}

/** Optional layers for {@link deriveUnitStats}, mirroring {@link DeriveStatsInput}. */
export interface UnitStatsInput {
  /** Per-level growth from the unit's primary post. */
  readonly growth: StatGrowth;
  /** Flat post modifiers (baseline, attached post, movement rates, ...). */
  readonly postMods?: StatModifiers;
  /** Flat modifiers from the unit's equipped kit. */
  readonly equipment?: readonly StatModifiers[];
}

/**
 * Convenience wrapper: derive stats for a {@link Unit}, reading its `level`.
 * Used when a post changes (T051) or a level-up lands (T049); the unit's stored
 * `stats` block is the derived **output**, not an input.
 */
export function deriveUnitStats(unit: Unit, input: UnitStatsInput): StatBlock {
  return deriveStats({
    level: unit.level,
    growth: input.growth,
    postMods: input.postMods,
    equipment: input.equipment,
  });
}
