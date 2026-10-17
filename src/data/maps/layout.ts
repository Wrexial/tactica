/**
 * Expanding an authored battle map into engine-shaped tiles (T074).
 *
 * {@link BattleMapDef} stores a board in the compact authoring format (rows of
 * terrain codes plus an optional layer of elevation codes). The engine's
 * `TerrainMap` (`src/engine/terrain.ts`, T014) instead wants a flat, row-major
 * array of `{ terrain, height }` tiles. This module is the one-way bridge
 * between the two.
 *
 * It deliberately does **not** import the engine: `src/data/` may not depend on
 * `src/engine/` (`src/data/README.md`). Instead {@link battleMapToTerrainMap}
 * returns a plain `{ grid, tiles }` value whose shape is structurally
 * assignable to `TerrainMap`, so a caller can hand it straight to
 * `createBattle` / `createTerrainMap` without a cast. The map tests pin that
 * compatibility.
 *
 * Contract (`agents.md` §2, §3, §7):
 * - Pure and deterministic: the same definition always expands to the same
 *   tiles, in row-major order (`y * width + x`).
 * - No mutation: a fresh array is returned every call.
 * - Trusted input: a `BattleMapDef` has already passed {@link BattleMapDefSchema},
 *   so the codes resolve; the guards below only protect hand-built objects.
 */

import { heightFromChar, terrainFromChar, type BattleMapDef, type TerrainKey } from "./schema";

/** One expanded tile: a terrain surface at an integer elevation layer. */
export interface BattleMapTile {
  readonly terrain: TerrainKey;
  readonly height: number;
}

/**
 * A grid plus a flat, row-major tile array. Structurally identical to the
 * engine's `TerrainMap`, declared locally so the data layer stays engine-free.
 */
export interface BattleMapTerrain {
  readonly grid: { readonly width: number; readonly height: number };
  readonly tiles: readonly BattleMapTile[];
}

/**
 * Expand a parsed battle map into its `width × height` tiles, north→south then
 * west→east (`grid.coordToIndex` order). A missing elevation layer means
 * everything stands at height {@link MAP_MIN_HEIGHT}.
 *
 * @throws RangeError when a definition was hand-built with an unknown terrain
 *   or elevation code (parsed content cannot hit this).
 */
export function expandBattleMap(def: BattleMapDef): readonly BattleMapTile[] {
  const tiles: BattleMapTile[] = [];
  for (let y = 0; y < def.height; y++) {
    const terrainRow = def.layout[y];
    const elevationRow = def.elevation?.[y];
    for (let x = 0; x < def.width; x++) {
      const terrain = terrainFromChar(terrainRow?.[x] ?? "");
      if (terrain === undefined) {
        throw new RangeError(
          `battle map ${def.id} has no terrain code at { x: ${x}, y: ${y} } (row ${y}, column ${x})`,
        );
      }
      const height = elevationRow === undefined ? 0 : heightFromChar(elevationRow[x] ?? "");
      if (height === undefined) {
        throw new RangeError(
          `battle map ${def.id} has an invalid elevation code at { x: ${x}, y: ${y} }`,
        );
      }
      tiles.push({ terrain, height });
    }
  }
  return tiles;
}

/**
 * Turn a parsed battle map into a value assignable to the engine's
 * `TerrainMap`:
 *
 * ```ts
 * createBattle(seed, { map: battleMapToTerrainMap(BATTLE_MAPS["sainte-colombe-bridge"]), units });
 * ```
 */
export function battleMapToTerrainMap(def: BattleMapDef): BattleMapTerrain {
  return {
    grid: { width: def.width, height: def.height },
    tiles: expandBattleMap(def),
  };
}
