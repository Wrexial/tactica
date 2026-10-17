import { describe, expect, it } from "vitest";

import type { StatBlock, StatGrowth } from "../../src/data/schema";
import { coord } from "../../src/engine/grid";
import { asPostId, asUnitId } from "../../src/engine/ids";
import {
  STAT_KEYS,
  addStatMods,
  deriveStats,
  deriveUnitStats,
  sumStatMods,
  zeroStatMods,
} from "../../src/engine/stats";
import { createUnit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T018 — Derived stats
 *
 * These tests pin the task's "done when": the effective stat block is
 * `base growth × level + post modifiers + equipment`, fully data-driven. They
 * also pin the guarantees the rest of the engine leans on: the formula is
 * deterministic, inputs are never mutated, movement rates come from flat
 * modifiers (not growth), and the result is always a sane integer block.
 * ------------------------------------------------------------------------ */

/** A rifleman-like growth profile, in the reference's FFTA job-table shape. */
const GROWTH: StatGrowth = {
  hp: 7.2,
  mp: 1.1,
  atk: 7.2,
  def: 7.2,
  mag: 6.4,
  res: 8.1,
  spd: 1.4,
};

/** Flat post modifiers: baseline, attached-post delta and movement rates. */
const POST_MODS = {
  hp: 50,
  mp: 5,
  atk: 10,
  def: 4,
  spd: -2,
  move: 4,
  jump: 2,
} as const;

/** Two pieces of kit, summed in order. */
const EQUIP = [{ atk: 12, spd: 2 }, { def: 6, res: 3, move: 1 }] as const;

const BASE_STATS: StatBlock = {
  hp: 60,
  mp: 20,
  atk: 12,
  def: 8,
  mag: 4,
  res: 6,
  spd: 10,
  move: 4,
  jump: 2,
};

describe("deriveStats", () => {
  it("scales the seven growth stats by level, truncating fractions", () => {
    expect(deriveStats({ level: 1, growth: GROWTH })).toEqual({
      hp: 7, // floor(7.2 × 1)
      mp: 1, // floor(1.1 × 1)
      atk: 7,
      def: 7,
      mag: 6, // floor(6.4 × 1)
      res: 8, // floor(8.1 × 1)
      spd: 1,
      move: 0, // movement rates do not grow
      jump: 0,
    });

    expect(deriveStats({ level: 10, growth: GROWTH })).toEqual({
      hp: 72,
      mp: 11,
      atk: 72,
      def: 72,
      mag: 64,
      res: 81,
      spd: 14,
      move: 0,
      jump: 0,
    });
  });

  it("adds flat post modifiers, including movement rates and penalties", () => {
    expect(deriveStats({ level: 10, growth: GROWTH, postMods: POST_MODS })).toEqual({
      hp: 122,
      mp: 16,
      atk: 82,
      def: 76,
      mag: 64,
      res: 81,
      spd: 12,
      move: 4,
      jump: 2,
    });
  });

  it("sums every equipped item on top of growth and post modifiers", () => {
    expect(
      deriveStats({
        level: 10,
        growth: GROWTH,
        postMods: POST_MODS,
        equipment: EQUIP,
      }),
    ).toEqual({
      hp: 122,
      mp: 16,
      atk: 94, // 72 + 10 + 12
      def: 82, // 72 + 4 + 6
      mag: 64,
      res: 84, // 81 + 3
      spd: 14, // 14 − 2 + 2
      move: 5, // 0 + 4 + 1
      jump: 2,
    });
  });

  it("keeps the equipment contribution independent of level", () => {
    const low = deriveStats({ level: 1, growth: GROWTH, equipment: EQUIP });
    const high = deriveStats({ level: 5, growth: GROWTH, equipment: EQUIP });
    expect(low.atk).toBe(7 + 12);
    expect(high.atk).toBe(36 + 12); // floor(7.2 × 5) = 36
    expect(low.def).toBe(7 + 6);
    expect(high.def).toBe(36 + 6);
  });

  it("clamps so no stat is negative and max HP is at least 1", () => {
    const derived = deriveStats({
      level: 1,
      growth: GROWTH,
      equipment: [{ atk: -100, hp: -1000, move: -9 }],
    });
    expect(derived.hp).toBe(1);
    expect(derived.atk).toBe(0);
    expect(derived.move).toBe(0);
    // Untouched stats are unaffected.
    expect(derived.mp).toBe(1);
  });

  it("returns a full, integer block with exactly the nine stats", () => {
    const derived = deriveStats({ level: 3, growth: GROWTH });
    expect(Object.keys(derived).sort()).toEqual([...STAT_KEYS].sort());
    for (const key of STAT_KEYS) {
      expect(Number.isInteger(derived[key])).toBe(true);
    }
  });

  it("is pure and deterministic — inputs are not mutated", () => {
    const growth = { ...GROWTH };
    const postMods = { ...POST_MODS };
    const equipment = [{ atk: 12 }, { def: 6 }];

    const first = deriveStats({ level: 4, growth, postMods, equipment });
    const second = deriveStats({ level: 4, growth, postMods, equipment });

    expect(first).toEqual(second);
    expect(growth).toEqual(GROWTH);
    expect(postMods).toEqual({ ...POST_MODS });
    expect(equipment).toEqual([{ atk: 12 }, { def: 6 }]);
    expect(first).not.toBe(second);
  });
});

describe("deriveStats validation", () => {
  it("rejects a level below 1 or a non-integer level", () => {
    expect(() => deriveStats({ level: 0, growth: GROWTH })).toThrow(RangeError);
    expect(() => deriveStats({ level: -3, growth: GROWTH })).toThrow(RangeError);
    expect(() => deriveStats({ level: 1.5, growth: GROWTH })).toThrow(RangeError);
  });

  it("rejects negative or non-finite growth values", () => {
    expect(() => deriveStats({ level: 1, growth: { ...GROWTH, hp: -1 } })).toThrow(
      RangeError,
    );
    expect(() => deriveStats({ level: 1, growth: { ...GROWTH, spd: NaN } })).toThrow(
      RangeError,
    );
    expect(() =>
      deriveStats({ level: 1, growth: { ...GROWTH, atk: Infinity } }),
    ).toThrow(RangeError);
  });

  it("rejects fractional modifiers (post or equipment)", () => {
    expect(() =>
      deriveStats({ level: 1, growth: GROWTH, postMods: { atk: 1.5 } }),
    ).toThrow(RangeError);
    expect(() =>
      deriveStats({ level: 1, growth: GROWTH, equipment: [{ move: 0.5 }] }),
    ).toThrow(RangeError);
  });
});

describe("modifier helpers", () => {
  it("provides a zero block", () => {
    expect(zeroStatMods()).toEqual({
      hp: 0,
      mp: 0,
      atk: 0,
      def: 0,
      mag: 0,
      res: 0,
      spd: 0,
      move: 0,
      jump: 0,
    });
  });

  it("sums partial blocks, treating omitted stats as zero", () => {
    expect(sumStatMods([])).toEqual(zeroStatMods());
    expect(sumStatMods([{ atk: 2 }, { atk: 3, def: 1 }])).toEqual({
      ...zeroStatMods(),
      atk: 5,
      def: 1,
    });
  });

  it("combines two blocks into a new one", () => {
    expect(addStatMods({ hp: 1, move: 2 }, { hp: 4, jump: 3 })).toEqual({
      ...zeroStatMods(),
      hp: 5,
      move: 2,
      jump: 3,
    });
  });
});

describe("deriveUnitStats", () => {
  it("reads the unit's level and applies the same formula", () => {
    const unit = createUnit({
      id: asUnitId("unit-1"),
      name: "Sgt. Aubry",
      power: "france",
      postId: asPostId("fusilier"),
      level: 10,
      at: coord(2, 3),
      stats: BASE_STATS,
    });

    const derived = deriveUnitStats(unit, {
      growth: GROWTH,
      postMods: POST_MODS,
      equipment: EQUIP,
    });

    expect(derived).toEqual(
      deriveStats({ level: 10, growth: GROWTH, postMods: POST_MODS, equipment: EQUIP }),
    );
  });

  it("does not read the unit's stored stats block", () => {
    const makeAtLevel = (level: number) =>
      createUnit({
        id: asUnitId(`unit-${level}`),
        name: "Sgt. Aubry",
        power: "france",
        postId: asPostId("fusilier"),
        level,
        at: coord(2, 3),
        stats: BASE_STATS,
      });

    // Same level, wildly different stored stats → same derived block.
    const a = createUnit({
      id: asUnitId("unit-a"),
      name: "Sgt. A",
      power: "france",
      postId: asPostId("fusilier"),
      level: 3,
      at: coord(0, 0),
      stats: { ...BASE_STATS, hp: 999, atk: 999 },
    });

    expect(deriveUnitStats(a, { growth: GROWTH })).toEqual(
      deriveUnitStats(makeAtLevel(3), { growth: GROWTH }),
    );
  });
});
