/**
 * Battle overlays (T030) — the interactive layer painted above the terrain.
 *
 * The move range, the planned march and the tile cursor are all *presentation*
 * (`agents.md` §7): this module reads plain engine values (tiles and paths) and
 * draws them; it owns no game state and never mutates what it is given. The
 * geometry it needs is Pixi-free and lives in `tiles.ts` / `iso.ts`, so the
 * overlay can be reasoned about (and its colours pinned) without a renderer.
 *
 * Contract:
 * - The overlay `Container` is parented to the scene's `world` container, so it
 *   pans and zooms with the battlefield automatically. Layers are drawn in
 *   order: move range, then path, then cursor.
 * - Every `set…` call is **idempotent and total**: calling it always redraws
 *   the layer from scratch, and an empty list clears it. This matches how React
 *   syncs state — one call per controller change, no diffing required.
 * - Elevation is honoured: a highlighted diamond sits on the tile's raised top
 *   face (via `heightAt`), exactly where the terrain was drawn.
 *
 * Reference: `docs/wiki/pages/Move_(stat).md` for the blue movement range.
 */

import { Container, Graphics } from "pixi.js";

import type { Coord } from "../engine/grid";
import { heightAt, type TerrainMap } from "../engine/terrain";
import { worldToScreen } from "./iso";
import { diamondPoints, type ScreenPoint } from "./tiles";

/* --------------------------------------------------------------------------
 * Palette (re-authored for the Napoleonic theatre — mapping §14)
 * ------------------------------------------------------------------------ */

/** Cold blue fill for every tile within the soldier's Move budget. */
export const MOVE_RANGE_COLOR = 0x5aa9ff;
/** Warm gold for the planned march and its destination marker. */
export const PATH_COLOR = 0xffd25a;
/** Pale parchment outline for the cursor / hover tile. */
export const CURSOR_COLOR = 0xf4f1e8;

/* --------------------------------------------------------------------------
 * Overlay
 * ------------------------------------------------------------------------ */

/**
 * A live overlay layer. Call the `set…` methods to sync it to controller state;
 * all coordinates are grid tiles (not screen pixels).
 */
export interface BattleOverlay {
  /** Parent this to the scene's `world` container. */
  readonly container: Container;
  /** Highlight every reachable tile, drawing each on its raised top face. */
  setMoveRange(tiles: readonly Coord[], map: TerrainMap): void;
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
 * Create an empty overlay. Draw order is fixed (range → path → cursor) so the
 * cursor always reads on top of the plan.
 */
export function createOverlay(): BattleOverlay {
  const container = new Container();
  const rangeLayer = new Graphics();
  const pathLayer = new Graphics();
  const cursorLayer = new Graphics();
  container.addChild(rangeLayer, pathLayer, cursorLayer);

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
      rangeLayer.clear();
      pathLayer.clear();
      cursorLayer.clear();
    },
  };
}
