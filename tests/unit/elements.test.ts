import { describe, expect, it } from "vitest";

import { ELEMENT_KEYS, ElementDefSchema, type ElementKey } from "../../src/data/schema";
import {
  ELEMENTS,
  ELEMENT_LIST,
  getElement,
  isOpposedTo,
  opposedElement,
} from "../../src/data/elements";
import {
  ELEMENT_AFFINITIES,
  ELEMENT_DAMAGE_FORMULA,
  applyElementToDamage,
  isElementAffinity,
  modifyElementalDamage,
  resolveElementAffinity,
  type ElementAffinity,
  type ElementAffinityMap,
  type ElementDamageFormula,
} from "../../src/engine/rules/elements";

/* --------------------------------------------------------------------------
 * T038 — Elements
 *
 * Pins the task's "done when": eight reflavoured FFTA elements authored as data
 * (`src/data/elements.ts`) and the weak / resist / immune / absorb damage
 * modification (`src/engine/rules/elements.ts`) that applies them. The maths
 * follows `docs/wiki/pages/Attack_(command).md` (weak doubles, resist halves,
 * immune nullifies, absorb heals) and the names follow the mapping §7 table.
 * ------------------------------------------------------------------------ */

/** The Napoleonic reading of each FFTA element id (mapping §7, D5). */
const NAPOLEONIC_NAMES: Record<ElementKey, string> = {
  fire: "Incendiary",
  ice: "Cold",
  lightning: "Shock",
  earth: "Siege",
  water: "Deluge",
  wind: "Smoke",
  holy: "Colours",
  dark: "Terror",
};

/** The opposition cycle authored in the data: four mutual pairs. */
const OPPOSITION_PAIRS: ReadonlyArray<readonly [ElementKey, ElementKey]> = [
  ["fire", "ice"],
  ["lightning", "water"],
  ["earth", "wind"],
  ["holy", "dark"],
];

/* --------------------------------------------------------------------------
 * Data — the eight authored elements
 * ------------------------------------------------------------------------ */

describe("authored elements (data/elements.ts)", () => {
  it("authors exactly the eight FFTA element ids", () => {
    expect(ELEMENT_LIST).toHaveLength(8);
    expect(ELEMENT_LIST.map((element) => element.id)).toEqual([...ELEMENT_KEYS]);
    expect(Object.keys(ELEMENTS)).toHaveLength(8);
  });

  it("carries the mapping §7 Napoleonic name for every element", () => {
    for (const id of ELEMENT_KEYS) {
      const element = ELEMENTS[id];
      expect(element.name).toBe(NAPOLEONIC_NAMES[id]);
      expect(element.name.trim()).not.toBe("");
      expect(element.description.trim()).not.toBe("");
      expect(element.flavour.trim()).not.toBe("");
      // The parsed definition round-trips through the schema untouched.
      expect(ElementDefSchema.parse(element)).toEqual(element);
    }
  });

  it("keeps the FFTA-shaped id but not the FFTA display name", () => {
    expect(ELEMENTS.fire.id).toBe("fire");
    expect(ELEMENTS.fire.name).toBe("Incendiary");
    expect(ELEMENTS.fire.name).not.toBe("Fire");
    expect(ELEMENTS.dark.name).toBe("Terror");
  });

  it("encodes a symmetric opposition cycle", () => {
    for (const [a, b] of OPPOSITION_PAIRS) {
      expect(opposedElement(a), `${a} opposes ${b}`).toBe(b);
      expect(opposedElement(b), `${b} opposes ${a}`).toBe(a);
      expect(isOpposedTo(a, b)).toBe(true);
      expect(isOpposedTo(b, a)).toBe(true);
      // An element is never opposed to itself, and unrelated pairs read false.
      expect(isOpposedTo(a, a)).toBe(false);
      expect(isOpposedTo(a, "dark")).toBe(a === "holy");
    }
  });

  it("looks up definitions and rejects unknown ids", () => {
    expect(getElement("fire")).toEqual(ELEMENTS.fire);
    expect(() => getElement("aether" as ElementKey)).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Engine — affinity guard & lookup
 * ------------------------------------------------------------------------ */

describe("isElementAffinity", () => {
  it("accepts the four authored affinities plus neutral", () => {
    for (const affinity of ELEMENT_AFFINITIES) {
      expect(isElementAffinity(affinity)).toBe(true);
    }
    expect(isElementAffinity("neutral")).toBe(true);
  });

  it("rejects unknown, non-string and missing values", () => {
    for (const value of ["immune!", "superweak", "", 1, null, undefined, {}]) {
      expect(isElementAffinity(value)).toBe(false);
    }
  });
});

describe("resolveElementAffinity", () => {
  const affinities: ElementAffinityMap = { fire: "weak", ice: "resist", water: "absorb" };

  it("returns the authored affinity for a matching element", () => {
    expect(resolveElementAffinity(affinities, "fire")).toBe("weak");
    expect(resolveElementAffinity(affinities, "ice")).toBe("resist");
    expect(resolveElementAffinity(affinities, "water")).toBe("absorb");
  });

  it("defaults to neutral for an unlisted element, no map or a non-elemental action", () => {
    expect(resolveElementAffinity(affinities, "lightning")).toBe("neutral");
    expect(resolveElementAffinity(undefined, "fire")).toBe("neutral");
    expect(resolveElementAffinity(affinities, undefined)).toBe("neutral");
    expect(resolveElementAffinity({}, "fire")).toBe("neutral");
  });

  it("does not mutate the affinity map", () => {
    const before = { ...affinities };
    resolveElementAffinity(affinities, "holy");
    expect(affinities).toEqual(before);
  });
});

/* --------------------------------------------------------------------------
 * Engine — damage modification
 * ------------------------------------------------------------------------ */

describe("modifyElementalDamage", () => {
  it("leaves neutral damage unchanged", () => {
    expect(modifyElementalDamage(20, "neutral")).toEqual({
      affinity: "neutral",
      damage: 20,
      healing: 0,
    });
  });

  it("doubles damage on a weakness", () => {
    expect(modifyElementalDamage(20, "weak")).toEqual({
      affinity: "weak",
      damage: 40,
      healing: 0,
    });
  });

  it("halves (flooring) damage on a resistance", () => {
    expect(modifyElementalDamage(21, "resist")).toEqual({
      affinity: "resist",
      damage: 10,
      healing: 0,
    });
    expect(modifyElementalDamage(1, "resist").damage).toBe(0);
  });

  it("nullifies damage on immunity", () => {
    expect(modifyElementalDamage(999, "immune")).toEqual({
      affinity: "immune",
      damage: 0,
      healing: 0,
    });
  });

  it("converts damage into healing on absorb", () => {
    expect(modifyElementalDamage(20, "absorb")).toEqual({
      affinity: "absorb",
      damage: 0,
      healing: 20,
    });
    // A zero-damage attack still produces a zero-heal result, never a negative.
    expect(modifyElementalDamage(0, "absorb")).toEqual({
      affinity: "absorb",
      damage: 0,
      healing: 0,
    });
  });

  it("honours an authored balance formula without touching the arithmetic", () => {
    const formula: ElementDamageFormula = { weakMultiplier: 3, resistDivisor: 4 };
    expect(modifyElementalDamage(5, "weak", formula).damage).toBe(15);
    expect(modifyElementalDamage(10, "resist", formula).damage).toBe(2);
    expect(modifyElementalDamage(10, "neutral", formula).damage).toBe(10);
  });

  it("is deterministic and never mutates its inputs", () => {
    const formula: ElementDamageFormula = { ...ELEMENT_DAMAGE_FORMULA };
    const first = modifyElementalDamage(37, "weak", formula);
    const second = modifyElementalDamage(37, "weak", formula);
    expect(second).toEqual(first);
    expect(formula).toEqual(ELEMENT_DAMAGE_FORMULA);
  });

  it("rejects malformed raw damage, unknown affinities and bad formulas", () => {
    expect(() => modifyElementalDamage(-1, "neutral")).toThrow(RangeError);
    expect(() => modifyElementalDamage(1.5, "neutral")).toThrow(RangeError);
    expect(() => modifyElementalDamage(10, "superweak" as ElementAffinity)).toThrow(RangeError);
    expect(() =>
      modifyElementalDamage(10, "weak", { weakMultiplier: -1, resistDivisor: 2 }),
    ).toThrow(RangeError);
    expect(() =>
      modifyElementalDamage(10, "resist", { weakMultiplier: 2, resistDivisor: 0 }),
    ).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Engine — combined pipeline
 * ------------------------------------------------------------------------ */

describe("applyElementToDamage", () => {
  const affinities: ElementAffinityMap = { fire: "weak", ice: "resist", water: "absorb" };

  it("resolves the affinity and applies it in one step", () => {
    expect(applyElementToDamage(20, "fire", affinities)).toEqual({
      affinity: "weak",
      damage: 40,
      healing: 0,
    });
    expect(applyElementToDamage(20, "ice", affinities)).toEqual({
      affinity: "resist",
      damage: 10,
      healing: 0,
    });
    expect(applyElementToDamage(20, "water", affinities)).toEqual({
      affinity: "absorb",
      damage: 0,
      healing: 20,
    });
  });

  it("treats a non-elemental action or missing affinities as neutral", () => {
    expect(applyElementToDamage(15, undefined, affinities)).toEqual({
      affinity: "neutral",
      damage: 15,
      healing: 0,
    });
    expect(applyElementToDamage(15, "fire", undefined)).toEqual({
      affinity: "neutral",
      damage: 15,
      healing: 0,
    });
  });

  it("lets content retune only the factors, keeping the lookup data-driven", () => {
    const formula: ElementDamageFormula = { weakMultiplier: 4, resistDivisor: 2 };
    expect(applyElementToDamage(10, "fire", affinities, formula).damage).toBe(40);
  });
});
