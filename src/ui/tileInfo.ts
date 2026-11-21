/**

 * Tile inspector (T145) â€” the pure projection behind the battlefield's

 * terrain card.

 *

 * The cursor already tells the player *where* they are looking, but not what

 * the ground under it does. This module turns one engine tile into the small

 * display value a card can render: the authored terrain name and rules text,

 * the absolute elevation, the signed height difference against a reference

 * soldier, the move cost, and the passable / sight / water flags.

 *

 * ## Contract (`agents.md` Â§2, Â§7, Â§9)

 *

 * - **Presentation projection only.** It reads an immutable {@link TerrainMap}

 *   and a list of {@link Unit}s; it never mutates either and never advances the

 *   simulation.

 * - **Pure and deterministic.** Identical `(map, at, reference, units)` always

 *   yield the identical value. No DOM, no camera, no randomness.

 * - **Engine facts, not duplicated rules.** Terrain names, costs and flags come

 *   from `src/engine/terrain.ts` (`getTerrainDef`, `heightAt`, `moveCostAt`,

 *   `isPassableAt`, `blocksSightAt`), so the card cannot drift from the rules

 *   the pathfinder and combat resolver use.

 * - **Out-of-bounds is `null`, not a throw.** The inspector is a UI helper; the

 *   cursor may briefly point outside a freshly switched board, and a missing

 *   card is better than a crashed field.

 */

import { inBounds, type Coord } from "../engine/grid";

import {
  blocksSightAt,
  getTerrainDef,
  heightAt,
  isPassableAt,
  moveCostAt,
  terrainAt,
  type TerrainCategory,
  type TerrainMap,
  type TerrainType,
} from "../engine/terrain";

import type { Unit } from "../engine/unit";

import type { Translator } from "../i18n";

/** Everything the tile card needs to describe one grid square. */

export interface TileInfo {
  /** The inspected coordinate (copied, never aliased to the caller's value). */

  readonly at: Coord;

  /** Engine-stable terrain key. */

  readonly terrain: TerrainType;

  /** Player-facing Napoleonic terrain name. */

  readonly name: string;

  /** Mechanical rules text authored on the terrain definition. */

  readonly description: string;

  /** Coarse grouping (open / rough / built / water / fortification). */

  readonly category: TerrainCategory;

  /** Absolute elevation layer (`0`â€“`15`). */

  readonly height: number;

  /**

   * Signed height difference from the reference tile (`height - reference`);

   * `null` when no valid reference was supplied.

   */

  readonly elevationDelta: number | null;

  /** Base movement points to enter the tile, before any climb premium. */

  readonly moveCost: number;

  /** Whether ordinary foot/cavalry may enter at all. */

  readonly passable: boolean;

  /** Whether the surface obscures line of sight. */

  readonly blocksSight: boolean;

  /** Whether the surface is water (bridging/soaked-powder rules). */

  readonly water: boolean;

  /** The soldier standing here, or `null` for an empty tile. */

  readonly occupant: Unit | null;
}

/**

 * Describe the tile at `at` for the HUD.

 *

 * `reference` is normally the selected or acting soldier's tile; the card shows

 * the signed climb/descent from there. `units` lets the card report the tile as

 * occupied without the caller re-implementing the lookup.

 *

 * Returns `null` when `at` is outside the map, or when a supplied `reference`

 * is outside it (an invalid reference simply drops the delta rather than

 * failing the card).

 */

export function tileInfoFor(
  map: TerrainMap,

  at: Coord,

  reference: Coord | null = null,

  units: readonly Unit[] = [],
): TileInfo | null {
  if (!inBounds(map.grid, at)) return null;

  const tile = { x: at.x, y: at.y } as const;

  const terrain = terrainAt(map, tile);

  const def = getTerrainDef(terrain);

  const height = heightAt(map, tile);

  const referenceHeight =
    reference !== null && inBounds(map.grid, reference) ? heightAt(map, reference) : null;

  const occupant = units.find((unit) => unit.at.x === tile.x && unit.at.y === tile.y) ?? null;

  return {
    at: { x: tile.x, y: tile.y },

    terrain,

    name: def.name,

    description: def.description,

    category: def.category,

    height,

    elevationDelta: referenceHeight === null ? null : height - referenceHeight,

    moveCost: moveCostAt(map, tile),

    passable: isPassableAt(map, tile),

    blocksSight: blocksSightAt(map, tile),

    water: def.water,

    occupant,
  };
}

/** Format the signed elevation delta: `level`, `+2` or `-1`. */

export function elevationDeltaText(info: TileInfo, t: Translator): string {
  if (info.elevationDelta === null) return t("common.none");

  if (info.elevationDelta === 0) return t("hud.elevationLevel");

  return info.elevationDelta > 0 ? `+${info.elevationDelta}` : `${info.elevationDelta}`;
}

/**

 * The one-line screen-reader / e2e summary of a tile. Shared by the anchored

 * card and the field readout (`hud-tile`) so both report the same facts.

 */

export function describeTile(info: TileInfo, t: Translator): string {
  return [
    info.name,

    t("tile.heightValue", { height: info.height }),

    t("tile.deltaValue", { delta: elevationDeltaText(info, t) }),

    t("tile.moveCostValue", {
      cost: info.passable ? String(info.moveCost) : t("tile.impassable"),
    }),

    info.passable ? t("tile.passable") : t("tile.blocked"),

    info.blocksSight ? t("tile.sightBlocked") : t("tile.sightClear"),

    info.water ? t("tile.water") : t("tile.dry"),

    info.occupant === null
      ? t("tile.unoccupied")
      : t("tile.occupiedBy", { name: info.occupant.name }),
  ].join(" · ");
}
