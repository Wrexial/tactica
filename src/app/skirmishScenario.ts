/**
 * Quick Battle (preset skirmish) — one self-contained, ready-made action.
 *
 * The campaign (`src/app/campaignController.ts`) needs an Officers' Mess, a
 * contract, a save and a calendar before it can field anybody. This module is
 * the opposite: a **single authored scene** — two preset teams, a named
 * objective and nothing else — so the game is playable the moment it opens and
 * so a designer can test the battle layer without touching the metagame.
 *
 * ```
 *   PRESET COMPANY (4) ──┐
 *                        ├─► createBattle(seed, setup) ──► BattleState
 *   PRESET ENEMY (4) ────┘        │
 *                                 └─ objective: annihilation (win/lose)
 * ```
 *
 * ## What it owns
 *
 * - Two **authored rosters** of four soldiers each: the free company's starting
 *   specialists against a scratch force of deserters, a veteran, a petard crew
 *   and a sapper party. Stats are authored directly (not grown from a level) so
 *   the two teams are actually balanced; the campaign's level curve is a
 *   separate concern.
 * - The **farmhouse** board (`src/data/maps/farmhouse-assault.json`) for its
 *   terrain and deployment zones, reused rather than re-authored.
 * - An **annihilation** objective (T031): win by putting every enemy out of
 *   action, lose if the company is wiped out.
 *
 * ## Contract (`agents.md` §2, §3, §7, §9)
 *
 * - **Pure and deterministic.** No `Math.random`, no clock; the seed is fixed
 *   and `createBattle` seeds the engine. The same call always yields the same
 *   battle.
 * - **Data-driven.** Terrain, deployment tiles and ability numbers come from
 *   `src/data`; this module only authors the matchup.
 * - **Engine untouched.** Everything here is a `BattleState` through the public
 *   factories — `createUnit`, `createBattle` and the AI runner.
 */

import { findAbility } from "../data/abilities";
import { BATTLE_MAPS } from "../data/maps";
import { battleMapToTerrainMap } from "../data/maps/layout";
import type { AbilityDef, PowerKey, StatBlock } from "../data/schema";
import type { ActionSpec } from "../engine/actions/resolve";
import { createBattle, findUnit, type BattleState } from "../engine/battle";
import type { BattleEvent } from "../engine/events";
import { coord, type Coord, type Facing } from "../engine/grid";
import { asAbilityId, asPostId, asUnitId } from "../engine/ids";
import type { Seed } from "../engine/rng";
import { createUnit, type Unit, type UnitSide } from "../engine/unit";
import { DEFAULT_CONTROL_POLICY, autoBattleAllies, isAiControlled } from "./autoBattle";
import { AGGRESSIVE_FIELD_AI, runAiUntilPlayer } from "./battleRunner";
import { actionSpecFromAbility } from "./battleSetup";

/* --------------------------------------------------------------------------
 * The scene
 * ------------------------------------------------------------------------ */

/** Fixed seed, so the same quick battle is fought every reload and in tests. */
export const SKIRMISH_SEED: Seed = "quick-battle-farmhouse";

/** The reused board: a stone farmhouse with four deployment tiles a side. */
export const SKIRMISH_MAP_ID = "farmhouse-assault";

/** The action's display name, for the Field panel. */
export const SKIRMISH_NAME = "The Farmhouse";

/** One authored fighter: identity, post, stats and the actions it can use. */
interface PresetFighter {
  readonly id: string;
  readonly name: string;
  readonly power: PowerKey;
  readonly postId: string;
  readonly stats: StatBlock;
  /** Authored action ability ids (keys of `src/data/abilities`). */
  readonly abilities: readonly string[];
}

/**
 * The company's four starting specialists. Deliberately an **assortment**: a
 * line fusilier, a grenadier, a marksman and a surgeon, so the quick battle
 * exercises ranged fire, melee, area damage and healing in one fight.
 */
const COMPANY_ROSTER: readonly PresetFighter[] = [
  {
    id: "skirmish-aubry",
    name: "Sgt. Aubry",
    power: "france",
    postId: "fusilier",
    stats: { hp: 62, mp: 24, atk: 13, def: 9, mag: 4, res: 6, spd: 36, move: 4, jump: 2 },
    abilities: ["bayonet-charge", "volley-fire"],
  },
  {
    id: "skirmish-bouvet",
    name: "Cpl. Bouvet",
    power: "france",
    postId: "grenadier",
    stats: { hp: 70, mp: 18, atk: 15, def: 10, mag: 3, res: 5, spd: 30, move: 4, jump: 2 },
    abilities: ["crushing-blow", "bayonet-charge"],
  },
  {
    id: "skirmish-okafor",
    name: "Pte. Okafor",
    power: "britain",
    postId: "marksman",
    stats: { hp: 54, mp: 22, atk: 12, def: 7, mag: 4, res: 6, spd: 40, move: 5, jump: 3 },
    abilities: ["aimed-shot", "leading-shot"],
  },
  {
    id: "skirmish-marchand",
    name: "Dr. Marchand",
    power: "france",
    postId: "surgeon",
    stats: { hp: 50, mp: 30, atk: 9, def: 6, mag: 8, res: 8, spd: 32, move: 4, jump: 2 },
    abilities: ["surgical-dressing", "bayonet-charge"],
  },
];

/** The opposing scratch force: four irregulars holding the farmhouse. */
const ENEMY_ROSTER: readonly PresetFighter[] = [
  {
    id: "skirmish-line-deserter",
    name: "Line Deserter",
    power: "france",
    postId: "fusilier",
    stats: { hp: 58, mp: 16, atk: 12, def: 8, mag: 3, res: 4, spd: 30, move: 4, jump: 2 },
    abilities: ["bayonet-charge", "volley-fire"],
  },
  {
    id: "skirmish-veteran",
    name: "Veteran Serjeant",
    power: "france",
    postId: "grenadier",
    stats: { hp: 68, mp: 16, atk: 14, def: 9, mag: 3, res: 5, spd: 27, move: 4, jump: 2 },
    abilities: ["crushing-blow", "bayonet-charge"],
  },
  {
    id: "skirmish-petard",
    name: "Petard Crew",
    power: "france",
    postId: "artilleryman",
    stats: { hp: 52, mp: 20, atk: 11, def: 7, mag: 5, res: 5, spd: 33, move: 4, jump: 2 },
    abilities: ["grenade-lob", "bayonet-charge"],
  },
  {
    id: "skirmish-sapper",
    name: "Sapper Party",
    power: "russia",
    postId: "sapper",
    stats: { hp: 56, mp: 18, atk: 12, def: 8, mag: 4, res: 5, spd: 31, move: 4, jump: 2 },
    abilities: ["bayonet-charge", "aimed-shot"],
  },
];

/* --------------------------------------------------------------------------
 * Construction
 * ------------------------------------------------------------------------ */

/** Resolve an authored ability or fail loudly at scene construction. */
function requireAbility(id: string): AbilityDef {
  const ability = findAbility(id);
  if (ability === undefined) {
    throw new RangeError(`quick battle names unknown ability "${id}"`);
  }
  return ability;
}

/** Build one soldier through the authored engine factory. */
function buildFighter(fighter: PresetFighter, at: Coord, side: UnitSide, facing: Facing): Unit {
  return createUnit({
    id: asUnitId(fighter.id),
    name: fighter.name,
    power: fighter.power,
    postId: asPostId(fighter.postId),
    side,
    level: 1,
    at,
    facing,
    stats: fighter.stats,
    hp: fighter.stats.hp,
    mp: fighter.stats.mp,
    abilities: fighter.abilities.map((abilityId) => ({
      abilityId: asAbilityId(abilityId),
      drill: 0,
      mastered: true,
    })),
  });
}

/** The deployment tiles a side may use on the quick-battle board. */
function tilesFor(side: "company" | "enemy"): Coord[] {
  const zone = BATTLE_MAPS[SKIRMISH_MAP_ID].deployment.find((entry) => entry.side === side);
  return zone === undefined ? [] : zone.tiles.map((tile) => coord(tile.x, tile.y));
}

/**
 * Build the preset two-team battle. Four company specialists face four enemy
 * irregulars on the farmhouse board under an annihilation objective; the first
 * company soldier (Pte. Okafor, Speed 40) out-speeds every enemy, so the player
 * always takes the opening turn.
 */
export function createSkirmishBattle(): BattleState {
  const map = BATTLE_MAPS[SKIRMISH_MAP_ID];
  const companyTiles = tilesFor("company");
  const enemyTiles = tilesFor("enemy");
  if (companyTiles.length < COMPANY_ROSTER.length || enemyTiles.length < ENEMY_ROSTER.length) {
    throw new RangeError(`quick-battle board "${SKIRMISH_MAP_ID}" has too few deployment tiles`);
  }

  const units: Unit[] = [
    ...COMPANY_ROSTER.map((fighter, index) =>
      buildFighter(fighter, companyTiles[index] as Coord, "company", "east"),
    ),
    ...ENEMY_ROSTER.map((fighter, index) =>
      buildFighter(fighter, enemyTiles[index] as Coord, "enemy", "west"),
    ),
  ];

  const seen = new Map<string, AbilityDef>();
  for (const fighter of [...COMPANY_ROSTER, ...ENEMY_ROSTER]) {
    for (const id of fighter.abilities) {
      if (!seen.has(id)) seen.set(id, requireAbility(id));
    }
  }
  const actions: ActionSpec[] = [...seen.values()].map(actionSpecFromAbility);

  return createBattle(SKIRMISH_SEED, {
    map: battleMapToTerrainMap(map),
    units,
    abilities: actions,
    objective: { kind: "annihilation" },
  });
}

/* --------------------------------------------------------------------------
 * Driving the enemy
 * ------------------------------------------------------------------------ */

/** The result of one quick-battle AI phase. */
export interface SkirmishUpdate {
  readonly battle: BattleState;
  /** Events emitted by the AI turns, in resolution order (for the renderer). */
  readonly events: readonly BattleEvent[];
}

/**
 * If the enemy holds the turn, take every consecutive hostile turn and hand the
 * control back to the company. Returns `null` when nothing happened: the battle
 * is over, no one holds the turn, or a company soldier is waiting to act. Pure
 * and deterministic — the enemy plans through the seeded utility AI (T095) and
 * every command goes through `step`.
 */
export function advanceSkirmishBattle(battle: BattleState): SkirmishUpdate | null {
  if (!skirmishAiHoldsTurn(battle)) return null;

  const run = runAiUntilPlayer(battle, {
    policy: DEFAULT_CONTROL_POLICY,
    ai: AGGRESSIVE_FIELD_AI,
  });
  if (run.state === battle) return null;
  return { battle: run.state, events: run.events };
}

/** Whether the quick battle is waiting on an AI-controlled soldier. */
export function skirmishAiHoldsTurn(battle: BattleState): boolean {
  if (battle.phase === "finished") return false;
  const actorId = battle.currentActorId;
  if (actorId === null) return false;
  const actor = findUnit(battle, actorId);
  return actor !== undefined && isAiControlled(actor, DEFAULT_CONTROL_POLICY);
}

/**
 * Take exactly **one** AI soldier's turn in the quick battle, so the caller can
 * pace a whole enemy phase one action at a time (animation, pause, next).
 * Returns `null` when no AI soldier holds the turn or nothing changed.
 */
export function runSkirmishTurn(battle: BattleState): SkirmishUpdate | null {
  if (!skirmishAiHoldsTurn(battle)) return null;
  const run = runAiUntilPlayer(battle, {
    policy: DEFAULT_CONTROL_POLICY,
    ai: AGGRESSIVE_FIELD_AI,
    maxTurns: 1,
  });
  if (run.state === battle) return null;
  return { battle: run.state, events: run.events };
}

/**
 * Auto-battle the rest of the quick battle: hand both sides to the deterministic
 * AI (with {@link AGGRESSIVE_FIELD_AI}) and play until the annihilation
 * objective resolves. A convenience for a hands-off "commit the company" order
 * and a stable test path; pure and deterministic like any other AI turn.
 */
export function resolveSkirmishBattle(battle: BattleState): SkirmishUpdate {
  const policy = autoBattleAllies(DEFAULT_CONTROL_POLICY, "all");
  let working = battle;
  const events: BattleEvent[] = [];
  for (let i = 0; i < 200 && working.phase !== "finished"; i++) {
    const run = runAiUntilPlayer(working, { policy, ai: AGGRESSIVE_FIELD_AI, maxTurns: 24 });
    events.push(...run.events);
    if (run.state === working) break; // stalled — bail rather than spin
    working = run.state;
  }
  return { battle: working, events };
}
