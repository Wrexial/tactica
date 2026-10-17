import { describe, expect, it } from "vitest";

import { CONDITIONS, type ConditionKey } from "../../src/data/conditions";
import type { StatBlock } from "../../src/data/schema";
import { coord } from "../../src/engine/grid";
import { asPostId, asUnitId } from "../../src/engine/ids";
import {
  DEFAULT_ELAN_REGEN_SCHEDULE,
  ELAN_REGEN_AMOUNT,
  ELAN_REGEN_INTERVAL_TICKS,
  MORALE_STATES,
  ROUTED_CONDITION,
  SHAKEN_CONDITION,
  SHAKEN_ELAN_RATIO,
  applyMorale,
  isMoraleState,
  isRegenTick,
  isRouted,
  isShaken,
  moraleStateOf,
  regenerateElan,
  settleElan,
  shakenThreshold,
  spendElan,
  type ElanRegenSchedule,
} from "../../src/engine/rules/elan";
import { canUseAbilities, conditionStatMods } from "../../src/engine/rules/conditions";
import { createUnit, type Unit, type UnitInit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T040 — Élan resource + morale
 *
 * Pins the task's "done when": **Élan is spent by actions and regenerates on a
 * tunable schedule; low Élan applies Shaken and zero applies Routed.** The
 * engine (`src/engine/rules/elan.ts`) turns the pool into the two authored
 * morale conditions (`src/data/conditions.ts`, D4) through the condition
 * engine (T039). The tests also pin purity and determinism, because a battle
 * replays from a seed plus a command log (`agents.md` §2).
 * ------------------------------------------------------------------------ */

const STATS: StatBlock = {
  hp: 80,
  mp: 20,
  atk: 20,
  def: 20,
  mag: 20,
  res: 20,
  spd: 20,
  move: 4,
  jump: 2,
};

function makeUnit(overrides: Partial<UnitInit> = {}): Unit {
  return createUnit({
    id: asUnitId("unit-soldier"),
    name: "Sgt. Aubry",
    power: "france",
    postId: asPostId("fusilier"),
    level: 1,
    at: coord(2, 3),
    stats: { ...STATS },
    ...overrides,
  });
}

/* --------------------------------------------------------------------------
 * Data — the authored morale conditions
 * ------------------------------------------------------------------------ */

describe("authored morale conditions (data/conditions.ts)", () => {
  it("authors Shaken and Routed as Élan-driven conditions", () => {
    expect(CONDITIONS.shaken.name).toBe("Shaken");
    expect(CONDITIONS.routed.name).toBe("Routed");
    for (const id of ["shaken", "routed"] as ConditionKey[]) {
      expect(CONDITIONS[id].id).toBe(id);
      expect(CONDITIONS[id].description.trim()).not.toBe("");
      expect(CONDITIONS[id].flavour.trim()).not.toBe("");
      // Both persist until the pool recovers, so the engine owns expiry.
      expect(CONDITIONS[id].duration).toBe(0);
    }
  });

  it("gives Shaken a debuff and Routed an action-suppressing state", () => {
    expect(CONDITIONS.shaken.kind).toBe("debuff");
    expect(CONDITIONS.shaken.hitModifier).toBeLessThan(0);
    expect(CONDITIONS.shaken.statMods.atk).toBeLessThan(0);
    expect(CONDITIONS.shaken.blocksAbilities).toBe(false);

    expect(CONDITIONS.routed.kind).toBe("special");
    expect(CONDITIONS.routed.blocksAbilities).toBe(true);
    expect(CONDITIONS.routed.statMods.def).toBeLessThan(0);
  });
});

/* --------------------------------------------------------------------------
 * Morale derivation
 * ------------------------------------------------------------------------ */

describe("moraleStateOf — deriving morale from the Élan pool", () => {
  it("uses half the pool as the Shaken threshold", () => {
    expect(SHAKEN_ELAN_RATIO).toBe(0.5);
    const unit = makeUnit();
    expect(shakenThreshold(unit)).toBe(10);
  });

  it("is steady above the threshold, shaken at or below it", () => {
    expect(moraleStateOf(makeUnit({ mp: 11 }))).toBe("steady");
    expect(moraleStateOf(makeUnit({ mp: 10 }))).toBe("shaken");
    expect(moraleStateOf(makeUnit({ mp: 1 }))).toBe("shaken");
  });

  it("is routed only at zero Élan", () => {
    expect(moraleStateOf(makeUnit({ mp: 0 }))).toBe("routed");
    expect(isRouted(makeUnit({ mp: 0 }))).toBe(true);
    expect(isRouted(makeUnit({ mp: 1 }))).toBe(false);
    expect(isShaken(makeUnit({ mp: 1 }))).toBe(true);
  });

  it("never shakes a unit with no Élan pool", () => {
    const parched = makeUnit({ stats: { ...STATS, mp: 0 }, mp: 0 });
    expect(moraleStateOf(parched)).toBe("steady");
    expect(isShaken(parched)).toBe(false);
    expect(isRouted(parched)).toBe(false);
  });

  it("exposes the three morale states and a runtime guard", () => {
    expect(MORALE_STATES).toEqual(["steady", "shaken", "routed"]);
    for (const state of MORALE_STATES) expect(isMoraleState(state)).toBe(true);
    expect(isMoraleState("broken")).toBe(false);
    expect(isMoraleState(7)).toBe(false);
  });
});

/* --------------------------------------------------------------------------
 * Spending
 * ------------------------------------------------------------------------ */

describe("spendElan — actions pay their cost", () => {
  it("deducts Élan and reports it as spent", () => {
    const unit = makeUnit({ mp: 20 });
    const result = spendElan(unit, 8, 12);

    expect(result.amount).toBe(8);
    expect(result.unit.mp).toBe(12);
    expect(result.events).toEqual([
      {
        kind: "mpChanged",
        tick: 12,
        unitId: unit.id,
        delta: -8,
        mpAfter: 12,
        reason: "spent",
      },
    ]);
  });

  it("is a no-op for a zero cost", () => {
    const unit = makeUnit();
    const result = spendElan(unit, 0);
    expect(result.unit).toBe(unit);
    expect(result.amount).toBe(0);
    expect(result.events).toEqual([]);
  });

  it("clamps an over-spend at zero and reports the actual cost", () => {
    const unit = makeUnit({ mp: 5 });
    const result = spendElan(unit, 12);

    expect(result.amount).toBe(5);
    expect(result.unit.mp).toBe(0);
    const event = result.events[0];
    expect(event?.kind === "mpChanged" && event.delta).toBe(-5);
    expect(event?.kind === "mpChanged" && event.mpAfter).toBe(0);
  });

  it("does nothing when the pool is already empty", () => {
    const unit = makeUnit({ mp: 0 });
    const result = spendElan(unit, 4);
    expect(result.unit).toBe(unit);
    expect(result.events).toEqual([]);
  });

  it("never mutates the input unit", () => {
    const unit = makeUnit();
    const before = JSON.stringify(unit);
    spendElan(unit, 6);
    expect(JSON.stringify(unit)).toBe(before);
  });

  it("rejects malformed costs and ticks", () => {
    expect(() => spendElan(makeUnit(), -1)).toThrow(RangeError);
    expect(() => spendElan(makeUnit(), 1.5)).toThrow(RangeError);
    expect(() => spendElan(makeUnit(), 1, -1)).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Regeneration
 * ------------------------------------------------------------------------ */

describe("regenerateElan — the tunable schedule", () => {
  it("restores Élan on schedule ticks only", () => {
    expect(ELAN_REGEN_INTERVAL_TICKS).toBe(10);
    expect(ELAN_REGEN_AMOUNT).toBe(5);

    const unit = makeUnit({ mp: 4 });

    expect(isRegenTick(0)).toBe(false);
    expect(isRegenTick(5)).toBe(false);
    expect(isRegenTick(10)).toBe(true);
    expect(isRegenTick(20)).toBe(true);

    expect(regenerateElan(unit, 5).amount).toBe(0);
    expect(regenerateElan(unit, 5).events).toEqual([]);

    const onCycle = regenerateElan(unit, 10);
    expect(onCycle.amount).toBe(ELAN_REGEN_AMOUNT);
    expect(onCycle.unit.mp).toBe(9);
    expect(onCycle.events[0]).toMatchObject({
      kind: "mpChanged",
      tick: 10,
      delta: ELAN_REGEN_AMOUNT,
      mpAfter: 9,
      reason: "regenerated",
    });
  });

  it("never regenerates past the maximum", () => {
    const almost = makeUnit({ mp: 18 });
    const result = regenerateElan(almost, 10);
    expect(result.amount).toBe(2);
    expect(result.unit.mp).toBe(20);
  });

  it("is a no-op on a full pool", () => {
    const full = makeUnit({ mp: 20 });
    const result = regenerateElan(full, 10);
    expect(result.unit).toBe(full);
    expect(result.events).toEqual([]);
  });

  it("accepts a custom schedule (the balance knobs are data)", () => {
    const schedule: ElanRegenSchedule = { amount: 3, intervalTicks: 4 };
    const unit = makeUnit({ mp: 0 });

    expect(isRegenTick(3, schedule)).toBe(false);
    expect(isRegenTick(4, schedule)).toBe(true);
    const result = regenerateElan(unit, 8, schedule);
    expect(result.amount).toBe(3);
    expect(result.unit.mp).toBe(3);
  });

  it("uses the documented default schedule", () => {
    expect(DEFAULT_ELAN_REGEN_SCHEDULE).toEqual({
      amount: ELAN_REGEN_AMOUNT,
      intervalTicks: ELAN_REGEN_INTERVAL_TICKS,
    });
  });

  it("rejects malformed schedules and ticks", () => {
    expect(() => isRegenTick(10, { amount: 5, intervalTicks: 0 })).toThrow(RangeError);
    expect(() => isRegenTick(10, { amount: -1, intervalTicks: 10 })).toThrow(RangeError);
    expect(() => regenerateElan(makeUnit(), -1)).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Applying morale
 * ------------------------------------------------------------------------ */

describe("applyMorale — the pool becomes a condition", () => {
  it("applies Shaken at or below the threshold", () => {
    const result = applyMorale(makeUnit({ mp: 10 }), 7);

    expect(result.state).toBe("shaken");
    expect(result.applied).toEqual([SHAKEN_CONDITION]);
    expect(result.unit.conditions.map((c) => c.conditionId)).toEqual(["shaken"]);
    expect(result.events[0]).toMatchObject({
      kind: "conditionApplied",
      tick: 7,
      conditionId: SHAKEN_CONDITION,
    });
    // Shaken reaches the shared condition queries and stat block.
    expect(conditionStatMods(result.unit).atk).toBe(CONDITIONS.shaken.statMods.atk);
    expect(canUseAbilities(result.unit)).toBe(true);
  });

  it("applies Routed at zero and cures Shaken first", () => {
    const shaken = applyMorale(makeUnit({ mp: 8 })).unit;
    const routed = applyMorale({ ...shaken, mp: 0 }, 9);

    expect(routed.state).toBe("routed");
    expect(routed.applied).toEqual([ROUTED_CONDITION]);
    expect(routed.removed).toEqual([SHAKEN_CONDITION]);
    expect(routed.unit.conditions.map((c) => c.conditionId)).toEqual(["routed"]);
    // Routed bars action abilities through the condition engine.
    expect(canUseAbilities(routed.unit)).toBe(false);
  });

  it("recovers to steady and cures Routed when Élan returns", () => {
    const routed = applyMorale(makeUnit({ mp: 0 })).unit;
    const steady = applyMorale({ ...routed, mp: 12 }, 11);

    expect(steady.state).toBe("steady");
    expect(steady.removed).toEqual([ROUTED_CONDITION]);
    expect(steady.unit.conditions).toEqual([]);
  });

  it("clears both morale conditions when steady", () => {
    let unit = applyMorale(makeUnit({ mp: 0 })).unit;
    expect(unit.conditions).toHaveLength(1);

    unit = applyMorale({ ...unit, mp: 20 }).unit;
    expect(unit.conditions).toEqual([]);
  });

  it("is idempotent and does not mutate its input", () => {
    const shaken = applyMorale(makeUnit({ mp: 5 })).unit;
    const before = JSON.stringify(shaken);

    const again = applyMorale(shaken, 3);
    expect(again.unit).toBe(shaken);
    expect(again.applied).toEqual([]);
    expect(again.removed).toEqual([]);
    expect(again.events).toEqual([]);
    expect(JSON.stringify(shaken)).toBe(before);
  });

  it("never shakes a unit with no Élan pool", () => {
    const parched = makeUnit({ stats: { ...STATS, mp: 0 }, mp: 0 });
    const result = applyMorale(parched);
    expect(result.state).toBe("steady");
    expect(result.unit).toBe(parched);
    expect(result.events).toEqual([]);
  });

  it("is deterministic", () => {
    const unit = makeUnit({ mp: 6 });
    expect(applyMorale(unit, 4)).toEqual(applyMorale(unit, 4));
  });
});

/* --------------------------------------------------------------------------
 * End-of-turn settlement
 * ------------------------------------------------------------------------ */

describe("settleElan — regenerate then reconcile morale", () => {
  it("restores Élan and lifts Routed in one step", () => {
    const routed = applyMorale(makeUnit({ mp: 0 })).unit;
    const settled = settleElan(routed, 10);

    expect(settled.regenerated).toBe(ELAN_REGEN_AMOUNT);
    expect(settled.unit.mp).toBe(ELAN_REGEN_AMOUNT);
    expect(settled.morale).toBe("shaken"); // 5 ≤ half of 20
    expect(settled.events.map((event) => event.kind)).toEqual([
      "mpChanged",
      "conditionRemoved",
      "conditionApplied",
    ]);
    expect(settled.unit.conditions.map((c) => c.conditionId)).toEqual(["shaken"]);
  });

  it("leaves an off-cycle steady soldier untouched", () => {
    const unit = makeUnit({ mp: 15 });
    const settled = settleElan(unit, 7);
    expect(settled.regenerated).toBe(0);
    expect(settled.unit).toBe(unit);
    expect(settled.events).toEqual([]);
  });
});
