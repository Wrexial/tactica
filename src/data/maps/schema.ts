/**
 * Battle-map & location schemas (T074, mapping §10/§12).
 *
 * FFTA's world is fought over in discrete, hand-authored **maps**: a rectangle
 * of tiles, each with a terrain surface and an elevation ("height"), plus the
 * mission's win condition (defeat all, survive N turns, hold a point...). The
 * retheme keeps that contract and renames the pieces around the Napoleonic
 * theatre: a **Location** is a named place in the Theatre (a bridge, a forest,
 * a pass), and a **Battle Map** is the board a detachment action is fought on
 * (mapping §0 "detachment scale", §12 "Height → Elevation").
 *
 * ## Where the schemas live
 *
 * Following the pattern of `src/data/weapons.ts` and `src/data/guards.ts`, the
 * collection-specific Zod schemas live with the collection rather than in the
 * shared `src/data/schema.ts`. Only the primitives every def shares
 * (`IdSchema`, `DisplayFields`) are imported from there, so the data layer
 * never reaches into `src/engine` (`src/data/README.md`).
 *
 * ## Terrain keys are mirrored, not imported
 *
 * The engine owns the canonical terrain set in `src/engine/terrain.ts`
 * (`TERRAIN_TYPES`, T014). The data layer may not import the engine
 * (`src/data/README.md`), so {@link TERRAIN_KEYS} restates the same twelve keys
 * and `tests/unit/maps.test.ts` asserts the two lists are identical. That
 * mirror test is the single integration point; if T014 ever grows a surface,
 * the map data and this list must grow with it.
 *
 * ## Authoring format
 *
 * A map is authored as **rows of single-character terrain codes** (the compact
 * format is much easier to read and diff than a flat tile array) plus an
 * optional **elevation layer** using the characters `0`–`9` and `a`–`f`
 * (`0`–`15`, matching the engine's elevation range). {@link BattleMapDefSchema}
 * validates the grid's shape and codes; `expandBattleMap` in `./layout.ts`
 * turns it into the tile array the engine's `TerrainMap` expects.
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.** Content lives here; the engine imports
 *   *this*, never the reverse.
 * - **Validated at load.** Every def is parsed with its schema, so a mistyped
 *   terrain code, a ragged row or an out-of-bounds deployment tile fails loudly
 *   at module load rather than skewing a battle.
 * - **No placeholders.** Every location and map carries an authored Napoleonic
 *   `name`, `description` and `flavour` (mapping §14, D6/D8).
 */

import { z } from "zod";

import { DisplayFields, IdSchema } from "../schema";

/* --------------------------------------------------------------------------
 * Terrain keys (mirror of the engine's `TERRAIN_TYPES`, T014)
 * ------------------------------------------------------------------------ */

/**
 * The terrain surfaces a battle map may use. **Mirror only** — the engine's
 * `TERRAIN_TYPES` is authoritative and the two are pinned together by the map
 * tests. Keep the order identical so the mirror test is a simple equality.
 */
export const TERRAIN_KEYS = [
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

/** A terrain surface key the data layer is allowed to name. */
export const TerrainKeySchema = z.enum(TERRAIN_KEYS);
export type TerrainKey = z.infer<typeof TerrainKeySchema>;

/** The single character that authors each terrain surface in a map layout. */
export const MAP_TERRAIN_CHARS: Readonly<Record<string, TerrainKey>> = {
  ".": "field",
  "=": "road",
  "%": "wood",
  "#": "village",
  "~": "river",
  ",": "marsh",
  "^": "hill",
  O: "redoubt",
  W: "wall",
  x: "rubble",
  B: "bridge",
  R: "rooftop",
};

/** The inverse of {@link MAP_TERRAIN_CHARS}: the code used to author a surface. */
export const TERRAIN_CHAR_FOR: Readonly<Record<TerrainKey, string>> = Object.fromEntries(
  Object.entries(MAP_TERRAIN_CHARS).map(([char, terrain]) => [terrain, char]),
) as Record<TerrainKey, string>;

/** Resolve a layout character to its terrain key, or `undefined` when unknown. */
export function terrainFromChar(char: string): TerrainKey | undefined {
  return MAP_TERRAIN_CHARS[char];
}

/* --------------------------------------------------------------------------
 * Elevation layer
 * ------------------------------------------------------------------------ */

/** Lowest elevation layer an authored map may use (matches the engine). */
export const MAP_MIN_HEIGHT = 0;
/** Highest elevation layer an authored map may use (`'f'`, matches the engine). */
export const MAP_MAX_HEIGHT = 15;

/** The elevation codes, one per integer layer `0`–`15`. */
export const ELEVATION_CHARS = "0123456789abcdef";

/** Resolve an elevation character to its layer, or `undefined` when unknown. */
export function heightFromChar(char: string): number | undefined {
  const index = ELEVATION_CHARS.indexOf(char);
  return index === -1 ? undefined : index;
}

/* --------------------------------------------------------------------------
 * Grid coordinates
 * ------------------------------------------------------------------------ */

/** A non-negative integer tile position. Bounds are checked per map. */
export const MapCoordSchema = z.object({
  x: z.number().int().min(0).describe("column, west→east"),
  y: z.number().int().min(0).describe("row, north→south"),
});
export type MapCoord = z.infer<typeof MapCoordSchema>;

/* --------------------------------------------------------------------------
 * Deployment, objectives
 * ------------------------------------------------------------------------ */

/** The sides a deployment zone can belong to. */
export const DEPLOYMENT_SIDES = ["company", "enemy", "neutral"] as const;
export const DeploymentSideSchema = z.enum(DEPLOYMENT_SIDES);
export type DeploymentSide = z.infer<typeof DeploymentSideSchema>;

/** A side's starting tiles. The scenario places soldiers on these at setup. */
export const DeploymentZoneSchema = z.object({
  side: DeploymentSideSchema,
  /** Tiles this side may start on; each must lie inside the map. */
  tiles: z.array(MapCoordSchema).min(1),
});
export type DeploymentZone = z.infer<typeof DeploymentZoneSchema>;

/**
 * The win/lose condition of a battle map. The shapes mirror the engine's
 * `Objective` union (`src/engine/objectives.ts`) structurally — the data layer
 * declares its own copy because it may not import the engine, exactly as
 * `weapons.ts` mirrors `WeaponFormula`.
 *
 * | kind           | win condition                                  |
 * | -------------- | ---------------------------------------------- |
 * | `annihilation` | put every enemy soldier out of action          |
 * | `rout`         | put `defeated` enemy soldiers out of action    |
 * | `survive`      | endure `turns` Orders Tempo turns              |
 * | `capture`      | stand a soldier on `at`                        |
 * | `defend`       | hold `at` for `turns` Orders Tempo turns       |
 */
export const BattleMapObjectiveSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("annihilation") }),
  z.object({ kind: z.literal("rout"), defeated: z.number().int().positive() }),
  z.object({ kind: z.literal("survive"), turns: z.number().int().positive() }),
  z.object({ kind: z.literal("capture"), at: MapCoordSchema }),
  z.object({ kind: z.literal("defend"), at: MapCoordSchema, turns: z.number().int().positive() }),
]);
export type BattleMapObjective = z.infer<typeof BattleMapObjectiveSchema>;

/* --------------------------------------------------------------------------
 * Battle map
 * ------------------------------------------------------------------------ */

/** Smallest side of an authored battle map. */
export const MAP_MIN_DIMENSION = 1;
/** Largest side of an authored battle map; keeps a board (and a save) bounded. */
export const MAP_MAX_DIMENSION = 32;

/** `true` when `at` names a tile of a `width × height` map. */
function inGrid(width: number, height: number, at: MapCoord): boolean {
  return at.x >= 0 && at.x < width && at.y >= 0 && at.y < height;
}

/** Check a terrain or elevation layer has exactly `height` rows of `width` chars. */
function checkLayer(
  layer: readonly string[],
  width: number,
  height: number,
  kind: "layout" | "elevation",
  ctx: z.RefinementCtx,
): void {
  if (layer.length !== height) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `${kind} must have ${height} rows, received ${layer.length}`,
      path: [kind],
    });
  }
  layer.forEach((row, y) => {
    if (row.length !== width) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${kind} row ${y} must be ${width} characters, received ${row.length}`,
        path: [kind, y],
      });
    }
    [...row].forEach((char, x) => {
      const valid =
        kind === "layout"
          ? terrainFromChar(char) !== undefined
          : heightFromChar(char) !== undefined;
      if (!valid) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            kind === "layout"
              ? `unknown terrain character "${char}"`
              : `unknown elevation character "${char}"`,
          path: [kind, y, x],
        });
      }
    });
  });
}

/**
 * A battlefield board. `layout` holds one row of terrain codes per grid row
 * (north→south); `elevation`, when present, holds one row of height codes with
 * the same shape. Deployment and the objective are checked to lie inside the
 * grid.
 */
export const BattleMapDefSchema = z
  .object({
    id: IdSchema,
    ...DisplayFields,
    /** The Location (T074) this action is fought at. */
    locationId: IdSchema,
    /** Grid width in tiles (west→east). */
    width: z.number().int().min(MAP_MIN_DIMENSION).max(MAP_MAX_DIMENSION),
    /** Grid height in tiles (north→south). */
    height: z.number().int().min(MAP_MIN_DIMENSION).max(MAP_MAX_DIMENSION),
    /** Terrain rows; `height` rows of exactly `width` {@link MAP_TERRAIN_CHARS}. */
    layout: z.array(z.string()).min(1),
    /** Optional elevation rows; same shape as `layout`, codes `0`–`f`. */
    elevation: z.array(z.string()).optional(),
    /** Where each side deploys (empty for a map that spawns units itself). */
    deployment: z.array(DeploymentZoneSchema).default([]),
    /** The win/lose condition this action is fought under. */
    objective: BattleMapObjectiveSchema,
    /** Balance hint for the Officers' Mess and AI (T095). */
    recommendedLevel: z.number().int().positive().default(1),
    /** Contract (T070) that posts this action, when one does. */
    contractId: IdSchema.optional(),
  })
  .superRefine((def, ctx) => {
    checkLayer(def.layout, def.width, def.height, "layout", ctx);
    if (def.elevation !== undefined) {
      checkLayer(def.elevation, def.width, def.height, "elevation", ctx);
    }

    def.deployment.forEach((zone, zoneIndex) => {
      zone.tiles.forEach((tile, tileIndex) => {
        if (!inGrid(def.width, def.height, tile)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `deployment tile { x: ${tile.x}, y: ${tile.y} } is outside the ${def.width}×${def.height} map`,
            path: ["deployment", zoneIndex, "tiles", tileIndex],
          });
        }
      });
    });

    if ("at" in def.objective && !inGrid(def.width, def.height, def.objective.at)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `objective tile { x: ${def.objective.at.x}, y: ${def.objective.at.y} } is outside the ${def.width}×${def.height} map`,
        path: ["objective", "at"],
      });
    }
  });
export type BattleMapDef = z.infer<typeof BattleMapDefSchema>;

/* --------------------------------------------------------------------------
 * Location
 * ------------------------------------------------------------------------ */

/**
 * A named place in the Theatre. Locations are the fiction around a region on
 * the Campaign Map (T073) and the anchor a battle map hangs from; a location
 * may host several maps (a picket action and a camp assault in the same wood).
 */
export const LocationDefSchema = z.object({
  id: IdSchema,
  ...DisplayFields,
  /** Campaign-map region this location establishes (T073). */
  regionId: IdSchema,
  /** Dominant terrain, used for map markers and travel flavour. */
  terrain: TerrainKeySchema,
  /** Battle maps fought here, in authored order. */
  battleMapIds: z.array(IdSchema).default([]),
  /** No-Man's Land (FFTA Jagd): no Provost, losses permanent (mapping §9). */
  isNoMansLand: z.boolean().default(false),
  /** Story chapter that unlocks the location (T077); omitted = always open. */
  chapter: z.number().int().positive().optional(),
});
export type LocationDef = z.infer<typeof LocationDefSchema>;

/* --------------------------------------------------------------------------
 * Bundle
 * ------------------------------------------------------------------------ */

/** Locations and battle maps together, for a single validation pass. */
export const MapBundleSchema = z.object({
  locations: z.array(LocationDefSchema).default([]),
  battleMaps: z.array(BattleMapDefSchema).default([]),
});
export type MapBundle = z.infer<typeof MapBundleSchema>;
