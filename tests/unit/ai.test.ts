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
import {
  ELAN_ROUTED_PENALTY,
  ELAN_SHAKEN_PENALTY,
  classifyAbility,
  consumableScarcity,
  effectiveHeal,
  elanBudget,
  elanCostPenalty,
  evaluateAbility,
  healNeed,
  healUrgencyBonus,
  projectedMorale,
} from "../../src/ai/heuristics";
import { ARTICLES } from "../../src/data/articles";
import { AI_PROFILES } from "../../src/data/enemies/profiles";
import type { StatBlock } from "../../src/data/schema";
import { createBattleOrders } from "../../src/engine/actions/orders";
import type { ActionSpec } from "../../src/engine/actions/resolve";
import { createBattle, step, type BattleState } from "../../src/engine/battle";
import { coord, type Coord } from "../../src/engine/grid";
import { asAbilityId, asConditionId, asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import { commission } from "../../src/engine/rules/articles";
import { createTerrainMap } from "../../src/engine/terrain";
import { createUnit, type Unit, type UnitInit } from "../../src/engine/unit";
import { forecastAbility } from "../../src/ui/battleForecast";

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

/* --------------------------------------------------------------------------
 * T097 — Ability/item heuristics
 *
 * Support actions need their own judgement: a bandage is worth more on a dying
 * soldier than on a healthy one; a buff the ally already carries is redundant;
 * a one-shot item is kit to be rationed; and spending the last Élan can break
 * a soldier's nerve. These tests pin that reasoning both through the pure
 * heuristics and through `chooseTurn`.
 * ------------------------------------------------------------------------ */

const HEAL: UtilityAbilitySpec = {
  id: asAbilityId("surgical-dressing"),
  mpCost: 0,
  chargeTime: 0,
  range: 3,
  power: 80,
  target: "ally",
  effects: [{ kind: "heal", power: 80 }],
};

const HEAL_ITEM: UtilityAbilitySpec = {
  ...HEAL,
  id: asAbilityId("field-dressing-kit"),
  consumable: true,
  charges: 1,
};

const BUFF: UtilityAbilitySpec = {
  id: asAbilityId("form-square"),
  mpCost: 0,
  chargeTime: 0,
  range: 3,
  power: 0,
  target: "ally",
  effects: [{ kind: "condition", conditionId: asConditionId("protect") }],
};

const REVIVE: UtilityAbilitySpec = {
  id: asAbilityId("revive-casualty"),
  mpCost: 0,
  chargeTime: 0,
  range: 2,
  power: 70,
  target: "ally",
  effects: [{ kind: "revive", power: 70 }],
};

const CLEANSE: UtilityAbilitySpec = {
  id: asAbilityId("cleanse-ailment"),
  mpCost: 0,
  chargeTime: 0,
  range: 3,
  power: 0,
  target: "ally",
  effects: [{ kind: "cleanse", conditionId: asConditionId("poison") }],
};

const DEBUFF: UtilityAbilitySpec = {
  id: asAbilityId("delay-the-enemy"),
  mpCost: 0,
  chargeTime: 0,
  range: 5,
  power: 0,
  target: "enemy",
  effects: [{ kind: "condition", conditionId: asConditionId("slow") }],
};

const STRIKE: UtilityAbilitySpec = {
  id: asAbilityId("free-shot"),
  mpCost: 0,
  chargeTime: 0,
  range: 5,
  power: 100,
  effects: [{ kind: "steel", power: 100 }],
};

const COSTLY_STRIKE: UtilityAbilitySpec = {
  ...STRIKE,
  id: asAbilityId("costly-shot"),
  mpCost: 5,
};

/** A battle whose catalogue is the given support orders. */
function supportBattle(
  units: readonly Unit[],
  abilities: readonly UtilityAbilitySpec[],
): BattleState {
  return createBattle(1815, { map: MAP, units, abilities });
}

/**
 * The rich action catalogue to hand the AI: `createBattle` stores only the
 * minimal `ActionSpec`, so target rules and effects are supplied to the
 * planner through {@link UtilityOptions.abilities} (exactly as authored
 * content will).
 */
function supportOptions(
  ...specs: readonly UtilityAbilitySpec[]
): { abilities: Record<string, UtilityAbilitySpec> } {
  const abilities: Record<string, UtilityAbilitySpec> = {};
  for (const spec of specs) abilities[spec.id] = spec;
  return { abilities };
}

const PROTECT_CONDITION = {
  conditionId: asConditionId("protect"),
  duration: 10,
} as const;

describe("classifyAbility (T097)", () => {
  it("recognises the role an order plays", () => {
    expect(classifyAbility(STRIKE).role).toBe("damage");
    expect(classifyAbility(HEAL).role).toBe("heal");
    expect(classifyAbility(REVIVE).role).toBe("revive");
    expect(classifyAbility(BUFF).role).toBe("buff");
    expect(classifyAbility(DEBUFF).role).toBe("debuff");
    expect(classifyAbility(CLEANSE).role).toBe("cleanse");
  });

  it("collects conditions and elements from effects", () => {
    const classification = classifyAbility({
      ...BUFF,
      element: "holy",
      effects: [{ kind: "condition", conditionId: asConditionId("regen") }],
    });
    expect(classification.inflicts).toEqual(["regen"]);
    expect(classification.elements).toEqual(["holy"]);
  });

  it("marks a spent consumable unusable", () => {
    const stocked = classifyAbility(HEAL_ITEM);
    expect(stocked.isConsumable).toBe(true);
    expect(stocked.charges).toBe(1);
    expect(stocked.usable).toBe(true);

    const spent = classifyAbility({ ...HEAL_ITEM, charges: 0 });
    expect(spent.charges).toBe(0);
    expect(spent.usable).toBe(false);
  });

  it("rations scarcer consumables more heavily", () => {
    expect(consumableScarcity(1)).toBeGreaterThan(consumableScarcity(3));
    expect(consumableScarcity(null)).toBe(0);
  });
});

describe("healNeed & effectiveHeal (T097)", () => {
  it("raises urgency as a soldier weakens and caps the restore", () => {
    const healthy = makeUnit(WEAK_ID, coord(0, 0), "company", ENEMY_STATS);
    const hurt = makeUnit(WEAK_ID, coord(0, 0), "company", ENEMY_STATS, { hp: 7 });

    expect(healNeed(healthy).urgency).toBe(0);
    expect(healNeed(hurt).urgency).toBeGreaterThan(50);
    expect(healNeed(hurt).urgency).toBeGreaterThan(healNeed(healthy).urgency);

    expect(effectiveHeal(hurt, 100)).toBe(43); // 50 max − 7 current
    expect(effectiveHeal(healthy, 100)).toBe(0);
    expect(healUrgencyBonus(hurt, 20)).toBeGreaterThan(healUrgencyBonus(healthy, 20));
  });
});

describe("Élan management (T097)", () => {
  it("reports the safe Élan budget above the Shaken threshold", () => {
    const unit = makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS, { mp: 15 });
    // ACTOR_STATS has 20 max Élan; the Shaken threshold is 10.
    expect(elanBudget(unit)).toBe(5);
  });

  it("penalises spending that crosses into Shaken or Routed", () => {
    const steady = makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS, { mp: 11 });

    expect(elanCostPenalty(steady, 0)).toBe(0);
    expect(projectedMorale(steady, 1)).toBe("shaken");
    expect(elanCostPenalty(steady, 1)).toBe(1 + ELAN_SHAKEN_PENALTY);

    expect(projectedMorale(steady, 11)).toBe("routed");
    expect(elanCostPenalty(steady, 11)).toBe(11 + ELAN_ROUTED_PENALTY);
  });

  it("does not double-penalise an already-shaken soldier", () => {
    const shaken = makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS, { mp: 5 });
    expect(projectedMorale(shaken, 2)).toBe("shaken");
    expect(elanCostPenalty(shaken, 2)).toBe(2); // thrift cost only
  });
});

describe("chooseTurn — support heuristics (T097)", () => {
  it("heals the soldier who needs it most", () => {
    const battle = supportBattle(
      [
        makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS),
        makeUnit(WEAK_ID, coord(0, 1), "company", ENEMY_STATS, { hp: 7 }),
        makeUnit(TOUGH_ID, coord(1, 0), "company", ENEMY_STATS),
      ],
      [HEAL],
    );

    const plan = chooseTurn(battle, ACTOR_ID, supportOptions(HEAL));
    expect(plan.abilityId).toBe(HEAL.id);
    expect(plan.target).toEqual({ kind: "unit", unitId: WEAK_ID });
    expect(plan.score.healing).toBeGreaterThan(0);
    expect(plan.score.healUrgency).toBeGreaterThan(0);
  });

  it("places a fresh buff on an ally", () => {
    const battle = supportBattle(
      [
        makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS, {
          conditions: [PROTECT_CONDITION],
        }),
        makeUnit(WEAK_ID, coord(0, 1), "company", ENEMY_STATS),
      ],
      [BUFF],
    );

    const plan = chooseTurn(battle, ACTOR_ID, supportOptions(BUFF));
    expect(plan.abilityId).toBe(BUFF.id);
    expect(plan.target).toEqual({ kind: "unit", unitId: WEAK_ID });
    expect(plan.score.buffValue).toBeGreaterThan(0);
    expect(plan.score.redundantBuffs).toBe(0);
  });

  it("scores a buff as redundant when the ally already carries it", () => {
    const actor = makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS);
    const ally = makeUnit(WEAK_ID, coord(0, 1), "company", ENEMY_STATS, {
      conditions: [PROTECT_CONDITION],
    });
    const battle = supportBattle([actor, ally], [BUFF]);

    const forecast = forecastAbility(battle, actor, BUFF, { kind: "unit", unitId: WEAK_ID });
    const evaluation = evaluateAbility(battle, BUFF, forecast);
    expect(evaluation.role).toBe("buff");
    expect(evaluation.buffValue).toBe(0);
    expect(evaluation.redundantBuffs).toBe(1);
  });

  it("prefers a renewable heal to an equal one-shot item", () => {
    const battle = supportBattle(
      [
        makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS),
        makeUnit(WEAK_ID, coord(0, 1), "company", ENEMY_STATS, { hp: 7 }),
      ],
      [HEAL, HEAL_ITEM],
    );

    const plan = chooseTurn(battle, ACTOR_ID, supportOptions(HEAL, HEAL_ITEM));
    expect(plan.abilityId).toBe(HEAL.id);
    expect(plan.score.consumablePenalty).toBe(0);
  });

  it("spends a consumable when it is the only way to treat a wound", () => {
    const battle = supportBattle(
      [
        makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS),
        makeUnit(WEAK_ID, coord(0, 1), "company", ENEMY_STATS, { hp: 7 }),
      ],
      [HEAL_ITEM],
    );

    const plan = chooseTurn(battle, ACTOR_ID, supportOptions(HEAL_ITEM));
    expect(plan.abilityId).toBe(HEAL_ITEM.id);
    expect(plan.score.consumablePenalty).toBe(consumableScarcity(1));
  });

  it("never orders an out-of-stock consumable", () => {
    const spent: UtilityAbilitySpec = { ...HEAL_ITEM, charges: 0 };
    const battle = supportBattle(
      [
        makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS),
        makeUnit(WEAK_ID, coord(0, 1), "company", ENEMY_STATS, { hp: 7 }),
      ],
      [spent],
    );

    const plan = chooseTurn(battle, ACTOR_ID, supportOptions(spent));
    expect(plan.abilityId).toBeNull();
    expect(plan.commands.some((command) => command.kind === "act")).toBe(false);
  });

  it("avoids an Élan spend that would break the soldier's nerve", () => {
    const battle = supportBattle(
      [
        makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS, { mp: 5 }),
        makeUnit(WEAK_ID, coord(0, 1), "enemy", ENEMY_STATS),
      ],
      [STRIKE, COSTLY_STRIKE],
    );

    const plan = chooseTurn(battle, ACTOR_ID, supportOptions(STRIKE, COSTLY_STRIKE));
    expect(plan.abilityId).toBe(STRIKE.id);
    expect(plan.score.elanPenalty).toBe(0);
  });
});
