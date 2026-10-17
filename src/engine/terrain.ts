/**
 * Terrain and elevation (T014) — the ground layer the square grid (T013) sits
 * on. Movement (T015), line of sight (T016) and the isometric renderer (T029)
 * all read their facts from here, so this module owns three things:
 *
 * 1. **Terrain types** — a closed, engine-stable set of keys (field, wood,
 *    village, river, redoubt, ...) with authored Napoleonic display text.
 * 2. **Per-type rules** — passability, movement cost and whether the tile
 *    blocks line of sight. These are *data*, not branches: adding a new
 *    battlefield surface is a new entry in {@link TERRAIN}, not new `if`s.
 * 3. **Per-tile elevation** — an integer height layer. A step between two tiles
 *    is gated by the mover's Climb (FFTA "Jump", mapping §12) and costs extra
 *    movement for every level gained.
 *
 * Contract:
 * - Pure, deterministic and serialisable: no DOM, no frequency, no mutation of
 *   inputs. {@link TerrainMap} is a plain value that round-trips through JSON.
 * - The **keys** are engine-stable; `name`/`description` carry the period
 *   fiction (mapping §14). Keys are deliberately *not* FFTA words — terrain is
 *   content we author, unlike the FFTA-shaped stat/ability keys.
 * - All tunable numbers live here as named constants so balance can move
 *   without touching logic.
 *
 * FFTA's move/jump model (mapping §12 "Move / Climb", "Height → Elevation")
 * is preserved: each tile has a movement cost, a unit may only step to a tile
 * whose height differs by at most its Climb, and climbing uphill costs more
 * than walking level or downhill. FFTA's `Jump` stat is our Climb.
 */

import { createGrid, coordToIndex, inBounds, type Coord, type Grid } from "./grid";

/* --------------------------------------------------------------------------
 * Terrain types
 * ------------------------------------------------------------------------ */

/**
 * The battlefield surfaces the engine knows. Keys are stable and
 * engine-shaped; display text is authored in {@link TERRAIN}.
 */
export const TERRAIN_TYPES = [
  "field",
  "road",
  "wood",
  "village",
  "river",
  "marsh",
  "hill",
  "redoubt",
  "wall",
  "rubble",
  "bridge",
  "rooftop",
] as const;

/** A terrain surface key. See {@link TERRAIN_TYPES} and {@link TERRAIN}. */
export type TerrainType = (typeof TERRAIN_TYPES)[number];

/** Coarse grouping used by later rules (cover, cavalry, artillery siting). */
export const TERRAIN_CATEGORIES = ["open", "rough", "built", "water", "fortification"] as const;
export type TerrainCategory = (typeof TERRAIN_CATEGORIES)[number];

/**
 * Authored rules for one terrain surface.
 *
 * This is the FFTA movement table re-authored for the Napoleonic theatre: the
 * numbers are our balance, inspired by (not copied from) the reference mirror's
 * terrain/movement behaviour.
 */
export interface TerrainDef {
  /** Engine-stable terrain key. */
  readonly id: TerrainType;
  /** Player-facing Napoleonic name (mapping §14, D6). */
  readonly name: string;
  /** Mechanical rules text. */
  readonly description: string;
  /** Broad grouping for later rules. */
  readonly category: TerrainCategory;
  /**
   * Movement points spent to *enter* the tile, before any climb premium.
   * FFTA-equivalent: 1 = normal, 2 = difficult, higher = punishing.
   */
  readonly moveCost: number;
  /** Whether foot/cavalry may enter at all. Impassable tiles use `false`. */
  readonly passable: boolean;
  /** Whether the tile obscures line of sight (T016 — woods, buildings). */
  readonly blocksSight: boolean;
  /** Whether the surface is water (Deluge/soaked powder, bridging rules). */
  readonly water: boolean;
}

/**
 * The terrain registry. Values are re-authored balance data: FFTA's movement
 * model inspired the shape (cost 1 normal / 2 rough, water impassable), but the
 * numbers are ours and safe to retune.
 */
export const TERRAIN: Readonly<Record<TerrainType, TerrainDef>> = {
  field: {
    id: "field",
    name: "Open Field",
    description: "Ploughed ground and meadow. Normal movement, no cover, clear sight.",
    category: "open",
    moveCost: 1,
    passable: true,
    blocksSight: false,
    water: false,
  },
  road: {
    id: "road",
    name: "Road",
    description: "Metalled or beaten track. Normal movement; columns move freely.",
    category: "open",
    moveCost: 1,
    passable: true,
    blocksSight: false,
    water: false,
  },
  wood: {
    id: "wood",
    name: "Wood",
    description: "Trees and undergrowth slow movement and block line of sight.",
    category: "rough",
    moveCost: 2,
    passable: true,
    blocksSight: true,
    water: false,
  },
  village: {
    id: "village",
    name: "Village",
    description: "Built-up streets and walls: costly to cross and sight-blocking.",
    category: "built",
    moveCost: 2,
    passable: true,
    blocksSight: true,
    water: false,
  },
  river: {
    id: "river",
    name: "River",
    description: "Open water. Impassable without a bridge, ford or bridging train.",
    category: "water",
    moveCost: 99,
    passable: false,
    blocksSight: false,
    water: true,
  },
  marsh: {
    id: "marsh",
    name: "Marsh",
    description: "Bog and flooded ground. Very slow going; clear sight lines.",
    category: "rough",
    moveCost: 3,
    passable: true,
    blocksSight: false,
    water: false,
  },
  hill: {
    id: "hill",
    name: "Rising Ground",
    description: "Sloped high ground. Slower to climb but commanding.",
    category: "rough",
    moveCost: 2,
    passable: true,
    blocksSight: false,
    water: false,
  },
  redoubt: {
    id: "redoubt",
    name: "Redoubt",
    description: "Earthwork parapet. Costly to storm, but not sight-blocking.",
    category: "fortification",
    moveCost: 2,
    passable: true,
    blocksSight: false,
    water: false,
  },
  wall: {
    id: "wall",
    name: "Stone Wall",
    description: "Solid masonry. Impassable on foot and blocks line of sight.",
    category: "built",
    moveCost: 99,
    passable: false,
    blocksSight: true,
    water: false,
  },
  rubble: {
    id: "rubble",
    name: "Rubble",
    description: "Broken masonry and debris. Slow to cross but does not block sight.",
    category: "rough",
    moveCost: 2,
    passable: true,
    blocksSight: false,
    water: false,
  },
  bridge: {
    id: "bridge",
    name: "Bridge",
    description: "A span over water. Normal movement, a natural choke point.",
    category: "built",
    moveCost: 1,
    passable: true,
    blocksSight: false,
    water: false,
  },
  rooftop: {
    id: "rooftop",
    name: "Rooftop",
    description: "Elevated footing reachable only by climbing. Normal movement.",
    category: "built",
    moveCost: 1,
    passable: true,
    blocksSight: false,
    water: false,
  },
} as const;

/** Runtime guard for untrusted terrain keys (saves, network, map files). */
export function isTerrainType(value: unknown): value is TerrainType {
  return typeof value === "string" && (TERRAIN_TYPES as readonly string[]).includes(value);
}

/** Look up a terrain definition. Throws when the key is unknown. */
export function getTerrainDef(type: TerrainType): TerrainDef {
  const def = TERRAIN[type];
  if (!def) {
    throw new RangeError(`unknown terrain type: ${String(type)}`);
  }
  return def;
}

/* --------------------------------------------------------------------------
 * Elevation rules (FFTA "Height" → Elevation, mapping §12)
 * ------------------------------------------------------------------------ */

/**
 * Lowest and highest legal elevation layers. FFTA maps stack tiles a few levels
 * high; we allow a little head-room so ramparts, rooftops and embankments can
 * share one integer scale. Re-authored balance, not a wiki constant.
 */
export const MIN_HEIGHT = 0;
export const MAX_HEIGHT = 15;

/**
 * Extra movement points charged per elevation level gained when climbing. Level
 * and downhill steps are free of premium; only uphill movement is taxed, which
 * keeps a unit's Climb stat the sole gate on how high it can go.
 */
export const CLIMB_COST_PER_LEVEL = 1;

/** Number of elevation layers crossed between two heights (always ≥ 0). */
export function elevationDelta(fromHeight: number, toHeight: number): number {
  return Math.abs(toHeight - fromHeight);
}

/**
 * Whether a mover with `climb` can step between two heights. Preserves FFTA's
 * Jump gate: the height difference (up **or** down) may not exceed Climb.
 */
export function canClimb(climb: number, fromHeight: number, toHeight: number): boolean {
  return elevationDelta(fromHeight, toHeight) <= climb;
}

/**
 * Movement points to step from one tile to another: the destination's terrain
 * cost plus a premium for every level climbed. Downhill and level steps pay no
 * premium. This is the edge weight A* (T015) will use.
 */
export function stepCost(from: TerrainTile, to: TerrainTile): number {
  const base = getTerrainDef(to.terrain).moveCost;
  const climb = Math.max(0, to.height - from.height) * CLIMB_COST_PER_LEVEL;
  return base + climb;
}

/* --------------------------------------------------------------------------
 * Tiles and maps
 * ------------------------------------------------------------------------ */

/** One grid tile: a terrain surface at an integer elevation layer. */
export interface TerrainTile {
  readonly terrain: TerrainType;
  /** Elevation layer, within [{@link MIN_HEIGHT}, {@link MAX_HEIGHT}]. */
  readonly height: number;
}

/**
 * A rectangular battlefield: a {@link Grid} plus a row-major array of tiles.
 * Index `y * width + x` (see `grid.coordToIndex`) holds tile `(x, y)`. Plain
 * and JSON-serialisable, so it rides along in saves and replays.
 */
export interface TerrainMap {
  readonly grid: Grid;
  /** `grid.width * grid.height` tiles, north→south then west→east. */
  readonly tiles: readonly TerrainTile[];
}

/** Assert a value is a usable elevation layer; returns it narrowed to `number`. */
function assertHeight(height: number, label = "height"): number {
  if (!Number.isInteger(height) || height < MIN_HEIGHT || height > MAX_HEIGHT) {
    throw new RangeError(
      `${label} must be an integer within [${MIN_HEIGHT}, ${MAX_HEIGHT}], received ${String(height)}`,
    );
  }
  return height;
}

/** Normalise an authored terrain spec into a validated {@link TerrainTile}. */
function toTile(spec: TerrainType | TerrainTile): TerrainTile {
  if (typeof spec === "string") {
    getTerrainDef(spec); // validation, throws on unknown
    return { terrain: spec, height: MIN_HEIGHT };
  }
  if (!isTerrainType(spec.terrain)) {
    throw new RangeError(`unknown terrain type: ${String(spec.terrain)}`);
  }
  return { terrain: spec.terrain, height: assertHeight(spec.height) };
}

/**
 * Build a rectangular map filled with one terrain. `fill` may be a bare
 * {@link TerrainType} (which fills at elevation {@link MIN_HEIGHT}) or a full
 * {@link TerrainTile} to set an initial height.
 *
 * ```ts
 * const map = createTerrainMap(10, 8, "field");
 * ```
 */
export function createTerrainMap(
  width: number,
  height: number,
  fill: TerrainType | TerrainTile = "field",
): TerrainMap {
  const grid = createGrid(width, height);
  const tile = toTile(fill);
  const tiles = Array.from({ length: width * height }, () => tile);
  return { grid, tiles };
}

/** Total tiles in a map (mirrors `grid.tileCount`). */
export function terrainTileCount(map: TerrainMap): number {
  return map.tiles.length;
}

/** The tile at `at`. Throws a `RangeError` naming the coordinate when off-grid. */
export function terrainTileAt(map: TerrainMap, at: Coord): TerrainTile {
  if (!inBounds(map.grid, at)) {
    throw new RangeError(
      `tile { x: ${at.x}, y: ${at.y} } is outside the ${map.grid.width}×${map.grid.height} map`,
    );
  }
  const tile = map.tiles[coordToIndex(map.grid, at)];
  // `createTerrainMap`/`withTile` guarantee a tile exists for every in-bounds
  // index; this only fires if a caller hand-built a malformed map.
  if (!tile) {
    throw new RangeError(`map has no tile at { x: ${at.x}, y: ${at.y} }`);
  }
  return tile;
}

/** The terrain surface key at `at`. Throws when off-grid. */
export function terrainAt(map: TerrainMap, at: Coord): TerrainType {
  return terrainTileAt(map, at).terrain;
}

/** The elevation layer at `at`. Throws when off-grid. */
export function heightAt(map: TerrainMap, at: Coord): number {
  return terrainTileAt(map, at).height;
}

/** Whether `at` may be entered by ordinary foot/cavalry (terrain alone). */
export function isPassableAt(map: TerrainMap, at: Coord): boolean {
  return getTerrainDef(terrainAt(map, at)).passable;
}

/** Base movement cost to enter `at`, ignoring elevation (T015 adds climb). */
export function moveCostAt(map: TerrainMap, at: Coord): number {
  return getTerrainDef(terrainAt(map, at)).moveCost;
}

/** Whether `at` obscures line of sight (T016). */
export function blocksSightAt(map: TerrainMap, at: Coord): boolean {
  return getTerrainDef(terrainAt(map, at)).blocksSight;
}

/**
 * Return a new map with the tile at `at` replaced. The input map is untouched
 * (engine state is immutable, `agents.md` §7). Useful for test fixtures and the
 * campaign-map/editor path.
 */
export function withTile(map: TerrainMap, at: Coord, spec: TerrainType | TerrainTile): TerrainMap {
  if (!inBounds(map.grid, at)) {
    throw new RangeError(
      `tile { x: ${at.x}, y: ${at.y} } is outside the ${map.grid.width}×${map.grid.height} map`,
    );
  }
  const index = coordToIndex(map.grid, at);
  const tiles = map.tiles.slice();
  tiles[index] = toTile(spec);
  return { grid: map.grid, tiles };
}
