import { describe, expect, it } from "vitest";

import type { StatBlock } from "../../src/data/schema";
import { WEAPON_FAMILIES } from "../../src/data/weapons";
import {
  executeAbility,
  type AbilityExecutionOptions,
  type AbilitySpec,
  type ConditionEffect,
  type SteelEffect,
} from "../../src/engine/actions/ability";
import {
  declareOrResolveAction,
  resolveCompletedCharges,
} from "../../src/engine/actions/resolve";
import { createBattle, findUnit, step, type BattleState } from "../../src/engine/battle";
import { isBattleEvent, type BattleEvent } from "../../src/engine/events";
import { coord, type Coord } from "../../src/engine/grid";
import { asAbilityId, asConditionId, asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import {
  DEFAULT_REACTION_ABILITIES,
  REACTION_IDS,
  incomingTrigger,
  resolveReactionDefense,
  resolveReactionResponses,
} from "../../src/engine/reactions";
import { Rng } from "../../src/engine/rng";
import {
  ADJUTANTS_ORDERS,
  applyCondition,
  canMove,
  hasActiveCondition,
  removeConditionsOnHit,
  tickConditions,
} from "../../src/engine/rules/conditions";
import { computeSteelDamage } from "../../src/engine/rules/damage";
import type { ElementAffinityMap } from "../../src/engine/rules/elements";
import { FALL_DAMAGE_PER_LEVEL, resolveShove } from "../../src/engine/rules/shove";
import {
  CONSTITUTION_RESISTS,
  applyDamageTaken,
  applyElementAffinity,
  makeTraitContext,
  resistsCondition,
  withTraits,
  type TraitOptions,
} from "../../src/engine/traits";
import { createTerrainMap, withTile } from "../../src/engine/terrain";
import { createUnit, withHp, type Unit, type UnitInit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T045 — Combat tests
 *
 * The cross-module **integration** suite for the combat slice. The individual
 * modules already have focused unit tests (T033–T044); this file pins that they
 * compose into a real exchange: a declared action resolves through the T041
 * executor, elements (T038) and conditions (T039) modify the result, traits
 * (T043) sharpen or blunt the numbers, reactions (T042) answer the blow, and a
 * shove (T044) can drive a soldier off the field. It also pins the two engine
 * contracts the whole combat slice rests on — no mutation and byte-identical
 * replays (`agents.md` §2, §7).
 *
 * Roster numbers are chosen so every expectation is a small integer the tests
 * can state exactly; where a hit could miss, `evasionOf: () => 0` guarantees it
 * lands.
 * ------------------------------------------------------------------------ */

const ACTOR_ID = asUnitId("unit-actor");
const ALLY_ID = asUnitId("unit-ally");
const FOE_ID = asUnitId("unit-foe");
const FOE2_ID = asUnitId("unit-foe2");
const REACTOR_ID = asUnitId("unit-reactor");

/** Steel attacker: atk 20, mag 30. */
const ACTOR_STATS: StatBlock = {
  hp: 60,
  mp: 20,
  atk: 20,
  def: 8,
  mag: 30,
  res: 10,
  spd: 20,
  move: 4,
  jump: 2,
};

/** Hostile picket: def 10, res 10. */
const FOE_STATS: StatBlock = {
  hp: 60,
  mp: 20,
  atk: 20,
  def: 10,
  mag: 20,
  res: 10,
  spd: 20,
  move: 4,
  jump: 2,
};

/** Support soldier: a medicine carrier, not a fighter. */
const ALLY_STATS: StatBlock = {
  hp: 60,
  mp: 20,
  atk: 10,
  def: 8,
  mag: 30,
  res: 10,
  spd: 15,
  move: 4,
  jump: 2,
};

const MAP = createTerrainMap(8, 6, "field");

/** A guaranteed-hit execution: zero evasion so the to-hit roll always lands. */
const SURE_HIT: AbilityExecutionOptions = { evasionOf: () => 0 };

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

function makeBattle(units: readonly Unit[], map = MAP): BattleState {
  return createBattle(1815, { map, units });
}

/** The default roster: a company section and two hostile pickets. */
function defaultUnits(): Unit[] {
  return [
    makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
    makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS),
    makeUnit(FOE_ID, coord(3, 1), "enemy", FOE_STATS),
    makeUnit(FOE2_ID, coord(3, 2), "enemy", FOE_STATS),
  ];
}

function actorOf(state: BattleState): Unit {
  const actor = findUnit(state, ACTOR_ID);
  if (actor === undefined) throw new Error("actor missing");
  return actor;
}

/** A trusted ability spec; tests override only what they exercise. */
function ability(overrides: Partial<AbilitySpec> = {}): AbilitySpec {
  return {
    id: asAbilityId("test-action"),
    mpCost: 0,
    chargeTime: 0,
    range: 5,
    power: 100,
    target: "enemy",
    hitRate: 100,
    effects: [],
    ...overrides,
  };
}

function steel(power: number, extra: Partial<SteelEffect> = {}): SteelEffect {
  return { kind: "steel", power, ...extra };
}

function condition(conditionId: string): ConditionEffect {
  return { kind: "condition", conditionId: asConditionId(conditionId) };
}

function unitTarget(unitId: UnitId): { kind: "unit"; unitId: UnitId } {
  return { kind: "unit", unitId };
}

/** Run an ability through the executor with a fresh seeded RNG. */
function runStrike(
  state: BattleState,
  spec: AbilitySpec,
  target: { kind: "unit"; unitId: UnitId },
  options: AbilityExecutionOptions = SURE_HIT,
  seed: string | number = "t045",
): ReturnType<typeof executeAbility> {
  return executeAbility(state, actorOf(state), spec, target, new Rng(seed), options);
}

/** Find a seed whose first to-hit draw falls inside `[min, max)`. */
function seedWithFirstRoll(min: number, max: number): string {
  for (let i = 0; i < 100_000; i++) {
    const seed = `combat-roll-${i}`;
    const roll = new Rng(seed).nextInt(100);
    if (roll >= min && roll < max) return seed;
  }
  throw new Error("no seed found in range");
}

/** Find a seed whose first draw dodges (or does not dodge). */
function seedForDodge(success: boolean): string {
  for (let i = 0; i < 100_000; i++) {
    const seed = `combat-dodge-${i}`;
    const roll = new Rng(seed).nextInt(100);
    if (success ? roll < 50 : roll >= 50) return seed;
  }
  throw new Error("no dodge seed found");
}

/** An enemy picket with a condition already active. */
function foeWith(conditionId: string): Unit {
  return applyCondition(makeUnit(FOE_ID, coord(3, 1), "enemy", FOE_STATS), conditionId).unit;
}

/* ==========================================================================
 * Damage tiers
 * ======================================================================== */

describe("combat — damage tiers", () => {
  it("baseline: a Steel strike lands WeaponAtk − Def/2", () => {
    const state = makeBattle(defaultUnits());
    const result = runStrike(state, ability({ effects: [steel(100)] }), unitTarget(FOE_ID));

    // atk 20, foe def 10 → base 15, ×100/100 = 15.
    expect(result.events.find((event) => event.kind === "damaged")).toMatchObject({
      unitId: FOE_ID,
      amount: 15,
      damageType: "steel",
    });
    expect(findUnit(result.state, FOE_ID)?.hp).toBe(45);
  });

  it("artillery: a Powder blast lands MagicPower − Res/2", () => {
    const state = makeBattle(defaultUnits());
    const result = runStrike(
      state,
      ability({ effects: [{ kind: "powder", power: 100 }] }),
      unitTarget(FOE_ID),
    );

    // mag 30, foe res 10 → base 25.
    expect(result.events.find((event) => event.kind === "damaged")).toMatchObject({
      amount: 25,
      damageType: "powder",
    });
    expect(findUnit(result.state, FOE_ID)?.hp).toBe(35);
  });

  it("weapon tier: a rifle strike uses its own family recipe", () => {
    const state = makeBattle(defaultUnits());
    const result = runStrike(
      state,
      ability({
        effects: [
          {
            kind: "weapon",
            power: 50,
            weaponPower: 5,
            formula: WEAPON_FAMILIES.rifle.formula,
          },
        ],
      }),
      unitTarget(FOE_ID),
    );

    // rifle: floor((20 + 20)/2) × 5 = 100; base 100 − 5 = 95; ×50/100 = 47.
    expect(result.events.find((event) => event.kind === "damaged")).toMatchObject({
      amount: 47,
      damageType: "steel",
    });
  });

  it("support tier: Medicine restores the wounded", () => {
    const units = [
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS, { hp: 20 }),
      makeUnit(FOE_ID, coord(3, 1), "enemy", FOE_STATS),
      makeUnit(FOE2_ID, coord(3, 2), "enemy", FOE_STATS),
    ];
    const state = makeBattle(units);
    const result = runStrike(
      state,
      ability({ target: "ally", effects: [{ kind: "heal", power: 40 }] }),
      unitTarget(ALLY_ID),
    );

    // 10 + floor(30 × 40 / 100) = 22.
    expect(result.events.find((event) => event.kind === "healed")).toMatchObject({
      unitId: ALLY_ID,
      amount: 22,
      hpAfter: 42,
    });
  });

  it("a fatal strike knocks the target out of action", () => {
    const units = [
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS),
      makeUnit(FOE_ID, coord(3, 1), "enemy", FOE_STATS, { hp: 10 }),
      makeUnit(FOE2_ID, coord(3, 2), "enemy", FOE_STATS),
    ];
    const state = makeBattle(units);
    const result = runStrike(state, ability({ effects: [steel(100)] }), unitTarget(FOE_ID));

    expect(result.events.map((event) => event.kind)).toEqual(["damaged", "outOfAction"]);
    expect(findUnit(result.state, FOE_ID)?.hp).toBe(0);
  });

  it("Formed raises the defender's Steel tier (def +20)", () => {
    const units = [
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS),
      foeWith("protect"),
      makeUnit(FOE2_ID, coord(3, 2), "enemy", FOE_STATS),
    ];
    const state = makeBattle(units);
    const result = runStrike(state, ability({ effects: [steel(100)] }), unitTarget(FOE_ID));

    // def 10 + 20 = 30 → base 20 − 15 = 5.
    expect(result.events.find((event) => event.kind === "damaged")).toMatchObject({ amount: 5 });
  });

  it("Braced raises the defender's Powder tier (res +20)", () => {
    const units = [
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS),
      foeWith("shell"),
      makeUnit(FOE2_ID, coord(3, 2), "enemy", FOE_STATS),
    ];
    const state = makeBattle(units);
    const result = runStrike(
      state,
      ability({ effects: [{ kind: "powder", power: 100 }] }),
      unitTarget(FOE_ID),
    );

    // res 10 + 20 = 30 → base 30 − 15 = 15.
    expect(result.events.find((event) => event.kind === "damaged")).toMatchObject({ amount: 15 });
  });

  it("Rallied raises the attacker's Steel tier (atk +20)", () => {
    const actor = applyCondition(
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      "boost",
    ).unit;
    const state = makeBattle([
      actor,
      makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS),
      makeUnit(FOE_ID, coord(3, 1), "enemy", FOE_STATS),
      makeUnit(FOE2_ID, coord(3, 2), "enemy", FOE_STATS),
    ]);
    const result = runStrike(state, ability({ effects: [steel(100)] }), unitTarget(FOE_ID));

    // atk 20 + 20 = 40 → base 40 − 5 = 35.
    expect(result.events.find((event) => event.kind === "damaged")).toMatchObject({ amount: 35 });
  });
});

/* ==========================================================================
 * Element interactions
 * ======================================================================== */

describe("combat — element interactions", () => {
  const affinities = (affinity: ElementAffinityMap): AbilityExecutionOptions => ({
    evasionOf: () => 0,
    affinitiesOf: () => affinity,
  });

  function elementalStrike(state: BattleState, affinity: ElementAffinityMap) {
    return runStrike(
      state,
      ability({ effects: [steel(100, { element: "fire" })] }),
      unitTarget(FOE_ID),
      affinities(affinity),
    );
  }

  it("a weakness doubles the blow", () => {
    const result = elementalStrike(makeBattle(defaultUnits()), { fire: "weak" });
    // raw 15 → 30.
    expect(result.events.find((event) => event.kind === "damaged")).toMatchObject({
      amount: 30,
      element: "fire",
    });
  });

  it("a resistance halves it", () => {
    const result = elementalStrike(makeBattle(defaultUnits()), { fire: "resist" });
    // raw 15 → floor(15/2) = 7.
    expect(result.events.find((event) => event.kind === "damaged")).toMatchObject({ amount: 7 });
  });

  it("immunity nullifies it", () => {
    const state = makeBattle(defaultUnits());
    const result = elementalStrike(state, { fire: "immune" });

    expect(result.events.some((event) => event.kind === "damaged")).toBe(false);
    expect(findUnit(result.state, FOE_ID)?.hp).toBe(60);
  });

  it("absorb turns it into medicine", () => {
    const units = [
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS),
      makeUnit(FOE_ID, coord(3, 1), "enemy", FOE_STATS, { hp: 20 }),
      makeUnit(FOE2_ID, coord(3, 2), "enemy", FOE_STATS),
    ];
    const result = elementalStrike(makeBattle(units), { fire: "absorb" });

    expect(result.events.find((event) => event.kind === "healed")).toMatchObject({
      unitId: FOE_ID,
      amount: 15,
      hpAfter: 35,
    });
  });

  it("Elemental Knowledge downgrades a resistance before the blow lands", () => {
    const state = makeBattle(defaultUnits());
    const attacker = actorOf(state);
    const ctx = makeTraitContext({
      unit: attacker,
      role: "attacker",
      channel: "steel",
      element: "fire",
    });
    const downgraded = applyElementAffinity("resist", "fire", ctx, {
      loadout: { [ACTOR_ID]: "elementalKnowledge" },
    });
    expect(downgraded).toBe("weak");
    const downgradedMap: ElementAffinityMap = downgraded === "neutral" ? {} : { fire: downgraded };

    const result = runStrike(
      state,
      ability({ effects: [steel(100, { element: "fire" })] }),
      unitTarget(FOE_ID),
      affinities(downgradedMap),
    );
    expect(result.events.find((event) => event.kind === "damaged")).toMatchObject({ amount: 30 });
  });
});

/* ==========================================================================
 * Condition lifecycle
 * ======================================================================== */

describe("combat — condition lifecycle", () => {
  it("an on-hit condition is applied, ticks and expires", () => {
    const state = makeBattle(defaultUnits());
    const result = runStrike(
      state,
      ability({
        effects: [steel(100, { inflicts: [asConditionId("poison")], conditionDuration: 2 })],
      }),
      unitTarget(FOE_ID),
    );

    const bleeding = findUnit(result.state, FOE_ID)!;
    expect(hasActiveCondition(bleeding, "poison")).toBe(true);
    expect(result.events.some((event) => event.kind === "conditionApplied")).toBe(true);

    // Bleeding deals 12 a tick; after two ticks the finite span expires.
    const first = tickConditions(bleeding, 1);
    expect(first.unit.hp).toBe(33);
    const second = tickConditions(first.unit, 2);
    expect(second.unit.hp).toBe(21);
    expect(hasActiveCondition(second.unit, "poison")).toBe(false);
    expect(
      second.events.some(
        (event) => event.kind === "conditionRemoved" && event.reason === "expired",
      ),
    ).toBe(true);
  });

  it("Pinned forbids movement until it wears off", () => {
    const state = makeBattle(defaultUnits());
    const result = runStrike(
      state,
      ability({ effects: [condition("immobilize")] }),
      unitTarget(FOE_ID),
    );
    let pinned = findUnit(result.state, FOE_ID)!;

    expect(canMove(pinned)).toBe(false);
    for (let tick = 1; tick <= 10; tick += 1) pinned = tickConditions(pinned, tick).unit;
    expect(canMove(pinned)).toBe(true);
    expect(hasActiveCondition(pinned, "immobilize")).toBe(false);
  });

  it("Steadied restores hit points each tick", () => {
    const units = [
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS, { hp: 30 }),
      makeUnit(FOE_ID, coord(3, 1), "enemy", FOE_STATS),
      makeUnit(FOE2_ID, coord(3, 2), "enemy", FOE_STATS),
    ];
    const state = makeBattle(units);
    const result = runStrike(
      state,
      ability({ target: "ally", effects: [condition("regen")] }),
      unitTarget(ALLY_ID),
    );

    const ticked = tickConditions(findUnit(result.state, ALLY_ID)!, 1);
    expect(ticked.unit.hp).toBe(42);
    expect(ticked.events.find((event) => event.kind === "healed")).toMatchObject({ amount: 12 });
  });

  it("Mortally Wounded counts down to a knockout", () => {
    const state = makeBattle(defaultUnits());
    const result = runStrike(state, ability({ effects: [condition("doom")] }), unitTarget(FOE_ID));
    let doomed = findUnit(result.state, FOE_ID)!;

    // Duration 3: two ticks survive, the third knocks out.
    doomed = tickConditions(doomed, 1).unit;
    doomed = tickConditions(doomed, 2).unit;
    expect(doomed.hp).toBe(60);

    const fatal = tickConditions(doomed, 3);
    expect(fatal.unit.hp).toBe(0);
    expect(fatal.events.some((event) => event.kind === "outOfAction")).toBe(true);
    expect(hasActiveCondition(fatal.unit, "doom")).toBe(false);
  });

  it("Adjutant's Orders absorbs one hostile condition", () => {
    const shielded = makeUnit(FOE_ID, coord(3, 1), "enemy", FOE_STATS, {
      conditions: [{ conditionId: ADJUTANTS_ORDERS, duration: 0 }],
    });
    const state = makeBattle([
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS),
      shielded,
      makeUnit(FOE2_ID, coord(3, 2), "enemy", FOE_STATS),
    ]);

    const result = runStrike(
      state,
      ability({ effects: [condition("poison")] }),
      unitTarget(FOE_ID),
    );
    const foe = findUnit(result.state, FOE_ID)!;

    expect(hasActiveCondition(foe, "poison")).toBe(false);
    expect(hasActiveCondition(foe, ADJUTANTS_ORDERS)).toBe(false);
    expect(
      result.events.some(
        (event) => event.kind === "conditionRemoved" && event.conditionId === ADJUTANTS_ORDERS,
      ),
    ).toBe(true);
  });

  it("a waking hit removes Unconscious but leaves other conditions", () => {
    const unit = applyCondition(
      applyCondition(makeUnit(FOE_ID, coord(3, 1), "enemy", FOE_STATS), "sleep").unit,
      "protect",
    ).unit;

    const woken = removeConditionsOnHit(unit, 4);
    expect(hasActiveCondition(woken.unit, "sleep")).toBe(false);
    expect(hasActiveCondition(woken.unit, "protect")).toBe(true);
    expect(woken.removed).toEqual(["sleep"]);
  });

  it("Dazed spoils the aim and turns a hit into a miss", () => {
    const clean = makeBattle(defaultUnits());
    const dazedState = (() => {
      const units = defaultUnits();
      units[0] = applyCondition(units[0], "blind").unit;
      return makeBattle(units);
    })();

    // Side (+15) accuracy: 115 → clamped 100 without Dazed; 85 with it, so a
    // high roll misses.
    const seed = seedWithFirstRoll(85, 100);
    const hit = runStrike(
      clean,
      ability({ effects: [steel(100)] }),
      unitTarget(FOE_ID),
      SURE_HIT,
      seed,
    );
    const dazed = runStrike(
      dazedState,
      ability({ effects: [steel(100)] }),
      unitTarget(FOE_ID),
      SURE_HIT,
      seed,
    );

    expect(hit.events[0]?.kind).toBe("damaged");
    expect(dazed.events[0]?.kind).toBe("missed");
  });
});

/* ==========================================================================
 * Reactions
 * ======================================================================== */

describe("combat — reactions", () => {
  /** A clash with the reactor within reach of the attacker. */
  function duel(reactorAt: Coord, reactorOverrides: Partial<UnitInit> = {}): BattleState {
    return makeBattle([
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(REACTOR_ID, reactorAt, "enemy", FOE_STATS, reactorOverrides),
    ]);
  }

  function provoke(
    state: BattleState,
    channel: "steel" | "powder" = "steel",
  ): {
    state: BattleState;
    events: readonly ReturnType<typeof executeAbility>["events"][number][];
  } {
    const spec =
      channel === "steel"
        ? ability({ effects: [steel(100)] })
        : ability({ id: asAbilityId("test-shell"), effects: [{ kind: "powder", power: 100 }] });
    const result = executeAbility(
      state,
      actorOf(state),
      spec,
      unitTarget(REACTOR_ID),
      new Rng("provoke"),
      SURE_HIT,
    );
    expect(result.ok).toBe(true);
    return { state: result.state, events: [...result.events] };
  }

  it("Riposte answers a Steel blow through the executor", () => {
    const duelState = duel(coord(2, 1));
    const provoked = provoke(duelState);
    const result = resolveReactionResponses(provoked.state, provoked.events, new Rng("riposte"), {
      loadout: { [REACTOR_ID]: "riposte" },
      execution: SURE_HIT,
    });

    expect(result.triggered).toEqual([REACTION_IDS.riposte]);
    const counter = result.events.find((event) => event.kind === "damaged");
    // reactor atk 20 − actor def 8 → 16; ×50/100 = 8.
    expect(counter).toMatchObject({ unitId: ACTOR_ID, sourceId: REACTOR_ID, amount: 8 });
    expect(findUnit(result.state, ACTOR_ID)?.hp).toBe(52);
  });

  it("Return Fire answers Powder in kind", () => {
    const duelState = duel(coord(4, 1));
    const provoked = provoke(duelState, "powder");
    const result = resolveReactionResponses(
      provoked.state,
      provoked.events,
      new Rng("return-fire"),
      { loadout: { [REACTOR_ID]: "returnFire" }, execution: SURE_HIT },
    );

    expect(result.triggered).toEqual([REACTION_IDS.returnFire]);
    const counter = result.events.find((event) => event.kind === "damaged");
    // reactor mag 20 − actor res 10 → base 15; ×100/100 = 15.
    expect(counter).toMatchObject({
      unitId: ACTOR_ID,
      sourceId: REACTOR_ID,
      amount: 15,
      damageType: "powder",
    });
  });

  it("Field Dressing bandages a badly wounded soldier", () => {
    const duelState = duel(coord(2, 1), { hp: 30 });
    const provoked = provoke(duelState);
    const result = resolveReactionResponses(
      provoked.state,
      provoked.events,
      new Rng("field-dressing"),
      { loadout: { [REACTOR_ID]: "fieldDressing" }, execution: SURE_HIT },
    );

    expect(result.triggered).toEqual([REACTION_IDS.fieldDressing]);
    // 30 − 15 = 15; medicine 10 + floor(20 × 100 / 100) = 30 → 45.
    const heal = result.events.find((event) => event.kind === "healed");
    expect(heal).toMatchObject({ unitId: REACTOR_ID, sourceId: REACTOR_ID, amount: 30 });
    expect(findUnit(result.state, REACTOR_ID)?.hp).toBe(45);
  });

  it("Dodge negates an incoming strike before it lands", () => {
    const duelState = duel(coord(2, 1));
    const incoming = incomingTrigger(
      duelState,
      ACTOR_ID,
      REACTOR_ID,
      ability({ effects: [steel(100)] }),
    );
    expect(incoming).toBeDefined();

    const negated = resolveReactionDefense(duelState, incoming!, new Rng(seedForDodge(true)), {
      loadout: { [REACTOR_ID]: "dodge" },
    });
    expect(negated.negated).toBe(true);
    expect(negated.state).toBe(duelState);
    expect(negated.events[0]).toMatchObject({
      kind: "reactionTriggered",
      unitId: REACTOR_ID,
      abilityId: REACTION_IDS.dodge,
    });

    const allowed = resolveReactionDefense(duelState, incoming!, new Rng(seedForDodge(false)), {
      loadout: { [REACTOR_ID]: "dodge" },
    });
    expect(allowed.negated).toBe(false);
  });

  it("Cold Steel sharpens a Riposte as it would any action", () => {
    const duelState = duel(coord(2, 1));
    const provoked = provoke(duelState);
    const reactor = findUnit(provoked.state, REACTOR_ID)!;
    const enhanced = withTraits(DEFAULT_REACTION_ABILITIES.riposte, reactor, {
      loadout: { [REACTOR_ID]: "coldSteel" },
    });

    const result = resolveReactionResponses(
      provoked.state,
      provoked.events,
      new Rng("reaction-trait"),
      {
        loadout: { [REACTOR_ID]: "riposte" },
        abilities: { riposte: enhanced },
        execution: SURE_HIT,
      },
    );

    // Cold Steel lifts the counter's Power 50 → 62: base 16 × 62/100 = 9.
    const counter = result.events.find((event) => event.kind === "damaged");
    expect(counter).toMatchObject({ amount: 9 });
  });
});

/* ==========================================================================
 * Support traits
 * ======================================================================== */

describe("combat — support traits", () => {
  it("Cold Steel raises Steel damage end to end", () => {
    const state = makeBattle(defaultUnits());
    const spec = withTraits(ability({ effects: [steel(100)] }), actorOf(state), {
      loadout: { [ACTOR_ID]: "coldSteel" },
    });

    const result = runStrike(state, spec, unitTarget(FOE_ID));
    // Power 100 → 125: base 15 × 125/100 = 18.
    expect(result.events.find((event) => event.kind === "damaged")).toMatchObject({ amount: 18 });
  });

  it("Two-Handed Grip raises Steel power when the offhand is free", () => {
    const state = makeBattle(defaultUnits());
    const spec = withTraits(ability({ effects: [steel(100)] }), actorOf(state), {
      loadout: { [ACTOR_ID]: "twoHandedGrip" },
    });

    const result = runStrike(state, spec, unitTarget(FOE_ID));
    // Power 100 → 150: base 15 × 150/100 = 22.
    expect(result.events.find((event) => event.kind === "damaged")).toMatchObject({ amount: 22 });
  });

  it("Powder Discipline raises Powder damage", () => {
    const state = makeBattle(defaultUnits());
    const spec = withTraits(
      ability({ effects: [{ kind: "powder", power: 100 }] }),
      actorOf(state),
      { loadout: { [ACTOR_ID]: "powderDiscipline" } },
    );

    const result = runStrike(state, spec, unitTarget(FOE_ID));
    // base 25, Power 125 → floor(3125/100) = 31.
    expect(result.events.find((event) => event.kind === "damaged")).toMatchObject({ amount: 31 });
  });

  it("Steady Aim turns a miss into a hit", () => {
    const build = (): BattleState => {
      const reactor = makeUnit(REACTOR_ID, coord(2, 1), "enemy", FOE_STATS, { facing: "west" });
      return makeBattle([makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS), reactor], MAP);
    };

    // Frontal (west-facing defender), evasion 0: base accuracy 40, Steady Aim 60.
    const seed = seedWithFirstRoll(40, 60);
    const baseState = build();
    const base = runStrike(
      baseState,
      ability({ hitRate: 40, effects: [steel(100)] }),
      unitTarget(REACTOR_ID),
      SURE_HIT,
      seed,
    );
    const aimedState = build();
    const aimed = runStrike(
      aimedState,
      withTraits(ability({ hitRate: 40, effects: [steel(100)] }), actorOf(aimedState), {
        loadout: { [ACTOR_ID]: "steadyAim" },
      }),
      unitTarget(REACTOR_ID),
      SURE_HIT,
      seed,
    );

    expect(base.events[0]?.kind).toBe("missed");
    expect(aimed.events[0]?.kind).toBe("damaged");
  });

  it("Drilled Guards reduces incoming Steel at the defender's seam", () => {
    const defender = makeUnit(FOE_ID, coord(3, 1), "enemy", FOE_STATS);
    const raw = computeSteelDamage({ weaponAtk: 20, targetWeaponDef: 10, power: 100 });
    expect(raw).toBe(15);

    const taken = applyDamageTaken(
      raw,
      makeTraitContext({ unit: defender, role: "defender", channel: "steel" }),
      { loadout: { [FOE_ID]: "drilledGuards" } },
    );
    // 25% of 15 (3) is taken off.
    expect(taken).toBe(12);
    expect(withHp(defender, defender.hp - taken).hp).toBe(48);
  });

  it("Constitution shrugs off the listed ailments but not every condition", () => {
    const defender = makeUnit(FOE_ID, coord(3, 1), "enemy", FOE_STATS);
    const ctx = makeTraitContext({ unit: defender, role: "defender" });
    const options: TraitOptions = { loadout: { [FOE_ID]: "constitution" } };

    for (const id of CONSTITUTION_RESISTS) {
      expect(resistsCondition(id, ctx, options)).toBe(true);
    }
    expect(resistsCondition(asConditionId("pinned"), ctx, options)).toBe(false);
    // Without the trait nothing is resisted.
    expect(resistsCondition(CONSTITUTION_RESISTS[0], ctx)).toBe(false);
  });
});

/* ==========================================================================
 * Battlefield displacement (Shove)
 * ======================================================================== */

describe("combat — battlefield displacement (Shove)", () => {
  it("a shove off a ledge deals fall damage inside a battle", () => {
    // A height-5 ledge at (2,2), the field at (3,2): a 5-level drop, Climb 2.
    let map = createTerrainMap(8, 6, "field");
    map = withTile(map, coord(2, 2), { terrain: "hill", height: 5 });
    const target = makeUnit(FOE_ID, coord(2, 2), "enemy", FOE_STATS);
    const state = makeBattle(
      [makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS), target],
      map,
    );

    const result = resolveShove(
      { map: state.map, units: state.units, tick: state.tempo.tick },
      { unitId: FOE_ID, direction: "east", distance: 1, allowFall: true },
    );

    const foe = result.units.find((unit) => unit.id === FOE_ID)!;
    expect(foe.at).toEqual(coord(3, 2));
    // 3 levels fallen (5 − Climb 2) × 5 damage = 15.
    expect(foe.hp).toBe(60 - 3 * FALL_DAMAGE_PER_LEVEL);
    expect(
      result.events.some((event) => event.kind === "damaged" && event.damageType === "none"),
    ).toBe(true);
    expect(result.events.every(isBattleEvent)).toBe(true);
  });
});

/* ==========================================================================
 * Ability effects through `step` (T117)
 *
 * The live pipeline wires the executor (T041), reactions (T042) and support
 * traits (T043) into `step`, so a committed `act` now reduces HP and can KO.
 * Roster speeds are set low (actor 1, target 0) so evasion is zero and every
 * roll lands without hunting for a seed.
 * ======================================================================== */

describe("combat — ability effects through step", () => {
  const STEP_ABILITY = asAbilityId("test-step-action");

  /** A hostile Steel action the executor can resolve through `step`. */
  function stepAbility(overrides: Partial<AbilitySpec> = {}): AbilitySpec {
    return ability({
      id: STEP_ABILITY,
      power: 100,
      target: "enemy",
      effects: [steel(100)],
      ...overrides,
    });
  }

  /**
   * A two-soldier clash with the actor at Speed 1 (evasion 0) and the target at
   * Speed 0, plus the action catalogue under test.
   */
  function pipelineBattle(
    actorOverrides: Partial<UnitInit> = {},
    foeOverrides: Partial<UnitInit> = {},
    abilitySpec: AbilitySpec = stepAbility(),
    foeAt: Coord = coord(3, 1),
  ): BattleState {
    const actor = makeUnit(
      ACTOR_ID,
      coord(1, 1),
      "company",
      { ...ACTOR_STATS, spd: 1 },
      actorOverrides,
    );
    const foe = makeUnit(FOE_ID, foeAt, "enemy", { ...FOE_STATS, spd: 0 }, foeOverrides);
    return createBattle("t117", { map: MAP, units: [actor, foe], abilities: [abilitySpec] });
  }

  function actAt(state: BattleState, targetId: UnitId = FOE_ID): ReturnType<typeof step> {
    return step(state, {
      kind: "act",
      unitId: state.currentActorId as UnitId,
      abilityId: STEP_ABILITY,
      target: { kind: "unit", unitId: targetId },
    });
  }

  it("lands an instant action's damage through the live `act`", () => {
    const result = actAt(pipelineBattle());

    expect(result.rejection).toBeUndefined();
    // atk 20, foe def 10 → base 15, ×100/100.
    expect(result.events.find((event) => event.kind === "damaged")).toMatchObject({
      unitId: FOE_ID,
      amount: 15,
      damageType: "steel",
    });
    expect(findUnit(result.state, FOE_ID)?.hp).toBe(45);
  });

  it("knocks a soldier out of action when the blow is fatal", () => {
    const result = actAt(pipelineBattle({}, { hp: 10 }));

    expect(result.events.map((event) => event.kind)).toContain("outOfAction");
    expect(findUnit(result.state, FOE_ID)?.hp).toBe(0);
  });

  it("applies the actor's support traits before the formula", () => {
    const battle = pipelineBattle({
      abilities: [{ abilityId: asAbilityId("cold-steel"), drill: 0, mastered: true }],
    });
    const result = actAt(battle);

    // Cold Steel: Power 100 → 125, base 15 × 125/100 = 18.
    expect(result.events.find((event) => event.kind === "damaged")).toMatchObject({ amount: 18 });
    expect(findUnit(result.state, FOE_ID)?.hp).toBe(42);
  });

  it("fires a mastered reaction off the damage it takes", () => {
    const battle = pipelineBattle(
      {},
      { abilities: [{ abilityId: asAbilityId("riposte"), drill: 0, mastered: true }] },
      stepAbility(),
      coord(2, 1),
    );
    const result = actAt(battle);

    expect(result.events.map((event) => event.kind)).toContain("reactionTriggered");
    // Foe Riposte answers the actor; both have evasion 0, so the counter lands.
    expect(findUnit(result.state, ACTOR_ID)?.hp).toBeLessThan(ACTOR_STATS.hp);
  });

  it("lands a charged action's effect when its timer elapses", () => {
    const result = actAt(pipelineBattle({}, {}, stepAbility({ chargeTime: 1 })));
    const kinds = result.events.map((event) => event.kind);

    expect(kinds).toContain("chargeResolved");
    expect(kinds).toContain("abilityResolved");
    expect(kinds).toContain("damaged");
    expect(findUnit(result.state, FOE_ID)?.hp).toBe(45);
  });

  it("does not mutate the state it is stepped from", () => {
    const state = pipelineBattle();
    const before = JSON.stringify(state);

    actAt(state);

    expect(JSON.stringify(state)).toBe(before);
  });
});

/* ==========================================================================
 * Tile-anchored charges (T125)
 *
 * Peer lesson L4: a charged action resolves against the **tile recorded when it
 * was declared**, not the named soldier's current position. A target that
 * marches off the tile therefore dodges the effect; an empty tile whiffs without
 * error. The out-of-action caster cancellation already present is kept and
 * pinned here too.
 * ======================================================================== */

describe("combat — tile-anchored charges (T125)", () => {
  const CHARGE_ABILITY = asAbilityId("test-tile-charge");

  /** A hostile Steel action with a real wind-up. */
  function chargeAbility(overrides: Partial<AbilitySpec> = {}): AbilitySpec {
    return ability({
      id: CHARGE_ABILITY,
      chargeTime: 3,
      effects: [steel(100)],
      ...overrides,
    });
  }

  /** The actor plus two hostiles, so a tile can change hands mid-charge. */
  function chargeBattle(spec: AbilitySpec = chargeAbility()): BattleState {
    return createBattle("t125", {
      map: MAP,
      units: [
        makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
        makeUnit(FOE_ID, coord(3, 1), "enemy", FOE_STATS),
        makeUnit(FOE2_ID, coord(3, 2), "enemy", FOE_STATS),
      ],
      abilities: [spec],
    });
  }

  /** Declare a charged unit action and return the state plus its charge id. */
  function declareAt(
    state: BattleState,
    spec: AbilitySpec,
    target: UnitId,
  ): { state: BattleState; chargeId: string } {
    const actor = findUnit(state, ACTOR_ID);
    if (actor === undefined) throw new Error("actor missing");
    const declared = declareOrResolveAction(state, actor, spec, unitTarget(target), []);
    const pending = declared.pendingActions[0];
    if (pending === undefined) throw new Error("expected a charging action");
    return { state: declared, chargeId: pending.chargeId };
  }

  /** Move a soldier without touching the Orders Tempo clock (test scaffold). */
  function placeUnit(state: BattleState, unitId: UnitId, at: Coord): BattleState {
    return {
      ...state,
      units: state.units.map((unit) => (unit.id === unitId ? { ...unit, at } : unit)),
    };
  }

  /** Mature the charge directly, returning the state and resolution events. */
  function resolveCharge(
    state: BattleState,
    chargeId: string,
  ): { state: BattleState; events: BattleEvent[] } {
    const events: BattleEvent[] = [];
    const after = resolveCompletedCharges(state, [{ chargeId, unitId: ACTOR_ID }], events);
    return { state: after, events };
  }

  it("lands on a target that holds its tile until the charge matures", () => {
    const spec = chargeAbility();
    const { state, chargeId } = declareAt(chargeBattle(spec), spec, FOE_ID);

    const result = resolveCharge(state, chargeId);

    expect(result.events.map((event) => event.kind)).toEqual([
      "chargeResolved",
      "abilityResolved",
      "damaged",
    ]);
    // atk 20, foe def 10 → 15.
    expect(findUnit(result.state, FOE_ID)?.hp).toBe(FOE_STATS.hp - 15);
  });

  it("whiffs when the named soldier marches off the recorded tile", () => {
    const spec = chargeAbility();
    const { state, chargeId } = declareAt(chargeBattle(spec), spec, FOE_ID);
    const moved = placeUnit(state, FOE_ID, coord(6, 4));

    const result = resolveCharge(moved, chargeId);

    // The declaration still matures; only its effect is lost.
    expect(result.events.map((event) => event.kind)).toEqual([
      "chargeResolved",
      "abilityResolved",
    ]);
    expect(findUnit(result.state, FOE_ID)?.hp).toBe(FOE_STATS.hp);
  });

  it("catches whoever stands on the recorded tile instead of homing", () => {
    const spec = chargeAbility();
    const { state, chargeId } = declareAt(chargeBattle(spec), spec, FOE_ID);
    // The named target leaves; a second hostile steps onto the recorded tile.
    const swapped = placeUnit(placeUnit(state, FOE_ID, coord(6, 4)), FOE2_ID, coord(3, 1));

    const result = resolveCharge(swapped, chargeId);

    expect(findUnit(result.state, FOE2_ID)?.hp).toBe(FOE_STATS.hp - 15);
    expect(findUnit(result.state, FOE_ID)?.hp).toBe(FOE_STATS.hp);
  });

  it("whiffs without error when the recorded tile holds no living unit", () => {
    const spec = chargeAbility();
    const { state, chargeId } = declareAt(chargeBattle(spec), spec, FOE_ID);
    const cleared = placeUnit(state, FOE_ID, coord(6, 4));

    expect(() => resolveCharge(cleared, chargeId)).not.toThrow();

    const result = resolveCharge(cleared, chargeId);
    expect(result.events.some((event) => event.kind === "damaged")).toBe(false);
    expect(findUnit(result.state, FOE_ID)?.hp).toBe(FOE_STATS.hp);
  });

  it("cancels the effect when the caster is out of action at maturity", () => {
    const spec = chargeAbility();
    const { state, chargeId } = declareAt(chargeBattle(spec), spec, FOE_ID);
    const wounded: BattleState = {
      ...state,
      units: state.units.map((unit) => (unit.id === ACTOR_ID ? { ...unit, hp: 0 } : unit)),
    };

    const result = resolveCharge(wounded, chargeId);

    expect(result.events.map((event) => event.kind)).toEqual([
      "chargeResolved",
      "abilityResolved",
    ]);
    expect(findUnit(result.state, FOE_ID)?.hp).toBe(FOE_STATS.hp);
  });
});

/* ==========================================================================
 * Purity & determinism
 * ======================================================================== */

describe("combat — purity & determinism", () => {
  it("a full exchange does not mutate the input state", () => {
    const state = makeBattle([
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(REACTOR_ID, coord(2, 1), "enemy", FOE_STATS),
    ]);
    const before = JSON.stringify(state);

    const spec = ability({
      effects: [steel(100, { element: "fire", inflicts: [asConditionId("poison")] })],
    });
    const result = executeAbility(
      state,
      actorOf(state),
      spec,
      unitTarget(REACTOR_ID),
      new Rng("purity"),
      { evasionOf: () => 0, affinitiesOf: () => ({ fire: "weak" }) },
    );
    resolveReactionResponses(result.state, result.events, new Rng("purity-reaction"), {
      loadout: { [REACTOR_ID]: "riposte" },
      execution: SURE_HIT,
    });

    expect(JSON.stringify(state)).toBe(before);
  });

  it("a full exchange produces byte-identical events for the same seed", () => {
    const play = (): string => {
      const state = makeBattle([
        makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
        makeUnit(REACTOR_ID, coord(2, 1), "enemy", FOE_STATS),
      ]);
      const spec = withTraits(
        ability({
          effects: [
            steel(100, {
              element: "fire",
              inflicts: [asConditionId("poison")],
              conditionDuration: 3,
            }),
          ],
        }),
        actorOf(state),
        { loadout: { [ACTOR_ID]: "coldSteel" } },
      );
      const strike = executeAbility(
        state,
        actorOf(state),
        spec,
        unitTarget(REACTOR_ID),
        new Rng("exchange"),
        { evasionOf: () => 0, affinitiesOf: () => ({ fire: "weak" }) },
      );
      const answers = resolveReactionResponses(
        strike.state,
        strike.events,
        new Rng("exchange-reaction"),
        { loadout: { [REACTOR_ID]: "riposte" }, execution: SURE_HIT },
      );
      return JSON.stringify([...strike.events, ...answers.events]);
    };

    expect(play()).toBe(play());
  });

  it("every event a full exchange emits is well-formed", () => {
    const state = makeBattle([
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(REACTOR_ID, coord(2, 1), "enemy", FOE_STATS),
    ]);
    const strike = runStrike(state, ability({ effects: [steel(100)] }), unitTarget(REACTOR_ID));
    const answers = resolveReactionResponses(strike.state, strike.events, new Rng("well-formed"), {
      loadout: { [REACTOR_ID]: "riposte" },
      execution: SURE_HIT,
    });

    for (const event of [...strike.events, ...answers.events]) {
      expect(isBattleEvent(event)).toBe(true);
    }
  });
});
