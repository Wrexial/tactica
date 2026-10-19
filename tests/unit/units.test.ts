import { describe, expect, it } from "vitest";

import { coord, FACINGS, type Facing } from "../../src/engine/grid";
import { asConditionId, asPostId, asUnitId } from "../../src/engine/ids";
import { chargeOf, createOrdersTempo } from "../../src/engine/turn";
import {
  createUnit,
  HONOUR_MAX,
  type ActiveCondition,
  type Unit,
  type UnitSide,
} from "../../src/engine/unit";
import type { PowerKey, StatBlock } from "../../src/data/schema";
import {
  CHARGE_BAR,
  CHARGE_COLOR_CHARGING,
  CHARGE_COLOR_READY,
  CONDITION_ICON_FALLBACK,
  CONDITION_KIND_COLORS,
  ELAN_COLOR_HIGH,
  ELAN_COLOR_LOW,
  HP_COLOR_HIGH,
  HP_COLOR_LOW,
  HP_COLOR_MID,
  POWER_UNIFORMS,
  SIDE_COLORS,
  abbreviate,
  chargeBar,
  chargeColor,
  chargeRatio,
  conditionIcon,
  conditionIcons,
  elanBar,
  elanColor,
  facingScreen,
  honourPips,
  hpBar,
  hpColor,
  powerUniform,
  roleCategory,
  soldierFigure,
  unitDrawOps,
  unitPresentation,
} from "../../src/render/units";

/* --------------------------------------------------------------------------
 * T081 — Unit presentation
 *
 * These pin the Pixi-free half of the unit renderer: the uniform palettes, the
 * role classifier, facing vectors, the HP / Élan bars, the Honour pips and the
 * condition icons. The Pixi drawing pass itself (`scene.ts`) is exercised by
 * the build and the e2e smoke spec; here we make sure the *data* a soldier is
 * built from is correct and deterministic.
 * ------------------------------------------------------------------------ */

const STATS: StatBlock = {
  hp: 40,
  mp: 10,
  atk: 8,
  def: 6,
  mag: 4,
  res: 5,
  spd: 20,
  move: 4,
  jump: 2,
};

interface UnitOverrides {
  readonly power?: PowerKey;
  readonly postId?: string;
  readonly facing?: Facing;
  readonly side?: UnitSide;
  readonly hp?: number;
  readonly mp?: number;
  readonly judgePoints?: number;
  readonly conditions?: readonly ActiveCondition[];
}

function makeUnit(overrides: UnitOverrides = {}): Unit {
  return createUnit({
    id: asUnitId("unit-test"),
    name: "Test Soldier",
    power: overrides.power ?? "france",
    postId: asPostId(overrides.postId ?? "fusilier"),
    side: overrides.side ?? "company",
    level: 1,
    at: coord(1, 1),
    facing: overrides.facing ?? "north",
    stats: STATS,
    hp: overrides.hp,
    mp: overrides.mp,
    judgePoints: overrides.judgePoints,
    conditions: overrides.conditions,
  });
}

const POWERS: readonly PowerKey[] = ["france", "britain", "prussia", "russia", "austria"];

describe("power uniforms", () => {
  it("defines a complete palette for every great power", () => {
    for (const power of POWERS) {
      const uniform = POWER_UNIFORMS[power];
      expect(uniform).toBeDefined();
      for (const value of Object.values(uniform)) {
        expect(Number.isInteger(value)).toBe(true);
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(0xffffff);
      }
    }
  });

  it("gives each power a distinct coat colour", () => {
    const coats = new Set(POWERS.map((power) => powerUniform(power).coat));
    expect(coats.size).toBe(POWERS.length);
  });

  it("keeps the uniform stable across calls", () => {
    expect(powerUniform("britain")).toEqual(powerUniform("britain"));
  });
});

describe("role classification", () => {
  it("maps representative posts to their presentation family", () => {
    expect(roleCategory("fusilier")).toBe("line");
    expect(roleCategory("rifleman")).toBe("skirmisher");
    expect(roleCategory("voltigeur")).toBe("skirmisher");
    expect(roleCategory("hussar")).toBe("cavalry");
    expect(roleCategory("artilleryman")).toBe("artillery");
    expect(roleCategory("surgeon")).toBe("medical");
    expect(roleCategory("staff-officer")).toBe("command");
    expect(roleCategory("sapper")).toBe("engineer");
    expect(roleCategory("irregular")).toBe("irregular");
  });

  it("falls back to line infantry for an unknown post", () => {
    expect(roleCategory("mystery-role")).toBe("line");
  });
});

describe("facing", () => {
  it("maps every facing to a distinct screen vector", () => {
    const vectors = FACINGS.map((facing) => {
      const vector = facingScreen(facing);
      return `${vector.x},${vector.y}`;
    });
    expect(new Set(vectors).size).toBe(FACINGS.length);
  });

  it("changes the figure's ops when the unit turns", () => {
    const north = soldierFigure({ power: "france", postId: "fusilier", facing: "north" });
    const south = soldierFigure({ power: "france", postId: "fusilier", facing: "south" });
    expect(north.ops).not.toEqual(south.ops);
  });
});

describe("soldierFigure", () => {
  it("is deterministic and reports the role, facing and uniform", () => {
    const options = { power: "russia", postId: "rifleman", facing: "east" } as const;
    const first = soldierFigure(options);
    const second = soldierFigure(options);
    expect(first).toEqual(second);
    expect(first.role).toBe("skirmisher");
    expect(first.facing).toBe("east");
    expect(first.uniform).toEqual(powerUniform("russia"));
  });

  it("produces finite geometry with a positive radius for every circle", () => {
    const figure = soldierFigure({ power: "austria", postId: "gunner", facing: "west" });
    expect(figure.ops.length).toBeGreaterThan(0);
    for (const op of figure.ops) {
      if (op.kind === "circle") {
        expect(Number.isFinite(op.x)).toBe(true);
        expect(Number.isFinite(op.y)).toBe(true);
        expect(op.radius).toBeGreaterThan(0);
      }
    }
  });

  it("varies the kit by role but not by side (side is layered separately)", () => {
    const line = soldierFigure({ power: "france", postId: "fusilier", facing: "north" });
    const medical = soldierFigure({ power: "france", postId: "surgeon", facing: "north" });
    expect(line.ops).not.toEqual(medical.ops);
  });
});

describe("HP and Élan bars", () => {
  it("fills the HP bar fully at full strength", () => {
    const bar = hpBar(makeUnit());
    expect(bar.ratio).toBe(1);
    expect(bar.color).toBe(HP_COLOR_HIGH);
    expect(bar.value).toBe(STATS.hp);
  });

  it("warns at wounded and critical hit points", () => {
    expect(hpBar(makeUnit({ hp: 14 })).color).toBe(HP_COLOR_MID);
    expect(hpBar(makeUnit({ hp: 4 })).color).toBe(HP_COLOR_LOW);
    expect(hpBar(makeUnit({ hp: 14 })).ratio).toBeCloseTo(14 / 40, 6);
  });

  it("clamps the HP ratio and bar colour thresholds", () => {
    expect(hpColor(1)).toBe(HP_COLOR_HIGH);
    expect(hpColor(0.3)).toBe(HP_COLOR_MID);
    expect(hpColor(0)).toBe(HP_COLOR_LOW);
  });

  it("tracks Élan (morale) and its breaking threshold", () => {
    expect(elanBar(makeUnit()).color).toBe(ELAN_COLOR_HIGH);
    expect(elanBar(makeUnit({ mp: 1 })).color).toBe(ELAN_COLOR_LOW);
    expect(elanColor(0.31)).toBe(ELAN_COLOR_HIGH);
    expect(elanColor(0.3)).toBe(ELAN_COLOR_LOW);
  });
});

describe("Orders Tempo charge meter (T136)", () => {
  it("measures charge against the threshold and clamps once ready", () => {
    const charging = chargeBar({ charge: 25, threshold: 100 });
    expect(charging.value).toBe(25);
    expect(charging.max).toBe(100);
    expect(charging.ratio).toBeCloseTo(0.25, 6);
    expect(charging.color).toBe(CHARGE_COLOR_CHARGING);
    expect(charging.x).toBe(CHARGE_BAR.x);
    expect(charging.y).toBe(CHARGE_BAR.y);

    // A ready soldier may carry overshoot; the bar fills and brightens.
    const ready = chargeBar({ charge: 140, threshold: 100 });
    expect(ready.ratio).toBe(1);
    expect(ready.color).toBe(CHARGE_COLOR_READY);
    expect(chargeColor(1)).toBe(CHARGE_COLOR_READY);
  });

  it("never divides by a non-positive threshold", () => {
    expect(chargeRatio(5, 0)).toBe(0);
    expect(chargeRatio(Number.NaN, 100)).toBe(0);
    expect(chargeRatio(50, -10)).toBe(0);
  });

  it("reads the same charge the engine scheduler holds", () => {
    const unitId = asUnitId("unit-test");
    const tempo = createOrdersTempo([unitId], {
      threshold: 100,
      initialCharge: { [unitId]: 40 },
    });
    const charge = chargeOf(tempo, unitId) ?? 0;
    const bar = chargeBar({ charge, threshold: tempo.threshold });

    expect(charge).toBe(40);
    expect(bar.value).toBe(chargeOf(tempo, unitId));
    expect(bar.ratio).toBeCloseTo(0.4, 6);
  });
});

describe("Honour pips", () => {
  it("clamps into the pip range", () => {
    expect(honourPips(-5)).toBe(0);
    expect(honourPips(4)).toBe(4);
    expect(honourPips(99)).toBe(HONOUR_MAX);
    expect(honourPips(Number.NaN)).toBe(0);
  });
});

describe("condition icons", () => {
  it("abbreviates Napoleonic condition names", () => {
    expect(abbreviate("Bleeding")).toBe("BL");
    expect(abbreviate("Double-Quick")).toBe("DQ");
    expect(abbreviate("Out of Action")).toBe("OA");
    expect(abbreviate("")).toBe("?");
  });

  it("resolves known conditions to their kind and colour", () => {
    const bleeding = conditionIcon("poison");
    expect(bleeding.kind).toBe("ailment");
    expect(bleeding.label).toBe("BL");
    expect(bleeding.color).toBe(CONDITION_KIND_COLORS.ailment);

    const haste = conditionIcon("haste");
    expect(haste.kind).toBe("buff");
    expect(haste.label).toBe("DQ");
  });

  it("degrades gracefully for an unknown condition id", () => {
    const unknown = conditionIcon("not-a-condition");
    expect(unknown.kind).toBe("unknown");
    expect(unknown.color).toBe(CONDITION_ICON_FALLBACK);
    expect(unknown.label.length).toBeGreaterThan(0);
  });

  it("preserves the engine's condition order", () => {
    const conditions: ActiveCondition[] = [
      { conditionId: asConditionId("poison"), duration: 3 },
      { conditionId: asConditionId("haste"), duration: 0 },
    ];
    expect(conditionIcons(conditions).map((icon) => icon.id)).toEqual(["poison", "haste"]);
  });
});

describe("unitPresentation", () => {
  it("bundles the figure, bars, Honour and conditions", () => {
    const unit = makeUnit({
      judgePoints: 6,
      conditions: [{ conditionId: asConditionId("poison"), duration: 3 }],
    });
    const presentation = unitPresentation(unit);
    expect(presentation.figure.role).toBe("line");
    expect(presentation.hp.ratio).toBe(1);
    expect(presentation.elan.ratio).toBe(1);
    expect(presentation.honour).toBe(6);
    expect(presentation.conditions).toHaveLength(1);
    expect(presentation.conditions[0].id).toBe("poison");
    // No tempo reading supplied, so no charge meter is drawn.
    expect(presentation.charge).toBeNull();
  });

  it("carries the optional charge meter only when tempo is supplied", () => {
    const unit = makeUnit();
    expect(unitPresentation(unit).charge).toBeNull();

    const withTempo = unitPresentation(unit, { charge: 60, threshold: 100 });
    expect(withTempo.charge?.ratio).toBeCloseTo(0.6, 6);
    expect(withTempo.charge?.color).toBe(CHARGE_COLOR_CHARGING);
  });
});

describe("unitDrawOps", () => {
  it("emits the figure and the full status readout", () => {
    const ops = unitDrawOps(makeUnit({ judgePoints: 3 }));
    expect(ops.some((op) => op.kind === "circle")).toBe(true);
    expect(ops.some((op) => op.kind === "line")).toBe(true);
    expect(ops.some((op) => op.kind === "poly")).toBe(true);
    // One backdrop + fill per bar (4) plus one rect per Honour pip (10).
    expect(ops.filter((op) => op.kind === "rect")).toHaveLength(14);
  });

  it("adds the Orders Tempo charge meter when a tempo reading is supplied", () => {
    const withoutTempo = unitDrawOps(makeUnit({ judgePoints: 3 }));
    const withTempo = unitDrawOps(makeUnit({ judgePoints: 3 }), { charge: 50, threshold: 100 });
    const rects = (ops: ReturnType<typeof unitDrawOps>): number =>
      ops.filter((op) => op.kind === "rect").length;

    // The meter contributes one backdrop and one proportional fill rect.
    expect(rects(withTempo)).toBe(rects(withoutTempo) + 2);
    expect(withTempo.some((op) => op.kind === "rect" && op.color === CHARGE_COLOR_CHARGING)).toBe(
      true,
    );
  });

  it("is deterministic for the same unit", () => {
    expect(unitDrawOps(makeUnit({ judgePoints: 3 }))).toEqual(
      unitDrawOps(makeUnit({ judgePoints: 3 })),
    );
  });

  it("tints the ground glow by side", () => {
    const enemy = unitDrawOps(makeUnit({ side: "enemy" }));
    const glow = enemy[0];
    expect(glow.kind).toBe("circle");
    if (glow.kind === "circle") {
      expect(glow.color).toBe(SIDE_COLORS.enemy);
    }

    const neutral = unitDrawOps(makeUnit({ side: "neutral" }))[0];
    if (neutral.kind === "circle") {
      expect(neutral.color).toBe(SIDE_COLORS.neutral);
    }
  });

  it("adds a condition icon for every active condition", () => {
    const withCondition = unitDrawOps(
      makeUnit({ conditions: [{ conditionId: asConditionId("haste"), duration: 0 }] }),
    );
    const withoutCondition = unitDrawOps(makeUnit());
    expect(withCondition.length).toBeGreaterThan(withoutCondition.length);
  });
});
