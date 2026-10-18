/**
 * Orders of battle (T118) — the bridge from an authored battle map to the
 * irregular troops that hold it.
 *
 * A `BattleMapDef` (`../maps/battleMaps.ts`) already names the win condition,
 * the terrain and the tiles each side may deploy on, but it deliberately says
 * nothing about **who** the enemy is: the map is reusable and the roster is a
 * separate content concern (`agents.md` §2, §3). This module supplies the
 * missing half. Each entry is a small **order of battle** keyed by the battle
 * map's stable id: a list of `{ enemyId, level?, at }` triples that binds an
 * authored {@link EnemyDef} (`./index.ts`, T091) to one of the map's `enemy`
 * deployment tiles.
 *
 * ```
 *   battle map  ── enemy deployment tiles ──┐
 *                                           ├─► OrderOfBattleDef ─► buildBattleFromContract
 *   enemy roster ── EnemyDef ───────────────┘        (src/app/battleSetup.ts)
 * ```
 *
 * ## Why a separate table
 *
 * - **Reuse.** A wood, a bridge or a crossroads can host several actions;
 *   binding the enemy inside the map would fork the board for every garrison.
 * - **Balance.** `level` lets a later pass tune one encounter without editing
 *   the troop itself; the troop's stat block stays its authored baseline.
 * - **Determinism.** The table is static data with a fixed order, so
 *   `buildBattleFromContract` deploys the same troops on the same tiles for a
 *   fixed seed (`agents.md` §2).
 *
 * Only **combat** maps (a `battle`, `skirmish` or `pacification` contract)
 * carry an order of battle. A map without one, or a combat contract with no
 * map, is an authoring fault that fails loudly at the deployment layer rather
 * than fielding an empty board.
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.** Enemy and map ids stay plain strings;
 *   the engine brands them at its boundary (T012), and `src/app` resolves the
 *   two tables together.
 * - **No placeholders.** Every `enemyId` names an authored irregular; every
 *   `at` names a tile of that map's enemy deployment zone (pinned by
 *   `tests/unit/battleSetup.test.ts`).
 */

import type { BattleMapKey } from "../maps/battleMaps";

/* --------------------------------------------------------------------------
 * Types
 * ------------------------------------------------------------------------ */

/** A tile an order of battle may station a troop on (matches the map's coords). */
export interface OrderOfBattleTile {
  readonly x: number;
  readonly y: number;
}

/**
 * One troop of an order of battle: which irregular holds the ground, at what
 * level, and on which of the map's `enemy` deployment tiles.
 */
export interface OrderOfBattleUnit {
  /** Stable troop id (a key of the enemy roster in `./index.ts`). */
  readonly enemyId: string;
  /**
   * Level an authored troop is fielded at. Omitted means the troop's own
   * `EnemyDef.level`; the stat block is the troop's authored baseline either
   * way (the enemy roster has no separate growth table).
   */
  readonly level?: number;
  /** The map's `enemy` deployment tile this troop stands on. */
  readonly at: OrderOfBattleTile;
}

/** The enemy garrison of one battle map, in deployment order. */
export interface OrderOfBattleDef {
  /** The battle map this order of battle defends (a `BattleMapKey`). */
  readonly mapId: BattleMapKey;
  /** The troops, in the order they are deployed onto the map's enemy tiles. */
  readonly units: readonly OrderOfBattleUnit[];
}

/* --------------------------------------------------------------------------
 * The table
 * ------------------------------------------------------------------------ */

/**
 * Every authored order of battle, keyed by the battle map it defends. Maps
 * absent from the table (non-combat boards, or boards whose garrison is still
 * to be authored) make `buildBattleFromContract` fail loudly rather than field
 * a one-sided battle.
 */
export const ORDERS_OF_BATTLE: Readonly<Partial<Record<BattleMapKey, OrderOfBattleDef>>> = {
  /* ----- Sainte-Colombe: the bridge ------------------------------------- */

  "sainte-colombe-bridge": {
    mapId: "sainte-colombe-bridge",
    units: [
      { enemyId: "militia-conscript", level: 1, at: { x: 10, y: 3 } },
      { enemyId: "militia-conscript", level: 1, at: { x: 10, y: 4 } },
      { enemyId: "town-levy", level: 1, at: { x: 10, y: 5 } },
      { enemyId: "militia-conscript", level: 1, at: { x: 9, y: 4 } },
    ],
  },

  /* ----- The Blackwood: a picket line ----------------------------------- */

  "blackwood-picket": {
    mapId: "blackwood-picket",
    units: [
      { enemyId: "town-levy", at: { x: 8, y: 7 } },
      { enemyId: "scout-hounds", at: { x: 9, y: 7 } },
      { enemyId: "blackwood-guerrilla", level: 2, at: { x: 9, y: 6 } },
    ],
  },

  /* ----- The Blackwood: the camp ---------------------------------------- */

  "guerrilla-camp": {
    mapId: "guerrilla-camp",
    units: [
      { enemyId: "blackwood-guerrilla", at: { x: 5, y: 2 } },
      { enemyId: "pass-sniper", at: { x: 6, y: 2 } },
      { enemyId: "partisan-band", level: 3, at: { x: 5, y: 3 } },
      { enemyId: "petard-crew", at: { x: 6, y: 3 } },
    ],
  },

  /* ----- The Crossroads: a rival company's stand ------------------------ */

  "crossroads-skirmish": {
    mapId: "crossroads-skirmish",
    units: [
      { enemyId: "town-levy", at: { x: 8, y: 3 } },
      { enemyId: "line-deserter", level: 2, at: { x: 9, y: 3 } },
      { enemyId: "scout-hounds", at: { x: 10, y: 3 } },
    ],
  },

  /* ----- The Coast Road: raiders in the marsh --------------------------- */

  "coast-road-ambush": {
    mapId: "coast-road-ambush",
    units: [
      { enemyId: "line-deserter", at: { x: 9, y: 4 } },
      { enemyId: "blackwood-guerrilla", at: { x: 10, y: 4 } },
      { enemyId: "pass-sniper", level: 4, at: { x: 11, y: 4 } },
    ],
  },

  /* ----- The farmhouse --------------------------------------------------- */

  "farmhouse-assault": {
    mapId: "farmhouse-assault",
    units: [
      { enemyId: "line-deserter", at: { x: 11, y: 3 } },
      { enemyId: "veteran-serjeant", at: { x: 10, y: 3 } },
      { enemyId: "petard-crew", at: { x: 11, y: 4 } },
      { enemyId: "sapper-party", at: { x: 10, y: 4 } },
    ],
  },

  /* ----- The redoubt ----------------------------------------------------- */

  "redoubt-stand": {
    mapId: "redoubt-stand",
    units: [
      { enemyId: "veteran-serjeant", at: { x: 4, y: 1 } },
      { enemyId: "powder-team", at: { x: 5, y: 1 } },
      { enemyId: "six-pounder-section", at: { x: 6, y: 1 } },
      { enemyId: "pioneer-section", at: { x: 5, y: 2 } },
    ],
  },

  /* ----- The orchard ----------------------------------------------------- */

  "orchard-skirmish": {
    mapId: "orchard-skirmish",
    units: [
      { enemyId: "town-levy", at: { x: 10, y: 3 } },
      { enemyId: "town-levy", at: { x: 10, y: 4 } },
      { enemyId: "scout-hounds", at: { x: 9, y: 4 } },
    ],
  },

  /* ----- The dawn duel --------------------------------------------------- */

  "duel-at-dawn": {
    mapId: "duel-at-dawn",
    units: [
      { enemyId: "line-deserter", level: 2, at: { x: 8, y: 2 } },
      { enemyId: "town-levy", at: { x: 8, y: 3 } },
      { enemyId: "town-levy", at: { x: 8, y: 4 } },
    ],
  },
};

/* --------------------------------------------------------------------------
 * Lookups
 * ------------------------------------------------------------------------ */

/** Runtime guard: `true` when `mapId` names a map with an authored garrison. */
export function hasOrderOfBattle(mapId: string): boolean {
  return (ORDERS_OF_BATTLE as Record<string, OrderOfBattleDef | undefined>)[mapId] !== undefined;
}

/**
 * The order of battle for `mapId`. Throws a `RangeError` when the map has no
 * authored garrison, so a missing table entry fails loudly at the boundary
 * instead of fielding a battle with no enemy.
 */
export function orderOfBattleFor(mapId: string): OrderOfBattleDef {
  const order = (ORDERS_OF_BATTLE as Record<string, OrderOfBattleDef | undefined>)[mapId];
  if (order === undefined) {
    throw new RangeError(`battle map "${mapId}" has no authored order of battle`);
  }
  return order;
}

/** The battle-map ids that carry an order of battle, in authoring order. */
export const ORDER_OF_BATTLE_MAP_IDS: readonly BattleMapKey[] = Object.keys(
  ORDERS_OF_BATTLE,
) as BattleMapKey[];
