import { describe, expect, it } from "vitest";

import {
  AiError,
  DEFAULT_UTILITY_WEIGHTS,
  articleBreaches,
  articleSubjectForCandidate,
  chooseCommand,
  chooseTurn,
  exposureAt,
  targetThreat,
  weightsFromProfile,
  type UtilityAbilitySpec,
} from "../../src/ai/utility";
import { ARTICLES } from "../../src/data/articles";
import { AI_PROFILES } from "../../src/data/enemies/profiles";
import type { StatBlock } from "../../src/data/schema";
import { createBattleOrders } from "../../src/engine/actions/orders";
import type { ActionSpec } from "../../src/engine/actions/resolve";
import { createBattle, step, type BattleState } from "../../src/engine/battle";
import { coord, type Coord } from "../../src/engine/grid";
import { asAbilityId, asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import { commission } from "../../src/engine/rules/articles";
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

/* --------------------------------------------------------------------------
 * T096 — Article-aware AI
 *
 * The AI reads the day's Articles of War and refuses to plan a breach unless
 * the soldier holds a Commission (the Colours). The tests pin the done-when
 * directly: an uncommissioned soldier avoids a forbidden act, while a
 * commissioned one may still take it.
 * ------------------------------------------------------------------------ */

/** A high-power charge forbidden by `no-bayonet` (action target). */
const BAYONET_CHARGE: UtilityAbilitySpec = {
  id: asAbilityId("bayonet-charge"),
  mpCost: 0,
  chargeTime: 0,
  range: 1,
  power: 300,
  effects: [{ kind: "steel", power: 300 }],
};

/** The legal fallback: a weaker, longer-ranged musket shot. */
const MUSKET_SPEC: UtilityAbilitySpec = {
  id: MUSKET.id,
  mpCost: 0,
  chargeTime: 0,
  range: 5,
  power: 100,
  effects: [{ kind: "steel", power: 100 }],
};

/** A fire-typed strike, forbidden by `no-fire` (element target). */
const FIRE_STRIKE: UtilityAbilitySpec = {
  id: asAbilityId("fire-strike"),
  mpCost: 0,
  chargeTime: 0,
  range: 1,
  power: 150,
  effects: [{ kind: "steel", power: 150, element: "fire" }],
};

/** The legal, cold-typed counterpart. */
const ICE_STRIKE: UtilityAbilitySpec = {
  id: asAbilityId("ice-strike"),
  mpCost: 0,
  chargeTime: 0,
  range: 1,
  power: 100,
  effects: [{ kind: "steel", power: 100, element: "ice" }],
};

/** A rifle attack, forbidden by `no-rifle` (weapon target). */
const RIFLE_SHOT: UtilityAbilitySpec = {
  id: asAbilityId("rifle-shot"),
  mpCost: 0,
  chargeTime: 0,
  range: 5,
  power: 150,
  weaponType: "rifle",
  effects: [{ kind: "steel", power: 150 }],
};

/** The legal, musket-armed counterpart. */
const MUSKET_SHOT: UtilityAbilitySpec = {
  id: asAbilityId("musket-shot"),
  mpCost: 0,
  chargeTime: 0,
  range: 5,
  power: 100,
  weaponType: "musket",
  effects: [{ kind: "steel", power: 100 }],
};

const ABILITIES = {
  [BAYONET_CHARGE.id]: BAYONET_CHARGE,
  [MUSKET_SPEC.id]: MUSKET_SPEC,
  [FIRE_STRIKE.id]: FIRE_STRIKE,
  [ICE_STRIKE.id]: ICE_STRIKE,
  [RIFLE_SHOT.id]: RIFLE_SHOT,
  [MUSKET_SHOT.id]: MUSKET_SHOT,
} as const;

/** A battle whose catalogue carries the given abilities (default: all). */
function articleBattle(
  units: readonly Unit[],
  abilities: readonly UtilityAbilitySpec[] = Object.values(ABILITIES),
): BattleState {
  return makeBattle(units, abilities);
}

const OPTIONS = { abilities: ABILITIES } as const;

const BAYONET_OPTIONS = {
  abilities: { [BAYONET_CHARGE.id]: BAYONET_CHARGE, [MUSKET_SPEC.id]: MUSKET_SPEC },
} as const;

const FIRE_OPTIONS = {
  abilities: { [FIRE_STRIKE.id]: FIRE_STRIKE, [ICE_STRIKE.id]: ICE_STRIKE },
} as const;

const WEAPON_OPTIONS = {
  abilities: { [RIFLE_SHOT.id]: RIFLE_SHOT, [MUSKET_SHOT.id]: MUSKET_SHOT },
} as const;

/** An adjacent enemy, so every melee strike is in reach. */
function adjacentBattle(actorPost = "fusilier"): BattleState {
  return articleBattle(
    [
      makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS, { postId: asPostId(actorPost) }),
      makeUnit(WEAK_ID, coord(0, 1), "enemy", ENEMY_STATS),
    ],
    [BAYONET_CHARGE, MUSKET_SPEC],
  );
}

describe("chooseTurn — Articles of War", () => {
  it("picks the weaker legal order over a forbidden one", () => {
    const battle = adjacentBattle();
    const orders = createBattleOrders([ARTICLES["no-bayonet"]]);

    // Sanity: without a posting the forbidden charge is the better stroke.
    expect(chooseTurn(battle, ACTOR_ID, BAYONET_OPTIONS).abilityId).toBe(BAYONET_CHARGE.id);

    const plan = chooseTurn(battle, ACTOR_ID, { ...BAYONET_OPTIONS, orders });
    expect(plan.abilityId).toBe(MUSKET_SPEC.id);
    expect(plan.score.unlawful).toBe(false);
    expect(plan.breaches).toEqual([]);
  });

  it("lets a commissioned soldier break the Article", () => {
    const battle = adjacentBattle();
    const orders = createBattleOrders([ARTICLES["no-bayonet"]]);

    const plan = chooseTurn(battle, ACTOR_ID, {
      ...BAYONET_OPTIONS,
      orders,
      commissions: [commission(ACTOR_ID)],
    });
    expect(plan.abilityId).toBe(BAYONET_CHARGE.id);
    // The breach is reported for the trace even though it was permitted.
    expect(plan.score.unlawful).toBe(true);
    expect(plan.breaches).toEqual([ARTICLES["no-bayonet"].id]);
  });

  it("ignores a lawless field's posting (no Provost, no breach)", () => {
    const battle = adjacentBattle();
    const orders = createBattleOrders([ARTICLES["no-bayonet"]], { lawless: true });

    expect(chooseTurn(battle, ACTOR_ID, { ...BAYONET_OPTIONS, orders }).abilityId).toBe(
      BAYONET_CHARGE.id,
    );
  });

  it("avoids an element it is forbidden to use", () => {
    const battle = articleBattle(
      [
        makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS),
        makeUnit(WEAK_ID, coord(0, 1), "enemy", ENEMY_STATS),
      ],
      [FIRE_STRIKE, ICE_STRIKE],
    );
    const orders = createBattleOrders([ARTICLES["no-fire"]]);

    expect(chooseTurn(battle, ACTOR_ID, FIRE_OPTIONS).abilityId).toBe(FIRE_STRIKE.id);
    expect(chooseTurn(battle, ACTOR_ID, { ...FIRE_OPTIONS, orders }).abilityId).toBe(ICE_STRIKE.id);
  });

  it("avoids a forbidden weapon family", () => {
    const battle = articleBattle(
      [
        makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS),
        makeUnit(WEAK_ID, coord(0, 1), "enemy", ENEMY_STATS),
      ],
      [RIFLE_SHOT, MUSKET_SHOT],
    );
    const orders = createBattleOrders([ARTICLES["no-rifle"]]);

    expect(chooseTurn(battle, ACTOR_ID, WEAPON_OPTIONS).abilityId).toBe(RIFLE_SHOT.id);
    expect(chooseTurn(battle, ACTOR_ID, { ...WEAPON_OPTIONS, orders }).abilityId).toBe(
      MUSKET_SHOT.id,
    );
  });

  it("will not act when every order is forbidden by post", () => {
    // `no-forager` forbids any action taken by a forager, so the only available
    // order is off the table; the soldier may still reposition but never act.
    const battle = articleBattle([
      makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS, { postId: asPostId("forager") }),
      makeUnit(WEAK_ID, coord(0, 1), "enemy", ENEMY_STATS),
    ]);
    const orders = createBattleOrders([ARTICLES["no-forager"]]);

    const plan = chooseTurn(battle, ACTOR_ID, { ...OPTIONS, orders });
    expect(plan.abilityId).toBeNull();
    expect(plan.intent).not.toBe("act");
    expect(plan.commands.some((command) => command.kind === "act")).toBe(false);
    expect(plan.breaches).toEqual([]);
  });

  it("refuses to march under a no-withdrawal order", () => {
    // The enemy is six tiles away, so every plan needs a march; the order bans
    // movement outright and the soldier braces in place.
    const battle = articleBattle([
      makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS),
      makeUnit(FAR_ID, coord(0, 6), "enemy", ENEMY_STATS),
    ]);
    const orders = createBattleOrders([ARTICLES["no-withdrawal"]]);

    const plan = chooseTurn(battle, ACTOR_ID, { ...OPTIONS, orders });
    expect(plan.commands.some((command) => command.kind === "move")).toBe(false);
    expect(plan.destination).toEqual(coord(0, 0));
    expect(plan.intent).toBe("hold");
    expect(plan.breaches).toEqual([]);
  });

  it("still marches under no-withdrawal when commissioned", () => {
    const battle = articleBattle([
      makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS),
      makeUnit(FAR_ID, coord(0, 6), "enemy", ENEMY_STATS),
    ]);
    const orders = createBattleOrders([ARTICLES["no-withdrawal"]]);

    const plan = chooseTurn(battle, ACTOR_ID, {
      ...OPTIONS,
      orders,
      commissions: [commission(ACTOR_ID)],
    });
    expect(plan.moveCost).toBeGreaterThan(0);
    expect(plan.score.unlawful).toBe(true);
  });

  it("is law-agnostic when no posting is supplied", () => {
    const battle = adjacentBattle();
    expect(chooseTurn(battle, ACTOR_ID, BAYONET_OPTIONS).abilityId).toBe(BAYONET_CHARGE.id);
  });
});

describe("articleSubjectForCandidate", () => {
  it("exposes the actor's post, weapon and element only when it acts", () => {
    const actor = makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS, {
      postId: asPostId("forager"),
    });

    // A hold exposes no facts at all; a march exposes only the `move` fact, so
    // an idle soldier is never judged as if it had taken an action.
    expect(articleSubjectForCandidate(actor, null, false)).toEqual({});
    expect(articleSubjectForCandidate(actor, null, true)).toEqual({ moved: true });

    const subject = articleSubjectForCandidate(actor, RIFLE_SHOT, false);
    expect(subject.actionId).toBe(RIFLE_SHOT.id);
    expect(subject.postId).toBe("forager");
    expect(subject.weaponTypes).toEqual(["rifle"]);
  });

  it("reports the forbidding Articles a subject breaks", () => {
    const orders = createBattleOrders([ARTICLES["no-rifle"]]);
    const actor = makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS);

    const broken = articleBreaches(orders, articleSubjectForCandidate(actor, RIFLE_SHOT, false));
    expect(broken.map((match) => match.article.id)).toEqual([ARTICLES["no-rifle"].id]);
    expect(articleBreaches(orders, articleSubjectForCandidate(actor, MUSKET_SHOT, false))).toEqual(
      [],
    );
    expect(articleBreaches(orders, articleSubjectForCandidate(actor, null, true))).toEqual([]);
  });
});
