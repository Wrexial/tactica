import { describe, expect, it } from "vitest";

import { ABILITIES } from "../../src/data/abilities";
import { CONTRACTS } from "../../src/data/contracts";
import {
  ORDER_OF_BATTLE_MAP_IDS,
  findEnemy,
  hasOrderOfBattle,
  orderOfBattleFor,
} from "../../src/data/enemies";
import {
  BATTLE_MAPS,
  BattleMapLookupError,
  battleMapsForContract,
  combatMapForContract,
  getBattleMap,
  hasCombatMap,
  type BattleMapDef,
} from "../../src/data/maps";
import {
  BattleDeploymentError,
  actionSpecFromAbility,
  buildBattleFromContract,
  isCombatContract,
} from "../../src/app/battleSetup";
import { createCompany, type Company, type RosterMemberInit } from "../../src/engine/company";
import { coord } from "../../src/engine/grid";
import { asCompanyId, asPostId, asUnitId } from "../../src/engine/ids";
import { createPostAssignment } from "../../src/engine/progression/posts";
import { hashBattleState } from "../../src/engine/serialize";
import { createUnit } from "../../src/engine/unit";
import type { StatBlock } from "../../src/data/schema";

/* --------------------------------------------------------------------------
 * T118 — Deploy a battle from a contract
 *
 * Pins the task's "done when": `buildBattleFromContract` returns a deterministic
 * `BattleState` from a `Company`, a combat `ContractDef` and its `BattleMapDef`,
 * with the roster on the map's `company` tiles, the authored irregulars on its
 * `enemy` tiles, the map's objective, and both sides' actions. It also pins the
 * failure modes the task calls out: a combat contract with no map and a map with
 * no order of battle both fail loudly.
 * ------------------------------------------------------------------------ */

const SEED = 1809;

/** A generous, combat-ready stat block for test roster members. */
const MEMBER_STATS: StatBlock = {
  hp: 60,
  mp: 24,
  atk: 12,
  def: 8,
  mag: 4,
  res: 6,
  spd: 28,
  move: 4,
  jump: 2,
};

/** A roster member with a valid primary post and a battlefield snapshot. */
function member(id: string, name: string, postId: string): RosterMemberInit {
  const assignment = createPostAssignment({
    primaryPostId: asPostId(postId),
    power: "france",
  });
  const unit = createUnit({
    id: asUnitId(id),
    name,
    power: "france",
    postId: asPostId(postId),
    level: 1,
    at: coord(0, 0),
    stats: { ...MEMBER_STATS },
  });
  return { unit, assignment };
}

/** A company of `size` French soldiers, in roster order. */
function companyOf(size: number): Company {
  const posts = ["fusilier", "fusilier", "surgeon", "fusilier"];
  const roster = Array.from({ length: size }, (_, index) =>
    member(`unit-${index}`, `Soldier ${index}`, posts[index % posts.length] as string),
  );
  return createCompany({
    id: asCompanyId("test-company"),
    name: "The Greycoats",
    roster,
  });
}

/** The zoned deployment tiles of a map side. */
function tilesFor(map: BattleMapDef, side: "company" | "enemy"): readonly { x: number; y: number }[] {
  return map.deployment.find((zone) => zone.side === side)?.tiles ?? [];
}

/* --------------------------------------------------------------------------
 * The happy path
 * ------------------------------------------------------------------------ */

describe("buildBattleFromContract (T118)", () => {
  const contract = CONTRACTS["break-the-bridge"];
  const map = BATTLE_MAPS["sainte-colombe-bridge"];

  it("deploys the roster on the map's company tiles", () => {
    const company = companyOf(4);
    const battle = buildBattleFromContract(SEED, company, contract, map);
    const companies = battle.units.filter((unit) => unit.side === "company");
    const companyTiles = tilesFor(map, "company");

    expect(companies).toHaveLength(4);
    for (const unit of companies) {
      expect(
        companyTiles.some((tile) => tile.x === unit.at.x && tile.y === unit.at.y),
        `${unit.id} should stand on a company tile`,
      ).toBe(true);
    }
  });

  it("deploys the order of battle on the map's enemy tiles", () => {
    const battle = buildBattleFromContract(SEED, companyOf(4), contract, map);
    const enemies = battle.units.filter((unit) => unit.side === "enemy");
    const enemyTiles = tilesFor(map, "enemy");
    const order = orderOfBattleFor(map.id);

    expect(enemies).toHaveLength(order.units.length);
    for (const unit of enemies) {
      expect(
        enemyTiles.some((tile) => tile.x === unit.at.x && tile.y === unit.at.y),
        `${unit.id} should stand on an enemy tile`,
      ).toBe(true);
    }
  });

  it("carries the map's objective and both sides' actions", () => {
    const battle = buildBattleFromContract(SEED, companyOf(4), contract, map);

    expect(battle.objective?.objective).toEqual(map.objective);
    // The fusilier's signature action is in the company's catalogue.
    expect(battle.abilities["volley-fire"]).toBeDefined();
    // The militia conscript's authored action is in the enemy's catalogue.
    expect(battle.abilities["bayonet-charge"]).toBeDefined();
    // Reactions/traits are read from mastered abilities, not the act catalogue.
    expect(battle.abilities["riposte"]).toBeUndefined();
  });

  it("re-derives company stats from the primary post and deploys at full strength", () => {
    const source = member("unit-0", "Soldier 0", "fusilier");
    const wounded = createUnit({
      ...source.unit,
      hp: 1,
      mp: 0,
      judgePoints: 4,
    });
    const battle = buildBattleFromContract(
      SEED,
      createCompany({
        id: asCompanyId("wounded"),
        name: "The Greycoats",
        roster: [{ unit: wounded, assignment: source.assignment }],
      }),
      contract,
      map,
    );

    const [unit] = battle.units.filter((candidate) => candidate.side === "company");
    expect(unit).toBeDefined();
    expect(unit?.hp).toBe(unit?.stats.hp);
    expect(unit?.mp).toBe(unit?.stats.mp);
    expect(unit?.judgePoints).toBe(0);
    expect(unit?.conditions).toEqual([]);
    expect(unit?.stats.move).toBeGreaterThan(0);
    expect(unit?.stats.hp).toBeGreaterThan(1);
  });

  it("applies an authored level override from the order of battle", () => {
    const battle = buildBattleFromContract(
      SEED,
      companyOf(2),
      CONTRACTS["clear-the-forest-bands"],
      BATTLE_MAPS["blackwood-picket"],
    );
    const guerrilla = battle.units.find((unit) => unit.name === "Blackwood Guerrilla");
    // The order of battle fields it at level 2, below its authored level 3.
    expect(guerrilla?.level).toBe(2);
  });

  it("is deterministic: the same seed and inputs produce the same state hash", () => {
    const first = buildBattleFromContract(SEED, companyOf(3), contract, map);
    const second = buildBattleFromContract(SEED, companyOf(3), contract, map);
    expect(hashBattleState(first)).toBe(hashBattleState(second));
    expect(first).toEqual(second);
  });

  it("leaves the company and its roster untouched", () => {
    const company = companyOf(3);
    const before = JSON.stringify(company);
    buildBattleFromContract(SEED, company, contract, map);
    expect(JSON.stringify(company)).toBe(before);
  });
});

/* --------------------------------------------------------------------------
 * The action bridge (AbilityDef → ActionSpec)
 * ------------------------------------------------------------------------ */

describe("actionSpecFromAbility (T118)", () => {
  it("maps the numeric and targeting fields of a hostile action", () => {
    const ability = ABILITIES["volley-fire"];
    const spec = actionSpecFromAbility(ability);

    expect(spec.id).toBe("volley-fire");
    expect(spec.mpCost).toBe(ability.mpCost);
    expect(spec.chargeTime).toBe(ability.chargeTime);
    expect(spec.range).toBe(ability.range);
    expect(spec.power).toBe(ability.power);
    expect(spec.aoeShape).toBe(ability.aoeShape);
    expect(spec.target).toBe(ability.target);
    expect(spec.effects?.[0]).toMatchObject({
      kind: "steel",
      power: ability.power,
      element: ability.element,
    });
  });

  it("translates an ally heal into a Medicine effect", () => {
    const spec = actionSpecFromAbility(ABILITIES["surgical-dressing"]);
    expect(spec.target).toBe("ally");
    expect(spec.effects?.[0]).toMatchObject({ kind: "heal", power: 60 });
  });

  it("translates a zero-power buff into the condition it applies", () => {
    const spec = actionSpecFromAbility(ABILITIES["close-order-drill"]);
    expect(spec.effects).toEqual([{ kind: "condition", conditionId: "protect" }]);
  });

  it("translates a cleanse into cleanse effects for each condition", () => {
    const spec = actionSpecFromAbility(ABILITIES["cleanse-ailment"]);
    expect(spec.effects?.length).toBeGreaterThan(0);
    expect(spec.effects?.every((effect) => effect.kind === "cleanse")).toBe(true);
  });
});

/* --------------------------------------------------------------------------
 * Loud failures
 * ------------------------------------------------------------------------ */

describe("buildBattleFromContract failures (T118)", () => {
  const company = companyOf(2);

  it("refuses a non-combat (detachment) contract", () => {
    expect(isCombatContract(CONTRACTS["forage-the-valley"])).toBe(false);
    expect(() =>
      buildBattleFromContract(
        SEED,
        company,
        CONTRACTS["forage-the-valley"],
        BATTLE_MAPS["green-valley-forage"],
      ),
    ).toThrow(BattleDeploymentError);
  });

  it("refuses a combat contract that posts no battle map", () => {
    expect(hasCombatMap("carry-the-pass")).toBe(false);
    expect(() =>
      buildBattleFromContract(
        SEED,
        company,
        CONTRACTS["carry-the-pass"],
        BATTLE_MAPS["sainte-colombe-bridge"],
      ),
    ).toThrow(BattleDeploymentError);
  });

  it("refuses a map that a different contract posts", () => {
    expect(() =>
      buildBattleFromContract(
        SEED,
        company,
        CONTRACTS["break-the-bridge"],
        BATTLE_MAPS["farmhouse-assault"],
      ),
    ).toThrow(BattleDeploymentError);
  });

  it("refuses a map with no authored order of battle", () => {
    const noGarrison: BattleMapDef = {
      ...getBattleMap("millford-crossing"),
      contractId: "break-the-bridge",
    };
    expect(hasOrderOfBattle("millford-crossing")).toBe(false);
    expect(() =>
      buildBattleFromContract(SEED, company, CONTRACTS["break-the-bridge"], noGarrison),
    ).toThrow(BattleDeploymentError);
    expect(() => orderOfBattleFor("millford-crossing")).toThrow(RangeError);
  });

  it("resolves a contract's map, or throws a lookup error", () => {
    expect(combatMapForContract("break-the-bridge").id).toBe("sainte-colombe-bridge");
    expect(() => combatMapForContract("carry-the-pass")).toThrow(BattleMapLookupError);
  });
});

/* --------------------------------------------------------------------------
 * Order-of-battle integrity (the authored table)
 * ------------------------------------------------------------------------ */

describe("orders of battle (T118)", () => {
  it("stations every troop on a unique enemy deployment tile", () => {
    for (const mapId of ORDER_OF_BATTLE_MAP_IDS) {
      const map = BATTLE_MAPS[mapId];
      const order = orderOfBattleFor(mapId);
      const enemyTiles = tilesFor(map, "enemy");
      const seen = new Set<string>();

      expect(order.mapId).toBe(mapId);
      expect(order.units.length).toBeGreaterThan(0);
      for (const unit of order.units) {
        expect(findEnemy(unit.enemyId), `${mapId} → ${unit.enemyId}`).toBeDefined();
        expect(
          enemyTiles.some((tile) => tile.x === unit.at.x && tile.y === unit.at.y),
          `${mapId}: ${unit.enemyId} at {${unit.at.x},${unit.at.y}} is off-zone`,
        ).toBe(true);
        const key = `${unit.at.x},${unit.at.y}`;
        expect(seen.has(key), `${mapId}: two troops on ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it("gives every combat map that a contract posts a garrison", () => {
    for (const contract of Object.values(CONTRACTS)) {
      if (!isCombatContract(contract)) continue;
      for (const map of battleMapsForContract(contract.id)) {
        expect(hasOrderOfBattle(map.id), `${contract.id} → ${map.id}`).toBe(true);
      }
    }
  });

  it("covers every authored combat map", () => {
    // The nine maps a combat contract can reach all carry a garrison.
    expect(ORDER_OF_BATTLE_MAP_IDS.length).toBeGreaterThanOrEqual(9);
    expect(new Set(ORDER_OF_BATTLE_MAP_IDS).size).toBe(ORDER_OF_BATTLE_MAP_IDS.length);
  });
});
