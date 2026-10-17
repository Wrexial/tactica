import { describe, expect, it } from "vitest";

import {
  applyPower,
  computeBaseDamage,
  computePowderDamage,
  computeSteelDamage,
  POWDER_FORMULA,
  STEEL_FORMULA,
  type DamageFormula,
  type PowderDamageInput,
  type SteelDamageInput,
} from "../../src/engine/rules/damage";

/* --------------------------------------------------------------------------
 * T033 — Steel (physical) damage
 *
 * These tests pin the task's "done when": the FFTA physical formula
 * `WeaponAtk − TargetWeaponDef/2`, then `× Power/100`, modelled as data. They
 * also pin the guarantees the rest of the engine leans on — integer in / integer
 * out, no mutation, deterministic, and rejection of malformed inputs at the
 * boundary — because a battle is replayed from a seed plus a command log
 * (`agents.md` §2, §7).
 *
 * The wiki's ambiguous secondary "final formula" line is resolved in the
 * module header (`src/engine/rules/damage.ts`): we trust the step-wise version
 * and treat `Power/100` — not `weapon att/100` — as the multiplier, and we do
 * not re-add the caster's Strength (it already feeds Weapon Attack upstream).
 * ------------------------------------------------------------------------ */

function steelInput(overrides: Partial<SteelDamageInput> = {}): SteelDamageInput {
  return {
    weaponAtk: 20,
    targetWeaponDef: 10,
    power: 100,
    ...overrides,
  };
}

function powderInput(overrides: Partial<PowderDamageInput> = {}): PowderDamageInput {
  return {
    magicPower: 30,
    targetMagicRes: 12,
    power: 100,
    ...overrides,
  };
}

describe("computeSteelDamage", () => {
  it("computes WeaponAtk − TargetWeaponDef/2, then × Power/100", () => {
    // base = 20 − floor(10 / 2) = 15; 15 × 100 / 100 = 15.
    expect(computeSteelDamage(steelInput())).toBe(15);
  });

  it("scales linearly with the ability's Power term", () => {
    // base 15, then × 50 / 100 = 7.5 → truncate to 7.
    expect(computeSteelDamage(steelInput({ power: 50 }))).toBe(7);
    // base 15, then × 200 / 100 = 30.
    expect(computeSteelDamage(steelInput({ power: 200 }))).toBe(30);
  });

  it("truncates the final Power multiplication (no rounding up)", () => {
    // base 15, then × 33 / 100 = 4.95 → 4.
    expect(computeSteelDamage(steelInput({ power: 33 }))).toBe(4);
  });

  it("truncates the halved Weapon Def before subtracting", () => {
    // floor(9 / 2) = 4, so base = 20 − 4 = 16 (not 15.5 → 16 either way, but
    // the truncation is observable once Power scales it).
    expect(computeSteelDamage(steelInput({ targetWeaponDef: 9 }))).toBe(16);
    // base = 13 − floor(7 / 2) = 13 − 3 = 10; × 33 / 100 = 3.3 → 3.
    expect(computeSteelDamage(steelInput({ weaponAtk: 13, targetWeaponDef: 7, power: 33 }))).toBe(
      3,
    );
  });

  it("floors at zero when the defender's Weapon Def exceeds the attack", () => {
    expect(computeSteelDamage(steelInput({ weaponAtk: 3, targetWeaponDef: 20 }))).toBe(0);
    // Exactly armored: 10 − floor(10/2) = 5, still a positive hit.
    expect(computeSteelDamage(steelInput({ weaponAtk: 10, targetWeaponDef: 10 }))).toBe(5);
  });

  it("deals zero when Power is zero", () => {
    expect(computeSteelDamage(steelInput({ power: 0 }))).toBe(0);
  });

  it("clamps a negative Power contribution to zero", () => {
    // base 15, then × −50 / 100 = −7.5 → floored and clamped to 0.
    expect(computeSteelDamage(steelInput({ power: -50 }))).toBe(0);
  });

  it("returns a non-negative integer for every valid input", () => {
    for (const weaponAtk of [0, 1, 7, 13, 20, 99]) {
      for (const targetWeaponDef of [0, 1, 8, 9, 20, 99]) {
        for (const power of [0, 25, 50, 100, 175, 300]) {
          const damage = computeSteelDamage({ weaponAtk, targetWeaponDef, power });
          expect(Number.isInteger(damage)).toBe(true);
          expect(damage).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("is deterministic and does not mutate its input", () => {
    const input: SteelDamageInput = steelInput({ power: 175 });
    const snapshot = { ...input };

    const first = computeSteelDamage(input);
    const second = computeSteelDamage(input);

    expect(first).toBe(second);
    expect(input).toEqual(snapshot);
  });

  it("honours an authored formula supplied by content", () => {
    // A variant that defends four times as hard and scales Power by 10.
    const variant: DamageFormula = { defenseDivisor: 4, powerDivisor: 10 };
    // base = 20 − floor(10 / 4) = 20 − 2 = 18; × 50 / 10 = 90.
    expect(computeSteelDamage(steelInput({ power: 50 }), variant)).toBe(90);
  });

  it("rejects malformed combat stats at the boundary", () => {
    expect(() => computeSteelDamage(steelInput({ weaponAtk: -1 }))).toThrow(RangeError);
    expect(() => computeSteelDamage(steelInput({ weaponAtk: 1.5 }))).toThrow(RangeError);
    expect(() => computeSteelDamage(steelInput({ targetWeaponDef: -3 }))).toThrow(RangeError);
    expect(() => computeSteelDamage(steelInput({ targetWeaponDef: 2.5 }))).toThrow(RangeError);
    expect(() => computeSteelDamage(steelInput({ power: 1.5 }))).toThrow(RangeError);
  });

  it("rejects a malformed formula", () => {
    expect(() =>
      computeSteelDamage(steelInput(), { defenseDivisor: 0, powerDivisor: 100 }),
    ).toThrow(RangeError);
    expect(() => computeSteelDamage(steelInput(), { defenseDivisor: 2, powerDivisor: 0 })).toThrow(
      RangeError,
    );
  });
});

/* --------------------------------------------------------------------------
 * T034 — Powder (magical) damage
 *
 * Pins the task's "done when": the FFTA magical formula
 * `MagicPower − TargetMagicRes/2`, then `× Power/100` (from
 * `docs/wiki/pages/Magic_(command).md`), modelled as data via the same
 * `DamageFormula` kernel as Steel. Powder is the retheme's channel for
 * artillery, medicine, signals and morale (mapping §7, §12).
 * ------------------------------------------------------------------------ */

describe("computePowderDamage", () => {
  it("computes MagicPower − TargetMagicRes/2, then × Power/100", () => {
    // base = 30 − floor(12 / 2) = 24; 24 × 100 / 100 = 24.
    expect(computePowderDamage(powderInput())).toBe(24);
  });

  it("scales linearly with the ability's Power term", () => {
    // base 24, then × 50 / 100 = 12.
    expect(computePowderDamage(powderInput({ power: 50 }))).toBe(12);
    // base 24, then × 200 / 100 = 48.
    expect(computePowderDamage(powderInput({ power: 200 }))).toBe(48);
  });

  it("truncates the final Power multiplication (no rounding up)", () => {
    // base 24, then × 33 / 100 = 7.92 → 7.
    expect(computePowderDamage(powderInput({ power: 33 }))).toBe(7);
  });

  it("truncates the halved Magic Resistance before subtracting", () => {
    // base = 30 − floor(11 / 2) = 30 − 5 = 25; × 100 / 100 = 25.
    expect(computePowderDamage(powderInput({ targetMagicRes: 11 }))).toBe(25);
    // base = 20 − floor(7 / 2) = 20 − 3 = 17; × 33 / 100 = 5.61 → 5.
    expect(
      computePowderDamage(powderInput({ magicPower: 20, targetMagicRes: 7, power: 33 })),
    ).toBe(5);
  });

  it("floors at zero when the defender's Magic Resistance exceeds the attack", () => {
    expect(computePowderDamage(powderInput({ magicPower: 4, targetMagicRes: 20 }))).toBe(0);
    // Exactly resistant: 10 − floor(10/2) = 5, still a positive hit.
    expect(computePowderDamage(powderInput({ magicPower: 10, targetMagicRes: 10 }))).toBe(5);
  });

  it("deals zero when Power is zero", () => {
    expect(computePowderDamage(powderInput({ power: 0 }))).toBe(0);
  });

  it("clamps a negative Power contribution to zero", () => {
    // base 24, then × −50 / 100 = −12 → floored and clamped to 0.
    expect(computePowderDamage(powderInput({ power: -50 }))).toBe(0);
  });

  it("returns a non-negative integer for every valid input", () => {
    for (const magicPower of [0, 1, 7, 13, 30, 99]) {
      for (const targetMagicRes of [0, 1, 8, 11, 20, 99]) {
        for (const power of [0, 25, 50, 100, 175, 300]) {
          const damage = computePowderDamage({ magicPower, targetMagicRes, power });
          expect(Number.isInteger(damage)).toBe(true);
          expect(damage).toBeGreaterThanOrEqual(0);
        }
      }
    }
  });

  it("is deterministic and does not mutate its input", () => {
    const input: PowderDamageInput = powderInput({ power: 175 });
    const snapshot = { ...input };

    const first = computePowderDamage(input);
    const second = computePowderDamage(input);

    expect(first).toBe(second);
    expect(input).toEqual(snapshot);
  });

  it("honours an authored formula supplied by content", () => {
    // A variant that defends four times as hard and scales Power by 10.
    const variant: DamageFormula = { defenseDivisor: 4, powerDivisor: 10 };
    // base = 30 − floor(12 / 4) = 30 − 3 = 27; × 50 / 10 = 135.
    expect(computePowderDamage(powderInput({ power: 50 }), variant)).toBe(135);
  });

  it("rejects malformed combat stats at the boundary", () => {
    expect(() => computePowderDamage(powderInput({ magicPower: -1 }))).toThrow(RangeError);
    expect(() => computePowderDamage(powderInput({ magicPower: 1.5 }))).toThrow(RangeError);
    expect(() => computePowderDamage(powderInput({ targetMagicRes: -3 }))).toThrow(RangeError);
    expect(() => computePowderDamage(powderInput({ targetMagicRes: 2.5 }))).toThrow(RangeError);
    expect(() => computePowderDamage(powderInput({ power: 1.5 }))).toThrow(RangeError);
  });

  it("rejects a malformed formula", () => {
    expect(() =>
      computePowderDamage(powderInput(), { defenseDivisor: 0, powerDivisor: 100 }),
    ).toThrow(RangeError);
    expect(() =>
      computePowderDamage(powderInput(), { defenseDivisor: 2, powerDivisor: 0 }),
    ).toThrow(RangeError);
  });
});

describe("computeBaseDamage", () => {
  it("subtracts the truncated half of the defender's Weapon Def", () => {
    expect(computeBaseDamage(20, 10)).toBe(15);
    expect(computeBaseDamage(20, 9)).toBe(16);
    expect(computeBaseDamage(20, 0)).toBe(20);
  });

  it("floors malformed-by-nature negative bases at zero", () => {
    expect(computeBaseDamage(3, 20)).toBe(0);
    expect(computeBaseDamage(0, 0)).toBe(0);
  });

  it("uses the supplied formula's defense divisor", () => {
    expect(computeBaseDamage(20, 10, { defenseDivisor: 4, powerDivisor: 100 })).toBe(18);
  });
});

describe("applyPower", () => {
  it("multiplies by Power/100 and truncates", () => {
    expect(applyPower(15, 100)).toBe(15);
    expect(applyPower(15, 50)).toBe(7);
    expect(applyPower(10, 33)).toBe(3);
  });

  it("returns zero for a zero or negative Power term", () => {
    expect(applyPower(15, 0)).toBe(0);
    expect(applyPower(15, -50)).toBe(0);
  });

  it("uses the supplied formula's power divisor", () => {
    expect(applyPower(10, 33, { defenseDivisor: 2, powerDivisor: 10 })).toBe(33);
  });
});

describe("STEEL_FORMULA", () => {
  it("encodes the scraped FFTA coefficients as our authored balance data", () => {
    expect(STEEL_FORMULA).toEqual({ defenseDivisor: 2, powerDivisor: 100 });
  });
});

describe("POWDER_FORMULA", () => {
  it("encodes the scraped FFTA magical coefficients as our authored balance data", () => {
    expect(POWDER_FORMULA).toEqual({ defenseDivisor: 2, powerDivisor: 100 });
  });
});
