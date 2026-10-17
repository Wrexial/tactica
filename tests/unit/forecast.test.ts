import { describe, expect, it } from "vitest";

import type { StatBlock } from "../../src/data/schema";
import type { AbilitySpec, SteelEffect } from "../../src/engine/actions/ability";
import { createBattle, findUnit, type BattleState } from "../../src/engine/battle";
import type { Target } from "../../src/engine/commands";
import { coord, type Coord } from "../../src/engine/grid";
import { asAbilityId, asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import { computeHealing, computeSteelDamage } from "../../src/engine/rules/damage";
import { createTerrainMap } from "../../src/engine/terrain";
import { createUnit, type Unit, type UnitInit } from "../../src/engine/unit";
import {
  forecastAbility,
  targetForCursor,
  type ForecastAbilitySpec,
  type ForecastOptions,
} from "../../src/ui/battleForecast";

/* --------------------------------------------------------------------------
 * T086 — Battle forecast
 *
 * Pins the confirm-prompt projection: expected damage, hit chance and reaction
 * risk, computed without rolling any dice. Every number here is checked against
 * the same rules kernel the executor (T041) uses, so the preview can never
 * disagree with the resolution it describes. Purity and determinism are
 * asserted directly (`agents.md` §2).
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

/** Actor at (1,1), an ally behind, and two hostile pickets to its flank. */
function defaultUnits(): Unit[] {
  return [
    makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
    makeUnit(ALLY_ID, coord(1, 3), "company", ALLY_STATS),
    makeUnit(ENEMY_ID, coord(2, 1), "enemy", ENEMY_STATS, { facing: "west" }),
    makeUnit(ENEMY2_ID, coord(2, 2), "enemy", ENEMY_STATS, { facing: "west" }),
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

function unitTarget(unitId: UnitId): Target {
  return { kind: "unit", unitId };
}

const steel = (power = 100): SteelEffect => ({ kind: "steel", power });

/* --------------------------------------------------------------------------
 * Cursor → target
 * ------------------------------------------------------------------------ */

describe("targetForCursor", () => {
  it("names the soldier standing on the tile", () => {
    expect(targetForCursor(makeBattle(), coord(2, 1))).toEqual(unitTarget(ENEMY_ID));
  });

  it("falls back to the ground tile when nobody is there", () => {
    expect(targetForCursor(makeBattle(), coord(4, 4))).toEqual({
      kind: "tile",
      at: coord(4, 4),
    });
  });

  it("ignores a soldier who is out of action", () => {
    const down = makeUnit(ENEMY_ID, coord(4, 4), "enemy", ENEMY_STATS, { hp: 0 });
    const battle = makeBattle([makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS), down]);
    expect(targetForCursor(battle, coord(4, 4))).toEqual({ kind: "tile", at: coord(4, 4) });
  });
});

/* --------------------------------------------------------------------------
 * Damage
 * ------------------------------------------------------------------------ */

describe("forecastAbility — damage", () => {
  it("previews Steel damage with the shared kernel", () => {
    const battle = makeBattle();
    const preview = forecastAbility(
      battle,
      actorOf(battle),
      ability({ effects: [steel()] }),
      unitTarget(ENEMY_ID),
    );

    const expected = computeSteelDamage({ weaponAtk: 20, targetWeaponDef: 10, power: 100 });
    expect(expected).toBe(15);
    expect(preview.damage).toBe(15);
    // The blade is in reach the enemy can answer from, so the odds are high but
    // not certain; expected damage is the hit-weighted figure.
    expect(preview.expectedDamage).toBe(Math.floor((15 * preview.hitChance) / 100));
    expect(preview.targets[0]?.hpAfter).toBe(35);
    expect(preview.targets[0]?.lethal).toBe(false);
  });

  it("falls back to a Steel blow for a minimal ActionSpec", () => {
    const battle = makeBattle();
    const minimal: ForecastAbilitySpec = {
      id: asAbilityId("generic-order"),
      mpCost: 0,
      chargeTime: 0,
      range: 5,
      power: 100,
    };
    const preview = forecastAbility(battle, actorOf(battle), minimal, unitTarget(ENEMY_ID));
    expect(preview.abilityId).toBe(asAbilityId("generic-order"));
    expect(preview.damage).toBe(15);
  });

  it("applies elemental weakness through the affinity hook", () => {
    const battle = makeBattle();
    const effects: SteelEffect[] = [{ kind: "steel", power: 100, element: "fire" }];
    const preview = forecastAbility(
      battle,
      actorOf(battle),
      ability({ effects }),
      unitTarget(ENEMY_ID),
      { affinitiesOf: () => ({ fire: "weak" }) },
    );
    // A weak affinity doubles the 15-point blow (T038).
    expect(preview.damage).toBe(30);
  });

  it("flags a lethal blow and clamps the survivor at zero", () => {
    const battle = makeBattle([
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ENEMY_ID, coord(2, 1), "enemy", ENEMY_STATS, { hp: 10, facing: "west" }),
    ]);
    const preview = forecastAbility(
      battle,
      actorOf(battle),
      ability({ effects: [steel()] }),
      unitTarget(ENEMY_ID),
    );
    expect(preview.targets[0]?.damage).toBe(15);
    expect(preview.targets[0]?.hpAfter).toBe(0);
    expect(preview.targets[0]?.lethal).toBe(true);
  });
});

/* --------------------------------------------------------------------------
 * Hit chance
 * ------------------------------------------------------------------------ */

describe("forecastAbility — hit chance", () => {
  it("weights expected damage by the to-hit odds", () => {
    const battle = makeBattle();
    const preview = forecastAbility(
      battle,
      actorOf(battle),
      ability({ hitRate: 80, effects: [steel()] }),
      unitTarget(ENEMY_ID),
      { evasionOf: () => 0 },
    );
    expect(preview.hitChance).toBe(80);
    expect(preview.expectedDamage).toBe(Math.floor((15 * 80) / 100));
  });

  it("adds the flank/rear facing bonus to the odds", () => {
    // The enemy looks west, so the actor to its west strikes it in front.
    const frontBattle = makeBattle([
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ENEMY_ID, coord(2, 1), "enemy", ENEMY_STATS, { facing: "west" }),
    ]);
    const front = forecastAbility(
      frontBattle,
      actorOf(frontBattle),
      ability({ hitRate: 50, effects: [steel()] }),
      unitTarget(ENEMY_ID),
      { evasionOf: () => 0 },
    );
    expect(front.targets[0]?.facing).toBe("front");
    expect(front.hitChance).toBe(50);

    // Turned away (looking east), the same strike lands as a rear attack (+30).
    const rearBattle = makeBattle([
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ENEMY_ID, coord(2, 1), "enemy", ENEMY_STATS, { facing: "east" }),
    ]);
    const rear = forecastAbility(
      rearBattle,
      actorOf(rearBattle),
      ability({ hitRate: 50, effects: [steel()] }),
      unitTarget(ENEMY_ID),
      { evasionOf: () => 0 },
    );
    expect(rear.targets[0]?.facing).toBe("rear");
    expect(rear.hitChance).toBe(80);
  });

  it("clamps a hopeless shot into the authored floor", () => {
    const battle = makeBattle();
    const preview = forecastAbility(
      battle,
      actorOf(battle),
      ability({ hitRate: 0, effects: [steel()] }),
      unitTarget(ENEMY_ID),
      { evasionOf: () => 0 },
    );
    // HIT_FORMULA.minChance keeps a sliver of hope (`hit.ts`, T037).
    expect(preview.hitChance).toBe(5);
    expect(preview.expectedDamage).toBe(0);
  });
});

/* --------------------------------------------------------------------------
 * Medicine
 * ------------------------------------------------------------------------ */

describe("forecastAbility — medicine", () => {
  it("previews healing on an ally without a to-hit roll", () => {
    const battle = makeBattle();
    const preview = forecastAbility(
      battle,
      actorOf(battle),
      ability({ target: "ally", effects: [{ kind: "heal", power: 40 }] }),
      unitTarget(ALLY_ID),
    );
    const expected = computeHealing({ medicalPower: 30, power: 40 });
    expect(expected).toBe(22);
    expect(preview.healing).toBe(22);
    expect(preview.damage).toBe(0);
    expect(preview.hitChance).toBe(100);
    expect(preview.targets[0]?.rollsToHit).toBe(false);
    expect(preview.targets[0]?.hpAfter).toBe(50);
  });
});

/* --------------------------------------------------------------------------
 * Reaction risk
 * ------------------------------------------------------------------------ */

describe("forecastAbility — reaction risk", () => {
  it("predicts a Riposte from a surviving adjacent target", () => {
    const battle = makeBattle();
    const options: ForecastOptions = { reactions: { loadout: { [ENEMY_ID]: "riposte" } } };
    const preview = forecastAbility(
      battle,
      actorOf(battle),
      ability({ effects: [steel()] }),
      unitTarget(ENEMY_ID),
      options,
    );
    expect(preview.reactions).toEqual([
      expect.objectContaining({
        kind: "riposte",
        label: "Riposte",
        phase: "afterDamage",
        equipped: true,
        unitId: ENEMY_ID,
      }),
    ]);
  });

  it("predicts a Dodge before damage when the target carries it", () => {
    const battle = makeBattle();
    const options: ForecastOptions = { reactions: { loadout: { [ENEMY_ID]: "dodge" } } };
    const preview = forecastAbility(
      battle,
      actorOf(battle),
      ability({ effects: [steel()] }),
      unitTarget(ENEMY_ID),
      options,
    );
    expect(preview.reactions).toEqual([
      expect.objectContaining({ kind: "dodge", phase: "beforeDamage", equipped: true }),
    ]);
  });

  it("predicts Return Fire against a Powder attack", () => {
    const battle = makeBattle();
    const options: ForecastOptions = { reactions: { loadout: { [ENEMY_ID]: "returnFire" } } };
    const preview = forecastAbility(
      battle,
      actorOf(battle),
      ability({ effects: [{ kind: "powder", power: 100 }] }),
      unitTarget(ENEMY_ID),
      options,
    );
    expect(preview.reactions).toEqual([
      expect.objectContaining({ kind: "returnFire", phase: "afterDamage" }),
    ]);
  });

  it("predicts Field Dressing when the blow leaves a target below half strength", () => {
    const battle = makeBattle([
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ENEMY_ID, coord(2, 1), "enemy", ENEMY_STATS, { hp: 20, facing: "west" }),
    ]);
    const options: ForecastOptions = {
      reactions: { loadout: { [ENEMY_ID]: "fieldDressing" } },
    };
    const preview = forecastAbility(
      battle,
      actorOf(battle),
      ability({ effects: [steel()] }),
      unitTarget(ENEMY_ID),
      options,
    );
    expect(preview.targets[0]?.hpAfter).toBe(5);
    expect(preview.reactions).toEqual([
      expect.objectContaining({ kind: "fieldDressing", phase: "afterDamage" }),
    ]);
  });

  it("reports every possible reaction when no loadout is supplied", () => {
    const battle = makeBattle();
    const preview = forecastAbility(
      battle,
      actorOf(battle),
      ability({ effects: [steel()] }),
      unitTarget(ENEMY_ID),
    );
    const kinds = preview.reactions.map((reaction) => reaction.kind).sort();
    expect(kinds).toEqual(["dodge", "riposte"]);
    expect(preview.reactions.every((reaction) => reaction.equipped === false)).toBe(true);
  });
});

/* --------------------------------------------------------------------------
 * Targeting & area
 * ------------------------------------------------------------------------ */

describe("forecastAbility — targeting", () => {
  it("reports an out-of-range aim as illegal without a target", () => {
    const battle = makeBattle([
      makeUnit(ACTOR_ID, coord(1, 1), "company", ACTOR_STATS),
      makeUnit(ENEMY_ID, coord(6, 5), "enemy", ENEMY_STATS),
    ]);
    const preview = forecastAbility(
      battle,
      actorOf(battle),
      ability({ range: 1, effects: [steel()] }),
      unitTarget(ENEMY_ID),
    );
    expect(preview.ok).toBe(false);
    expect(preview.reason).toBe("out-of-range");
    expect(preview.targets).toHaveLength(0);
  });

  it("sweeps the whole footprint of a ground action, friend and foe alike", () => {
    // A separate board keeps the blast clear of the actor's own tile.
    const battle = makeBattle([
      makeUnit(ACTOR_ID, coord(0, 0), "company", ACTOR_STATS),
      makeUnit(ALLY_ID, coord(4, 2), "company", ALLY_STATS),
      makeUnit(ENEMY_ID, coord(4, 3), "enemy", ENEMY_STATS),
      makeUnit(ENEMY2_ID, coord(5, 3), "enemy", ENEMY_STATS),
    ]);
    const preview = forecastAbility(
      battle,
      actorOf(battle),
      ability({
        target: "tile",
        range: 8,
        aoeShape: "cross",
        aoeSize: 1,
        effects: [steel()],
      }),
      { kind: "tile", at: coord(4, 3) },
    );
    // The cross around (4,3) catches both pickets and the nearby ally.
    const ids = preview.targets.map((entry) => entry.unitId).sort();
    expect(ids).toEqual([ALLY_ID, ENEMY2_ID, ENEMY_ID].sort());
  });
});

/* --------------------------------------------------------------------------
 * Purity & determinism
 * ------------------------------------------------------------------------ */

describe("forecastAbility — purity", () => {
  it("never mutates the battle and is deterministic", () => {
    const battle = makeBattle();
    const before = JSON.stringify(battle);
    const spec = ability({ effects: [steel()] });

    const first = forecastAbility(battle, actorOf(battle), spec, unitTarget(ENEMY_ID));
    const second = forecastAbility(battle, actorOf(battle), spec, unitTarget(ENEMY_ID));

    expect(second).toEqual(first);
    expect(JSON.stringify(battle)).toBe(before);
  });
});
