import { describe, expect, it } from "vitest";

import { WEAPON_FAMILIES } from "../../src/data/weapons";
import type { StatBlock } from "../../src/data/schema";
import {
  abilityRangeProfile,
  evasionOf,
  executeAbility,
  type AbilityExecutionOptions,
  type AbilitySpec,
  type CleanseEffect,
  type ConditionEffect,
  type DrainEffect,
  type HealEffect,
  type ReviveEffect,
  type SteelEffect,
} from "../../src/engine/actions/ability";
import { createBattle, findUnit, type BattleState } from "../../src/engine/battle";
import type { Target } from "../../src/engine/commands";
import { isBattleEvent } from "../../src/engine/events";
import { coord, type Coord } from "../../src/engine/grid";
import { asAbilityId, asConditionId, asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import { Rng } from "../../src/engine/rng";
import { hasActiveCondition } from "../../src/engine/rules/conditions";
import { createTerrainMap } from "../../src/engine/terrain";
import { createUnit, type Unit, type UnitInit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T041 — Action executor
 *
 * Pins the task's "done when": a **data-defined** action executes every family
 * the retheme keeps — physical (`steel`), ranged (a `weapon` family), artillery
 * (`powder`), medical (`heal`), buffs/debuffs (`condition`), drains (`drain`)
 * and revival (`revive`). The executor composes the rules that already landed
 * (T033/T034/T035/T036 damage, T037 hit, T038 elements, T039 conditions) into
 * one deterministic pass, and must stay pure: no mutation, no `Math.random`,
 * and byte-identical output for the same state and seed (`agents.md` §2).
 *
 * Where a hit could miss, the tests inject `evasionOf: () => 0` so the roll is
 * a guaranteed hit; the miss test finds a seed whose first draw fails instead.
 * ------------------------------------------------------------------------ */

const ACTOR_ID = asUnitId("unit-actor");
const ALLY_ID = asUnitId("unit-ally");
const ENEMY_ID = asUnitId("unit-enemy");
const ENEMY2_ID = asUnitId("unit-enemy2");

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

const ALLY_STATS: StatBlock = {
  hp: 50,
  mp: 10,
  atk: 10,
  def: 8,
  mag: 10,
  res: 8,
  spd: 15,
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

/** The default roster: a company section and two hostile pickets. */
function defaultUnits(): Unit[] {
  return [
    makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
    makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS),
    makeUnit(ENEMY_ID, coord(3, 1), "enemy", ENEMY_STATS),
    makeUnit(ENEMY2_ID, coord(3, 2), "enemy", ENEMY_STATS),
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

/** A guaranteed-hit execution: zero evasion so the to-hit roll always lands. */
const SURE_HIT: AbilityExecutionOptions = { evasionOf: () => 0 };

/** A trusted ability spec factory; tests override only what they exercise. */
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

function unitTarget(unitId: UnitId): { kind: "unit"; unitId: UnitId } {
  return { kind: "unit", unitId };
}

/** Run an ability through the executor with a fresh seeded RNG. */
function run(
  state: BattleState,
  spec: AbilitySpec,
  target: Target,
  options: AbilityExecutionOptions = SURE_HIT,
  seed: string | number = "t041",
): ReturnType<typeof executeAbility> {
  return executeAbility(state, actorOf(state), spec, target, new Rng(seed), options);
}

/** Find a seed whose first to-hit draw falls inside `[min, max)`. */
function seedWithFirstRoll(min: number, max: number): string {
  for (let i = 0; i < 100_000; i++) {
    const seed = `roll-seed-${i}`;
    const roll = new Rng(seed).nextInt(100);
    if (roll >= min && roll < max) return seed;
  }
  throw new Error("no seed found in range");
}

/* --------------------------------------------------------------------------
 * Targeting
 * ------------------------------------------------------------------------ */

describe("executeAbility — targeting", () => {
  it("rejects an out-of-range aim without touching the state", () => {
    const state = makeBattle();
    const spec = ability({ range: 1, effects: [steel(100)] });

    const result = executeAbility(state, actorOf(state), spec, unitTarget(ENEMY_ID), new Rng(1));

    expect(result.ok).toBe(false);
    expect(result.events).toEqual([]);
    expect(result.state).toBe(state);
    expect(result.targeting.reason).toBe("out-of-range");
  });

  it("rejects a friendly target for an enemy-only action", () => {
    const state = makeBattle();
    const spec = ability({ target: "enemy", effects: [steel(100)] });

    const result = executeAbility(state, actorOf(state), spec, unitTarget(ALLY_ID), new Rng(1));

    expect(result.ok).toBe(false);
    expect(result.targeting.reason).toBe("wrong-affiliation");
    expect(result.events).toEqual([]);
  });

  it("defaults a self-target action to a minimum reach of zero", () => {
    expect(abilityRangeProfile(ability({ target: "self", range: 0 })).min).toBe(0);
    expect(abilityRangeProfile(ability({ target: "enemy", range: 3 })).min).toBe(1);
  });
});

/* --------------------------------------------------------------------------
 * Damage families
 * ------------------------------------------------------------------------ */

function steel(power: number, extra: Partial<SteelEffect> = {}): SteelEffect {
  return { kind: "steel", power, ...extra };
}

describe("executeAbility — physical (Steel)", () => {
  it("deals WeaponAtk − TargetDef/2, then × Power/100", () => {
    const state = makeBattle();
    // atk 20, enemy def 10 → base 15, ×100/100 = 15.
    const result = run(state, ability({ effects: [steel(100)] }), unitTarget(ENEMY_ID));

    expect(result.ok).toBe(true);
    const damaged = result.events.find((event) => event.kind === "damaged");
    expect(damaged).toMatchObject({
      kind: "damaged",
      unitId: ENEMY_ID,
      sourceId: ACTOR_ID,
      amount: 15,
      damageType: "steel",
      critical: false,
      fatal: false,
    });
    expect(findUnit(result.state, ENEMY_ID)?.hp).toBe(35);
    expect(result.events.every(isBattleEvent)).toBe(true);
  });

  it("scales damage with the effect's Power term", () => {
    const state = makeBattle();
    const result = run(state, ability({ effects: [steel(50)] }), unitTarget(ENEMY_ID));
    const damaged = result.events.find((event) => event.kind === "damaged");
    // base 15, ×50/100 = 7 (truncated).
    expect(damaged?.kind === "damaged" ? damaged.amount : -1).toBe(7);
  });

  it("knocks a soldier out and emits outOfAction when the blow is fatal", () => {
    const units = [
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ENEMY_ID, coord(3, 1), "enemy", ENEMY_STATS, { hp: 10 }),
      makeUnit(ENEMY2_ID, coord(3, 2), "enemy", ENEMY_STATS),
    ];
    const state = makeBattle(units);

    const result = run(state, ability({ effects: [steel(100)] }), unitTarget(ENEMY_ID));

    expect(result.events.map((event) => event.kind)).toEqual(["damaged", "outOfAction"]);
    const damaged = result.events[0];
    expect(damaged.kind === "damaged" ? damaged.fatal : false).toBe(true);
    expect(findUnit(result.state, ENEMY_ID)?.hp).toBe(0);
  });

  it("flags a critical strike when the action has a crit rate", () => {
    const state = makeBattle();
    const result = run(
      state,
      ability({ critRate: 100, effects: [steel(100)] }),
      unitTarget(ENEMY_ID),
    );
    const damaged = result.events.find((event) => event.kind === "damaged");
    expect(damaged?.kind === "damaged" ? damaged.critical : false).toBe(true);
  });
});

describe("executeAbility — artillery (Powder)", () => {
  it("deals MagicPower − TargetRes/2, then × Power/100", () => {
    const state = makeBattle();
    // mag 30, enemy res 10 → base 25, ×100/100 = 25.
    const result = run(
      state,
      ability({ effects: [{ kind: "powder", power: 100 }] }),
      unitTarget(ENEMY_ID),
    );

    const damaged = result.events.find((event) => event.kind === "damaged");
    expect(damaged).toMatchObject({
      kind: "damaged",
      unitId: ENEMY_ID,
      amount: 25,
      damageType: "powder",
    });
    expect(findUnit(result.state, ENEMY_ID)?.hp).toBe(25);
  });
});

describe("executeAbility — ranged (weapon family)", () => {
  it("uses the rifle family's (atk + spd)/2 × weaponPower recipe", () => {
    const state = makeBattle();
    // rifle: floor((20 + 20)/2) × 5 = 100; base 100 − 5 = 95; ×50/100 = 47.
    const result = run(
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
      unitTarget(ENEMY_ID),
    );

    const damaged = result.events.find((event) => event.kind === "damaged");
    expect(damaged?.kind === "damaged" ? damaged.amount : -1).toBe(47);
    expect(findUnit(result.state, ENEMY_ID)?.hp).toBe(3);
  });
});

/* --------------------------------------------------------------------------
 * Medicine and revival
 * ------------------------------------------------------------------------ */

function heal(power: number, extra: Partial<HealEffect> = {}): HealEffect {
  return { kind: "heal", power, ...extra };
}

describe("executeAbility — medicine (heal)", () => {
  it("restores flatHeal + MedicalPower × Power/100 to an ally", () => {
    const units = [
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS, { hp: 20 }),
      makeUnit(ENEMY_ID, coord(3, 1), "enemy", ENEMY_STATS),
      makeUnit(ENEMY2_ID, coord(3, 2), "enemy", ENEMY_STATS),
    ];
    const state = makeBattle(units);

    // mag 30, power 40 → 10 + floor(1200/100) = 22.
    const result = run(
      state,
      ability({ target: "ally", effects: [heal(40)] }),
      unitTarget(ALLY_ID),
      SURE_HIT,
    );

    const healed = result.events.find((event) => event.kind === "healed");
    expect(healed).toMatchObject({ kind: "healed", unitId: ALLY_ID, amount: 22, hpAfter: 42 });
    expect(findUnit(result.state, ALLY_ID)?.hp).toBe(42);
  });

  it("never rolls to hit for a support action", () => {
    const units = [
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS, { hp: 20 }),
      makeUnit(ENEMY_ID, coord(3, 1), "enemy", ENEMY_STATS),
    ];
    const state = makeBattle(units);

    const result = executeAbility(
      state,
      actorOf(state),
      ability({ target: "ally", hitRate: 0, effects: [heal(40)] }),
      unitTarget(ALLY_ID),
      new Rng("irrelevant"),
      { evasionOf: () => 999 },
    );

    expect(result.events.some((event) => event.kind === "missed")).toBe(false);
    expect(result.events.some((event) => event.kind === "healed")).toBe(true);
  });

  it("cleanses a condition as the dressing lands", () => {
    const units = [
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS, {
        hp: 20,
        conditions: [{ conditionId: asConditionId("blind"), duration: 0 }],
      }),
      makeUnit(ENEMY_ID, coord(3, 1), "enemy", ENEMY_STATS),
    ];
    const state = makeBattle(units);

    const result = run(
      state,
      ability({ target: "ally", effects: [heal(40, { cleanses: [asConditionId("blind")] })] }),
      unitTarget(ALLY_ID),
    );

    expect(result.events.map((event) => event.kind)).toEqual(["healed", "conditionRemoved"]);
    expect(hasActiveCondition(findUnit(result.state, ALLY_ID)!, "blind")).toBe(false);
  });
});

function revive(power: number): ReviveEffect {
  return { kind: "revive", power };
}

describe("executeAbility — revival", () => {
  it("brings an out-of-action ally back at a Medicine-derived amount", () => {
    const units = [
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS, { hp: 0 }),
      makeUnit(ENEMY_ID, coord(3, 1), "enemy", ENEMY_STATS),
    ];
    const state = makeBattle(units);

    const result = run(
      state,
      ability({ target: "ally", effects: [revive(40)] }),
      unitTarget(ALLY_ID),
    );

    const revived = result.events.find((event) => event.kind === "revived");
    expect(revived).toMatchObject({
      kind: "revived",
      unitId: ALLY_ID,
      sourceId: ACTOR_ID,
      hpAfter: 22,
    });
    expect(findUnit(result.state, ALLY_ID)?.hp).toBe(22);
  });

  it("does nothing to a soldier still standing", () => {
    const state = makeBattle();
    const result = run(
      state,
      ability({ target: "ally", effects: [revive(40)] }),
      unitTarget(ALLY_ID),
    );
    expect(result.events).toEqual([]);
  });
});

/* --------------------------------------------------------------------------
 * Buffs, debuffs and on-hit conditions
 * ------------------------------------------------------------------------ */

function condition(conditionId: string, duration?: number): ConditionEffect {
  return {
    kind: "condition",
    conditionId: asConditionId(conditionId),
    ...(duration === undefined ? {} : { duration }),
  };
}

describe("executeAbility — buffs & debuffs", () => {
  it("applies a buff to an ally without a hit roll", () => {
    const state = makeBattle();
    const result = run(
      state,
      ability({ target: "ally", effects: [condition("boost")] }),
      unitTarget(ALLY_ID),
    );

    expect(result.events.map((event) => event.kind)).toEqual(["conditionApplied"]);
    expect(hasActiveCondition(findUnit(result.state, ALLY_ID)!, "boost")).toBe(true);
  });

  it("applies a debuff to a hostile after a successful hit roll", () => {
    const state = makeBattle();
    const result = run(
      state,
      ability({ target: "enemy", effects: [condition("slow")] }),
      unitTarget(ENEMY_ID),
    );

    expect(result.events.map((event) => event.kind)).toEqual(["conditionApplied"]);
    expect(hasActiveCondition(findUnit(result.state, ENEMY_ID)!, "slow")).toBe(true);
  });

  it("applies conditions carried by a damaging blow (on-hit)", () => {
    const state = makeBattle();
    const result = run(
      state,
      ability({ effects: [steel(100, { inflicts: [asConditionId("slow")] })] }),
      unitTarget(ENEMY_ID),
    );

    expect(result.events.map((event) => event.kind)).toEqual(["damaged", "conditionApplied"]);
    expect(hasActiveCondition(findUnit(result.state, ENEMY_ID)!, "slow")).toBe(true);
  });

  it("strips every condition when a cleanse names none", () => {
    const units = [
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS, {
        conditions: [
          { conditionId: asConditionId("blind"), duration: 0 },
          { conditionId: asConditionId("slow"), duration: 0 },
        ],
      }),
      makeUnit(ENEMY_ID, coord(3, 1), "enemy", ENEMY_STATS),
    ];
    const state = makeBattle(units);
    const cleanse: CleanseEffect = { kind: "cleanse" };

    const result = run(state, ability({ target: "ally", effects: [cleanse] }), unitTarget(ALLY_ID));

    expect(result.events.every((event) => event.kind === "conditionRemoved")).toBe(true);
    expect(result.events).toHaveLength(2);
    expect(findUnit(result.state, ALLY_ID)?.conditions).toEqual([]);
  });
});

/* --------------------------------------------------------------------------
 * Drains
 * ------------------------------------------------------------------------ */

function drain(resource: "hp" | "mp", power: number): DrainEffect {
  return { kind: "drain", resource, power };
}

describe("executeAbility — drains", () => {
  it("drains hit points and heals the caster by what was taken", () => {
    const units = [
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS, { hp: 30 }),
      makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS),
      makeUnit(ENEMY_ID, coord(3, 1), "enemy", ENEMY_STATS),
    ];
    const state = makeBattle(units);

    const result = run(state, ability({ effects: [drain("hp", 100)] }), unitTarget(ENEMY_ID));

    // Powder: mag 30 − res 10/2 = 25, ×100/100 = 25.
    expect(result.events.map((event) => event.kind)).toEqual(["damaged", "healed"]);
    expect(findUnit(result.state, ENEMY_ID)?.hp).toBe(25);
    expect(findUnit(result.state, ACTOR_ID)?.hp).toBe(55);
  });

  it("drains Élan from the target into the caster", () => {
    const units = [
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS, { mp: 5 }),
      makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS),
      makeUnit(ENEMY_ID, coord(3, 1), "enemy", ENEMY_STATS, { mp: 4 }),
    ];
    const state = makeBattle(units);

    const result = run(state, ability({ effects: [drain("mp", 10)] }), unitTarget(ENEMY_ID));

    const changes = result.events.filter((event) => event.kind === "mpChanged");
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      unitId: ENEMY_ID,
      delta: -4,
      mpAfter: 0,
      reason: "drained",
    });
    expect(changes[1]).toMatchObject({ unitId: ACTOR_ID, delta: 4, mpAfter: 9, reason: "drained" });
  });
});

/* --------------------------------------------------------------------------
 * Elements
 * ------------------------------------------------------------------------ */

describe("executeAbility — elemental affinity", () => {
  it("doubles a weakness", () => {
    const state = makeBattle();
    const result = executeAbility(
      state,
      actorOf(state),
      ability({ effects: [steel(100, { element: "fire" })] }),
      unitTarget(ENEMY_ID),
      new Rng("elements"),
      { evasionOf: () => 0, affinitiesOf: () => ({ fire: "weak" }) },
    );

    const damaged = result.events.find((event) => event.kind === "damaged");
    expect(damaged?.kind === "damaged" ? damaged.amount : -1).toBe(30);
    expect(damaged?.kind === "damaged" ? damaged.element : undefined).toBe("fire");
  });

  it("turns an absorbed element into healing", () => {
    const units = [
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ALLY_ID, coord(1, 2), "company", ALLY_STATS),
      makeUnit(ENEMY_ID, coord(3, 1), "enemy", ENEMY_STATS, { hp: 20 }),
    ];
    const state = makeBattle(units);

    const result = executeAbility(
      state,
      actorOf(state),
      ability({ effects: [steel(100, { element: "fire" })] }),
      unitTarget(ENEMY_ID),
      new Rng("absorb"),
      { evasionOf: () => 0, affinitiesOf: () => ({ fire: "absorb" }) },
    );

    expect(result.events.map((event) => event.kind)).toEqual(["healed"]);
    const healed = result.events[0];
    expect(healed.kind === "healed" ? healed.amount : -1).toBe(15);
  });
});

/* --------------------------------------------------------------------------
 * Misses, areas and contracts
 * ------------------------------------------------------------------------ */

describe("executeAbility — hit and miss", () => {
  it("emits missed and applies nothing when the roll fails", () => {
    const state = makeBattle();
    const spec = ability({ hitRate: 0, effects: [steel(100)] });
    const result = executeAbility(
      state,
      actorOf(state),
      spec,
      unitTarget(ENEMY_ID),
      new Rng(seedWithFirstRoll(5, 100)),
      { evasionOf: () => 200 },
    );

    expect(result.events.map((event) => event.kind)).toEqual(["missed"]);
    expect(findUnit(result.state, ENEMY_ID)?.hp).toBe(50);
  });

  it("uses facing: a rear strike is more likely to land than a frontal one", () => {
    const frontal = makeBattle();
    const rear = makeBattle();

    // Point each picket along the axis that makes the attacker west of it a
    // frontal or a rear threat respectively (mapping §12, T037).
    const face = (state: BattleState, facing: "west" | "east"): BattleState => ({
      ...state,
      units: state.units.map((unit) => (unit.id === ENEMY_ID ? { ...unit, facing } : unit)),
    });

    const spec = ability({ hitRate: 80, effects: [steel(100)] });
    const evasion = { evasionOf: () => 20 };
    const seed = seedWithFirstRoll(60, 90);

    // Frontal: 80 − 20 + 0 = 60 → the roll lands on a miss.
    const a = executeAbility(
      face(frontal, "west"),
      actorOf(frontal),
      spec,
      unitTarget(ENEMY_ID),
      new Rng(seed),
      evasion,
    );
    // Rear: 80 − 20 + 30 = 90 → the same roll is now a hit.
    const b = executeAbility(
      face(rear, "east"),
      actorOf(rear),
      spec,
      unitTarget(ENEMY_ID),
      new Rng(seed),
      evasion,
    );

    expect(a.events[0]?.kind).toBe("missed");
    expect(b.events[0]?.kind).toBe("damaged");
  });
});

describe("executeAbility — ground areas", () => {
  it("sweeps every occupant of a ground action's footprint", () => {
    const state = makeBattle();
    const spec = ability({
      target: "tile",
      range: 5,
      aoeShape: "cross",
      aoeSize: 1,
      effects: [{ kind: "powder", power: 100 }],
    });

    const result = executeAbility(
      state,
      actorOf(state),
      spec,
      { kind: "tile", at: coord(3, 1) },
      new Rng("area"),
      SURE_HIT,
    );

    const hits = result.events.filter((event) => event.kind === "damaged");
    expect(hits.map((event) => (event.kind === "damaged" ? event.unitId : ""))).toEqual([
      ENEMY_ID,
      ENEMY2_ID,
    ]);
    expect(findUnit(result.state, ENEMY_ID)?.hp).toBe(25);
    expect(findUnit(result.state, ENEMY2_ID)?.hp).toBe(25);
  });
});

/* --------------------------------------------------------------------------
 * Tile vs unit anchoring (T125)
 * ------------------------------------------------------------------------ */

describe("executeAbility — tile vs unit anchoring (T125)", () => {
  it("cannot land an enemy-filtered action on bare ground", () => {
    // A single-target action is aimed at a *soldier*; aimed at an empty tile it
    // has no affiliated occupant, so the executor rejects the aim and applies
    // nothing. The charge pipeline (T125) relies on this by resolving a matured
    // charge against the recorded tile's occupant — a tile that empties out
    // whiffs rather than homing onto the fleeing soldier.
    const state = makeBattle();
    const result = run(
      state,
      ability({ target: "enemy", effects: [steel(100)] }),
      { kind: "tile", at: coord(5, 1) },
      SURE_HIT,
      "bare-ground",
    );

    expect(result.ok).toBe(false);
    expect(result.targeting.reason).toBe("wrong-affiliation");
    expect(result.events).toEqual([]);
  });

  it("still resolves a genuine ground action when its chosen tile empties", () => {
    // A `tile` action has no named occupant, so it sweeps its recorded footprint
    // regardless of who happens to be standing there — here, nobody.
    const state = makeBattle();
    const result = run(
      state,
      ability({
        target: "tile",
        aoeShape: "square",
        aoeSize: 1,
        effects: [{ kind: "powder", power: 100 }],
      }),
      { kind: "tile", at: coord(5, 1) },
      SURE_HIT,
      "empty-ground",
    );

    expect(result.ok).toBe(true);
    expect(result.events).toEqual([]);
  });
});

describe("executeAbility — purity & determinism", () => {
  it("does not mutate the input state", () => {
    const state = makeBattle();
    const before = JSON.stringify(state);

    run(state, ability({ effects: [steel(100)] }), unitTarget(ENEMY_ID));

    expect(JSON.stringify(state)).toBe(before);
  });

  it("produces byte-identical events for the same state and seed", () => {
    const play = (): string => {
      const state = makeBattle();
      const result = executeAbility(
        state,
        actorOf(state),
        ability({ effects: [steel(100, { inflicts: [asConditionId("slow")] })] }),
        unitTarget(ENEMY_ID),
        new Rng("determinism"),
        SURE_HIT,
      );
      return JSON.stringify(result.events);
    };
    expect(play()).toBe(play());
  });

  it("exposes the default evasion term as an authored, integer balance value", () => {
    const soldier = makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS);
    expect(evasionOf(soldier)).toBe(10);
    expect(Number.isInteger(evasionOf(soldier))).toBe(true);
  });
});
