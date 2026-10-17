import { describe, expect, it } from "vitest";

import type { StatBlock } from "../../src/data/schema";
import {
  executeAbility,
  type AbilityExecutionOptions,
  type AbilitySpec,
} from "../../src/engine/actions/ability";
import { createBattle, findUnit, type BattleState } from "../../src/engine/battle";
import { isBattleEvent, type BattleEvent } from "../../src/engine/events";
import { coord, type Coord } from "../../src/engine/grid";
import { asAbilityId, asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import {
  DEFAULT_REACTION_ABILITIES,
  DODGE_CHANCE,
  FIELD_DRESSING_HP_RATIO,
  REACTIONS,
  REACTION_IDS,
  damageChannelOf,
  dodgeTriggers,
  equippedReaction,
  fieldDressingTriggers,
  incomingTrigger,
  reactionForUnit,
  reactionKindOf,
  reactionKindsFor,
  resolveReactionDefense,
  resolveReactionResponses,
  returnFireTriggers,
  riposteTriggers,
  triggerFromDamage,
  type ReactionOptions,
  type ReactionTrigger,
} from "../../src/engine/reactions";
import { Rng } from "../../src/engine/rng";
import { createTerrainMap } from "../../src/engine/terrain";
import { createUnit, type Unit, type UnitInit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T042 — Reaction abilities
 *
 * Pins the task's "done when": trigger hooks for **Riposte**, **Return Fire**,
 * **Dodge** and **Field Dressing** (mapping §6). The tests cover the pure
 * trigger predicates, the two builders that turn an incoming attack or a landed
 * `damaged` event into a {@link ReactionTrigger}, and the two resolvers that
 * consult a soldier's single reaction slot and answer — all deterministically
 * and without mutating state (`agents.md` §2).
 *
 * Provoking attacks inject `evasionOf: () => 0` so the setup hit is guaranteed;
 * ripostes then face an attacker whose Speed is 0, so their evasion is 0 too
 * and the counter lands without hunting for a lucky seed.
 * ------------------------------------------------------------------------ */

const REACTOR_ID = asUnitId("unit-reactor");
const ATTACKER_ID = asUnitId("unit-attacker");

const REACTOR_STATS: StatBlock = {
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

const ATTACKER_STATS: StatBlock = {
  hp: 50,
  mp: 4,
  atk: 10,
  def: 10,
  mag: 30,
  res: 10,
  // Speed 0 keeps a counter's evasion at zero, so the answer always lands.
  spd: 0,
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

/** A clash with the reactor to the north and a hostile attacker beside/away. */
function makeBattle(attackerAt: Coord = coord(1, 2), reactorHp?: number): BattleState {
  const reactor = makeUnit(REACTOR_ID, coord(1, 1), "company", REACTOR_STATS, {
    ...(reactorHp === undefined ? {} : { hp: reactorHp }),
  });
  const attacker = makeUnit(ATTACKER_ID, attackerAt, "enemy", ATTACKER_STATS);
  return createBattle(1815, { map: MAP, units: [reactor, attacker] });
}

function unitOf(state: BattleState, id: UnitId): Unit {
  const unit = findUnit(state, id);
  if (unit === undefined) throw new Error(`missing ${id}`);
  return unit;
}

function ability(channel: "steel" | "powder", power = 100): AbilitySpec {
  return {
    id: asAbilityId(channel === "steel" ? "test-blade" : "test-shell"),
    mpCost: 0,
    chargeTime: 0,
    range: 5,
    power,
    target: "enemy",
    hitRate: 100,
    effects: [channel === "steel" ? { kind: "steel", power } : { kind: "powder", power }],
  };
}

/** Build a trigger by hand, overriding only the field under test. */
function trigger(overrides: Partial<ReactionTrigger> = {}): ReactionTrigger {
  return {
    phase: "afterDamage",
    reactorId: REACTOR_ID,
    sourceId: ATTACKER_ID,
    abilityId: asAbilityId("test-blade"),
    channel: "steel",
    hostile: true,
    amount: 10,
    hpAfter: 50,
    reactorMaxHp: 60,
    fatal: false,
    distance: 1,
    ...overrides,
  };
}

/** Find a seed whose first draw dodges (or does not dodge). */
function seedForDodge(success: boolean): string {
  for (let i = 0; i < 100_000; i++) {
    const seed = `dodge-seed-${i}`;
    const roll = new Rng(seed).nextInt(100);
    if (success ? roll < DODGE_CHANCE : roll >= DODGE_CHANCE) return seed;
  }
  throw new Error("no dodge seed found");
}

/** Run a hostile provoking attack and return the state plus its events. */
function provoke(
  state: BattleState,
  channel: "steel" | "powder" = "steel",
  options: AbilityExecutionOptions = SURE_HIT,
): { state: BattleState; events: readonly BattleEvent[] } {
  const result = executeAbility(
    state,
    unitOf(state, ATTACKER_ID),
    ability(channel),
    { kind: "unit", unitId: REACTOR_ID },
    new Rng("provoke"),
    options,
  );
  expect(result.ok).toBe(true);
  return { state: result.state, events: result.events };
}

/* --------------------------------------------------------------------------
 * Identity and authored data
 * ------------------------------------------------------------------------ */

describe("reactions — identity", () => {
  it("maps every FFTA id to its retheme kind", () => {
    expect(reactionKindOf(REACTION_IDS.riposte)).toBe("riposte");
    expect(reactionKindOf("return-fire")).toBe("returnFire");
    expect(reactionKindOf(REACTION_IDS.dodge)).toBe("dodge");
    expect(reactionKindOf(REACTION_IDS.fieldDressing)).toBe("fieldDressing");
    expect(reactionKindOf(asAbilityId("not-a-reaction"))).toBeUndefined();
  });

  it("gives each reaction a Napoleonic name and a phase", () => {
    expect(REACTIONS.riposte.name).toBe("Riposte");
    expect(REACTIONS.returnFire.name).toBe("Return Fire");
    expect(REACTIONS.dodge.phase).toBe("beforeDamage");
    expect(REACTIONS.fieldDressing.phase).toBe("afterDamage");
  });

  it("builds default reaction specs on the right channel", () => {
    expect(damageChannelOf(DEFAULT_REACTION_ABILITIES.riposte)).toBe("steel");
    expect(damageChannelOf(DEFAULT_REACTION_ABILITIES.returnFire)).toBe("powder");
    expect(damageChannelOf(DEFAULT_REACTION_ABILITIES.dodge)).toBe("none");
    expect(DEFAULT_REACTION_ABILITIES.fieldDressing.effects[0]?.kind).toBe("heal");
  });
});

/* --------------------------------------------------------------------------
 * Trigger builders
 * ------------------------------------------------------------------------ */

describe("reactions — trigger builders", () => {
  it("classifies an incoming attack and measures the gap", () => {
    const state = makeBattle(coord(1, 4));
    const incoming = incomingTrigger(
      state,
      ATTACKER_ID,
      REACTOR_ID,
      ability("powder"),
    );

    expect(incoming).toBeDefined();
    expect(incoming).toMatchObject({
      phase: "beforeDamage",
      reactorId: REACTOR_ID,
      sourceId: ATTACKER_ID,
      channel: "powder",
      hostile: true,
      hpAfter: REACTOR_STATS.hp,
      reactorMaxHp: REACTOR_STATS.hp,
      distance: 3,
    });
  });

  it("returns undefined for a soldier who is not deployed", () => {
    const state = makeBattle();
    expect(
      incomingTrigger(state, asUnitId("ghost"), REACTOR_ID, ability("steel")),
    ).toBeUndefined();
  });

  it("builds an after-damage trigger from a landed damaged event", () => {
    const state = makeBattle();
    const provoked = provoke(state);
    const damage = provoked.events.find((event) => event.kind === "damaged");
    expect(damage).toBeDefined();

    const built = triggerFromDamage(provoked.state, damage!);
    expect(built).toMatchObject({
      phase: "afterDamage",
      reactorId: REACTOR_ID,
      sourceId: ATTACKER_ID,
      channel: "steel",
      hostile: true,
      amount: 6,
      hpAfter: REACTOR_STATS.hp - 6,
      fatal: false,
      distance: 1,
    });
  });

  it("ignores events that are not damage", () => {
    const state = makeBattle();
    const moved: BattleEvent = {
      kind: "moved",
      tick: 0,
      unitId: REACTOR_ID,
      from: coord(1, 1),
      to: coord(2, 1),
      path: [coord(1, 1), coord(2, 1)],
      facing: "east",
    };
    expect(triggerFromDamage(state, moved)).toBeUndefined();
  });
});

/* --------------------------------------------------------------------------
 * Trigger predicates
 * ------------------------------------------------------------------------ */

describe("reactions — trigger hooks", () => {
  it("Riposte answers a hostile Steel hit in reach, and nothing else", () => {
    expect(riposteTriggers(trigger())).toBe(true);
    expect(riposteTriggers(trigger({ channel: "powder" }))).toBe(false);
    expect(riposteTriggers(trigger({ distance: 2 }))).toBe(false);
    expect(riposteTriggers(trigger({ fatal: true }))).toBe(false);
    expect(riposteTriggers(trigger({ hostile: false }))).toBe(false);
    expect(riposteTriggers(trigger({ phase: "beforeDamage" }))).toBe(false);
  });

  it("Return Fire answers a hostile Powder hit in reach", () => {
    expect(returnFireTriggers(trigger({ channel: "powder", distance: 4 }))).toBe(true);
    expect(returnFireTriggers(trigger({ channel: "steel" }))).toBe(false);
    expect(returnFireTriggers(trigger({ channel: "powder", distance: 5 }))).toBe(false);
    expect(returnFireTriggers(trigger({ channel: "powder", fatal: true }))).toBe(false);
  });

  it("Dodge is offered before a hostile blow resolves", () => {
    expect(dodgeTriggers(trigger({ phase: "beforeDamage", amount: 0 }))).toBe(true);
    expect(dodgeTriggers(trigger({ phase: "beforeDamage", channel: "powder" }))).toBe(true);
    expect(dodgeTriggers(trigger({ phase: "beforeDamage", channel: "none" }))).toBe(false);
    expect(dodgeTriggers(trigger({ phase: "afterDamage" }))).toBe(false);
  });

  it("Field Dressing fires only when the wound crosses the dressing line", () => {
    const threshold = Math.floor(REACTOR_STATS.hp * FIELD_DRESSING_HP_RATIO);
    expect(fieldDressingTriggers(trigger({ hpAfter: threshold }))).toBe(true);
    expect(fieldDressingTriggers(trigger({ hpAfter: threshold + 1 }))).toBe(false);
    expect(fieldDressingTriggers(trigger({ hpAfter: 0 }))).toBe(false);
    expect(fieldDressingTriggers(trigger({ fatal: true }))).toBe(false);
    expect(fieldDressingTriggers(trigger({ amount: 0 }))).toBe(false);
  });

  it("lists matching reactions and the one a soldier carries", () => {
    const steel = trigger();
    expect(reactionKindsFor(steel)).toEqual(["riposte"]);

    const soldier = makeUnit(REACTOR_ID, coord(1, 1), "company", REACTOR_STATS);
    expect(reactionForUnit(soldier, steel, { loadout: { [REACTOR_ID]: "riposte" } })).toBe(
      "riposte",
    );
    expect(reactionForUnit(soldier, steel, { loadout: { [REACTOR_ID]: "dodge" } })).toBeUndefined();
    expect(reactionForUnit(soldier, steel)).toBeUndefined();
  });

  it("reads a loadout entry written as either an id or a kind", () => {
    const soldier = makeUnit(REACTOR_ID, coord(1, 1), "company", REACTOR_STATS);
    expect(equippedReaction(soldier, { loadout: { [REACTOR_ID]: REACTION_IDS.riposte } })).toBe(
      "riposte",
    );
    expect(equippedReaction(soldier, { loadout: { [REACTOR_ID]: "returnFire" } })).toBe(
      "returnFire",
    );
    expect(
      equippedReaction(soldier, { reactionOf: () => REACTION_IDS.fieldDressing }),
    ).toBe("fieldDressing");
  });
});

/* --------------------------------------------------------------------------
 * Pre-damage resolution — Dodge
 * ------------------------------------------------------------------------ */

describe("resolveReactionDefense — Dodge", () => {
  const loadout: ReactionOptions = { loadout: { [REACTOR_ID]: "dodge" } };

  it("negates the attack and emits one reactionTriggered when the roll succeeds", () => {
    const state = makeBattle();
    const incoming = incomingTrigger(state, ATTACKER_ID, REACTOR_ID, ability("steel"))!;
    const rng = new Rng(seedForDodge(true));

    const result = resolveReactionDefense(state, incoming, rng, loadout);

    expect(result.negated).toBe(true);
    expect(result.reactionId).toBe(REACTION_IDS.dodge);
    expect(result.state).toBe(state);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      kind: "reactionTriggered",
      unitId: REACTOR_ID,
      abilityId: REACTION_IDS.dodge,
      sourceId: ATTACKER_ID,
    });
    expect(isBattleEvent(result.events[0])).toBe(true);
  });

  it("lets the attack through when the roll fails", () => {
    const state = makeBattle();
    const incoming = incomingTrigger(state, ATTACKER_ID, REACTOR_ID, ability("steel"))!;
    const rng = new Rng(seedForDodge(false));

    const result = resolveReactionDefense(state, incoming, rng, loadout);

    expect(result.negated).toBe(false);
    expect(result.events).toEqual([]);
    expect(result.state).toBe(state);
  });

  it("does not touch the PRNG when no Dodge is equipped", () => {
    const state = makeBattle();
    const incoming = incomingTrigger(state, ATTACKER_ID, REACTOR_ID, ability("steel"))!;
    const rng = new Rng("untouched");
    const before = rng.getState();

    const result = resolveReactionDefense(state, incoming, rng);

    expect(result.negated).toBe(false);
    expect(rng.getState()).toEqual(before);
  });

  it("rejects a malformed dodge chance", () => {
    const state = makeBattle();
    const incoming = incomingTrigger(state, ATTACKER_ID, REACTOR_ID, ability("steel"))!;
    expect(() =>
      resolveReactionDefense(state, incoming, new Rng(1), { dodgeChance: 101 }),
    ).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Post-damage resolution
 * ------------------------------------------------------------------------ */

describe("resolveReactionResponses", () => {
  it("Riposte answers the attacker's Steel blow", () => {
    const state = makeBattle();
    const provoked = provoke(state);
    const options: ReactionOptions = { loadout: { [REACTOR_ID]: "riposte" } };

    const result = resolveReactionResponses(
      provoked.state,
      provoked.events,
      new Rng("riposte"),
      options,
    );

    expect(result.triggered).toEqual([REACTION_IDS.riposte]);
    const kinds = result.events.map((event) => event.kind);
    expect(kinds[0]).toBe("reactionTriggered");
    expect(kinds).toContain("damaged");

    const counter = result.events.find((event) => event.kind === "damaged");
    expect(counter).toMatchObject({ unitId: ATTACKER_ID, sourceId: REACTOR_ID });
    expect(unitOf(result.state, ATTACKER_ID).hp).toBeLessThan(ATTACKER_STATS.hp);
  });

  it("Return Fire answers a Powder attack with Powder of its own", () => {
    const state = makeBattle(coord(1, 4));
    const provoked = provoke(state, "powder");
    const options: ReactionOptions = { loadout: { [REACTOR_ID]: "returnFire" } };

    const result = resolveReactionResponses(
      provoked.state,
      provoked.events,
      new Rng("return-fire"),
      options,
    );

    expect(result.triggered).toEqual([REACTION_IDS.returnFire]);
    const counter = result.events.find((event) => event.kind === "damaged");
    expect(counter).toMatchObject({
      unitId: ATTACKER_ID,
      sourceId: REACTOR_ID,
      damageType: "powder",
    });
  });

  it("Field Dressing bandages the wounded soldier in place", () => {
    const state = makeBattle(coord(1, 2), 25);
    const provoked = provoke(state);
    const options: ReactionOptions = { loadout: { [REACTOR_ID]: "fieldDressing" } };

    const result = resolveReactionResponses(
      provoked.state,
      provoked.events,
      new Rng("field-dressing"),
      options,
    );

    expect(result.triggered).toEqual([REACTION_IDS.fieldDressing]);
    const heal = result.events.find((event) => event.kind === "healed");
    expect(heal).toMatchObject({ unitId: REACTOR_ID, sourceId: REACTOR_ID });
    expect(unitOf(result.state, REACTOR_ID).hp).toBeGreaterThan(
      unitOf(provoked.state, REACTOR_ID).hp,
    );
  });

  it("does nothing when the soldier carries no reaction", () => {
    const state = makeBattle();
    const provoked = provoke(state);

    const result = resolveReactionResponses(provoked.state, provoked.events, new Rng(1));

    expect(result.triggered).toEqual([]);
    expect(result.events).toEqual([]);
    expect(result.state).toBe(provoked.state);
  });

  it("does not answer a blow that was never taken", () => {
    const state = makeBattle();
    const options: ReactionOptions = { loadout: { [REACTOR_ID]: "riposte" } };

    // A missed attack produces no `damaged` event, so there is nothing to answer.
    const result = resolveReactionResponses(state, [], new Rng(1), options);

    expect(result.triggered).toEqual([]);
    expect(result.events).toEqual([]);
  });

  it("does not chain a Riposte off its own counter", () => {
    const state = makeBattle();
    const provoked = provoke(state);
    const options: ReactionOptions = {
      loadout: { [REACTOR_ID]: "riposte", [ATTACKER_ID]: "riposte" },
    };

    const result = resolveReactionResponses(
      provoked.state,
      provoked.events,
      new Rng("no-chain"),
      options,
    );

    // Exactly one reaction: the attacker never gets to riposte the riposte.
    expect(result.triggered).toEqual([REACTION_IDS.riposte]);
    expect(result.events.filter((event) => event.kind === "reactionTriggered")).toHaveLength(1);
  });
});

/* --------------------------------------------------------------------------
 * Purity and determinism
 * ------------------------------------------------------------------------ */

describe("reactions — purity & determinism", () => {
  it("does not mutate the input state", () => {
    const state = makeBattle();
    const provoked = provoke(state);
    const before = JSON.stringify(provoked.state);

    resolveReactionResponses(
      provoked.state,
      provoked.events,
      new Rng("purity"),
      { loadout: { [REACTOR_ID]: "riposte" } },
    );

    expect(JSON.stringify(provoked.state)).toBe(before);
  });

  it("produces byte-identical events for the same state and seed", () => {
    const play = (): string => {
      const state = makeBattle();
      const provoked = provoke(state);
      const result = resolveReactionResponses(
        provoked.state,
        provoked.events,
        new Rng("determinism"),
        { loadout: { [REACTOR_ID]: "riposte" } },
      );
      return JSON.stringify(result.events);
    };
    expect(play()).toBe(play());
  });

  it("every emitted event is a well-formed battle event", () => {
    const state = makeBattle();
    const provoked = provoke(state);
    const result = resolveReactionResponses(
      provoked.state,
      provoked.events,
      new Rng("valid"),
      { loadout: { [REACTOR_ID]: "riposte" } },
    );
    for (const event of result.events) {
      expect(isBattleEvent(event)).toBe(true);
    }
  });
});
