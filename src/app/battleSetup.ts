/**
 * Battle deployment from a contract (T118) — turn a company, a contract and a
 * battle map into a ready-to-play {@link BattleState}.
 *
 * The campaign loop (Phase 13) needed the last piece of the bridge between the
 * Officers' Mess and the Field: `src/data/` already described **who can fight**
 * (the enemy roster, T091), **where** (the battle maps' deployment zones,
 * T074/T092) and **why** (the contracts, T070), and `src/engine/battle.ts`
 * already knew how to build a battle from a `BattleSetup` (T022). What was
 * missing was the assembly step. This module is it.
 *
 * ```
 *   Company ── roster + PostAssignment (T051) ──► company units on `company` tiles
 *   ContractDef ─┐
 *                ├─► buildBattleFromContract ──► createBattle(seed, setup)
 *   BattleMapDef ┘        │
 *        │                └─ enemy order of battle (T118) ──► enemy units on `enemy` tiles
 *        └─ battleMapToTerrainMap + objective
 * ```
 *
 * ## What it does
 *
 * 1. **Validates the pairing.** Only a **combat** contract (`battle`,
 *    `skirmish` or `pacification`) fields a detachment; the contract must post
 *    the map it was handed, and the map must carry an authored **order of
 *    battle** (`src/data/enemies/ordersOfBattle.ts`). A detachment contract, a
 *    combat contract with no map, or a map with no garrison is an authoring
 *    fault that throws a {@link BattleDeploymentError} rather than fielding a
 *    half-empty board.
 * 2. **Deploys the company.** Up to one soldier per `company` tile, in roster
 *    order, each rebuilt with its **primary post's derived stats** (T018/T051)
 *    and full health/Élan, facing the enemy. Soldiers beyond the deploy limit
 *    wait in reserve.
 * 3. **Deploys the enemy.** Every unit of the map's order of battle is resolved
 *    through the authored roster (T091) onto its named `enemy` tile, facing the
 *    company, with its authored actions marked **mastered** (an irregular needs
 *    no Drill to use what it already knows).
 * 4. **Builds the action catalogue.** The union of the company's learned/
 *    skillset actions and the enemy's actions, translated from `AbilityDef` to
 *    the engine's `ActionSpec`. The engine then resolves them through the T117
 *    pipeline.
 * 5. **Passes the map's objective** to `createBattle`, so the action ends on
 *    its authored win/lose condition (T031).
 *
 * ## Contract (`agents.md` §2, §3, §7, §9)
 *
 * - **Deterministic.** The seed is a parameter; there is no `Math.random` and
 *   no clock. The same `(seed, company, contract, map)` yields a byte-identical
 *   battle, so a campaign action replays and a test is stable.
 * - **Pure.** Inputs are never mutated; the company and its roster are read,
 *   not written. Deployment is a value transformation.
 * - **Data-driven.** Which troop holds which tile, at what level, is authored
 *   content (the order of battle); no enemy id is special-cased here. Balance
 *   constants (the fallback movement rates) are named and documented.
 * - **Fail loudly at the boundary.** Malformed pairings throw a
 *   {@link BattleDeploymentError}; the engine's own `createBattle` then guards
 *   the assembled board.
 *
 * Reference: `docs/NAPOLEONIC_MAPPING.md` §0 (detachment scale), §10 (the
 * campaign loop) and §11 (irregular troops). Fiction, ids and balance are ours,
 * inspired by the FFTA mission/monster model rather than copied from it.
 */

import { actionAbilitiesForSkillset, findAbility } from "../data/abilities";
import { findEnemy, hasOrderOfBattle, orderOfBattleFor } from "../data/enemies";
import type { OrderOfBattleDef } from "../data/enemies/ordersOfBattle";
import { battleMapsForContract, type BattleMapDef } from "../data/maps";
import { battleMapToTerrainMap } from "../data/maps/layout";
import type { AbilityDef, ContractDef, EnemyDef } from "../data/schema";
import type { AbilityEffect } from "../engine/actions/ability";
import type { ActionSpec } from "../engine/actions/resolve";
import { AUXILIARY_POST_ID, DEFAULT_IRREGULAR_POWER } from "../engine/barracks";
import { createBattle, type BattleState } from "../engine/battle";
import type { Company, RosterMember } from "../engine/company";
import { coord, type Coord, type Facing } from "../engine/grid";
import { asAbilityId, asConditionId, asUnitId } from "../engine/ids";
import { deriveUnitPostStats } from "../engine/progression/posts";
import type { Seed } from "../engine/rng";
import { createUnit, type Unit } from "../engine/unit";

/* --------------------------------------------------------------------------
 * Tunables (Phase 13 owns the final balance pass)
 * ------------------------------------------------------------------------ */

/**
 * Fallback movement in tiles for a deployed soldier when its stored stat block
 * carries no Move rate. FFTA job tables list Move/Jump as fixed rates rather
 * than growth columns (`src/engine/stats.ts`), so the value has to come from
 * somewhere; the roster snapshot supplies it when present, and this is the
 * conservative default when it does not.
 */
export const DEFAULT_MOVE_RATE = 4;

/** Fallback Climb (Jump) rate; see {@link DEFAULT_MOVE_RATE}. */
export const DEFAULT_JUMP_RATE = 2;

/**
 * Contract kinds that actually field a detachment. `detachment` contracts
 * (`src/data/contracts/detachments.ts`) dispatch soldiers away for a number of
 * campaign days and resolve without a board, so they are not deployable.
 */
export const COMBAT_CONTRACT_KINDS = ["battle", "skirmish", "pacification"] as const;
export type CombatContractKind = (typeof COMBAT_CONTRACT_KINDS)[number];

/* --------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------ */

/**
 * Thrown when a battle cannot be assembled from the supplied contract and map:
 * a non-combat contract, a combat contract with no map, a map posted by a
 * different contract, or a map with no authored order of battle. These are
 * authoring/caller faults, not in-world illegal orders.
 */
export class BattleDeploymentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BattleDeploymentError";
  }
}

/* --------------------------------------------------------------------------
 * Queries
 * ------------------------------------------------------------------------ */

/** `true` when `contract` fields a detachment on a battlefield. */
export function isCombatContract(contract: ContractDef): boolean {
  return (COMBAT_CONTRACT_KINDS as readonly string[]).includes(contract.kind);
}

/* --------------------------------------------------------------------------
 * Ability translation (data `AbilityDef` → engine `ActionSpec`)
 * ------------------------------------------------------------------------ */

/**
 * Translate an authored {@link AbilityDef} into the engine's {@link ActionSpec}.
 *
 * The numeric and targeting fields map straight across. The authoring schema
 * carries no damage *channel* (the FFTA split between Steel and Powder), so a
 * hostile action is delivered through the **Steel** channel — exactly the
 * fallback the executor already uses for a minimal spec (`executableSpec` in
 * `src/engine/actions/resolve.ts`). An ally- or self-target action with power
 * is translated as **Medicine**, and a zero-power action as the conditions it
 * applies or removes. A later content pass may author effects explicitly; this
 * bridge keeps a deployed battle immediately playable.
 */
export function actionSpecFromAbility(ability: AbilityDef): ActionSpec {
  const effects = effectsForAbility(ability);
  return {
    id: asAbilityId(ability.id),
    mpCost: ability.mpCost,
    chargeTime: ability.chargeTime,
    range: ability.range,
    power: ability.power,
    aoeShape: ability.aoeShape,
    aoeSize: ability.aoeSize,
    target: ability.target,
    hitRate: ability.hitRate,
    ...(effects === undefined ? {} : { effects }),
  };
}

/** The effect list an authored action implies; `undefined` when it is pure. */
function effectsForAbility(ability: AbilityDef): readonly AbilityEffect[] | undefined {
  const inflicts = ability.inflicts.map((id) => asConditionId(id));
  const cleanses = ability.cleanses.map((id) => asConditionId(id));

  if (ability.power === 0) {
    const effects: AbilityEffect[] = inflicts.map((conditionId) => ({
      kind: "condition",
      conditionId,
    }));
    for (const conditionId of cleanses) {
      effects.push({ kind: "cleanse", conditionId });
    }
    return effects.length === 0 ? undefined : effects;
  }

  if (ability.target === "ally" || ability.target === "self") {
    return [
      {
        kind: "heal",
        power: ability.power,
        ...(cleanses.length === 0 ? {} : { cleanses }),
      },
    ];
  }

  return [
    {
      kind: "steel",
      power: ability.power,
      ...(ability.element === undefined ? {} : { element: ability.element }),
      ...(inflicts.length === 0 ? {} : { inflicts }),
      ...(cleanses.length === 0 ? {} : { cleanses }),
    },
  ];
}

/* --------------------------------------------------------------------------
 * Geometry helpers
 * ------------------------------------------------------------------------ */

/** The tiles a map's deployment zone for `side` names, in authored order. */
function deploymentTiles(map: BattleMapDef, side: "company" | "enemy"): Coord[] {
  const zone = map.deployment.find((candidate) => candidate.side === side);
  return zone === undefined ? [] : zone.tiles.map((tile) => coord(tile.x, tile.y));
}

/** The centre of a set of tiles, rounded to the nearest whole tile. */
function centroidOf(tiles: readonly Coord[]): Coord {
  if (tiles.length === 0) return coord(0, 0);
  let x = 0;
  let y = 0;
  for (const tile of tiles) {
    x += tile.x;
    y += tile.y;
  }
  return coord(Math.round(x / tiles.length), Math.round(y / tiles.length));
}

/** The cardinal direction from `from` toward `to`, preferring the longer axis. */
function facingTowards(from: Coord, to: Coord): Facing {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) return "north";
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
}

/* --------------------------------------------------------------------------
 * Company deployment
 * ------------------------------------------------------------------------ */

/** The roster members fielded and the units they became. */
interface CompanyDeployment {
  readonly members: readonly RosterMember[];
  readonly units: readonly Unit[];
}

/** Movement is not a growth stat; carry the soldier's stored rate into the derive. */
function movementMods(member: RosterMember): { readonly move: number; readonly jump: number } {
  const move = member.unit.stats.move > 0 ? member.unit.stats.move : DEFAULT_MOVE_RATE;
  const jump = member.unit.stats.jump > 0 ? member.unit.stats.jump : DEFAULT_JUMP_RATE;
  return { move, jump };
}

/**
 * Deploy the company onto its tiles. Up to one soldier per `company` tile takes
 * the field, in roster order; any surplus waits in reserve. Each unit is rebuilt
 * through `createUnit` (T017) with stats re-derived from its **primary post**
 * (T018/T051), full health and Élan, and no carried-in Honour or conditions.
 */
function deployCompany(
  company: Company,
  tiles: readonly Coord[],
  focus: Coord,
): CompanyDeployment {
  if (company.roster.length === 0) {
    throw new BattleDeploymentError(`company "${company.id}" has no soldiers on its roster`);
  }
  if (tiles.length === 0) {
    throw new BattleDeploymentError("the battle map has no company deployment tiles");
  }

  const fielded = company.roster.slice(0, tiles.length);
  const units = fielded.map((member, index) => {
    const at = tiles[index] as Coord;
    const stats = deriveUnitPostStats(member.unit, member.assignment, {
      postMods: movementMods(member),
    });
    return createUnit({
      ...member.unit,
      side: "company",
      at,
      facing: facingTowards(at, focus),
      stats,
      hp: stats.hp,
      mp: stats.mp,
      judgePoints: 0,
      conditions: [],
    });
  });

  return { members: fielded, units };
}

/* --------------------------------------------------------------------------
 * Enemy deployment
 * ------------------------------------------------------------------------ */

/** The enemy units fielded and the definitions they came from. */
interface EnemyDeployment {
  readonly defs: readonly EnemyDef[];
  readonly units: readonly Unit[];
}

/**
 * Deploy an order of battle onto the map's `enemy` tiles. Every troop must
 * resolve to an authored irregular, stand on a tile of the map's enemy
 * deployment zone, and share a tile with no other troop; a violation throws a
 * {@link BattleDeploymentError} rather than silently dropping a defender.
 */
function deployEnemies(
  order: OrderOfBattleDef,
  enemyTiles: readonly Coord[],
  focus: Coord,
): EnemyDeployment {
  const seenTiles = new Set<string>();
  const defs: EnemyDef[] = [];
  const units: Unit[] = [];

  order.units.forEach((entry, index) => {
    const def = findEnemy(entry.enemyId);
    if (def === undefined) {
      throw new BattleDeploymentError(
        `order of battle for "${order.mapId}" names unknown troop "${entry.enemyId}"`,
      );
    }
    if (!enemyTiles.some((tile) => tile.x === entry.at.x && tile.y === entry.at.y)) {
      throw new BattleDeploymentError(
        `order of battle for "${order.mapId}" stations ${entry.enemyId} at { x: ${entry.at.x}, y: ${entry.at.y} }, which is not an enemy deployment tile`,
      );
    }
    const tileKey = `${entry.at.x},${entry.at.y}`;
    if (seenTiles.has(tileKey)) {
      throw new BattleDeploymentError(
        `order of battle for "${order.mapId}" stations two troops on { x: ${entry.at.x}, y: ${entry.at.y} }`,
      );
    }
    seenTiles.add(tileKey);

    const at = coord(entry.at.x, entry.at.y);
    units.push(
      createUnit({
        id: asUnitId(`enemy:${def.id}:${index}`),
        name: def.name,
        power: DEFAULT_IRREGULAR_POWER,
        postId: AUXILIARY_POST_ID,
        side: "enemy",
        level: entry.level ?? def.level,
        at,
        facing: facingTowards(at, focus),
        stats: def.stats,
        // An irregular needs no Drill to use what it already knows, so every
        // authored action is marked mastered (mirrors `deployIrregular`, T078).
        abilities: def.abilities.map((abilityId) => ({
          abilityId: asAbilityId(abilityId),
          drill: 0,
          mastered: true,
        })),
      }),
    );
    defs.push(def);
  });

  if (units.length === 0) {
    throw new BattleDeploymentError(
      `order of battle for "${order.mapId}" fields no troops`,
    );
  }

  return { defs, units };
}

/* --------------------------------------------------------------------------
 * Action catalogue
 * ------------------------------------------------------------------------ */

/** Deduplicate abilities by id, preserving first-seen order. */
function collectActions(
  abilities: readonly (AbilityDef | undefined)[],
): readonly AbilityDef[] {
  const byId = new Map<string, AbilityDef>();
  for (const ability of abilities) {
    if (ability === undefined) continue;
    if (!byId.has(ability.id)) byId.set(ability.id, ability);
  }
  return [...byId.values()];
}

/**
 * Every **action** ability the fielded company can command: the action set of
 * each soldier's chosen skillset, plus any action-class ability it has learned
 * (T048/T051). Reaction, trait and volley abilities are not actions, so they
 * stay out of the battle's `act` catalogue and are read by the engine from the
 * units' mastered abilities instead.
 */
function companyActions(members: readonly RosterMember[]): readonly AbilityDef[] {
  const candidates: AbilityDef[] = [];
  for (const member of members) {
    const skillsetId = member.assignment.actionSkillsetId;
    if (skillsetId !== null) {
      candidates.push(...actionAbilitiesForSkillset(skillsetId));
    }
    for (const learned of member.unit.abilities) {
      const ability = findAbility(learned.abilityId);
      if (ability !== undefined && ability.abilityClass === "action") {
        candidates.push(ability);
      }
    }
  }
  return collectActions(candidates);
}

/** Every action-class ability the deployed irregulars bring to the field. */
function enemyActions(defs: readonly EnemyDef[]): readonly AbilityDef[] {
  const candidates: AbilityDef[] = [];
  for (const def of defs) {
    for (const abilityId of def.abilities) {
      const ability = findAbility(abilityId);
      if (ability !== undefined && ability.abilityClass === "action") {
        candidates.push(ability);
      }
    }
  }
  return collectActions(candidates);
}

/* --------------------------------------------------------------------------
 * Deployment
 * ------------------------------------------------------------------------ */

/** Guard the contract/map pairing before any unit is built. */
function assertDeployable(contract: ContractDef, map: BattleMapDef): void {
  if (!isCombatContract(contract)) {
    throw new BattleDeploymentError(
      `contract "${contract.id}" is a ${contract.kind}; only ${COMBAT_CONTRACT_KINDS.join(", ")} contracts field a detachment`,
    );
  }
  if (battleMapsForContract(contract.id).length === 0) {
    throw new BattleDeploymentError(
      `combat contract "${contract.id}" posts no battle map`,
    );
  }
  if (map.contractId !== contract.id) {
    throw new BattleDeploymentError(
      `battle map "${map.id}" is not posted by contract "${contract.id}" (it names ${map.contractId ?? "no contract"})`,
    );
  }
  if (!hasOrderOfBattle(map.id)) {
    throw new BattleDeploymentError(
      `battle map "${map.id}" has no authored order of battle`,
    );
  }
}

/**
 * Build the deterministic battle a combat contract is fought on.
 *
 * ```ts
 * const battle = buildBattleFromContract(seed, company, CONTRACTS["break-the-bridge"], BATTLE_MAPS["sainte-colombe-bridge"]);
 * ```
 *
 * The company fields up to one soldier per `company` tile (in roster order) with
 * its primary post's derived stats; the map's order of battle fields its
 * irregulars on the `enemy` tiles; the map's objective and both sides' actions
 * ride along. The return value is a normal {@link BattleState}, ready for
 * `step` and the battle controller.
 *
 * @throws BattleDeploymentError when the contract is not a combat contract, has
 *   no battle map, names a different map, or the map has no order of battle.
 * @throws RangeError when the order of battle names an unknown troop, an
 *   off-zone or duplicate tile, or fields no troops.
 */
export function buildBattleFromContract(
  seed: Seed,
  company: Company,
  contract: ContractDef,
  map: BattleMapDef,
): BattleState {
  assertDeployable(contract, map);

  const companyTiles = deploymentTiles(map, "company");
  const enemyTiles = deploymentTiles(map, "enemy");
  const companyFocus = centroidOf(enemyTiles);
  const enemyFocus = centroidOf(companyTiles);

  const companyDeployment = deployCompany(company, companyTiles, companyFocus);
  const enemyDeployment = deployEnemies(orderOfBattleFor(map.id), enemyTiles, enemyFocus);

  const actions = collectActions([
    ...companyActions(companyDeployment.members),
    ...enemyActions(enemyDeployment.defs),
  ]).map(actionSpecFromAbility);

  return createBattle(seed, {
    map: battleMapToTerrainMap(map),
    units: [...companyDeployment.units, ...enemyDeployment.units],
    abilities: actions,
    objective: map.objective,
  });
}
