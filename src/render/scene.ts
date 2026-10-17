/**
 * PixiJS isometric battlefield renderer (T029).
 *
 * Renders the engine's {@link TerrainMap} as an isometric tile field with
 * elevation blocks and a grid overlay, with drag-to-pan and wheel-to-zoom. This
 * module is the only presentation code allowed to import Pixi; all geometry and
 * camera maths live Pixi-free in `tiles.ts`.
 *
 * Contract:
 * - The renderer **reads** engine values and never mutates them (`agents.md`
 *   §7). It owns no game state.
 * - `createScene` returns immediately; Pixi initialises asynchronously and the
 *   returned {@link Scene} exposes a `ready` promise for callers that need it.
 * - Initialisation is serialised per canvas so React StrictMode's mount →
 *   unmount → remount cycle in development cannot race two Pixi applications
 *   onto one canvas.
 */

import { Application, Container, Graphics } from "pixi.js";

import { allCoords } from "../engine/grid";
import {
  createTerrainMap,
  heightAt,
  terrainTileAt,
  withTile,
  type TerrainMap,
  type TerrainType,
} from "../engine/terrain";
import type { Unit } from "../engine/unit";
import { worldToScreen } from "./iso";
import { createOverlay, type BattleOverlay } from "./overlay";
import { unitDrawOps, type UnitDrawOp } from "./units";
import {
  ELEVATION_STEP,
  TILE_HEIGHT,
  TILE_WIDTH,
  blockLevelLines,
  blockSideFaces,
  centerCameraOnBounds,
  createCamera,
  diamondPoints,
  panCamera,
  shadeColor,
  terrainStyle,
  terrainVariant,
  tileDecorations,
  zoomCameraAt,
  type Bounds,
  type Camera,
  type ScreenPoint,
} from "./tiles";

/** A live battlefield scene. Initialise asynchronously; always `dispose`. */
export interface Scene {
  /** Resolves once Pixi is ready and the map is on screen (or has failed). */
  readonly ready: Promise<void>;
  /** The interactive overlay (move range, path, cursor) parented to the world. */
  readonly overlay: BattleOverlay;
  /** The current camera transform, for unprojecting pointer input to tiles. */
  readonly camera: Camera;
  /**
   * Replace the soldiers drawn on the field. The scene reads the units only;
   * it never mutates engine state (`agents.md` §7). Passing an empty list
   * clears the field.
   */
  setUnits(units: readonly Unit[]): void;
  /** Tear down the renderer, input listeners and observers. Idempotent. */
  dispose(): void;
}

/** Serialise Pixi init/destroy per canvas so remounts don't race (StrictMode). */
const sceneChains = new WeakMap<HTMLCanvasElement, Promise<void>>();

/** Stroke an open polyline of flat `[x, y, ...]` points, offset by `center`. */
function strokeLine(
  graphics: Graphics,
  points: readonly number[],
  center: ScreenPoint,
  style: { width: number; color: number; alpha: number },
): void {
  if (points.length < 4) return;
  graphics.moveTo(points[0] + center.x, points[1] + center.y);
  for (let index = 2; index < points.length; index += 2) {
    graphics.lineTo(points[index] + center.x, points[index + 1] + center.y);
  }
  graphics.stroke(style);
}

/**
 * Draw one unit's Pixi-free {@link unitDrawOps} description (the soldier, its
 * status bars and condition icons) offset by its tile's top-face centre. The
 * shape mirrors `drawDecorations` so the render layer keeps one drawing pattern
 * for both terrain and units.
 */
function drawUnitOps(graphics: Graphics, ops: readonly UnitDrawOp[], center: ScreenPoint): void {
  for (const op of ops) {
    if (op.kind === "circle") {
      graphics
        .circle(center.x + op.x, center.y + op.y, op.radius)
        .fill({ color: op.color, alpha: op.alpha });
    } else if (op.kind === "rect") {
      graphics
        .rect(center.x + op.x, center.y + op.y, op.width, op.height)
        .fill({ color: op.color, alpha: op.alpha });
    } else if (op.kind === "poly") {
      const points: number[] = [];
      for (let index = 0; index < op.points.length; index += 2) {
        points.push(op.points[index] + center.x, op.points[index + 1] + center.y);
      }
      graphics.poly(points).fill({ color: op.color, alpha: op.alpha });
    } else {
      strokeLine(graphics, op.points, center, {
        width: op.width,
        color: op.color,
        alpha: op.alpha,
      });
    }
  }
}

/**
 * Draw one tile's terrain details (trees, houses, ripples, earthworks...) from
 * the Pixi-free {@link tileDecorations} description. Details are painted after
 * the top face so they sit on the tile; back-to-front painting handles overlap
 * with neighbouring blocks.
 */
function drawDecorations(
  graphics: Graphics,
  type: TerrainType,
  variant: number,
  center: ScreenPoint,
): void {
  for (const op of tileDecorations(type, { variant })) {
    if (op.kind === "circle") {
      graphics
        .circle(center.x + op.x, center.y + op.y, op.radius)
        .fill({ color: op.color, alpha: op.alpha });
    } else if (op.kind === "poly") {
      const points: number[] = [];
      for (let index = 0; index < op.points.length; index += 2) {
        points.push(op.points[index] + center.x, op.points[index + 1] + center.y);
      }
      graphics.poly(points).fill({ color: op.color, alpha: op.alpha });
    } else {
      strokeLine(graphics, op.points, center, {
        width: op.width,
        color: op.color,
        alpha: op.alpha,
      });
    }
  }
}

/**
 * Create the battlefield scene on `canvas`. When `map` is omitted, a small
 * deterministic demo field is authored so the shell has terrain to show before
 * a real battle is wired up.
 */
export function createScene(canvas: HTMLCanvasElement, map: TerrainMap = createDemoMap()): Scene {
  const app = new Application();
  const world = new Container();
  const overlay = createOverlay();
  const unitLayer = new Container();
  let units: readonly Unit[] = [];
  let camera: Camera = createCamera();
  let destroyed = false;
  let appReady = false;
  let appInitialised = false;
  let dragPointerId: number | null = null;
  let lastPointer = { x: 0, y: 0 };

  const applyCamera = (): void => {
    world.position.set(camera.x, camera.y);
    world.scale.set(camera.scale);
  };

  /** World-space bounds of every tile, including elevation lift and faces. */
  const projectedBounds = (): Bounds => {
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const coord of allCoords(map.grid)) {
      const tile = terrainTileAt(map, coord);
      const center = worldToScreen(coord.x, coord.y, tile.height);
      minX = Math.min(minX, center.x - TILE_WIDTH / 2);
      maxX = Math.max(maxX, center.x + TILE_WIDTH / 2);
      minY = Math.min(minY, center.y - TILE_HEIGHT / 2);
      maxY = Math.max(maxY, center.y + TILE_HEIGHT / 2 + tile.height * ELEVATION_STEP);
    }
    return { minX, minY, maxX, maxY };
  };

  const centerCamera = (): void => {
    camera = centerCameraOnBounds(
      projectedBounds(),
      app.screen.width,
      app.screen.height,
      camera.scale,
    );
    applyCamera();
  };

  /** Paint the whole map into one static `Graphics` (back-to-front). */
  const drawMap = (): void => {
    const graphics = new Graphics();
    const ordered = allCoords(map.grid).sort((a, b) => {
      const depth = a.x + a.y - (b.x + b.y);
      if (depth !== 0) return depth;
      return b.y - a.y;
    });

    for (const coord of ordered) {
      const tile = terrainTileAt(map, coord);
      const style = terrainStyle(tile.terrain);
      const center = worldToScreen(coord.x, coord.y, tile.height);

      if (tile.height > 0) {
        const [left, right] = blockSideFaces(center, tile.height * ELEVATION_STEP);
        graphics.poly(left).fill({ color: style.side });
        graphics.poly(right).fill({ color: shadeColor(style.side, 0.82) });
        for (const band of blockLevelLines(center, tile.height)) {
          strokeLine(graphics, band, center, { width: 1, color: style.edge, alpha: 0.35 });
        }
      }

      graphics
        .poly(diamondPoints(center))
        .fill({ color: style.top })
        .stroke({ width: 1, color: style.edge, alpha: 0.55 });

      drawDecorations(graphics, tile.terrain, terrainVariant(coord.x, coord.y), center);
    }

    world.addChild(graphics);
    // Units sit on the terrain but under the interactive overlay (which is
    // parented later, once Pixi is ready).
    world.addChild(unitLayer);
    app.stage.addChild(world);
    applyCamera();
  };

  /** Repaint every soldier, back-to-front so nearer units overlap farther ones. */
  const drawUnits = (): void => {
    for (const child of unitLayer.removeChildren()) child.destroy();
    const ordered = [...units].sort((a, b) => {
      const depth = a.at.x + a.at.y - (b.at.x + b.at.y);
      if (depth !== 0) return depth;
      return a.at.y - b.at.y;
    });
    for (const unit of ordered) {
      const center = worldToScreen(unit.at.x, unit.at.y, heightAt(map, unit.at));
      const graphics = new Graphics();
      drawUnitOps(graphics, unitDrawOps(unit), center);
      unitLayer.addChild(graphics);
    }
  };

  const resize = (): void => {
    const rect = canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor(rect.width));
    const height = Math.max(1, Math.floor(rect.height));
    app.renderer.resize(width, height);
    if (!appInitialised) {
      appInitialised = true;
      centerCamera();
    }
  };

  const observer = new ResizeObserver(resize);

  const onPointerDown = (event: PointerEvent): void => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    dragPointerId = event.pointerId;
    lastPointer = { x: event.clientX, y: event.clientY };
    canvas.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    if (dragPointerId !== event.pointerId) return;
    const dx = event.clientX - lastPointer.x;
    const dy = event.clientY - lastPointer.y;
    lastPointer = { x: event.clientX, y: event.clientY };
    camera = panCamera(camera, dx, dy);
    applyCamera();
  };

  const onPointerUp = (event: PointerEvent): void => {
    if (dragPointerId !== event.pointerId) return;
    dragPointerId = null;
    canvas.releasePointerCapture?.(event.pointerId);
  };

  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const factor = Math.exp(-event.deltaY * 0.0015);
    camera = zoomCameraAt(camera, factor, pointer);
    applyCamera();
  };

  canvas.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  const detachInput = (): void => {
    canvas.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
  };

  const destroyApp = (): void => {
    if (!appReady) return;
    appReady = false;
    app.destroy(true, { children: true });
  };

  const prior = sceneChains.get(canvas) ?? Promise.resolve();
  const ready = prior
    .catch(() => undefined)
    .then(async () => {
      if (destroyed) return;
      canvas.style.touchAction = "none";
      await app.init({
        canvas,
        background: 0x141b28,
        antialias: true,
        autoDensity: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
      });
      appReady = true;
      if (destroyed) {
        destroyApp();
        return;
      }
      drawMap();
      world.addChild(overlay.container);
      observer.observe(canvas);
      resize();
    })
    .catch((error: unknown) => {
      // A failed WebGL context should not take the whole shell down.
      console.error("[render] failed to initialise battlefield scene", error);
    });

  sceneChains.set(
    canvas,
    ready.catch(() => undefined),
  );

  return {
    ready,
    overlay,
    get camera(): Camera {
      return camera;
    },
    setUnits(next: readonly Unit[]): void {
      units = next;
      drawUnits();
    },
    dispose(): void {
      if (destroyed) return;
      destroyed = true;
      detachInput();
      observer.disconnect();
      destroyApp();
    },
  };
}

/* --------------------------------------------------------------------------
 * Placeholder demo map
 * ------------------------------------------------------------------------ */

/**
 * A small deterministic battlefield used until a real battle is wired in.
 * Deliberately seed-free: a pure pattern rather than `Math.random`, so the
 * shell renders identically every reload (`agents.md` §2).
 */
export function createDemoMap(): TerrainMap {
  const cols = 14;
  const rows = 12;
  let map = createTerrainMap(cols, rows, "field");

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const n = (x * 7 + y * 13) % 29;
      let terrain: TerrainType = "field";
      if (n === 0) terrain = "river";
      else if (n < 3) terrain = "village";
      else if (n < 7) terrain = "wood";
      else if (n < 11) terrain = "marsh";
      else if (n < 14) terrain = "road";

      const ridge = Math.max(0, 4 - Math.abs(x - 6) - Math.abs(y - 4));
      const elevation = terrain === "river" ? 0 : Math.min(3, ridge);

      if (terrain !== "field" || elevation > 0) {
        map = withTile(map, { x, y }, { terrain, height: elevation });
      }
    }
  }

  return map;
}
