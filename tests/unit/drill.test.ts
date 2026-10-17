import { describe, expect, it } from "vitest";

import { coord } from "../../src/engine/grid";
import { isBattleEvent, type BattleEvent } from "../../src/engine/events";
import {
  asAbilityId,
  asEquipmentId,
  asPostId,
  asUnitId,
} from "../../src/engine/ids";
import {
  awardBattleDrill,
  awardDrill,
  drillProgress,
  equippedTeaches,
  isMastered,
  learnedAbilityOf,
  unmasteredEquippedTeaches,
} from "../../src/engine/progression/drill";
import {
  createUnit,
  learnAbility,
  withEquipment,
  type Unit,
  type UnitInit,
} from "../../src/engine/unit";
import type { StatBlock } from "../../src/data/schema";

/* --------------------------------------------------------------------------
 * T048 — Drill learning from kit
 *
 * Pins the task's "done when": **abilities are bound to equipment**, a battle's
 * **Drill award is distributed to the equipped, unmastered abilities**, and
 * **mastery is permanent** once the authored Drill cost is met. The kit that
 * teaches abilities is authored content (`EquipmentDef.teaches`,
 * `src/data/equipment.ts`); this module owns only the learning rules.
 *
 * The FFTA reference (`docs/wiki/raw/Ability_Points.wiki`) credits the award to
 * *any unmastered ability a unit is trying to learn* — every equipped ability
 * learns in parallel, and a duplicate teaching does not stack. The tests pin
 * that policy, plus purity and determinism (a battle replays from a seed and a
 * command log, `agents.md` §2).
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

/**
 * A soldier wearing three teaching items, in slot order:
 * weapon `charleville-musket` → volley-fire (100), offhand `pavise-shield` →
 * parry (70), accessory `spyglass` → range-the-ground (70). Armour and head
 * teach nothing.
 */
function makeUnit(overrides: Partial<UnitInit> = {}): Unit {
  return createUnit({
    id: asUnitId("unit-soldier"),
    name: "Sgt. Aubry",
    power: "france",
    postId: asPostId("fusilier"),
    level: 1,
    at: coord(2, 3),
    stats: STATS,
    equipment: {
      weapon: asEquipmentId("charleville-musket"),
      offhand: asEquipmentId("pavise-shield"),
      armour: asEquipmentId("line-uniform"),
      head: asEquipmentId("shako"),
      accessory: asEquipmentId("spyglass"),
    },
    ...overrides,
  });
}

/* --------------------------------------------------------------------------
 * Kit bindings
 * ------------------------------------------------------------------------ */

describe("equippedTeaches — abilities bound to kit", () => {
  it("binds each equipped item's teaching, in canonical slot order", () => {
    const teaches = equippedTeaches(makeUnit());
    expect(teaches.map((teach) => teach.abilityId)).toEqual([
      "volley-fire",
      "parry",
      "range-the-ground",
    ]);
    expect(teaches[0]).toEqual({
      abilityId: "volley-fire",
      requiredDrill: 100,
      equipmentId: "charleville-musket",
      slot: "weapon",
    });
    expect(teaches[1]).toEqual({
      abilityId: "parry",
      requiredDrill: 70,
      equipmentId: "pavise-shield",
      slot: "offhand",
    });
    expect(teaches[2]).toMatchObject({
      abilityId: "range-the-ground",
      requiredDrill: 70,
      slot: "accessory",
    });
  });

  it("ignores empty slots, non-teaching kit and unknown (fixture) kit", () => {
    const unit = makeUnit({
      equipment: {
        weapon: asEquipmentId("brown-bess"), // not in the data registry
        offhand: null,
        armour: asEquipmentId("line-uniform"), // no teaches
        head: asEquipmentId("shako"), // no teaches
        accessory: null,
      },
    });
    expect(equippedTeaches(unit)).toEqual([]);
  });

  it("deduplicates kit that teaches the same ability (FFTA does not stack)", () => {
    const unit = makeUnit({
      equipment: {
        weapon: asEquipmentId("charleville-musket"),
        offhand: asEquipmentId("charleville-musket"),
      },
    });
    const teaches = equippedTeaches(unit);
    expect(teaches).toHaveLength(1);
    expect(teaches[0]?.equipmentId).toBe("charleville-musket");
    expect(teaches[0]?.slot).toBe("weapon"); // first slot wins
  });

  it("is deterministic", () => {
    const first = equippedTeaches(makeUnit());
    const second = equippedTeaches(makeUnit());
    expect(first).toEqual(second);
  });
});

describe("unmasteredEquippedTeaches / isMastered", () => {
  it("excludes abilities already mastered", () => {
    const unit = makeUnit({
      abilities: [{ abilityId: asAbilityId("volley-fire"), drill: 100, mastered: true }],
    });
    expect(isMastered(unit, asAbilityId("volley-fire"))).toBe(true);
    expect(isMastered(unit, asAbilityId("parry"))).toBe(false);
    expect(unmasteredEquippedTeaches(unit).map((teach) => teach.abilityId)).toEqual([
      "parry",
      "range-the-ground",
    ]);
  });

  it("keeps an in-progress (unmastered) ability in the learning set", () => {
    const unit = learnAbility(makeUnit(), {
      abilityId: asAbilityId("volley-fire"),
      drill: 40,
      mastered: false,
    });
    expect(unmasteredEquippedTeaches(unit).map((teach) => teach.abilityId)).toContain(
      "volley-fire",
    );
    expect(learnedAbilityOf(unit, asAbilityId("volley-fire"))?.drill).toBe(40);
  });
});

describe("drillProgress — the barracks view", () => {
  it("reports drill and the required cost for every equipped ability", () => {
    const unit = learnAbility(makeUnit(), {
      abilityId: asAbilityId("volley-fire"),
      drill: 30,
      mastered: false,
    });
    const progress = drillProgress(unit);
    expect(progress.map((entry) => entry.abilityId)).toEqual([
      "volley-fire",
      "parry",
      "range-the-ground",
    ]);
    expect(progress[0]).toMatchObject({ drill: 30, requiredDrill: 100, mastered: false });
    expect(progress[1]).toMatchObject({ drill: 0, requiredDrill: 70, mastered: false });
  });
});

/* --------------------------------------------------------------------------
 * Awarding Drill
 * ------------------------------------------------------------------------ */

describe("awardDrill — the battle award", () => {
  it("credits the full award to each equipped, unmastered ability", () => {
    const unit = makeUnit();
    const result = awardDrill(unit, 30, 5);

    expect(result.trained).toBe(3);
    expect(result.mastered).toBe(0);
    expect(result.gained).toBe(30);
    expect(result.unit.abilities).toEqual([
      { abilityId: "volley-fire", drill: 30, mastered: false },
      { abilityId: "parry", drill: 30, mastered: false },
      { abilityId: "range-the-ground", drill: 30, mastered: false },
    ]);
    expect(result.events.map((event) => event.kind)).toEqual([
      "drillGained",
      "drillGained",
      "drillGained",
    ]);

    // Every ability got the whole award, not a split of it.
    for (const learned of result.unit.abilities) {
      expect(learned.drill).toBe(30);
    }
  });

  it("carries the tick and current total on each drillGained event", () => {
    const result = awardDrill(makeUnit(), 30, 7);
    expect(result.events[0]).toEqual({
      kind: "drillGained",
      tick: 7,
      unitId: asUnitId("unit-soldier"),
      abilityId: "volley-fire",
      amount: 30,
      drillAfter: 30,
      mastered: false,
    });
  });

  it("masters an ability when the award reaches its authored cost", () => {
    const result = awardDrill(makeUnit(), 100, 3);

    expect(result.trained).toBe(3);
    expect(result.mastered).toBe(3);
    expect(result.events.map((event) => event.kind)).toEqual([
      "drillGained",
      "abilityLearned",
      "drillGained",
      "abilityLearned",
      "drillGained",
      "abilityLearned",
    ]);
    expect(result.events[1]).toEqual({
      kind: "abilityLearned",
      tick: 3,
      unitId: asUnitId("unit-soldier"),
      abilityId: "volley-fire",
    });
    expect(result.unit.abilities.every((learned) => learned.mastered)).toBe(true);
  });

  it("caps banked Drill at the required cost once mastered", () => {
    const result = awardDrill(makeUnit(), 100);
    const volley = result.unit.abilities.find((a) => a.abilityId === "volley-fire");
    const parry = result.unit.abilities.find((a) => a.abilityId === "parry");
    expect(volley).toEqual({ abilityId: "volley-fire", drill: 100, mastered: true });
    expect(parry).toEqual({ abilityId: "parry", drill: 70, mastered: true }); // not 100
  });

  it("accumulates across awards and masters exactly on the threshold", () => {
    const first = awardDrill(makeUnit(), 50);
    expect(first.unit.abilities.find((a) => a.abilityId === "volley-fire")?.drill).toBe(50);
    expect(first.unit.abilities.find((a) => a.abilityId === "parry")?.mastered).toBe(false);

    const second = awardDrill(first.unit, 50);
    expect(second.unit.abilities.find((a) => a.abilityId === "volley-fire")).toEqual({
      abilityId: "volley-fire",
      drill: 100,
      mastered: true,
    });
    expect(second.unit.abilities.find((a) => a.abilityId === "parry")).toEqual({
      abilityId: "parry",
      drill: 70,
      mastered: true,
    });
    expect(second.mastered).toBe(3); // all three reach their cost on the second award
    expect(second.events.filter((event) => event.kind === "abilityLearned")).toHaveLength(3);
  });

  it("does not re-credit abilities already mastered", () => {
    const mastered = awardDrill(makeUnit(), 100).unit;
    const again = awardDrill(mastered, 50, 9);

    expect(again.trained).toBe(0);
    expect(again.gained).toBe(0);
    expect(again.mastered).toBe(0);
    expect(again.events).toEqual([]);
    expect(again.unit).toBe(mastered); // no-op returns the same reference
  });

  it("is a no-op with no equipped, unmastered kit", () => {
    const bare = makeUnit({ equipment: {} });
    const result = awardDrill(bare, 50);
    expect(result.unit).toBe(bare);
    expect(result.events).toEqual([]);
  });

  it("is a no-op for a zero award", () => {
    const unit = makeUnit();
    const result = awardDrill(unit, 0);
    expect(result.unit).toBe(unit);
    expect(result.gained).toBe(0);
    expect(result.events).toEqual([]);
  });

  it("never mutates its input and is deterministic", () => {
    const unit = makeUnit();
    const before = JSON.parse(JSON.stringify(unit)) as Unit;

    const first = awardDrill(unit, 30, 4);
    const second = awardDrill(unit, 30, 4);

    expect(JSON.parse(JSON.stringify(unit))).toEqual(before);
    expect(first.unit).not.toBe(unit);
    expect(first.unit).toEqual(second.unit);
    expect(first.events).toEqual(second.events);
  });

  it("emits structurally valid battle events", () => {
    const result = awardDrill(makeUnit(), 100, 2);
    expect(result.events.every(isBattleEvent)).toBe(true);
    expect(result.events as BattleEvent[]).toHaveLength(6);
  });

  it("rejects malformed input", () => {
    const unit = makeUnit();
    expect(() => awardDrill(unit, -1)).toThrow(RangeError);
    expect(() => awardDrill(unit, 1.5)).toThrow(RangeError);
    expect(() => awardDrill(unit, 10, -1)).toThrow(RangeError);
    expect(() => awardDrill(unit, 10, 0.5)).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Mastery is permanent
 * ------------------------------------------------------------------------ */

describe("mastery is permanent", () => {
  it("keeps partial progress when the teaching item is removed", () => {
    const trained = awardDrill(makeUnit(), 40).unit; // parry at 40/70
    const disarmed = withEquipment(trained, "offhand", null);

    expect(learnedAbilityOf(disarmed, asAbilityId("parry"))?.drill).toBe(40);
    expect(isMastered(disarmed, asAbilityId("parry"))).toBe(false);
    expect(unmasteredEquippedTeaches(disarmed).map((t) => t.abilityId)).not.toContain(
      "parry",
    );
  });

  it("resumes banked Drill when the item is re-equipped", () => {
    const trained = awardDrill(makeUnit(), 40).unit;
    const disarmed = withEquipment(trained, "offhand", null);
    const rearmed = withEquipment(disarmed, "offhand", asEquipmentId("pavise-shield"));

    const finished = awardDrill(rearmed, 30);
    expect(finished.unit.abilities.find((a) => a.abilityId === "parry")).toEqual({
      abilityId: "parry",
      drill: 70,
      mastered: true,
    });
  });

  it("keeps mastery even after the teaching item is gone", () => {
    const mastered = awardDrill(makeUnit(), 100).unit;
    const stripped = withEquipment(mastered, "weapon", null);

    expect(isMastered(stripped, asAbilityId("volley-fire"))).toBe(true);
    // Removing it does not erase the record or reset the Drill.
    expect(learnedAbilityOf(stripped, asAbilityId("volley-fire"))).toEqual({
      abilityId: "volley-fire",
      drill: 100,
      mastered: true,
    });
    expect(unmasteredEquippedTeaches(stripped).map((t) => t.abilityId)).not.toContain(
      "volley-fire",
    );
  });
});

/* --------------------------------------------------------------------------
 * Party-level award
 * ------------------------------------------------------------------------ */

describe("awardBattleDrill — one award across the party", () => {
  it("credits every soldier from its own kit, in order", () => {
    const soldier = makeUnit({ id: asUnitId("unit-a") });
    const rifleman = makeUnit({
      id: asUnitId("unit-b"),
      equipment: { weapon: asEquipmentId("charleville-musket") },
    });

    const results = awardBattleDrill([soldier, rifleman], 100, 2);

    expect(results).toHaveLength(2);
    expect(results[0]?.trained).toBe(3);
    expect(results[1]?.trained).toBe(1);
    expect(isMastered(results[1]!.unit, asAbilityId("volley-fire"))).toBe(true);
    expect(results[1]!.events.map((event) => event.kind)).toEqual([
      "drillGained",
      "abilityLearned",
    ]);
  });

  it("is deterministic across identical parties", () => {
    const first = awardBattleDrill([makeUnit()], 40);
    const second = awardBattleDrill([makeUnit()], 40);
    expect(first[0]?.unit).toEqual(second[0]?.unit);
    expect(first[0]?.events).toEqual(second[0]?.events);
  });
});
