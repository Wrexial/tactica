import { describe, expect, it } from "vitest";

import { POSTS } from "../../src/data/posts";
import type { StatGrowth } from "../../src/data/schema";
import { isBattleEvent, type BattleEvent } from "../../src/engine/events";
import { coord } from "../../src/engine/grid";
import { asPostId, asUnitId } from "../../src/engine/ids";
import {
  ACTION_EXPERIENCE,
  EXPERIENCE_PER_LEVEL,
  MAX_EXPERIENCE_AWARD,
  MAX_LEVEL,
  MIN_EXPERIENCE_AWARD,
  awardActionExperience,
  awardExperience,
  awardKoExperience,
  experienceForAction,
  experienceForKo,
  experienceToNextLevel,
  isMaxLevel,
  levelUpStatGains,
} from "../../src/engine/progression/level";
import { deriveStats } from "../../src/engine/stats";
import { createUnit, type Unit, type UnitInit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T049 — XP & level growth
 *
 * Pins the task's "done when": **Experience is earned from actions and KOs, and
 * level-ups apply the post's stat growth.** The growth source is the authored
 * `PostDef.growth` block (`src/data/posts/`), the same one `deriveStats` (T018)
 * reads, so a soldier leveled here must match one derived at the same level.
 *
 * The tests also pin purity and determinism: a battle replays from a seed plus
 * a command log (`agents.md` §2), so awarding Experience may never mutate its
 * inputs or consult a clock.
 * ------------------------------------------------------------------------ */

/** The Fusilier's authored growth (France, `src/data/posts/france.ts`). */
const GROWTH: StatGrowth = POSTS.fusilier.growth;

/** Flat layers a soldier might already carry (post baseline, kit, ...). */
const POST_MODS = { hp: 50, mp: 5, atk: 10, def: 4, move: 4, jump: 2 } as const;

function makeUnit(overrides: Partial<UnitInit> = {}): Unit {
  return createUnit({
    id: asUnitId("unit-soldier"),
    name: "Sgt. Aubry",
    power: "france",
    postId: asPostId("fusilier"),
    level: 1,
    experience: 0,
    at: coord(2, 3),
    stats: deriveStats({ level: 1, growth: GROWTH }),
    ...overrides,
  });
}

/* --------------------------------------------------------------------------
 * The Experience curve
 * ------------------------------------------------------------------------ */

describe("Experience curve", () => {
  it("uses FFTA's flat 100-Experience threshold", () => {
    expect(EXPERIENCE_PER_LEVEL).toBe(100);
    expect(experienceToNextLevel(1)).toBe(100);
    expect(experienceToNextLevel(49)).toBe(100);
  });

  it("caps at FFTA's level 50", () => {
    expect(MAX_LEVEL).toBe(50);
    expect(experienceToNextLevel(MAX_LEVEL)).toBe(0);
    expect(experienceToNextLevel(MAX_LEVEL + 5)).toBe(0);
    expect(isMaxLevel(49)).toBe(false);
    expect(isMaxLevel(50)).toBe(true);
  });

  it("rejects malformed levels", () => {
    expect(() => experienceToNextLevel(0)).toThrow(RangeError);
    expect(() => experienceToNextLevel(1.5)).toThrow(RangeError);
    expect(() => isMaxLevel(-1)).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Action and KO awards
 * ------------------------------------------------------------------------ */

describe("experienceForAction — FFTA's 10 ± 2 per level rule", () => {
  it("awards the base at equal level", () => {
    expect(ACTION_EXPERIENCE).toBe(10);
    expect(experienceForAction(20, 20)).toBe(10);
  });

  it("scales by 2 per level of difference", () => {
    expect(experienceForAction(20, 30)).toBe(30);
    expect(experienceForAction(30, 20)).toBe(1); // 10 − 20, clamped
    expect(experienceForAction(20, 21)).toBe(12);
    expect(experienceForAction(21, 20)).toBe(8);
  });

  it("clamps to [1, 99]", () => {
    expect(experienceForAction(1, 50)).toBe(MAX_EXPERIENCE_AWARD);
    expect(experienceForAction(50, 1)).toBe(MIN_EXPERIENCE_AWARD);
  });

  it("rejects malformed levels", () => {
    expect(() => experienceForAction(0, 1)).toThrow(RangeError);
    expect(() => experienceForAction(1, 1.2)).toThrow(RangeError);
  });
});

describe("experienceForKo — the target's authored reward, level-scaled", () => {
  it("uses the authored base at equal level", () => {
    expect(experienceForKo(20, 20, 40)).toBe(40);
  });

  it("adds 2 per level the target is above the actor", () => {
    expect(experienceForKo(20, 30, 40)).toBe(60);
  });

  it("defaults the base to the action value and still clamps", () => {
    expect(experienceForKo(20, 20)).toBe(ACTION_EXPERIENCE);
    expect(experienceForKo(50, 1, 0)).toBe(MIN_EXPERIENCE_AWARD);
    expect(experienceForKo(1, 50, 999)).toBe(MAX_EXPERIENCE_AWARD);
  });

  it("rejects malformed input", () => {
    expect(() => experienceForKo(1, 1, -1)).toThrow(RangeError);
    expect(() => experienceForKo(1, 1, 1.5)).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Growth increments
 * ------------------------------------------------------------------------ */

describe("levelUpStatGains — post growth, consistent with deriveStats", () => {
  it("takes the truncated difference between adjacent levels", () => {
    const gains = levelUpStatGains(GROWTH, 1);
    expect(gains.hp).toBe(Math.floor(GROWTH.hp * 2) - Math.floor(GROWTH.hp));
    expect(gains.mp).toBe(Math.floor(GROWTH.mp * 2) - Math.floor(GROWTH.mp));
    expect(gains.atk).toBe(Math.floor(GROWTH.atk * 2) - Math.floor(GROWTH.atk));
    expect(gains.spd).toBe(Math.floor(GROWTH.spd * 2) - Math.floor(GROWTH.spd));
  });

  it("never grows movement rates", () => {
    const gains = levelUpStatGains(GROWTH, 5);
    expect(gains.move).toBe(0);
    expect(gains.jump).toBe(0);
  });

  it("telescopes to deriveStats' floor(growth × level)", () => {
    for (const level of [1, 5, 25, 50] as const) {
      const base = deriveStats({ level: 1, growth: GROWTH });
      const total = deriveStats({ level, growth: GROWTH });
      for (const key of ["hp", "mp", "atk", "def", "mag", "res", "spd"] as const) {
        let value = 0;
        for (let l = 1; l < level; l += 1) {
          value += levelUpStatGains(GROWTH, l)[key];
        }
        expect(base[key] + value).toBe(total[key]);
      }
    }
  });

  it("rejects malformed growth or level", () => {
    expect(() => levelUpStatGains({ ...GROWTH, hp: -1 }, 1)).toThrow(RangeError);
    expect(() => levelUpStatGains({ ...GROWTH, hp: Number.NaN }, 1)).toThrow(RangeError);
    expect(() => levelUpStatGains(GROWTH, 0)).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Awarding Experience
 * ------------------------------------------------------------------------ */

describe("awardExperience", () => {
  it("banks Experience below the threshold without a level-up", () => {
    const unit = makeUnit();
    const result = awardExperience(unit, 50, GROWTH, 7);

    expect(result.unit.level).toBe(1);
    expect(result.unit.experience).toBe(50);
    expect(result.gained).toBe(50);
    expect(result.levelsGained).toBe(0);
    expect(result.unit.stats).toEqual(unit.stats);
    expect(result.events).toEqual<BattleEvent[]>([
      {
        kind: "experienceGained",
        tick: 7,
        unitId: unit.id,
        amount: 50,
        experienceAfter: 50,
      },
    ]);
  });

  it("levels up exactly on the threshold and carries the remainder", () => {
    const unit = makeUnit();
    const result = awardExperience(unit, 150, GROWTH, 3);

    expect(result.unit.level).toBe(2);
    expect(result.unit.experience).toBe(50);
    expect(result.levelsGained).toBe(1);
    expect(result.events.map((event) => event.kind)).toEqual(["experienceGained", "levelUp"]);
    expect(result.events[1]).toMatchObject({ kind: "levelUp", tick: 3, level: 2 });
  });

  it("crosses several levels from one large award, in order", () => {
    const unit = makeUnit();
    const result = awardExperience(unit, 250, GROWTH);

    expect(result.unit.level).toBe(3);
    expect(result.unit.experience).toBe(50);
    expect(result.levelsGained).toBe(2);
    expect(result.events.map((event) => event.kind)).toEqual([
      "experienceGained",
      "levelUp",
      "levelUp",
    ]);
    expect(result.events[1]).toMatchObject({ level: 2 });
    expect(result.events[2]).toMatchObject({ level: 3 });
  });

  it("applies the post's stat growth on level-up", () => {
    const level1 = deriveStats({ level: 1, growth: GROWTH, postMods: POST_MODS });
    const level2 = deriveStats({ level: 2, growth: GROWTH, postMods: POST_MODS });
    const unit = makeUnit({ stats: level1 });

    const result = awardExperience(unit, 100, GROWTH);

    expect(unit.stats).toEqual(level1); // input untouched
    expect(result.unit.stats).toEqual(level2);
  });

  it("grows current HP and Élan by the gain, keeping wounds", () => {
    const level1 = deriveStats({ level: 1, growth: GROWTH, postMods: POST_MODS });
    const level2 = deriveStats({ level: 2, growth: GROWTH, postMods: POST_MODS });
    const unit = makeUnit({
      stats: level1,
      hp: level1.hp - 20,
      mp: Math.max(0, level1.mp - 3),
    });

    const result = awardExperience(unit, 100, GROWTH);
    const gains = levelUpStatGains(GROWTH, 1);

    expect(result.unit.stats.hp).toBe(level2.hp);
    expect(result.unit.hp).toBe(Math.min(level2.hp, unit.hp + gains.hp));
    expect(result.unit.mp).toBe(Math.min(level2.mp, unit.mp + gains.mp));
  });

  it("stops growing at the level cap", () => {
    const stats = deriveStats({ level: MAX_LEVEL, growth: GROWTH });
    const capped = makeUnit({ level: MAX_LEVEL, stats, hp: stats.hp });
    const result = awardExperience(capped, 500, GROWTH, 9);

    expect(result.unit).toBe(capped);
    expect(result.gained).toBe(0);
    expect(result.levelsGained).toBe(0);
    expect(result.events).toEqual([]);
  });

  it("reaches the cap and discards further progress", () => {
    const stats = deriveStats({ level: 49, growth: GROWTH });
    const nearCap = makeUnit({ level: 49, experience: 90, stats, hp: stats.hp });
    const result = awardExperience(nearCap, 50, GROWTH);

    expect(result.unit.level).toBe(MAX_LEVEL);
    expect(result.unit.experience).toBe(0);
    expect(result.levelsGained).toBe(1);
    expect(result.events.map((event) => event.kind)).toEqual(["experienceGained", "levelUp"]);
  });

  it("is a no-op for a zero award", () => {
    const unit = makeUnit();
    const result = awardExperience(unit, 0, GROWTH);
    expect(result.unit).toBe(unit);
    expect(result.gained).toBe(0);
    expect(result.events).toEqual([]);
  });

  it("never mutates its input and is deterministic", () => {
    const unit = makeUnit({ hp: 5 });
    const before = JSON.parse(JSON.stringify(unit)) as Unit;

    const first = awardExperience(unit, 250, GROWTH, 4);
    const second = awardExperience(unit, 250, GROWTH, 4);

    expect(JSON.parse(JSON.stringify(unit))).toEqual(before);
    expect(first.unit).not.toBe(unit);
    expect(first.unit).toEqual(second.unit);
    expect(first.events).toEqual(second.events);
  });

  it("emits valid battle events", () => {
    const unit = makeUnit();
    const result = awardExperience(unit, 250, GROWTH, 2);
    expect(result.events.every(isBattleEvent)).toBe(true);
  });

  it("rejects malformed input", () => {
    const unit = makeUnit();
    expect(() => awardExperience(unit, -1, GROWTH)).toThrow(RangeError);
    expect(() => awardExperience(unit, 1.5, GROWTH)).toThrow(RangeError);
    expect(() => awardExperience(unit, 10, { ...GROWTH, hp: -1 })).toThrow(RangeError);
    expect(() => awardExperience(unit, 10, GROWTH, -1)).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Action / KO convenience wrappers
 * ------------------------------------------------------------------------ */

describe("awardActionExperience / awardKoExperience", () => {
  it("awards the action value against the target's level", () => {
    const actor = makeUnit({ level: 10 });
    const target = makeUnit({ id: asUnitId("unit-enemy"), level: 10, side: "enemy" });
    const result = awardActionExperience(actor, target, GROWTH, 1);

    expect(result.gained).toBe(experienceForAction(actor.level, target.level));
    expect(result.unit.experience).toBe(10);
  });

  it("awards the KO value from the target's authored reward", () => {
    const actor = makeUnit({ level: 10 });
    const target = makeUnit({ id: asUnitId("unit-enemy"), level: 12, side: "enemy" });
    const result = awardKoExperience(actor, target, 40, GROWTH, 1);

    expect(result.gained).toBe(experienceForKo(actor.level, target.level, 40));
    expect(result.gained).toBe(44);
    expect(result.unit.experience).toBe(44);
  });
});

/* --------------------------------------------------------------------------
 * Data — the growth source really is a post
 * ------------------------------------------------------------------------ */

describe("post growth is the data source", () => {
  it("reads the seven growing stats from the authored post", () => {
    const block = POSTS.fusilier.growth;
    expect(Object.keys(block).sort()).toEqual(
      ["atk", "def", "hp", "mag", "mp", "res", "spd"].sort(),
    );
  });
});
