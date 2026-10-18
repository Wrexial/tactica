import { describe, expect, it } from "vitest";

import type { StatBlock } from "../../src/data/schema";
import type { BattleEvent } from "../../src/engine/events";
import { coord } from "../../src/engine/grid";
import { asAbilityId, asArticleId, asConditionId, asPostId, asUnitId } from "../../src/engine/ids";
import { createUnit, type Unit } from "../../src/engine/unit";
import {
  A11Y_COLOUR_ROLES,
  A11Y_CSS_PREFIX,
  A11Y_PALETTES,
  MOTION_DATA_ATTRIBUTE,
  REDUCED_MOTION_DATA_ATTRIBUTE,
  REDUCED_MOTION_QUERY,
  WCAG_NON_TEXT_CONTRAST,
  applyColourBlindPalette,
  applyMotionPreference,
  contrastRatio,
  describeEvent,
  describeEvents,
  describeUnit,
  motionModeFor,
  nextRovingIndex,
  paletteFor,
  paletteVariables,
  prefersReducedMotion,
  relativeLuminance,
  rovingTabIndex,
  scaleMotionDuration,
} from "../../src/ui/a11y";

/* --------------------------------------------------------------------------
 * T109 — Accessibility
 *
 * These pin the pure half of the presentation layer: motion preference
 * resolution, the colour-blind-safe palettes (including their WCAG contrast),
 * roving keyboard navigation, and screen-reader descriptions. The DOM glue
 * (live region, data attributes) is exercised by `tests/e2e/a11y.spec.ts`.
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

function makeUnit(): Unit {
  return createUnit({
    id: asUnitId("unit-1"),
    name: "Sgt. Aubry",
    power: "france",
    postId: asPostId("fusilier"),
    level: 3,
    at: coord(2, 3),
    stats: { ...STATS },
    hp: 41,
    mp: 7,
    conditions: [{ conditionId: asConditionId("bleeding"), duration: 3 }],
  });
}

/** A tiny HTMLElement stand-in for the attribute-writing helpers. */
function fakeRoot(): {
  attributes: Record<string, string>;
  styles: Record<string, string>;
  setAttribute(name: string, value: string): void;
  style: { setProperty(name: string, value: string): void };
} {
  const attributes: Record<string, string> = {};
  const styles: Record<string, string> = {};
  const root = {
    attributes,
    styles,
    setAttribute(name: string, value: string): void {
      attributes[name] = value;
    },
    style: {
      setProperty(name: string, value: string): void {
        styles[name] = value;
      },
    },
  };
  return root;
}

describe("reduced motion", () => {
  it("reads the matchMedia preference through an injectable probe", () => {
    expect(prefersReducedMotion((query) => query === REDUCED_MOTION_QUERY)).toBe(true);
    expect(prefersReducedMotion(() => false)).toBe(false);
  });

  it("survives a probe that throws", () => {
    expect(
      prefersReducedMotion(() => {
        throw new Error("no matchMedia");
      }),
    ).toBe(false);
  });

  it("maps a boolean preference to the two modes", () => {
    expect(motionModeFor(true)).toBe("reduced");
    expect(motionModeFor(false)).toBe("full");
  });

  it("collapses durations to instant under reduced motion", () => {
    expect(scaleMotionDuration(180, false)).toBe(180);
    expect(scaleMotionDuration(180, true)).toBe(0);
    expect(scaleMotionDuration(0, false)).toBe(0);
    expect(scaleMotionDuration(-5, false)).toBe(0);
    expect(scaleMotionDuration(Number.NaN, false)).toBe(0);
  });

  it("writes both motion data attributes to the root", () => {
    const root = fakeRoot();
    const mode = applyMotionPreference(true, root as unknown as HTMLElement);
    expect(mode).toBe("reduced");
    expect(root.attributes[MOTION_DATA_ATTRIBUTE]).toBe("reduced");
    expect(root.attributes[REDUCED_MOTION_DATA_ATTRIBUTE]).toBe("reduced");
  });
});

describe("colour-blind-safe palette", () => {
  it("defines every role for every mode", () => {
    for (const mode of Object.keys(A11Y_PALETTES) as (keyof typeof A11Y_PALETTES)[]) {
      const palette = paletteFor(mode);
      for (const role of A11Y_COLOUR_ROLES) {
        expect(palette.colours[role]).toMatch(/^#[0-9a-fA-F]{6}$/);
      }
    }
  });

  it("exposes role colours as CSS custom properties", () => {
    const variables = paletteVariables("deuteranopia");
    expect(variables[`${A11Y_CSS_PREFIX}company`]).toBe(A11Y_PALETTES.deuteranopia.colours.company);
    expect(Object.keys(variables)).toHaveLength(A11Y_COLOUR_ROLES.length);
  });

  it("keeps friend and foe >= 3:1 apart in every mode (luminance, not just hue)", () => {
    for (const mode of Object.keys(A11Y_PALETTES) as (keyof typeof A11Y_PALETTES)[]) {
      const { company, enemy } = paletteFor(mode).colours;
      expect(contrastRatio(company, enemy)).toBeGreaterThanOrEqual(WCAG_NON_TEXT_CONTRAST);
    }
  });

  it("re-authors the field colours rather than reusing the issue palette", () => {
    const issue = A11Y_PALETTES.off.colours;
    for (const mode of ["protanopia", "deuteranopia", "tritanopia"] as const) {
      const palette = A11Y_PALETTES[mode].colours;
      expect(palette.company === issue.company && palette.enemy === issue.enemy).toBe(false);
    }
  });

  it("falls back to the issue palette for an unknown mode", () => {
    // A save from a future build may name a palette this one does not know.
    expect(paletteFor("unknown" as never)).toBe(A11Y_PALETTES.off);
  });

  it("applies the palette as data attribute and CSS variables", () => {
    const root = fakeRoot();
    applyColourBlindPalette("tritanopia", root as unknown as HTMLElement);
    expect(root.attributes["data-colour-blind"]).toBe("tritanopia");
    expect(root.styles[`${A11Y_CSS_PREFIX}company`]).toBe(A11Y_PALETTES.tritanopia.colours.company);
  });

  it("computes WCAG contrast from hex colours", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 5);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 5);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
    // An unparseable value degrades to black rather than throwing.
    expect(contrastRatio("nope", "#ffffff")).toBeCloseTo(21, 1);
  });
});

describe("roving keyboard navigation", () => {
  it("steps and wraps on a single axis", () => {
    expect(nextRovingIndex(4, 0, "ArrowRight", { orientation: "horizontal" })).toBe(1);
    expect(nextRovingIndex(4, 3, "ArrowRight", { orientation: "horizontal" })).toBe(0);
    expect(nextRovingIndex(4, 0, "ArrowLeft", { orientation: "horizontal" })).toBe(3);
    expect(nextRovingIndex(4, 2, "ArrowDown", { orientation: "horizontal" })).toBe(2);
  });

  it("can clamp instead of wrapping", () => {
    expect(nextRovingIndex(3, 2, "ArrowDown", { orientation: "vertical", wrap: false })).toBe(2);
    expect(nextRovingIndex(3, 0, "ArrowUp", { orientation: "vertical", wrap: false })).toBe(0);
  });

  it("supports Home and End", () => {
    expect(nextRovingIndex(5, 3, "Home")).toBe(0);
    expect(nextRovingIndex(5, 1, "End")).toBe(4);
  });

  it("starts at the first item when nothing is focused", () => {
    expect(nextRovingIndex(3, -1, "ArrowRight")).toBe(1);
  });

  it("returns -1 for an empty widget and ignores unhandled keys", () => {
    expect(nextRovingIndex(0, 0, "ArrowRight")).toBe(-1);
    expect(nextRovingIndex(3, 1, "Tab")).toBe(1);
  });

  it("gives only the active item a 0 tabindex", () => {
    expect(rovingTabIndex(0, 0)).toBe(0);
    expect(rovingTabIndex(1, 0)).toBe(-1);
  });
});

describe("screen-reader labels", () => {
  it("describes a soldier's full state", () => {
    const label = describeUnit(makeUnit(), {
      postName: () => "Fusilier",
      conditionName: () => "Bleeding",
    });
    expect(label).toContain("Sgt. Aubry");
    expect(label).toContain("free company");
    expect(label).toContain("level 3");
    expect(label).toContain("Fusilier");
    expect(label).toContain("strength 41 of 60");
    expect(label).toContain("Élan 7 of 20");
    expect(label).toContain("facing north");
    expect(label).toContain("tile 2, 3");
    expect(label).toContain("Bleeding");
  });

  it("falls back to the condition id when no resolver is supplied", () => {
    expect(describeUnit(makeUnit())).toContain("bleeding");
  });

  it("speaks the important battle events and skips bookkeeping", () => {
    const events: BattleEvent[] = [
      { kind: "turnStarted", tick: 1, unitId: asUnitId("unit-1") },
      {
        kind: "damaged",
        tick: 2,
        unitId: asUnitId("unit-1"),
        amount: 14,
        hpAfter: 27,
        damageType: "powder",
        critical: false,
        fatal: false,
      },
      {
        kind: "articleBroken",
        tick: 3,
        unitId: asUnitId("unit-1"),
        articleId: asArticleId("no-incendiary"),
        severity: "reprimand",
      },
      { kind: "battleEnded", tick: 9, outcome: "companyVictory" },
    ];
    const spoken = describeEvents(events, { unitName: () => "Sgt. Aubry" });
    expect(spoken).toContain("takes 14 damage");
    expect(spoken).toContain("breaks an Article of War");
    expect(spoken).toContain("The battle has ended: companyVictory");
    expect(spoken).not.toContain("turn");
  });

  it("returns null for an event with nothing to say", () => {
    expect(
      describeEvent({
        kind: "chargeStarted",
        tick: 1,
        unitId: asUnitId("u"),
        chargeId: "c",
        abilityId: asAbilityId("a"),
        ticks: 2,
      }),
    ).toBeNull();
  });
});
