import { describe, expect, it } from "vitest";

import {
  applyPower,
  computeBaseDamage,
  computeHealing,
  computePowderDamage,
  computeSteelDamage,
  computeWeaponDamage,
  computeWeaponOffense,
  HEALING_FORMULA,
  POWDER_FORMULA,
  STEEL_FORMULA,
  type DamageFormula,
  type HealingFormula,
  type HealingInput,
  type PowderDamageInput,
  type SteelDamageInput,
  type WeaponFormula,
  type WeaponOffenseInput,
} from "../../src/engine/rules/damage";
import { getWeaponFamily, WEAPON_FAMILIES } from "../../src/data/weapons";
import { WEAPON_TYPES } from "../../src/data/schema";

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
    expect(computePowderDamage(powderInput({ magicPower: 20, targetMagicRes: 7, power: 33 }))).toBe(
      5,
    );
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

/* --------------------------------------------------------------------------
 * T035 — Weapon-type variants
 *
 * Pins the task's "done when": the per-family formulas from
 * `docs/wiki/pages/Attack_(command).md` (the Final Fantasy Tactics variant
 * list), re-authored as data in `src/data/weapons.ts`. The engine exposes the
 * generic `computeWeaponOffense` / `computeWeaponDamage`; the data supplies the
 * coefficients, so no weapon id is special-cased in code.
 * ------------------------------------------------------------------------ */

describe("computeWeaponOffense", () => {
  function offense(overrides: Partial<WeaponOffenseInput> = {}): WeaponOffenseInput {
    return { atk: 20, spd: 10, mag: 8, weaponPower: 5, ...overrides };
  }

  it("scales a melee family off the attacker's atk (PA × WP)", () => {
    // floor((1×20 + 0 + 0)/1) × 5 = 100.
    expect(computeWeaponOffense(offense(), WEAPON_FAMILIES.sabre.formula)).toBe(100);
    expect(computeWeaponOffense(offense(), WEAPON_FAMILIES.lance.formula)).toBe(100);
    // The melee shape ignores spd and mag entirely.
    expect(computeWeaponOffense(offense({ spd: 99, mag: 99 }), WEAPON_FAMILIES.sabre.formula)).toBe(
      100,
    );
  });

  it("averages atk and spd for precision families ((PA + Spd)/2 × WP)", () => {
    // floor((20 + 10)/2) = 15; 15 × 5 = 75.
    expect(computeWeaponOffense(offense(), WEAPON_FAMILIES.rifle.formula)).toBe(75);
    expect(computeWeaponOffense(offense(), WEAPON_FAMILIES.bow.formula)).toBe(75);
    // Truncation is observable with an odd sum: floor((21 + 10)/2) = 15.
    expect(computeWeaponOffense(offense({ atk: 21 }), WEAPON_FAMILIES.carbine.formula)).toBe(75);
  });

  it("squares weapon power for the gun and ignores the attacker's stats (WP²)", () => {
    expect(computeWeaponOffense(offense({ weaponPower: 7 }), WEAPON_FAMILIES.gun.formula)).toBe(49);
    expect(
      computeWeaponOffense(
        offense({ weaponPower: 7, atk: 0, spd: 0, mag: 0 }),
        WEAPON_FAMILIES.gun.formula,
      ),
    ).toBe(49);
  });

  it("scales a staff off the attacker's mag (MA × WP)", () => {
    // floor((0 + 0 + 1×15)/1) × 5 = 75; atk/spd are ignored.
    expect(computeWeaponOffense(offense({ mag: 15 }), WEAPON_FAMILIES.staff.formula)).toBe(75);
  });

  it("averages atk and mag for an instrument ((PA + MA)/2 × WP)", () => {
    // floor((20 + 8)/2) = 14; 14 × 5 = 70.
    expect(computeWeaponOffense(offense(), WEAPON_FAMILIES.instrument.formula)).toBe(70);
  });

  it("returns zero offense for an unloaded weapon", () => {
    expect(computeWeaponOffense(offense({ weaponPower: 0 }), WEAPON_FAMILIES.sabre.formula)).toBe(
      0,
    );
    expect(computeWeaponOffense(offense({ weaponPower: 0 }), WEAPON_FAMILIES.gun.formula)).toBe(0);
  });

  it("is deterministic and does not mutate its inputs", () => {
    const input = offense({ atk: 13, spd: 7 });
    const snapshot = { ...input };
    const formula = WEAPON_FAMILIES.rifle.formula;

    const first = computeWeaponOffense(input, formula);
    const second = computeWeaponOffense(input, formula);

    expect(first).toBe(second);
    expect(input).toEqual(snapshot);
  });

  it("rejects malformed stats and formulas at the boundary", () => {
    expect(() => computeWeaponOffense(offense({ atk: -1 }), WEAPON_FAMILIES.sabre.formula)).toThrow(
      RangeError,
    );
    expect(() =>
      computeWeaponOffense(offense({ weaponPower: 1.5 }), WEAPON_FAMILIES.sabre.formula),
    ).toThrow(RangeError);

    const badDivisor: WeaponFormula = { ...WEAPON_FAMILIES.sabre.formula, offenseDivisor: 0 };
    expect(() => computeWeaponOffense(offense(), badDivisor)).toThrow(RangeError);

    const badWeight: WeaponFormula = { ...WEAPON_FAMILIES.sabre.formula, spdWeight: -1 };
    expect(() => computeWeaponOffense(offense(), badWeight)).toThrow(RangeError);

    const badMode = {
      ...WEAPON_FAMILIES.sabre.formula,
      weaponPowerMode: "divide" as unknown as WeaponFormula["weaponPowerMode"],
    };
    expect(() => computeWeaponOffense(offense(), badMode)).toThrow(RangeError);
  });
});

describe("computeWeaponDamage", () => {
  it("runs the family offense through the shared Steel kernel", () => {
    const base = { atk: 20, spd: 10, mag: 8, weaponPower: 5, targetWeaponDef: 10, power: 100 };

    // sabre: offense 100 → (100 − 5) × 100/100 = 95.
    expect(computeWeaponDamage(base, WEAPON_FAMILIES.sabre.formula)).toBe(95);
    // rifle: offense 75 → (75 − 5) × 100/100 = 70.
    expect(computeWeaponDamage(base, WEAPON_FAMILIES.rifle.formula)).toBe(70);
    // instrument: offense 70 → (70 − 5) × 100/100 = 65.
    expect(computeWeaponDamage(base, WEAPON_FAMILIES.instrument.formula)).toBe(65);
  });

  it("applies the action Power term after the variant offense", () => {
    // gun: offense 49, base 49 − 5 = 44, then × 50/100 = 22.
    expect(
      computeWeaponDamage(
        { atk: 0, spd: 0, mag: 0, weaponPower: 7, targetWeaponDef: 10, power: 50 },
        WEAPON_FAMILIES.gun.formula,
      ),
    ).toBe(22);
    // staff: offense 60, base 60 − 4 = 56, then × 200/100 = 112.
    expect(
      computeWeaponDamage(
        { atk: 0, spd: 0, mag: 15, weaponPower: 4, targetWeaponDef: 8, power: 200 },
        WEAPON_FAMILIES.staff.formula,
      ),
    ).toBe(112);
  });

  it("floors a variant hit at zero when the defender's guard wins", () => {
    expect(
      computeWeaponDamage(
        { atk: 3, spd: 3, mag: 3, weaponPower: 1, targetWeaponDef: 1000, power: 100 },
        WEAPON_FAMILIES.sabre.formula,
      ),
    ).toBe(0);
  });

  it("is deterministic and does not mutate its inputs", () => {
    const input = {
      atk: 20,
      spd: 10,
      mag: 8,
      weaponPower: 5,
      targetWeaponDef: 12,
      power: 175,
    };
    const snapshot = { ...input };
    const formula = WEAPON_FAMILIES.blade.formula;

    const first = computeWeaponDamage(input, formula);
    const second = computeWeaponDamage(input, formula);

    expect(first).toBe(second);
    expect(input).toEqual(snapshot);
  });
});

describe("WEAPON_FAMILIES (T035 data)", () => {
  it("authors a validated family for every WeaponType", () => {
    expect(Object.keys(WEAPON_FAMILIES).sort()).toEqual([...WEAPON_TYPES].sort());
    for (const type of WEAPON_TYPES) {
      const family = getWeaponFamily(type);
      expect(family.id).toBe(type);
      expect(family.name.trim()).not.toBe("");
      expect(family.description.trim()).not.toBe("");
      expect(family.flavour.trim()).not.toBe("");
    }
  });

  it("pins the required reference variants (sabre, lance, rifle, gun, instrument)", () => {
    expect(WEAPON_FAMILIES.sabre.formula).toMatchObject({
      atkWeight: 1,
      offenseDivisor: 1,
      weaponPowerMode: "multiply",
    });
    expect(WEAPON_FAMILIES.lance.formula).toMatchObject({
      atkWeight: 1,
      offenseDivisor: 1,
      weaponPowerMode: "multiply",
    });
    expect(WEAPON_FAMILIES.rifle.formula).toMatchObject({
      atkWeight: 1,
      spdWeight: 1,
      offenseDivisor: 2,
      weaponPowerMode: "multiply",
    });
    expect(WEAPON_FAMILIES.gun.formula).toMatchObject({
      weaponPowerMode: "square",
      atkWeight: 0,
      spdWeight: 0,
      magWeight: 0,
    });
    expect(WEAPON_FAMILIES.instrument.formula).toMatchObject({
      atkWeight: 1,
      magWeight: 1,
      offenseDivisor: 2,
      weaponPowerMode: "multiply",
    });
  });

  it("keeps the shared Steel kernel coefficients on every family", () => {
    for (const type of WEAPON_TYPES) {
      expect(WEAPON_FAMILIES[type].formula).toMatchObject({
        defenseDivisor: 2,
        powerDivisor: 100,
      });
    }
  });
});

/* --------------------------------------------------------------------------
 * T036 — Healing / Medicine
 *
 * Pins the task's "done when": an **authored** healing formula, because the
 * wiki lists White Magic ability Power values but documents no formula
 * (`docs/wiki/pages/White_Magic_(Tactics_Advance).md`; `agents.md` §10 flags
 * the gap). The shape is `flatHeal + floor(MedicalPower × Power / 100)`, with
 * the same `Power/100` tuning convention as Steel and Powder but **no defence
 * term** — nothing opposes a bandage. The result must be a non-negative integer
 * fit for a `HealedEvent`, deterministic, and free of input mutation.
 * ------------------------------------------------------------------------ */

function healingInput(overrides: Partial<HealingInput> = {}): HealingInput {
  return { medicalPower: 30, power: 40, ...overrides };
}

describe("computeHealing", () => {
  it("computes flatHeal + floor(MedicalPower × Power / powerDivisor)", () => {
    // 10 + floor(30 × 40 / 100) = 10 + 12 = 22.
    expect(computeHealing(healingInput())).toBe(22);
  });

  it("scales with the caster's Medical Power", () => {
    // 10 + floor(60 × 40 / 100) = 10 + 24 = 34.
    expect(computeHealing(healingInput({ medicalPower: 60 }))).toBe(34);
    // 10 + floor(0 × 40 / 100) = 10 — the flat bandage effect still lands.
    expect(computeHealing(healingInput({ medicalPower: 0 }))).toBe(10);
  });

  it("scales with the ability's Power term", () => {
    // Cure 40 → 22; Cura 60 → 10 + 18 = 28; Curaga 80 → 10 + 24 = 34.
    expect(computeHealing(healingInput({ power: 40 }))).toBe(22);
    expect(computeHealing(healingInput({ power: 60 }))).toBe(28);
    expect(computeHealing(healingInput({ power: 80 }))).toBe(34);
  });

  it("truncates the scaled term (no rounding up)", () => {
    // 10 + floor(35 × 33 / 100) = 10 + floor(11.55) = 21.
    expect(computeHealing(healingInput({ medicalPower: 35, power: 33 }))).toBe(21);
  });

  it("treats a zero Power as the flat base only", () => {
    expect(computeHealing(healingInput({ power: 0 }))).toBe(10);
  });

  it("floors at zero for a negative Power term", () => {
    // 10 + floor(30 × −50 / 100) = 10 − 15 = −5 → 0.
    expect(computeHealing(healingInput({ power: -50 }))).toBe(0);
  });

  it("returns a non-negative integer for every valid input", () => {
    for (const medicalPower of [0, 1, 7, 15, 30, 99]) {
      for (const power of [0, 25, 40, 60, 80, 175]) {
        const heal = computeHealing({ medicalPower, power });
        expect(Number.isInteger(heal)).toBe(true);
        expect(heal).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("is deterministic and does not mutate its input", () => {
    const input: HealingInput = healingInput({ medicalPower: 42, power: 77 });
    const snapshot = { ...input };

    const first = computeHealing(input);
    const second = computeHealing(input);

    expect(first).toBe(second);
    expect(input).toEqual(snapshot);
  });

  it("honours an authored formula supplied by content", () => {
    // A field-hospital variant with a bigger flat base and Power/10 scaling.
    const variant: HealingFormula = { flatHeal: 25, powerDivisor: 10 };
    // 25 + floor(30 × 40 / 10) = 25 + 120 = 145.
    expect(computeHealing(healingInput(), variant)).toBe(145);
  });

  it("rejects malformed inputs at the boundary", () => {
    expect(() => computeHealing(healingInput({ medicalPower: -1 }))).toThrow(RangeError);
    expect(() => computeHealing(healingInput({ medicalPower: 1.5 }))).toThrow(RangeError);
    expect(() => computeHealing(healingInput({ power: 1.5 }))).toThrow(RangeError);
  });

  it("rejects a malformed formula", () => {
    expect(() => computeHealing(healingInput(), { flatHeal: -1, powerDivisor: 100 })).toThrow(
      RangeError,
    );
    expect(() => computeHealing(healingInput(), { flatHeal: 10, powerDivisor: 0 })).toThrow(
      RangeError,
    );
  });
});

describe("HEALING_FORMULA", () => {
  it("encodes our authored flat base and the shared Power/100 scaling", () => {
    expect(HEALING_FORMULA).toEqual({ flatHeal: 10, powerDivisor: 100 });
  });
});
