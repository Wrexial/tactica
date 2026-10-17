import { describe, expect, it } from "vitest";

import {
  computeHitChance,
  FACING_HIT_MODIFIERS,
  HIT_FORMULA,
  isRelativeFacing,
  relativeFacing,
  RELATIVE_FACINGS,
  rollHit,
  type FacingHitModifiers,
  type HitChanceInput,
  type HitChanceResult,
  type HitFormula,
} from "../../src/engine/rules/hit";
import { Rng } from "../../src/engine/rng";
import type { Facing } from "../../src/engine/grid";

/* --------------------------------------------------------------------------
 * T037 — Hit, evasion & facing
 *
 * The task's "done when" is a hit chance with front/side/rear facing modifiers,
 * resolved through the seeded PRNG. FFTA documents its damage formula but not
 * its to-hit formula, so the retheme authors this one (see the module header):
 *
 *   base   = accuracy − evasion
 *   chance = clamp(base + facingModifier[relativeFacing], minChance, maxChance)
 *   hit    = roll < chance              (roll drawn from [0, 100))
 *
 * These tests pin the facing geometry, the arithmetic and its clamps, the
 * seeded/deterministic roll (exactly one PRNG draw per attempt, outcomes
 * independent of stream position), and the boundary validation the replay and
 * save layers rely on (`agents.md` §2, §7, §9).
 * ------------------------------------------------------------------------ */

function chanceInput(overrides: Partial<HitChanceInput> = {}): HitChanceInput {
  return {
    accuracy: 80,
    evasion: 20,
    attackerAt: { x: 5, y: 3 },
    defenderAt: { x: 5, y: 5 },
    defenderFacing: "north",
    ...overrides,
  };
}

/* --------------------------------------------------------------------------
 * Facing geometry
 * ------------------------------------------------------------------------ */

describe("relativeFacing", () => {
  const defenderAt = { x: 5, y: 5 };

  it("classifies a strike from the way the defender looks as a frontal attack", () => {
    expect(relativeFacing(defenderAt, "north", { x: 5, y: 2 })).toBe("front");
    expect(relativeFacing(defenderAt, "east", { x: 8, y: 5 })).toBe("front");
    expect(relativeFacing(defenderAt, "south", { x: 5, y: 8 })).toBe("front");
    expect(relativeFacing(defenderAt, "west", { x: 2, y: 5 })).toBe("front");
  });

  it("classifies a strike from behind as a rear attack", () => {
    expect(relativeFacing(defenderAt, "north", { x: 5, y: 8 })).toBe("rear");
    expect(relativeFacing(defenderAt, "east", { x: 2, y: 5 })).toBe("rear");
    expect(relativeFacing(defenderAt, "south", { x: 5, y: 2 })).toBe("rear");
    expect(relativeFacing(defenderAt, "west", { x: 8, y: 5 })).toBe("rear");
  });

  it("classifies a strike from the perpendicular as a flank", () => {
    expect(relativeFacing(defenderAt, "north", { x: 8, y: 5 })).toBe("side");
    expect(relativeFacing(defenderAt, "north", { x: 2, y: 5 })).toBe("side");
    expect(relativeFacing(defenderAt, "east", { x: 5, y: 3 })).toBe("side");
    expect(relativeFacing(defenderAt, "south", { x: 8, y: 5 })).toBe("side");
    expect(relativeFacing(defenderAt, "west", { x: 5, y: 8 })).toBe("side");
  });

  it("treats an exact diagonal as a flank (between front and side)", () => {
    // North-facing defender; the attacker is behind-right / behind-left quarters.
    expect(relativeFacing(defenderAt, "north", { x: 6, y: 4 })).toBe("side");
    expect(relativeFacing(defenderAt, "north", { x: 6, y: 6 })).toBe("side");
    expect(relativeFacing(defenderAt, "north", { x: 4, y: 4 })).toBe("side");
    expect(relativeFacing(defenderAt, "north", { x: 4, y: 6 })).toBe("side");
  });

  it("treats a strike from the defender's own tile as frontal (no flank bonus)", () => {
    expect(relativeFacing(defenderAt, "north", { x: 5, y: 5 })).toBe("front");
    expect(relativeFacing(defenderAt, "west", { x: 5, y: 5 })).toBe("front");
  });

  it("uses the dominant axis for distant (non-adjacent) attackers", () => {
    // Far to the north-east, but mostly north: frontal.
    expect(relativeFacing(defenderAt, "north", { x: 7, y: 1 })).toBe("front");
    // Far to the south-east, but mostly south: rear.
    expect(relativeFacing(defenderAt, "north", { x: 7, y: 9 })).toBe("rear");
  });

  it("does not mutate its inputs and is deterministic", () => {
    const defender = { x: 5, y: 5 };
    const attacker = { x: 8, y: 5 };
    const snapshot = { defender: { ...defender }, attacker: { ...attacker } };

    expect(relativeFacing(defender, "north", attacker)).toBe(
      relativeFacing(defender, "north", attacker),
    );
    expect({ defender, attacker }).toEqual(snapshot);
  });

  it("rejects malformed coordinates and facing at the boundary", () => {
    expect(() => relativeFacing({ x: 1.5, y: 5 }, "north", { x: 5, y: 5 })).toThrow(RangeError);
    expect(() => relativeFacing({ x: 5, y: 5 }, "north", { x: 5, y: "5" as unknown as number })).toThrow(
      RangeError,
    );
    expect(() => relativeFacing({ x: 5, y: 5 }, "northwest" as Facing, { x: 5, y: 4 })).toThrow(
      RangeError,
    );
  });
});

describe("RELATIVE_FACINGS / isRelativeFacing", () => {
  it("exposes the closed set front / side / rear", () => {
    expect(RELATIVE_FACINGS).toEqual(["front", "side", "rear"]);
  });

  it("guards untrusted values", () => {
    expect(isRelativeFacing("front")).toBe(true);
    expect(isRelativeFacing("side")).toBe(true);
    expect(isRelativeFacing("rear")).toBe(true);
    expect(isRelativeFacing("back")).toBe(false);
    expect(isRelativeFacing(3)).toBe(false);
  });
});

/* --------------------------------------------------------------------------
 * Hit chance (forecast)
 * ------------------------------------------------------------------------ */

describe("computeHitChance", () => {
  it("computes accuracy − evasion, then adds the facing bonus", () => {
    // Frontal: 80 − 20 = 60, +0.
    expect(computeHitChance(chanceInput()).chance).toBe(60);
    // Flank: 80 − 20 = 60, +15.
    expect(computeHitChance(chanceInput({ attackerAt: { x: 8, y: 5 } })).chance).toBe(75);
    // Rear: 80 − 20 = 60, +30.
    expect(computeHitChance(chanceInput({ attackerAt: { x: 5, y: 8 } })).chance).toBe(90);
  });

  it("reports the pieces of the result for the forecast UI", () => {
    const result = computeHitChance(chanceInput({ attackerAt: { x: 8, y: 5 } }));
    expect(result).toEqual<HitChanceResult>({
      chance: 75,
      baseChance: 60,
      facing: "side",
      facingModifier: 15,
      rawChance: 75,
    });
  });

  it("clamps the chance into the authored band", () => {
    // A hopeless frontal shot still retains the floor...
    expect(computeHitChance(chanceInput({ accuracy: 0, evasion: 200 })).chance).toBe(
      HIT_FORMULA.minChance,
    );
    // ...and an overwhelming one stops at the ceiling.
    expect(computeHitChance(chanceInput({ accuracy: 200, evasion: 0 })).chance).toBe(
      HIT_FORMULA.maxChance,
    );
  });

  it("keeps the unclamped raw chance in the result", () => {
    const hopeless = computeHitChance(chanceInput({ accuracy: 0, evasion: 200 }));
    expect(hopeless.baseChance).toBe(-200);
    expect(hopeless.rawChance).toBe(-200);

    const overwhelming = computeHitChance(
      chanceInput({ accuracy: 300, evasion: 0, attackerAt: { x: 5, y: 8 } }),
    );
    expect(overwhelming.rawChance).toBe(330);
    expect(overwhelming.chance).toBe(100);
  });

  it("orders the chances front ≤ side ≤ rear for the same combat terms", () => {
    const front = computeHitChance(chanceInput({ attackerAt: { x: 5, y: 3 } })).chance;
    const side = computeHitChance(chanceInput({ attackerAt: { x: 8, y: 5 } })).chance;
    const rear = computeHitChance(chanceInput({ attackerAt: { x: 5, y: 8 } })).chance;
    expect(front).toBeLessThan(side);
    expect(side).toBeLessThan(rear);
  });

  it("honours authored facing modifiers supplied by content", () => {
    const flat: FacingHitModifiers = { front: 0, side: 0, rear: 0 };
    expect(computeHitChance(chanceInput({ facingModifiers: flat })).chance).toBe(60);
    expect(
      computeHitChance(chanceInput({ attackerAt: { x: 5, y: 8 }, facingModifiers: flat })).chance,
    ).toBe(60);

    const punishing: FacingHitModifiers = { front: -20, side: 0, rear: 40 };
    expect(computeHitChance(chanceInput({ facingModifiers: punishing })).chance).toBe(40);
    expect(
      computeHitChance(chanceInput({ attackerAt: { x: 5, y: 8 }, facingModifiers: punishing }))
        .chance,
    ).toBe(100);
  });

  it("honours an authored clamp band supplied by content", () => {
    const sureThing: HitFormula = { minChance: 100, maxChance: 100 };
    expect(computeHitChance(chanceInput({ formula: sureThing })).chance).toBe(100);

    const noLuck: HitFormula = { minChance: 0, maxChance: 0 };
    expect(computeHitChance(chanceInput({ formula: noLuck })).chance).toBe(0);

    const narrow: HitFormula = { minChance: 25, maxChance: 75 };
    expect(computeHitChance(chanceInput({ accuracy: 200, formula: narrow })).chance).toBe(75);
    expect(computeHitChance(chanceInput({ accuracy: 0, evasion: 200, formula: narrow })).chance).toBe(
      25,
    );
  });

  it("is deterministic and does not mutate its inputs", () => {
    const input = chanceInput({ attackerAt: { x: 8, y: 5 } });
    const snapshot = JSON.parse(JSON.stringify(input));

    const first = computeHitChance(input);
    const second = computeHitChance(input);

    expect(first).toEqual(second);
    expect(input).toEqual(snapshot);
  });

  it("rejects malformed combat terms at the boundary", () => {
    expect(() => computeHitChance(chanceInput({ accuracy: -1 }))).toThrow(RangeError);
    expect(() => computeHitChance(chanceInput({ accuracy: 1.5 }))).toThrow(RangeError);
    expect(() => computeHitChance(chanceInput({ evasion: -1 }))).toThrow(RangeError);
    expect(() => computeHitChance(chanceInput({ evasion: 2.5 }))).toThrow(RangeError);
  });

  it("rejects a malformed clamp band", () => {
    expect(() => computeHitChance(chanceInput({ formula: { minChance: -1, maxChance: 100 } }))).toThrow(
      RangeError,
    );
    expect(() => computeHitChance(chanceInput({ formula: { minChance: 0, maxChance: 101 } }))).toThrow(
      RangeError,
    );
    expect(() => computeHitChance(chanceInput({ formula: { minChance: 80, maxChance: 20 } }))).toThrow(
      RangeError,
    );
    expect(() => computeHitChance(chanceInput({ formula: { minChance: 1.5, maxChance: 100 } }))).toThrow(
      RangeError,
    );
  });

  it("rejects malformed facing modifiers", () => {
    expect(() =>
      computeHitChance(chanceInput({ facingModifiers: { front: 0, side: 15.5, rear: 30 } })),
    ).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Seeded roll
 * ------------------------------------------------------------------------ */

describe("rollHit", () => {
  it("reproduces the forecast alongside the outcome", () => {
    const input = chanceInput({ attackerAt: { x: 8, y: 5 } });
    const forecast = computeHitChance(input);
    const result = rollHit(new Rng("bridge"), input);

    expect(result.chance).toBe(forecast.chance);
    expect(result.baseChance).toBe(forecast.baseChance);
    expect(result.facing).toBe(forecast.facing);
    expect(result.facingModifier).toBe(forecast.facingModifier);
    expect(result.rawChance).toBe(forecast.rawChance);
    expect(result.roll).toBeGreaterThanOrEqual(0);
    expect(result.roll).toBeLessThan(100);
    expect(result.hit).toBe(result.roll < result.chance);
  });

  it("is deterministic for the same seed and ordered inputs", () => {
    const input = chanceInput();
    const first = rollHit(new Rng("waterloo-1815"), input);
    const second = rollHit(new Rng("waterloo-1815"), input);
    expect(first).toEqual(second);
  });

  it("consumes exactly one PRNG draw per attempt, win or lose", () => {
    const input = chanceInput();
    const rng = new Rng("one-draw");
    const before = rng.getState().calls;

    rollHit(rng, input);
    expect(rng.getState().calls).toBe(before + 1);

    rollHit(rng, input);
    expect(rng.getState().calls).toBe(before + 2);
  });

  it("uses the next integer in [0, 100) from the stream", () => {
    const input = chanceInput();
    const expectedRoll = new Rng("draw-check").nextInt(100);
    const result = rollHit(new Rng("draw-check"), input);
    expect(result.roll).toBe(expectedRoll);
  });

  it("never hits when the chance is clamped to zero", () => {
    const noLuck: HitFormula = { minChance: 0, maxChance: 0 };
    for (let seed = 0; seed < 25; seed++) {
      expect(rollHit(new Rng(seed), chanceInput({ formula: noLuck })).hit).toBe(false);
    }
  });

  it("always hits when the chance is clamped to 100", () => {
    const sureThing: HitFormula = { minChance: 100, maxChance: 100 };
    for (let seed = 0; seed < 25; seed++) {
      expect(rollHit(new Rng(seed), chanceInput({ formula: sureThing })).hit).toBe(true);
    }
  });

  it("does not mutate its input", () => {
    const input = chanceInput();
    const snapshot = JSON.parse(JSON.stringify(input));
    rollHit(new Rng("no-mutation"), input);
    expect(input).toEqual(snapshot);
  });

  it("validates before drawing, so a malformed input consumes no randomness", () => {
    const rng = new Rng("strict");
    const before = rng.getState().calls;
    expect(() => rollHit(rng, chanceInput({ accuracy: -1 }))).toThrow(RangeError);
    expect(rng.getState().calls).toBe(before);
  });
});

describe("HIT_FORMULA / FACING_HIT_MODIFIERS", () => {
  it("encodes the authored clamp band", () => {
    expect(HIT_FORMULA).toEqual({ minChance: 5, maxChance: 100 });
  });

  it("rewards the flank and the rear over a frontal assault", () => {
    expect(FACING_HIT_MODIFIERS.front).toBeLessThan(FACING_HIT_MODIFIERS.side);
    expect(FACING_HIT_MODIFIERS.side).toBeLessThan(FACING_HIT_MODIFIERS.rear);
  });
});
