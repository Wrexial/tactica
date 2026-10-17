import { describe, expect, it } from "vitest";

import { coord } from "../../src/engine/grid";
import type { EquipSlot, PowerKey, StatBlock } from "../../src/data/schema";
import {
  asAbilityId,
  asConditionId,
  asEquipmentId,
  asPostId,
  asUnitId,
} from "../../src/engine/ids";
import {
  EXPERIENCE_MIN,
  HONOUR_MAX,
  UNIT_SIDES,
  addCondition,
  createEquipmentLoadout,
  createUnit,
  getCondition,
  hasCondition,
  isOutOfAction,
  isPowerKey,
  isUnitSide,
  learnAbility,
  removeCondition,
  withEquipment,
  withFacing,
  withHp,
  withJudgePoints,
  withMp,
  withPosition,
  type ActiveCondition,
  type LearnedAbility,
  type Unit,
  type UnitInit,
  type UnitSide,
} from "../../src/engine/unit";
import type { Facing } from "../../src/engine/grid";

/* --------------------------------------------------------------------------
 * T017 — Unit model
 *
 * These tests pin the task's "done when": a unit carries its **power**, **post**,
 * **level**, **stats**, **HP**, **Élan**, **Honour**, **facing**,
 * **conditions**, **equipment** and **learned abilities**. They also pin the
 * guarantees the rest of the engine leans on: creation fails fast on malformed
 * data, updates are pure (inputs are never mutated) and a unit round-trips
 * through JSON for saves and replays.
 * ------------------------------------------------------------------------ */

const STATS: StatBlock = {
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

function baseInit(): UnitInit {
  return {
    id: asUnitId("unit-1"),
    name: "Sgt. Aubry",
    power: "france",
    postId: asPostId("fusilier"),
    level: 1,
    at: coord(2, 3),
    stats: { ...STATS },
  };
}

function makeUnit(overrides: Partial<UnitInit> = {}): Unit {
  return createUnit({ ...baseInit(), ...overrides });
}

const BLEEDING: ActiveCondition = {
  conditionId: asConditionId("bleeding"),
  duration: 3,
  sourceId: asUnitId("unit-9"),
};

const VOLLEY: LearnedAbility = {
  abilityId: asAbilityId("volley"),
  drill: 40,
  mastered: true,
};

describe("createUnit", () => {
  it("carries every field the task requires", () => {
    const unit = makeUnit();

    expect(unit.id).toBe(asUnitId("unit-1"));
    expect(unit.name).toBe("Sgt. Aubry");
    expect(unit.power).toBe("france");
    expect(unit.postId).toBe(asPostId("fusilier"));
    expect(unit.side).toBe("company");
    expect(unit.level).toBe(1);
    expect(unit.experience).toBe(EXPERIENCE_MIN);
    expect(unit.at).toEqual({ x: 2, y: 3 });
    expect(unit.facing).toBe("north");
    expect(unit.stats).toEqual(STATS);
    expect(unit.hp).toBe(STATS.hp);
    expect(unit.mp).toBe(STATS.mp); // Élan
    expect(unit.judgePoints).toBe(0); // Honour
    expect(unit.conditions).toEqual([]);
    expect(unit.equipment).toEqual({
      weapon: null,
      offhand: null,
      armour: null,
      head: null,
      accessory: null,
    });
    expect(unit.abilities).toEqual([]);
  });

  it("defaults current HP and Élan to full strength", () => {
    const unit = makeUnit();
    expect(unit.hp).toBe(unit.stats.hp);
    expect(unit.mp).toBe(unit.stats.mp);
  });

  it("accepts explicit current values within range", () => {
    const unit = makeUnit({
      side: "enemy",
      level: 7,
      experience: 350,
      facing: "west",
      hp: 12,
      mp: 3,
      judgePoints: HONOUR_MAX,
      conditions: [BLEEDING],
      equipment: { weapon: asEquipmentId("brown-bess") },
      abilities: [VOLLEY],
    });

    expect(unit.side).toBe("enemy");
    expect(unit.level).toBe(7);
    expect(unit.experience).toBe(350);
    expect(unit.facing).toBe("west");
    expect(unit.hp).toBe(12);
    expect(unit.mp).toBe(3);
    expect(unit.judgePoints).toBe(HONOUR_MAX);
    expect(unit.conditions).toEqual([BLEEDING]);
    expect(unit.equipment.weapon).toBe(asEquipmentId("brown-bess"));
    expect(unit.equipment.offhand).toBeNull();
    expect(unit.abilities).toEqual([VOLLEY]);
  });

  it("normalises a partial equip loadout to every slot", () => {
    const loadout = createEquipmentLoadout({ head: asEquipmentId("shako") });
    expect(loadout).toEqual({
      weapon: null,
      offhand: null,
      armour: null,
      head: asEquipmentId("shako"),
      accessory: null,
    });
  });

  it("copies the stats and position so callers cannot alias engine state", () => {
    const stats = { ...STATS };
    const at = { x: 1, y: 1 };
    const unit = createUnit({ ...baseInit(), stats, at });

    stats.hp = 999;
    at.x = 99;

    expect(unit.stats.hp).toBe(60);
    expect(unit.at).toEqual({ x: 1, y: 1 });
    expect(unit.stats).not.toBe(stats);
    expect(unit.at).not.toBe(at);
  });

  it("round-trips through JSON (serialisable for saves/replays)", () => {
    const unit = makeUnit({
      conditions: [BLEEDING],
      equipment: { weapon: asEquipmentId("brown-bess") },
      abilities: [VOLLEY],
    });
    expect(JSON.parse(JSON.stringify(unit))).toEqual(unit);
  });

  it("is deterministic — same input yields an equal unit", () => {
    expect(makeUnit()).toEqual(makeUnit());
  });
});

describe("createUnit validation", () => {
  it("rejects an unknown power or side", () => {
    expect(() =>
      createUnit({ ...baseInit(), power: "spain" as unknown as PowerKey }),
    ).toThrow(RangeError);
    expect(() =>
      createUnit({ ...baseInit(), side: "rebels" as unknown as UnitSide }),
    ).toThrow(RangeError);
  });

  it("rejects a non-positive level or negative experience", () => {
    expect(() => createUnit({ ...baseInit(), level: 0 })).toThrow(RangeError);
    expect(() => createUnit({ ...baseInit(), level: 1.5 })).toThrow(RangeError);
    expect(() => createUnit({ ...baseInit(), experience: -1 })).toThrow(RangeError);
  });

  it("rejects fractional coordinates", () => {
    expect(() => createUnit({ ...baseInit(), at: coord(1.5, 2) })).toThrow(RangeError);
  });

  it("rejects an invalid facing", () => {
    expect(() =>
      createUnit({ ...baseInit(), facing: "up" as unknown as Facing }),
    ).toThrow(RangeError);
  });

  it("rejects negative stats and zero max HP", () => {
    expect(() =>
      createUnit({ ...baseInit(), stats: { ...STATS, atk: -1 } }),
    ).toThrow(RangeError);
    expect(() =>
      createUnit({ ...baseInit(), stats: { ...STATS, hp: 0 } }),
    ).toThrow(RangeError);
  });

  it("rejects current HP, Élan or Honour above their caps", () => {
    expect(() => createUnit({ ...baseInit(), hp: STATS.hp + 1 })).toThrow(RangeError);
    expect(() => createUnit({ ...baseInit(), hp: -1 })).toThrow(RangeError);
    expect(() => createUnit({ ...baseInit(), mp: STATS.mp + 1 })).toThrow(RangeError);
    expect(() => createUnit({ ...baseInit(), judgePoints: HONOUR_MAX + 1 })).toThrow(
      RangeError,
    );
  });

  it("rejects malformed conditions and learned abilities", () => {
    expect(() =>
      createUnit({
        ...baseInit(),
        conditions: [{ conditionId: asConditionId("bleeding"), duration: -1 }],
      }),
    ).toThrow(RangeError);
    expect(() =>
      createUnit({
        ...baseInit(),
        abilities: [
          { abilityId: asAbilityId("volley"), drill: -1, mastered: false },
        ],
      }),
    ).toThrow(RangeError);
    expect(() =>
      createUnit({
        ...baseInit(),
        abilities: [
          {
            abilityId: asAbilityId("volley"),
            drill: 0,
            mastered: "yes" as unknown as boolean,
          },
        ],
      }),
    ).toThrow(RangeError);
  });
});

describe("unit queries", () => {
  it("reports out of action at zero HP", () => {
    expect(isOutOfAction(makeUnit({ hp: 0 }))).toBe(true);
    expect(isOutOfAction(makeUnit({ hp: 1 }))).toBe(false);
  });

  it("finds active conditions", () => {
    const unit = makeUnit({ conditions: [BLEEDING] });
    expect(hasCondition(unit, asConditionId("bleeding"))).toBe(true);
    expect(hasCondition(unit, asConditionId("formed"))).toBe(false);
    expect(getCondition(unit, asConditionId("bleeding"))).toEqual(BLEEDING);
    expect(getCondition(unit, asConditionId("formed"))).toBeUndefined();
  });

  it("guards power and side keys at the boundary", () => {
    for (const power of ["france", "britain", "prussia", "russia", "austria"]) {
      expect(isPowerKey(power)).toBe(true);
    }
    expect(isPowerKey("spain")).toBe(false);
    for (const side of UNIT_SIDES) expect(isUnitSide(side)).toBe(true);
    expect(isUnitSide("rebels")).toBe(false);
  });
});

describe("immutable updates", () => {
  it("moves a unit and optionally turns it, without mutating the input", () => {
    const before = makeUnit();
    const after = withPosition(before, coord(5, 6), "east");

    expect(after.at).toEqual({ x: 5, y: 6 });
    expect(after.facing).toBe("east");
    expect(before.at).toEqual({ x: 2, y: 3 });
    expect(before.facing).toBe("north");
    expect(after).not.toBe(before);
  });

  it("turns a unit in place", () => {
    const before = makeUnit();
    const after = withFacing(before, "south");
    expect(after.facing).toBe("south");
    expect(after.at).toEqual(before.at);
    expect(before.facing).toBe("north");
  });

  it("clamps HP into [0, stats.hp]", () => {
    const unit = makeUnit();
    expect(withHp(unit, 10).hp).toBe(10);
    expect(withHp(unit, -5).hp).toBe(0);
    expect(withHp(unit, 9999).hp).toBe(STATS.hp);
  });

  it("clamps Élan into [0, stats.mp]", () => {
    const unit = makeUnit();
    expect(withMp(unit, 4).mp).toBe(4);
    expect(withMp(unit, -1).mp).toBe(0);
    expect(withMp(unit, 999).mp).toBe(STATS.mp);
  });

  it("clamps Honour into [0, HONOUR_MAX]", () => {
    const unit = makeUnit();
    expect(withJudgePoints(unit, 3).judgePoints).toBe(3);
    expect(withJudgePoints(unit, -1).judgePoints).toBe(0);
    expect(withJudgePoints(unit, 99).judgePoints).toBe(HONOUR_MAX);
  });

  it("appends a condition and refreshes a repeated one in place", () => {
    const unit = makeUnit();
    const once = addCondition(unit, BLEEDING);
    expect(once.conditions).toEqual([BLEEDING]);
    expect(unit.conditions).toEqual([]); // input untouched

    const refreshed: ActiveCondition = {
      conditionId: asConditionId("bleeding"),
      duration: 9,
    };
    const twice = addCondition(once, refreshed);
    expect(twice.conditions).toEqual([refreshed]);
    expect(once.conditions).toEqual([BLEEDING]);
  });

  it("removes conditions and is a no-op when absent", () => {
    const unit = makeUnit({ conditions: [BLEEDING] });
    expect(removeCondition(unit, asConditionId("bleeding")).conditions).toEqual([]);
    // No change means the same reference (cheap structural sharing).
    expect(removeCondition(unit, asConditionId("formed"))).toBe(unit);
  });

  it("sets and clears an equipment slot", () => {
    const unit = makeUnit();
    const armed = withEquipment(unit, "weapon", asEquipmentId("brown-bess"));
    expect(armed.equipment.weapon).toBe(asEquipmentId("brown-bess"));
    expect(unit.equipment.weapon).toBeNull();

    const cleared = withEquipment(armed, "weapon", null);
    expect(cleared.equipment.weapon).toBeNull();
    expect(() =>
      withEquipment(unit, "cape" as unknown as EquipSlot, asEquipmentId("brown-bess")),
    ).toThrow(RangeError);
  });

  it("learns an ability and keeps mastery sticky across refreshes", () => {
    const unit = makeUnit();
    const learning = learnAbility(unit, {
      abilityId: asAbilityId("volley"),
      drill: 10,
      mastered: false,
    });
    expect(learning.abilities).toEqual([
      { abilityId: asAbilityId("volley"), drill: 10, mastered: false },
    ]);

    const mastered = learnAbility(learning, VOLLEY);
    expect(mastered.abilities).toEqual([VOLLEY]);

    // A later, lower event cannot un-master or lose Drill.
    const again = learnAbility(mastered, {
      abilityId: asAbilityId("volley"),
      drill: 1,
      mastered: false,
    });
    expect(again.abilities).toEqual([VOLLEY]);
    expect(learning.abilities).toEqual([
      { abilityId: asAbilityId("volley"), drill: 10, mastered: false },
    ]);
  });
});
