import { describe, expect, it } from "vitest";

import type { StatBlock } from "../../src/data/schema";
import {
  GUARD_SORTIE_KEYS,
  GUARD_SORTIE_LIST,
  GUARD_SORTIES,
  getGuardSortie,
  guardSortiesForChapter,
  guardSortiesForPower,
  isGuardSortieKey,
} from "../../src/data/guards";
import {
  executeGuardSortie,
  guardSortieSpec,
  guardSortieUnlockPredicate,
  unlockedGuardSorties,
  type GuardSortieOptions,
  type GuardSortieSpec,
} from "../../src/engine/actions/guardSortie";
import { createBattle, findUnit, type BattleState } from "../../src/engine/battle";
import { isBattleEvent, type BattleEvent } from "../../src/engine/events";
import { coord, type Coord } from "../../src/engine/grid";
import { asGuardSortieId, asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import { GUARD_SORTIE_COST } from "../../src/engine/rules/honour";
import { Rng } from "../../src/engine/rng";
import { createTerrainMap } from "../../src/engine/terrain";
import { createUnit, type Unit, type UnitInit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T062 — Guard Sorties
 *
 * Pins the task's "done when": **five national Guard Sorties cost 10 Honour,
 * hit the whole field, and must be unlocked via story.** A Guard Sortie is the
 * retheme's FFTA Totema (mapping §4): it costs ten Judge Points (Honour),
 * cannot be dodged, reaches every enemy, and answers only once the campaign
 * story has met that national formation. The tests also pin purity and
 * determinism, because a battle replays from a seed plus a command log
 * (`agents.md` §2).
 * ------------------------------------------------------------------------ */

const CALLER_ID = asUnitId("unit-caller");
const ALLY_ID = asUnitId("unit-ally");
const ENEMY_A_ID = asUnitId("unit-enemy-a");
const ENEMY_B_ID = asUnitId("unit-enemy-b");

const CALLER_STATS: StatBlock = {
  hp: 120,
  mp: 60,
  atk: 60,
  def: 20,
  mag: 60,
  res: 20,
  spd: 20,
  move: 5,
  jump: 2,
};

const ALLY_STATS: StatBlock = {
  hp: 90,
  mp: 20,
  atk: 20,
  def: 12,
  mag: 10,
  res: 12,
  spd: 15,
  move: 4,
  jump: 2,
};

const ENEMY_STATS: StatBlock = {
  hp: 900,
  mp: 10,
  atk: 20,
  def: 10,
  mag: 10,
  res: 10,
  spd: 8,
  move: 4,
  jump: 2,
};

const MAP = createTerrainMap(14, 10, "field");

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
 * A callable field: the caller holds a full ten Honour, one ally stands beside
 * them, and the two enemies are spread to opposite corners — far beyond any
 * ordinary action's reach.
 */
function defaultUnits(): Unit[] {
  return [
    makeUnit(CALLER_ID, coord(1, 1), "company", CALLER_STATS, {
      judgePoints: 10,
      mp: 40,
    }),
    makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS),
    makeUnit(ENEMY_A_ID, coord(12, 8), "enemy", ENEMY_STATS),
    makeUnit(ENEMY_B_ID, coord(2, 7), "enemy", ENEMY_STATS),
  ];
}

function makeBattle(units: readonly Unit[] = defaultUnits()): BattleState {
  return createBattle(1815, { map: MAP, units });
}

function callerOf(state: BattleState): Unit {
  const caller = findUnit(state, CALLER_ID);
  if (caller === undefined) throw new Error("caller missing");
  return caller;
}

function oldGuard(): GuardSortieSpec {
  return guardSortieSpec(GUARD_SORTIES["old-guard"]);
}

const UNLOCK_ALL: GuardSortieOptions = { isUnlocked: () => true };

function run(
  state: BattleState,
  spec: GuardSortieSpec,
  options: GuardSortieOptions = UNLOCK_ALL,
  seed: string | number = "t062",
): ReturnType<typeof executeGuardSortie> {
  return executeGuardSortie(state, callerOf(state), spec, new Rng(seed), options);
}

/** Sum the damage of every `damaged` event in `events`. */
function totalDamage(events: readonly BattleEvent[]): number {
  return events.reduce((sum, event) => (event.kind === "damaged" ? sum + event.amount : sum), 0);
}

/** The `damaged` events aimed at `unitId`. */
function damageTo(events: readonly BattleEvent[], unitId: UnitId): number {
  return events.reduce(
    (sum, event) =>
      event.kind === "damaged" && event.unitId === unitId ? sum + event.amount : sum,
    0,
  );
}

/* --------------------------------------------------------------------------
 * The authored table (five national formations)
 * ------------------------------------------------------------------------ */

describe("Guard Sortie data — five national formations", () => {
  it("authors exactly one Guard Sortie per great power", () => {
    expect(GUARD_SORTIE_LIST).toHaveLength(5);
    expect(Object.keys(GUARD_SORTIES).sort()).toEqual([...GUARD_SORTIE_KEYS].sort());

    const powers = GUARD_SORTIE_LIST.map((guard) => guard.power).sort();
    expect(powers).toEqual(["austria", "britain", "france", "prussia", "russia"]);
  });

  it("carries authored Napoleonic prose and at least one effect each", () => {
    for (const guard of GUARD_SORTIE_LIST) {
      expect(guard.name.trim(), guard.id).not.toBe("");
      expect(guard.description.trim(), guard.id).not.toBe("");
      expect(guard.flavour.trim(), guard.id).not.toBe("");
      expect(guard.effects.length, guard.id).toBeGreaterThanOrEqual(1);
      expect(guard.hits, guard.id).toBeGreaterThanOrEqual(1);
      expect(guard.chapter, guard.id).toBeGreaterThanOrEqual(1);
    }
  });

  it("maps each power to its canonical formation", () => {
    expect(guardSortiesForPower("france")[0].id).toBe("old-guard");
    expect(guardSortiesForPower("britain")[0].id).toBe("heavy-brigade");
    expect(guardSortiesForPower("prussia")[0].id).toBe("deaths-head-hussars");
    expect(guardSortiesForPower("russia")[0].id).toBe("grand-battery");
    expect(guardSortiesForPower("austria")[0].id).toBe("kaisers-bombardiers");
  });

  it("guards lookups and rejects unknown ids", () => {
    expect(isGuardSortieKey("old-guard")).toBe(true);
    expect(isGuardSortieKey("old-guard-2")).toBe(false);
    expect(getGuardSortie("grand-battery").power).toBe("russia");
    expect(() => getGuardSortie("missing" as never)).toThrow(RangeError);
  });

  it("records the story chapter that unlocks each formation", () => {
    expect(guardSortiesForChapter(1)).toEqual([]);
    expect(guardSortiesForChapter(2).map((guard) => guard.id)).toEqual(["old-guard"]);
    expect(guardSortiesForChapter(6)).toHaveLength(5);
    expect(() => guardSortiesForChapter(-1)).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * The executable spec
 * ------------------------------------------------------------------------ */

describe("guardSortieSpec — authored data to engine spec", () => {
  it("bridges the formation id and carries its effects", () => {
    const spec = oldGuard();
    expect(spec.guardSortieId).toBe("old-guard");
    expect(spec.id).toBe("old-guard");
    expect(spec.target).toBe("enemy");
    expect(spec.aoeShape).toBe("field");
    expect(spec.hitRate).toBe(100);
    expect(spec.hits).toBe(1);
    expect(spec.effects[0]).toMatchObject({ kind: "steel", power: 320, element: "holy" });
  });

  it("carries the multi-hit formation's pass count", () => {
    const spec = guardSortieSpec(GUARD_SORTIES["kaisers-bombardiers"]);
    expect(spec.hits).toBe(3);
    expect(spec.effects[0]).toMatchObject({ kind: "powder", element: "fire" });
  });

  it("carries the Heavy Brigade's Élan drain", () => {
    const spec = guardSortieSpec(GUARD_SORTIES["heavy-brigade"]);
    expect(spec.effects.some((effect) => effect.kind === "drain")).toBe(true);
  });
});

/* --------------------------------------------------------------------------
 * The story gate
 * ------------------------------------------------------------------------ */

describe("executeGuardSortie — story unlock gate", () => {
  it("refuses a formation the story has not unlocked", () => {
    const state = makeBattle();
    const result = run(state, oldGuard(), { isUnlocked: () => false });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("locked");
    expect(result.events).toEqual([]);
    expect(result.honourSpent).toBe(0);
    expect(result.targets).toEqual([]);
    expect(result.state).toBe(state);
    expect(findUnit(result.state, CALLER_ID)?.judgePoints).toBe(10);
  });

  it("treats an omitted gate as locked", () => {
    const state = makeBattle();
    const result = executeGuardSortie(state, callerOf(state), oldGuard(), new Rng(1));
    expect(result.reason).toBe("locked");
  });

  it("unlocks the formations a chapter has reached", () => {
    expect(unlockedGuardSorties(1)).toEqual([]);
    expect(unlockedGuardSorties(2)).toEqual(["old-guard"]);
    expect(unlockedGuardSorties(6)).toHaveLength(5);

    const predicate = guardSortieUnlockPredicate(2);
    expect(predicate(asGuardSortieId("old-guard"))).toBe(true);
    expect(predicate(asGuardSortieId("grand-battery"))).toBe(false);

    const result = run(makeBattle(), oldGuard(), { isUnlocked: predicate });
    expect(result.ok).toBe(true);
  });
});

/* --------------------------------------------------------------------------
 * Cost
 * ------------------------------------------------------------------------ */

describe("executeGuardSortie — ten Honour", () => {
  it("spends exactly GUARD_SORTIE_COST and announces the call", () => {
    const state = makeBattle();
    const result = run(state, oldGuard());

    expect(result.ok).toBe(true);
    expect(GUARD_SORTIE_COST).toBe(10);
    expect(result.honourSpent).toBe(10);
    expect(findUnit(result.state, CALLER_ID)?.judgePoints).toBe(0);

    const called = result.events.find((event) => event.kind === "guardSortieCalled");
    expect(called).toMatchObject({
      kind: "guardSortieCalled",
      unitId: CALLER_ID,
      guardSortieId: "old-guard",
    });

    const spent = result.events.find(
      (event) => event.kind === "honourChanged" && event.unitId === CALLER_ID,
    );
    expect(spent).toMatchObject({
      kind: "honourChanged",
      delta: -10,
      honourAfter: 0,
      reason: "guardSortie",
    });
  });

  it("refuses a caller with fewer than ten Honour without touching the field", () => {
    const units = defaultUnits().map((unit) =>
      unit.id === CALLER_ID ? { ...unit, judgePoints: 9 } : unit,
    );
    const state = makeBattle(units);
    const result = run(state, oldGuard());

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("insufficient-honour");
    expect(result.events).toEqual([]);
    expect(result.honourSpent).toBe(0);
    expect(result.state).toBe(state);
    expect(findUnit(result.state, CALLER_ID)?.judgePoints).toBe(9);
  });
});

/* --------------------------------------------------------------------------
 * Whole-field reach
 * ------------------------------------------------------------------------ */

describe("executeGuardSortie — hits the whole field", () => {
  it("damages every enemy and no ally, however far away", () => {
    const state = makeBattle();
    const result = run(state, oldGuard());

    expect(result.targets).toEqual([ENEMY_A_ID, ENEMY_B_ID]);
    expect(damageTo(result.events, ENEMY_A_ID)).toBeGreaterThan(0);
    expect(damageTo(result.events, ENEMY_B_ID)).toBeGreaterThan(0);
    expect(damageTo(result.events, ALLY_ID)).toBe(0);
    expect(findUnit(result.state, ENEMY_A_ID)!.hp).toBeLessThan(ENEMY_STATS.hp);
    expect(findUnit(result.state, ENEMY_B_ID)!.hp).toBeLessThan(ENEMY_STATS.hp);
  });

  it("cannot be evaded (no misses on an open field)", () => {
    const state = makeBattle();
    const result = run(state, oldGuard());
    expect(result.events.some((event) => event.kind === "missed")).toBe(false);
  });

  it("refuses to call when no enemy is on the field", () => {
    const units = defaultUnits().filter((unit) => unit.side !== "enemy");
    const state = makeBattle(units);
    const result = run(state, oldGuard());

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("no-target");
    expect(result.events).toEqual([]);
    expect(findUnit(result.state, CALLER_ID)?.judgePoints).toBe(10);
  });

  it("makes one strike per authored pass", () => {
    const single = run(makeBattle(), oldGuard());
    const multi = run(makeBattle(), guardSortieSpec(GUARD_SORTIES["kaisers-bombardiers"]));

    const singleHits = single.events.filter((event) => event.kind === "damaged").length;
    const multiHits = multi.events.filter((event) => event.kind === "damaged").length;

    // Two enemies: one pass → 2 hits; three passes → 6 hits.
    expect(singleHits).toBe(2);
    expect(multiHits).toBe(6);
    expect(totalDamage(multi.events)).toBeGreaterThan(totalDamage(single.events));
  });

  it("drains Élan from every enemy into the caller (Heavy Brigade)", () => {
    const state = makeBattle();
    const result = run(state, guardSortieSpec(GUARD_SORTIES["heavy-brigade"]));

    expect(result.ok).toBe(true);
    // Each enemy holds 10 Élan and loses 4; the caller banks both draughts.
    expect(findUnit(result.state, ENEMY_A_ID)!.mp).toBe(6);
    expect(findUnit(result.state, ENEMY_B_ID)!.mp).toBe(6);
    expect(findUnit(result.state, CALLER_ID)!.mp).toBe(48);
  });
});

/* --------------------------------------------------------------------------
 * Targeting, purity and determinism
 * ------------------------------------------------------------------------ */

describe("executeGuardSortie — contracts", () => {
  it("rejects a malformed pass count", () => {
    const state = makeBattle();
    const spec: GuardSortieSpec = { ...oldGuard(), hits: 0 };
    expect(() => run(state, spec)).toThrow(RangeError);
  });

  it("never mutates the input state or unit", () => {
    const state = makeBattle();
    const before = JSON.stringify(state);
    run(state, oldGuard());
    expect(JSON.stringify(state)).toBe(before);
  });

  it("is deterministic for the same seed and inputs", () => {
    const state = makeBattle();
    const first = run(state, oldGuard(), UNLOCK_ALL, "guard-seed");
    const second = run(state, oldGuard(), UNLOCK_ALL, "guard-seed");

    expect(second.events).toEqual(first.events);
    expect(second.state.units).toEqual(first.state.units);
    expect(second.targets).toEqual(first.targets);
  });

  it("emits only well-formed battle events", () => {
    const state = makeBattle();
    const result = run(state, oldGuard());
    expect(result.events.every(isBattleEvent)).toBe(true);
    expect(result.events.map((event) => event.kind)).toContain("guardSortieCalled");
  });
});
