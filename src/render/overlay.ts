/**
 * Battle overlays (T030, T085) — the interactive layer painted above the
 * terrain.
 *
 * The move range, the planned march, the tile cursor, the aiming reach, the
 * area-of-effect footprint, the hostile **danger zone** and the **elevation**
 * preview are all *presentation* (`agents.md` §7): this module reads plain
 * engine values (tiles, paths) and draws them; it owns no game state and never
 * mutates what it is given. The geometry it needs is Pixi-free and lives in
 * `tiles.ts` / `iso.ts`, so the overlay can be reasoned about (and its colours
 * pinned) without a renderer.
 *
 * Contract:
 * - The overlay `Container` is parented to the scene's `world` container, so it
 *   pans and zooms with the battlefield automatically. Layers are drawn in a
 *   fixed order: danger zone, then move range, aiming reach, area footprint,
 *   march, elevation marker, cursor.
 * - Every `set…` call is **idempotent and total**: calling it always redraws
 *   the layer from scratch, and an empty list clears it. This matches how React
 *   syncs state — one call per controller change, no diffing required.
 * - Elevation is honoured: a highlighted diamond sits on the tile's raised top
 *   face (via `heightAt`), exactly where the terrain was drawn.
 *
 * The T085 additions answer the three questions an aiming player asks:
 * *what can I reach?* (target reach), *what will it catch?* (area footprint),
 * *where is it dangerous?* (the union of hostile reach). The elevation chevron
 * answers *what will the climb cost me?*.
 *
 * Reference: `docs/wiki/pages/Move_(stat).md` for the blue movement range,
 * `docs/wiki/pages/Ability_Points.md`/`Range` for the aiming overlay.
 */

import { Container, Graphics } from "pixi.js";

import { coordKey, type Coord } from "../engine/grid";
import { heightAt, type TerrainMap } from "../engine/terrain";
import { worldToScreen } from "./iso";
import { diamondPoints, TILE_HEIGHT, TILE_WIDTH, type ScreenPoint } from "./tiles";

/* --------------------------------------------------------------------------
 * Palette (re-authored for the Napoleonic theatre — mapping §14)
 * ------------------------------------------------------------------------ */

/** Cold blue fill for every tile within the soldier's Move budget. */
export const MOVE_RANGE_COLOR = 0x5aa9ff;
/** Warm gold for the planned march and its destination marker. */
export const PATH_COLOR = 0xffd25a;
/** Pale parchment outline for the cursor / hover tile. */
export const CURSOR_COLOR = 0xf4f1e8;
/** Amber wash for every tile an aimed action can reach. */
export const TARGET_RANGE_COLOR = 0xf2b134;
/** Ember fill for the tiles an area-of-effect action covers. */
export const AREA_COLOR = 0xff7a3c;
/** Bright fill for an area tile that holds a soldier (it would be caught). */
export const AREA_HIT_COLOR = 0xffe08a;
/** Crimson wash for tiles a hostile soldier could strike next turn. */
export const DANGER_COLOR = 0xd23b3b;
/** Green chevron for standing on higher ground than the reference. */
export const ELEVATION_UP_COLOR = 0x74d680;
/** Red chevron for standing on lower ground than the reference. */
export const ELEVATION_DOWN_COLOR = 0xe8834f;

/* --------------------------------------------------------------------------
 * Pure geometry helpers (Pixi-free, unit-testable)
 * ------------------------------------------------------------------------ */

/**
 * An elevation marker: a chevron pointing up for higher ground, down for lower.
 * `points` is a flat `[x, y, ...]` polyline relative to the tile's raised face.
 */
export interface ElevationGlyph {
  readonly direction: "up" | "down";
  readonly points: number[];
  readonly color: number;
}

/**
 * Build the chevron for an elevation difference in layers. Returns `null` for
 * level ground (`delta === 0`) or a non-finite delta, so the overlay simply
 * draws nothing when there is nothing to preview.
 */
export function elevationGlyph(center: ScreenPoint, delta: number): ElevationGlyph | null {
  if (!Number.isFinite(delta) || delta === 0) return null;
  const up = delta > 0;
  const points = up
    ? [center.x - 9, center.y + 5, center.x, center.y - 7, center.x + 9, center.y + 5]
    : [center.x - 9, center.y - 5, center.x, center.y + 7, center.x + 9, center.y - 5];
  return {
    direction: up ? "up" : "down",
    points,
    color: up ? ELEVATION_UP_COLOR : ELEVATION_DOWN_COLOR,
  };
}

/**
 * The inner diamond outline that marks a tile as dangerous. Reusing
 * {@link diamondPoints} with a smaller tile keeps the marker inset from the
 * tile edge, so a danger fill and the tile border stay legible together.
 */
export function innerDiamondPoints(center: ScreenPoint, factor = 0.55): number[] {
  return diamondPoints(center, TILE_WIDTH * factor, TILE_HEIGHT * factor);
}

/* --------------------------------------------------------------------------
 * Overlay
 * ------------------------------------------------------------------------ */

/** Tiles for an area-of-effect preview, with the tiles it would actually hit. */
export interface AreaHighlight {
  /** Every tile the footprint covers, drawn on its raised top face. */
  readonly tiles: readonly Coord[];
  /** Footprint tiles holding a soldier; drawn brighter. Defaults to none. */
  readonly hits?: readonly Coord[];
}

/** A tile plus the elevation change from the reference soldier. */
export interface ElevationPreview {
  /** The cursor tile to mark. */
  readonly at: Coord;
  /** Layers higher (`> 0`) or lower (`< 0`) than the reference; `0` is level. */
  readonly delta: number;
}

/**
 * A live overlay layer. Call the `set…` methods to sync it to controller state;
 * all coordinates are grid tiles (not screen pixels).
 */
export interface BattleOverlay {
  /** Parent this to the scene's `world` container. */
  readonly container: Container;
  /** Highlight every reachable tile, drawing each on its raised top face. */
  setMoveRange(tiles: readonly Coord[], map: TerrainMap): void;
  /** Highlight every tile an aimed action can reach (T085). */
  setTargetRange(tiles: readonly Coord[], map: TerrainMap): void;
  /** Draw the area footprint under the aim, brightening any occupied tiles. */
  setArea(area: AreaHighlight, map: TerrainMap): void;
  /** Shade the tiles hostile soldiers can strike next turn (T085). */
  setDangerZone(tiles: readonly Coord[], map: TerrainMap): void;
  /** Draw the up/down elevation chevron, or clear it when `null`. */
  setElevationPreview(preview: ElevationPreview | null, map: TerrainMap): void;
  /** Draw the origin-first march, ending in a destination ring. An empty path clears it. */
  setPath(path: readonly Coord[], map: TerrainMap): void;
  /** Outline the cursor tile, or clear the outline when `at` is `null`. */
  setCursor(at: Coord | null, map: TerrainMap): void;
  /** Clear every layer. */
  clear(): void;
}

/** Projected centre of a tile, lifted by its elevation (matches `scene.ts`). */
function centerOf(map: TerrainMap, at: Coord): ScreenPoint {
  return worldToScreen(at.x, at.y, heightAt(map, at));
}

/**
 * Create an empty overlay. Draw order is fixed (danger → range → reach → area →
 * path → elevation → cursor) so the reading order matches the tactical
 * priorities: the threat first, then your options, then your plan.
 */
export function createOverlay(): BattleOverlay {
  const container = new Container();
  const dangerLayer = new Graphics();
  const rangeLayer = new Graphics();
  const targetLayer = new Graphics();
  const areaLayer = new Graphics();
  const pathLayer = new Graphics();
  const elevationLayer = new Graphics();
  const cursorLayer = new Graphics();
  container.addChild(
    dangerLayer,
    rangeLayer,
    targetLayer,
    areaLayer,
    pathLayer,
    elevationLayer,
    cursorLayer,
  );

  return {
    container,

    setMoveRange(tiles, map) {
      rangeLayer.clear();
      for (const at of tiles) {
        rangeLayer
          .poly(diamondPoints(centerOf(map, at)))
          .fill({ color: MOVE_RANGE_COLOR, alpha: 0.34 })
          .stroke({ width: 1, color: MOVE_RANGE_COLOR, alpha: 0.7 });
      }
    },

    setTargetRange(tiles, map) {
      targetLayer.clear();
      for (const at of tiles) {
        targetLayer
          .poly(diamondPoints(centerOf(map, at)))
          .fill({ color: TARGET_RANGE_COLOR, alpha: 0.18 })
          .stroke({ width: 1, color: TARGET_RANGE_COLOR, alpha: 0.6 });
      }
    },

    setArea(area, map) {
      areaLayer.clear();
      const hitKeys = new Set((area.hits ?? []).map((at) => coordKey(at)));
      for (const at of area.tiles) {
        const center = centerOf(map, at);
        const hit = hitKeys.has(coordKey(at));
        areaLayer
          .poly(diamondPoints(center))
          .fill({ color: hit ? AREA_HIT_COLOR : AREA_COLOR, alpha: hit ? 0.42 : 0.28 })
          .stroke({ width: 2, color: hit ? AREA_HIT_COLOR : AREA_COLOR, alpha: 0.85 });
      }
    },

    setDangerZone(tiles, map) {
      dangerLayer.clear();
      for (const at of tiles) {
        const center = centerOf(map, at);
        dangerLayer
          .poly(diamondPoints(center))
          .fill({ color: DANGER_COLOR, alpha: 0.16 })
          .stroke({ width: 1, color: DANGER_COLOR, alpha: 0.5 });
        dangerLayer
          .poly(innerDiamondPoints(center))
          .stroke({ width: 1.5, color: DANGER_COLOR, alpha: 0.75 });
      }
    },

    setElevationPreview(preview, map) {
      elevationLayer.clear();
      if (preview === null) return;
      const center = centerOf(map, preview.at);
      const glyph = elevationGlyph(center, preview.delta);
      if (glyph === null) return;
      elevationLayer.poly(glyph.points).stroke({ width: 3, color: glyph.color, alpha: 0.95 });
      elevationLayer.circle(center.x, center.y, 3).fill({ color: glyph.color, alpha: 0.9 });
    },

    setPath(path, map) {
      pathLayer.clear();
      if (path.length === 0) return;

      const points = path.map((at) => centerOf(map, at));
      if (points.length > 1) {
        pathLayer.moveTo(points[0].x, points[0].y);
        for (let index = 1; index < points.length; index++) {
          pathLayer.lineTo(points[index].x, points[index].y);
        }
        pathLayer.stroke({ width: 4, color: PATH_COLOR, alpha: 0.9 });
        for (const point of points) {
          pathLayer.circle(point.x, point.y, 3).fill({ color: PATH_COLOR, alpha: 0.9 });
        }
      }

      const destination = points[points.length - 1];
      pathLayer.circle(destination.x, destination.y, 8).stroke({ width: 3, color: PATH_COLOR });
    },

    setCursor(at, map) {
      cursorLayer.clear();
      if (at === null) return;
      cursorLayer
        .poly(diamondPoints(centerOf(map, at)))
        .stroke({ width: 2, color: CURSOR_COLOR, alpha: 0.95 });
    },

    clear() {
      dangerLayer.clear();
      rangeLayer.clear();
      targetLayer.clear();
      areaLayer.clear();
      pathLayer.clear();
      elevationLayer.clear();
      cursorLayer.clear();
    },
  };
}
