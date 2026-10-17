import { describe, expect, it } from "vitest";

import {
  AiError,
  DEFAULT_UTILITY_WEIGHTS,
  chooseCommand,
  chooseTurn,
  exposureAt,
  targetThreat,
  weightsFromProfile,
} from "../../src/ai/utility";
import { AI_PROFILES } from "../../src/data/enemies/profiles";
import type { StatBlock } from "../../src/data/schema";
import type { ActionSpec } from "../../src/engine/actions/resolve";
import { createBattle, step, type BattleState } from "../../src/engine/battle";
import { coord, type Coord } from "../../src/engine/grid";
import { asAbilityId, asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import { createTerrainMap } from "../../src/engine/terrain";
import { createUnit, type Unit, type UnitInit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T095 — Utility-based AI
 *
 * Pins the behaviour the Phase 9 AI depends on: targets are scored by expected
 * damage, kill potential, threat and positioning; the winner is returned as
 * ordinary, replayable commands; and the engine would accept every order the AI
 * issues. The scoring primitives are deterministic and never mutate the battle
 * (`agents.md` §2, §7).
 * ------------------------------------------------------------------------ */

const ACTOR_ID = asUnitId("unit-actor");
const WEAK_ID = asUnitId("unit-weak");
const TOUGH_ID = asUnitId("unit-tough");
const FAR_ID = asUnitId("unit-far");
const GUARD_ID = asUnitId("unit-guard");

const ACTOR_STATS: StatBlock = {
  hp: 60,
  mp: 20,
  atk: 20,
  def: 8,
  mag: 5,
  res: 8,
  spd: 30,
  move: 4,
  jump: 2,
};

const ENEMY_STATS: StatBlock = {
  hp: 50,
  mp: 4,
  atk: 10,
  def: 10,
  mag: 5,
  res: 10,
  spd: 10,
  move: 4,
  jump: 2,
};

const MAP = createTerrainMap(8, 8, "field");

const MUSKET: ActionSpec = {
  id: asAbilityId("musket-fire"),
  mpCost: 0,
  chargeTime: 0,
  range: 5,
  power: 100,
};

const BAYONET: ActionSpec = {
  id: asAbilityId("bayonet"),
  mpCost: 0,
  chargeTime: 0,
  range: 1,
  power: 120,
};

const CANISTER: ActionSpec = {
  id: asAbilityId("canister"),
  mpCost: 0,
  chargeTime: 0,
  range: 1,
  power: 200,
};

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

function makeBattle(
  units: readonly Unit[],
  abilities: readonly ActionSpec[] = [MUSKET, BAYONET],
): BattleState {
  return createBattle(1815, { map: MAP, units, abilities });
}

/* --------------------------------------------------------------------------
 * Threat & exposure
 * ------------------------------------------------------------------------ */

describe("targetThreat", () => {
  it("scores a standing soldier by its offensive stats", () => {
    const unit = makeUnit(WEAK_ID, coord(0, 0), "enemy", ENEMY_STATS);
    expect(targetThreat(unit)).toBe(15); // atk 10 + mag 5
  });

  it("treats a soldier out of action as no threat", () => {
    const down = makeUnit(WEAK_ID, coord(0, 0), "enemy", ENEMY_STATS, { hp: 0 });
    expect(targetThreat(down)).toBe(0);
  });
});

describe("exposureAt", () => {
  it("measures the return fire a covered tile invites", () => {
    const battle = makeBattle([
      makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS),
      makeUnit(GUARD_ID, coord(0, 1), "enemy", ENEMY_STATS),
    ]);
    const actor = battle.units[0];

    // (0,2) is adjacent to the enemy's canister; (6,6) is out of every reach.
    expect(
      exposureAt(battle, actor, coord(0, 2), { abilities: { canister: CANISTER } }),
    ).toBeGreaterThan(0);
    expect(exposureAt(battle, actor, coord(6, 6), { abilities: { canister: CANISTER } })).toBe(0);
  });

  it("never counts the soldier as its own threat", () => {
    const battle = makeBattle([makeUnit(GUARD_ID, coord(0, 1), "enemy", ENEMY_STATS)]);
    const enemy = battle.units[0];
    // The only soldier on the field is the one being asked about, and it does
    // not threaten itself.
    expect(exposureAt(battle, enemy, coord(0, 1), { abilities: { canister: CANISTER } })).toBe(0);
  });
});

/* --------------------------------------------------------------------------
 * Target selection
 * ------------------------------------------------------------------------ */

describe("chooseTurn — target selection", () => {
  it("prefers the finishing stroke over a fresh wound", () => {
    const battle = makeBattle([
      makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS),
      makeUnit(WEAK_ID, coord(2, 0), "enemy", ENEMY_STATS, { hp: 10 }),
      makeUnit(TOUGH_ID, coord(2, 2), "enemy", ENEMY_STATS, { hp: 50 }),
    ]);

    const plan = chooseTurn(battle, ACTOR_ID);
    expect(plan.target).not.toBeNull();
    expect(plan.target?.kind).toBe("unit");
    if (plan.target?.kind === "unit") {
      expect(plan.target.unitId).toBe(WEAK_ID);
    }
    expect(plan.score.killThreat).toBeGreaterThan(0);
  });
});

/* --------------------------------------------------------------------------
 * Movement
 * ------------------------------------------------------------------------ */

describe("chooseTurn — movement", () => {
  it("marches into range before it fires", () => {
    const battle = makeBattle([
      makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS),
      makeUnit(FAR_ID, coord(0, 6), "enemy", ENEMY_STATS),
    ]);

    const plan = chooseTurn(battle, ACTOR_ID);
    expect(plan.abilityId).toBe(MUSKET.id);
    expect(plan.commands).toHaveLength(2);
    expect(plan.commands[0]?.kind).toBe("move");
    expect(plan.commands[1]?.kind).toBe("act");
    expect(plan.moveCost).toBeGreaterThan(0);
  });

  it("advances toward the enemy when it has no shot", () => {
    const battle = makeBattle([
      makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS),
      makeUnit(FAR_ID, coord(0, 6), "enemy", ENEMY_STATS),
    ]);

    const plan = chooseTurn(battle, ACTOR_ID, {
      weights: { damage: 0, kill: 0, threat: 0, healing: 0, brace: 0 },
      abilities: { bayonet: BAYONET },
    });
    // With only the point-blank bayonet, the AI must close the distance.
    expect(plan.intent).toBe("advance");
    expect(plan.destination).not.toEqual(coord(0, 0));
    expect(plan.commands[0]?.kind).toBe("move");
  });

  it("never marches twice in one turn", () => {
    const battle = makeBattle([
      makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS),
      makeUnit(FAR_ID, coord(0, 6), "enemy", ENEMY_STATS),
    ]);
    const moved = step(battle, {
      kind: "move",
      unitId: ACTOR_ID,
      path: [coord(0, 0), coord(1, 0)],
    });
    expect(moved.rejection).toBeUndefined();

    const plan = chooseTurn(moved.state, ACTOR_ID);
    expect(plan.commands.every((command) => command.kind !== "move")).toBe(true);
  });
});

/* --------------------------------------------------------------------------
 * Affordability & legality
 * ------------------------------------------------------------------------ */

describe("chooseTurn — only legal commands", () => {
  it("issues orders the engine accepts", () => {
    const battle = makeBattle([
      makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS),
      makeUnit(WEAK_ID, coord(2, 0), "enemy", ENEMY_STATS, { hp: 10 }),
    ]);

    const command = chooseCommand(battle, ACTOR_ID);
    const result = step(battle, command);
    expect(result.rejection).toBeUndefined();
  });

  it("replays a whole plan through step without a rejection", () => {
    const battle = makeBattle([
      makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS),
      makeUnit(FAR_ID, coord(0, 6), "enemy", ENEMY_STATS),
    ]);

    let working = battle;
    for (const command of chooseTurn(battle, ACTOR_ID).commands) {
      const result = step(working, command);
      expect(result.rejection).toBeUndefined();
      working = result.state;
    }
  });

  it("will not spend Élan it does not have", () => {
    const expensive: ActionSpec = { ...MUSKET, mpCost: 10 };
    const battle = makeBattle(
      [
        makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS, { mp: 0 }),
        makeUnit(WEAK_ID, coord(2, 0), "enemy", ENEMY_STATS),
      ],
      [expensive],
    );

    const plan = chooseTurn(battle, ACTOR_ID);
    expect(plan.abilityId).toBeNull();
    expect(plan.commands.some((command) => command.kind === "act")).toBe(false);
  });

  it("throws when the soldier is not deployed", () => {
    const battle = makeBattle([makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS)]);
    expect(() => chooseTurn(battle, asUnitId("ghost"))).toThrow(AiError);
  });
});

/* --------------------------------------------------------------------------
 * Purity & determinism
 * ------------------------------------------------------------------------ */

describe("chooseTurn — purity", () => {
  it("never mutates the battle and is deterministic", () => {
    const battle = makeBattle([
      makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS),
      makeUnit(WEAK_ID, coord(2, 0), "enemy", ENEMY_STATS, { hp: 10 }),
      makeUnit(TOUGH_ID, coord(3, 3), "enemy", ENEMY_STATS),
    ]);

    const before = JSON.stringify(battle);
    const first = chooseTurn(battle, ACTOR_ID);
    const second = chooseTurn(battle, ACTOR_ID);

    expect(second).toEqual(first);
    expect(JSON.stringify(battle)).toBe(before);
  });
});

/* --------------------------------------------------------------------------
 * Profile weights
 * ------------------------------------------------------------------------ */

describe("weightsFromProfile", () => {
  it("values kills and exposure differently by temperament", () => {
    const aggressive = weightsFromProfile(AI_PROFILES.aggressive);
    const defensive = weightsFromProfile(AI_PROFILES.defensive);

    expect(aggressive.kill).toBeGreaterThanOrEqual(DEFAULT_UTILITY_WEIGHTS.kill);
    expect(defensive.moveCost).toBe(4); // `holdGround`
    expect(aggressive.exposure).toBeLessThan(defensive.exposure);
  });

  it("raises the flank weight for cavalry", () => {
    const cavalry = weightsFromProfile(AI_PROFILES.cavalry);
    expect(cavalry.flank).toBeGreaterThan(DEFAULT_UTILITY_WEIGHTS.flank);
  });
});
