import { describe, expect, it } from "vitest";

import type { StatBlock } from "../../src/data/schema";
import {
  executeVolley,
  scaleVolleyPower,
  scaleVolleySpec,
  volleyHonourMultiplier,
  volleyHonourNumerator,
  volleyLinkers,
  volleyLinkRange,
  type VolleySpec,
} from "../../src/engine/actions/volley";
import type { AbilityExecutionOptions, SteelEffect } from "../../src/engine/actions/ability";
import { createBattle, findUnit, type BattleState } from "../../src/engine/battle";
import type { Target } from "../../src/engine/commands";
import { isBattleEvent, type BattleEvent } from "../../src/engine/events";
import { coord, type Coord } from "../../src/engine/grid";
import { asAbilityId, asConditionId, asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import { Rng } from "../../src/engine/rng";
import { createTerrainMap } from "../../src/engine/terrain";
import { createUnit, type Unit, type UnitInit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T061 — Volleys (combos)
 *
 * Pins the task's "done when": **the initiator spends Honour; adjacent allies
 * chain in; damage scales with Honour spent.** A Volley is the retheme's FFTA
 * Combo (`docs/wiki/pages/Combo_(Tactics_Advance).md`): the initiator commits
 * Judge Points, eligible neighbours fire too, and the FFTA multiplier
 * `(10 + 4×JP)/10` scales the damage. The tests also pin purity and
 * determinism, because a battle replays from a seed plus a command log
 * (`agents.md` §2).
 * ------------------------------------------------------------------------ */

const ACTOR_ID = asUnitId("unit-actor");
const ALLY_A_ID = asUnitId("unit-ally-a");
const ALLY_B_ID = asUnitId("unit-ally-b");
const FAR_ALLY_ID = asUnitId("unit-far-ally");
const ENEMY_ID = asUnitId("unit-enemy");

const ACTOR_STATS: StatBlock = {
  hp: 60,
  mp: 20,
  atk: 20,
  def: 8,
  mag: 10,
  res: 8,
  spd: 20,
  move: 4,
  jump: 2,
};

const ALLY_STATS: StatBlock = {
  hp: 50,
  mp: 10,
  atk: 10,
  def: 8,
  mag: 8,
  res: 8,
  spd: 15,
  move: 4,
  jump: 2,
};

const ENEMY_STATS: StatBlock = {
  hp: 500,
  mp: 4,
  atk: 10,
  def: 10,
  mag: 5,
  res: 10,
  spd: 10,
  move: 4,
  jump: 2,
};

const MAP = createTerrainMap(8, 6, "field");

function makeUnit(
  id: UnitId,
  at: Coord,
  side: "company" | "enemy",
  stats: StatBlock,
  overrides: Partial<UnitInit> = {},
): Unit {
  return createUnit({
    id,
    name: `Soldier ${id}`,
    power: "france",
    postId: asPostId("fusilier"),
    side,
    level: 1,
    at,
    stats: { ...stats },
    ...overrides,
  });
}

/**
 * A firing line: the initiator and two neighbours around the mark, plus a
 * distant ally that must **not** chain in at the default adjacent range.
 */
function defaultUnits(): Unit[] {
  return [
    makeUnit(ACTOR_ID, coord(3, 3), "company", ACTOR_STATS, { judgePoints: 8 }),
    makeUnit(ALLY_A_ID, coord(4, 2), "company", ALLY_STATS),
    makeUnit(ALLY_B_ID, coord(4, 4), "company", ALLY_STATS),
    makeUnit(FAR_ALLY_ID, coord(6, 5), "company", ALLY_STATS),
    makeUnit(ENEMY_ID, coord(4, 3), "enemy", ENEMY_STATS),
  ];
}

function makeBattle(units: readonly Unit[] = defaultUnits()): BattleState {
  return createBattle(1815, { map: MAP, units });
}

function actorOf(state: BattleState): Unit {
  const actor = findUnit(state, ACTOR_ID);
  if (actor === undefined) throw new Error("actor missing");
  return actor;
}

function steel(power: number): SteelEffect {
  return { kind: "steel", power };
}

/** A data-defined volley ability factory; tests override only what they use. */
function volleyFire(overrides: Partial<VolleySpec> = {}): VolleySpec {
  return {
    id: asAbilityId("volley-fire"),
    mpCost: 0,
    chargeTime: 0,
    range: 1,
    power: 100,
    target: "enemy",
    hitRate: 100,
    effects: [steel(100)],
    ...overrides,
  };
}

function unitTarget(unitId: UnitId): Target {
  return { kind: "unit", unitId };
}

/** A guaranteed-hit volley: zero evasion so every shot lands. */
const SURE_HIT: AbilityExecutionOptions = { evasionOf: () => 0 };

function run(
  state: BattleState,
  spec: VolleySpec,
  honour: number,
  target: Target = unitTarget(ENEMY_ID),
  options: AbilityExecutionOptions = SURE_HIT,
  seed: string | number = "t061",
): ReturnType<typeof executeVolley> {
  return executeVolley(state, actorOf(state), spec, target, honour, new Rng(seed), options);
}

/** Sum the damage of every `damaged` event in `events`. */
function totalDamage(events: readonly BattleEvent[]): number {
  return events.reduce((sum, event) => (event.kind === "damaged" ? sum + event.amount : sum), 0);
}

/* --------------------------------------------------------------------------
 * The honour multiplier (the FFTA combo formula)
 * ------------------------------------------------------------------------ */

describe("Volley honour multiplier", () => {
  it("reproduces FFTA's (10 + 4×JP)/10 curve", () => {
    expect(volleyHonourNumerator(0)).toBe(10);
    expect(volleyHonourNumerator(1)).toBe(14);
    expect(volleyHonourNumerator(5)).toBe(30);
    expect(volleyHonourNumerator(10)).toBe(50);

    expect(volleyHonourMultiplier(1)).toEqual({ numerator: 14, denominator: 10 });
    expect(volleyHonourMultiplier(10)).toEqual({ numerator: 50, denominator: 10 });
  });

  it("scales an ability's power term by the commitment", () => {
    expect(scaleVolleyPower(100, 0)).toBe(100);
    expect(scaleVolleyPower(100, 1)).toBe(140);
    expect(scaleVolleyPower(100, 5)).toBe(300);
    expect(scaleVolleyPower(100, 10)).toBe(500);
    // Truncation happens once, at the boundary, keeping the arithmetic integer.
    expect(scaleVolleyPower(55, 1)).toBe(77); // floor(55 × 14 / 10)
  });

  it("scales every damaging effect but leaves conditions alone", () => {
    const scaled = scaleVolleySpec(
      volleyFire({
        effects: [steel(50), { kind: "condition", conditionId: asConditionId("pinned") }],
      }),
      2, // (10 + 8)/10 = 1.8 → floor(50 × 18/10) = 90
    );

    expect(scaled.effects[0]).toMatchObject({ kind: "steel", power: 90 });
    expect(scaled.effects[1]).toEqual({ kind: "condition", conditionId: "pinned" });
    // The input spec is untouched.
    expect(volleyFire().effects[0]).toMatchObject({ power: 100 });
  });

  it("rejects malformed powers and honours", () => {
    expect(() => scaleVolleyPower(1.5, 1)).toThrow(RangeError);
    expect(() => scaleVolleyPower(100, -1)).toThrow(RangeError);
    expect(() => scaleVolleyPower(100, 1.5)).toThrow(RangeError);
    expect(() => volleyHonourNumerator(-2)).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Linker selection
 * ------------------------------------------------------------------------ */

describe("volleyLinkers — adjacent allies", () => {
  it("returns only living allies adjacent to the target", () => {
    const state = makeBattle();
    const linkers = volleyLinkers(state, actorOf(state), coord(4, 3));

    expect(linkers.map((unit) => unit.id)).toEqual([ALLY_A_ID, ALLY_B_ID]);
    expect(linkers.some((unit) => unit.id === FAR_ALLY_ID)).toBe(false);
  });

  it("honours a longer authored chain range", () => {
    const state = makeBattle();
    const linkers = volleyLinkers(state, actorOf(state), coord(4, 3), 4);

    expect(linkers.map((unit) => unit.id)).toEqual([ALLY_A_ID, ALLY_B_ID, FAR_ALLY_ID]);
  });

  it("excludes out-of-action allies and the initiator", () => {
    const units = defaultUnits().map((unit) => (unit.id === ALLY_A_ID ? { ...unit, hp: 0 } : unit));
    const state = makeBattle(units);
    const linkers = volleyLinkers(state, actorOf(state), coord(4, 3));

    expect(linkers.map((unit) => unit.id)).toEqual([ALLY_B_ID]);
  });

  it("resolves the default link range and rejects a malformed one", () => {
    expect(volleyLinkRange(volleyFire())).toBe(1);
    expect(volleyLinkRange(volleyFire({ linkRange: 4 }))).toBe(4);
    expect(() => volleyLinkRange(volleyFire({ linkRange: 0 }))).toThrow(RangeError);
    expect(() => volleyLinkRange(volleyFire({ linkRange: 1.5 }))).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Spending Honour
 * ------------------------------------------------------------------------ */

describe("executeVolley — spending Honour", () => {
  it("spends the initiator's Honour and announces the volley", () => {
    const state = makeBattle();
    const result = run(state, volleyFire(), 3);

    expect(result.ok).toBe(true);
    expect(result.honour).toBe(3);
    expect(result.honourSpent).toBe(3);
    expect(findUnit(result.state, ACTOR_ID)?.judgePoints).toBe(5);

    const started = result.events.find((event) => event.kind === "volleyStarted");
    expect(started).toMatchObject({
      kind: "volleyStarted",
      unitId: ACTOR_ID,
      abilityId: "volley-fire",
      at: { x: 4, y: 3 },
      targetId: ENEMY_ID,
      honour: 3,
    });

    const spent = result.events.find(
      (event) => event.kind === "honourChanged" && event.unitId === ACTOR_ID,
    );
    expect(spent).toMatchObject({
      kind: "honourChanged",
      delta: -3,
      honourAfter: 5,
      reason: "volley",
    });
  });

  it("never spends the linkers' Honour", () => {
    const state = makeBattle();
    const result = run(state, volleyFire(), 2);

    expect(findUnit(result.state, ALLY_A_ID)?.judgePoints).toBe(0);
    expect(findUnit(result.state, ALLY_B_ID)?.judgePoints).toBe(0);
  });

  it("refuses a commitment larger than the pool without touching the state", () => {
    const units = defaultUnits().map((unit) =>
      unit.id === ACTOR_ID ? { ...unit, judgePoints: 2 } : unit,
    );
    const state = makeBattle(units);
    const result = executeVolley(
      state,
      actorOf(state),
      volleyFire(),
      unitTarget(ENEMY_ID),
      5,
      new Rng(1),
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("insufficient-honour");
    expect(result.honourSpent).toBe(0);
    expect(result.events).toEqual([]);
    expect(result.state).toBe(state);
  });

  it("requires at least one Honour (FFTA's combo gate)", () => {
    const state = makeBattle();
    const result = run(state, volleyFire(), 0);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("insufficient-honour");
    expect(findUnit(result.state, ACTOR_ID)?.judgePoints).toBe(8);
  });

  it("rejects malformed honour values", () => {
    const state = makeBattle();
    const actor = actorOf(state);
    expect(() =>
      executeVolley(state, actor, volleyFire(), unitTarget(ENEMY_ID), -1, new Rng(1)),
    ).toThrow(RangeError);
    expect(() =>
      executeVolley(state, actor, volleyFire(), unitTarget(ENEMY_ID), 1.5, new Rng(1)),
    ).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Chaining in
 * ------------------------------------------------------------------------ */

describe("executeVolley — adjacent allies chain in", () => {
  it("emits volleyChained for each adjacent ally but not the distant one", () => {
    const state = makeBattle();
    const result = run(state, volleyFire(), 2);

    const chained = result.events
      .filter((event) => event.kind === "volleyChained")
      .map((event) => event.unitId);
    expect(chained).toEqual([ALLY_A_ID, ALLY_B_ID]);
    expect(result.linkers).toEqual([ALLY_A_ID, ALLY_B_ID]);
    expect(chained).not.toContain(FAR_ALLY_ID);
  });

  it("lets a longer-ranged volley chain in distant allies", () => {
    const state = makeBattle();
    const result = run(state, volleyFire({ range: 4, linkRange: 4 }), 2);

    const chained = result.events
      .filter((event) => event.kind === "volleyChained")
      .map((event) => event.unitId);
    expect(chained).toEqual([ALLY_A_ID, ALLY_B_ID, FAR_ALLY_ID]);
  });

  it("still fires the opening shot when no ally is adjacent", () => {
    const units = [
      makeUnit(ACTOR_ID, coord(3, 3), "company", ACTOR_STATS, { judgePoints: 4 }),
      makeUnit(ENEMY_ID, coord(4, 3), "enemy", ENEMY_STATS),
    ];
    const state = makeBattle(units);
    const result = run(state, volleyFire(), 2);

    expect(result.ok).toBe(true);
    expect(result.linkers).toEqual([]);
    expect(result.events.some((event) => event.kind === "volleyChained")).toBe(false);
    expect(result.events.some((event) => event.kind === "damaged")).toBe(true);
  });

  it("stops once the primary target is out of action", () => {
    const units = defaultUnits().map((unit) => (unit.id === ENEMY_ID ? { ...unit, hp: 10 } : unit));
    const state = makeBattle(units);
    const result = run(state, volleyFire(), 2);

    // The initiator's scaled opening shot (base 15 × 180/100 = 27) drops it.
    const damaged = result.events.filter((event) => event.kind === "damaged");
    expect(damaged).toHaveLength(1);
    expect(result.events.some((event) => event.kind === "volleyChained")).toBe(false);
  });
});

/* --------------------------------------------------------------------------
 * Damage scaling
 * ------------------------------------------------------------------------ */

describe("executeVolley — damage scales with Honour spent", () => {
  it("deals more damage the more Honour is committed", () => {
    const state = makeBattle();
    const low = run(state, volleyFire(), 1);
    const high = run(state, volleyFire(), 5);

    // Honour 1 → ×1.4: initiator 21, each ally 7. Honour 5 → ×3.0: 45 / 15.
    expect(totalDamage(low.events)).toBe(21 + 7 + 7);
    expect(totalDamage(high.events)).toBe(45 + 15 + 15);
    expect(totalDamage(high.events)).toBeGreaterThan(totalDamage(low.events));
    expect(findUnit(high.state, ENEMY_ID)!.hp).toBeLessThan(findUnit(low.state, ENEMY_ID)!.hp);
  });

  it("scales the opening shot even before anyone joins", () => {
    const units = [
      makeUnit(ACTOR_ID, coord(3, 3), "company", ACTOR_STATS, { judgePoints: 10 }),
      makeUnit(ENEMY_ID, coord(4, 3), "enemy", ENEMY_STATS),
    ];
    const state = makeBattle(units);
    const low = run(state, volleyFire(), 1);
    const high = run(state, volleyFire(), 10);

    expect(totalDamage(low.events)).toBe(21);
    expect(totalDamage(high.events)).toBe(75); // floor(15 × 500/100)
  });
});

/* --------------------------------------------------------------------------
 * Targeting, purity and determinism
 * ------------------------------------------------------------------------ */

describe("executeVolley — targeting and contracts", () => {
  it("rejects an out-of-range aim without spending Honour", () => {
    const units = [
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS, { judgePoints: 5 }),
      makeUnit(ENEMY_ID, coord(6, 5), "enemy", ENEMY_STATS),
    ];
    const state = makeBattle(units);
    const result = run(state, volleyFire(), 3);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("out-of-range");
    expect(result.events).toEqual([]);
    expect(result.honourSpent).toBe(0);
    expect(result.state).toBe(state);
    expect(findUnit(result.state, ACTOR_ID)?.judgePoints).toBe(5);
  });

  it("never mutates the input state or unit", () => {
    const state = makeBattle();
    const before = JSON.stringify(state);
    run(state, volleyFire(), 3);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("is deterministic for the same seed and inputs", () => {
    const state = makeBattle();
    const first = run(state, volleyFire(), 4, unitTarget(ENEMY_ID), SURE_HIT, "volley-seed");
    const second = run(state, volleyFire(), 4, unitTarget(ENEMY_ID), SURE_HIT, "volley-seed");

    expect(second.events).toEqual(first.events);
    expect(second.state.units).toEqual(first.state.units);
  });

  it("emits only well-formed battle events", () => {
    const state = makeBattle();
    const result = run(state, volleyFire(), 3);
    expect(result.events.every(isBattleEvent)).toBe(true);
    expect(result.events.map((event) => event.kind)).toContain("volleyStarted");
  });
});
