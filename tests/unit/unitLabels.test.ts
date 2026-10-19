import { describe, expect, it } from "vitest";

import type { StatBlock } from "../../src/data/schema";
import { coord } from "../../src/engine/grid";
import { asConditionId, asPostId, asUnitId } from "../../src/engine/ids";
import { createUnit, type ActiveCondition, type Unit } from "../../src/engine/unit";
import {
  POWER_LABEL_KEYS,
  ROLE_LABEL_KEYS,
  SIDE_LABEL_KEYS,
  unitChips,
  unitConditionName,
  unitConditionNames,
  unitRoleLabelKey,
} from "../../src/ui/unitLabels";

/* --------------------------------------------------------------------------
 * T134 — per-character unit card labels.
 *
 * The card itself is a thin React view (covered by the e2e suite). The parts
 * worth pinning in Node are the pure label/stat projections: the vitals chips,
 * the role family lookup, and the condition names. They must read straight from
 * the unit and the catalog, with no balance maths or mutation.
 * ------------------------------------------------------------------------ */

const STATS: StatBlock = {
  hp: 40,
  mp: 12,
  atk: 8,
  def: 6,
  mag: 4,
  res: 5,
  spd: 20,
  move: 5,
  jump: 3,
};

function makeUnit(overrides: { readonly conditions?: readonly ActiveCondition[] } = {}): Unit {
  return createUnit({
    id: asUnitId("unit-card-test"),
    name: "Sgt. Test",
    power: "france",
    postId: asPostId("fusilier"),
    side: "company",
    level: 1,
    at: coord(1, 1),
    stats: STATS,
    hp: 27,
    mp: 4,
    conditions: overrides.conditions,
  });
}

describe("unitChips", () => {
  it("reads the soldier's exact vitals in a fixed order", () => {
    const chips = unitChips(makeUnit());

    expect(chips.map((chip) => chip.id)).toEqual(["hp", "elan", "spd", "move", "jump"]);
    expect(chips).toEqual([
      { id: "hp", labelKey: "stat.hp", value: 27, max: 40 },
      { id: "elan", labelKey: "stat.mp", value: 4, max: 12 },
      { id: "spd", labelKey: "stat.spd", value: 20 },
      { id: "move", labelKey: "stat.move", value: 5 },
      { id: "jump", labelKey: "stat.jump", value: 3 },
    ]);
  });

  it("does not mutate the unit", () => {
    const unit = makeUnit();
    const before = JSON.stringify(unit);
    unitChips(unit);
    expect(JSON.stringify(unit)).toBe(before);
  });
});

describe("role and power labels", () => {
  it("maps a post id to its coarse role family", () => {
    expect(unitRoleLabelKey("fusilier")).toBe("role.line");
    expect(unitRoleLabelKey("hussar")).toBe("role.cavalry");
    expect(unitRoleLabelKey("surgeon")).toBe("role.medical");
    expect(unitRoleLabelKey("voltigeur")).toBe("role.skirmisher");
  });

  it("covers all five powers and all three sides", () => {
    expect(Object.keys(POWER_LABEL_KEYS)).toHaveLength(5);
    expect(Object.keys(SIDE_LABEL_KEYS)).toEqual(["company", "enemy", "neutral"]);
    expect(Object.keys(ROLE_LABEL_KEYS)).toHaveLength(8);
  });
});

describe("condition names", () => {
  it("resolves an authored condition id to its Napoleonic name", () => {
    const unit = makeUnit({
      conditions: [{ conditionId: asConditionId("poison"), duration: 3 }],
    });
    // Poison (FFTA) retired to Bleeding (mapping §8).
    expect(unitConditionNames(unit)).toEqual(["Bleeding"]);
  });

  it("passes an unknown condition id through unchanged", () => {
    expect(unitConditionName("not-a-condition")).toBe("not-a-condition");
  });
});
