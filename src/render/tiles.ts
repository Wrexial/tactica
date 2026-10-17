/**
 * Tile presentation data and camera maths for the isometric renderer (T029).
 *
 * This module is deliberately **Pixi-free and DOM-free**: it holds the
 * engine-stable → on-screen mapping (terrain colours, tile geometry, camera
 * pan/zoom) as plain functions and values. `scene.ts` turns these into Pixi
 * display objects; tests exercise them directly in Node.
 *
 * The grid is square-isometric (locked decision D10): a tile is a diamond of
 * `TILE_WIDTH × TILE_HEIGHT`, drawn as a block whose height comes from the
 * engine's elevation layer (`src/engine/terrain.ts`). One elevation level
 * lifts a tile by half a tile height, matching `iso.ts`.
 */

import type { TerrainType } from "../engine/terrain";

/* --------------------------------------------------------------------------
 * Tile metrics
 * ------------------------------------------------------------------------ */

/** On-screen width of one grid tile in world (unzoomed) pixels. */
export const TILE_WIDTH = 64;
/** On-screen height of one grid tile in world (unzoomed) pixels. */
export const TILE_HEIGHT = 32;

/** Screen-space offset applied per elevation layer (half a tile height). */
export const ELEVATION_STEP = TILE_HEIGHT / 2;

/* --------------------------------------------------------------------------
 * Terrain palette
 * ------------------------------------------------------------------------ */

/** Colours for one terrain surface: top face, side face and grid edge. */
export interface TerrainStyle {
  /** Fill of the tile's top diamond. */
  readonly top: number;
  /** Fill of a tile's visible (left) elevation face. */
  readonly side: number;
  /** Grid outline colour. */
  readonly edge: number;
}

/**
 * Re-authored palette in the period fiction (mapping §14). Keys mirror the
 * engine's `TerrainType` set so the renderer never branches on terrain ids;
 * adding terrain is a data entry in `engine/terrain.ts` plus one here.
 */
export const TERRAIN_STYLE: Readonly<Record<TerrainType, TerrainStyle>> = {
  field: { top: 0x7ba04f, side: 0x55703a, edge: 0x39502a },
  road: { top: 0xb7a06a, side: 0x8c7950, edge: 0x5f5136 },
  wood: { top: 0x3f6b3a, side: 0x2c4d29, edge: 0x1d341c },
  village: { top: 0x9a7d5c, side: 0x6f5941, edge: 0x4b3c2c },
  river: { top: 0x3d6f8f, side: 0x2b5169, edge: 0x1d3747 },
  marsh: { top: 0x5f7350, side: 0x44533a, edge: 0x2f3a28 },
  hill: { top: 0x8a8a55, side: 0x63633c, edge: 0x444428 },
  redoubt: { top: 0x8a6f4a, side: 0x634f35, edge: 0x443626 },
  wall: { top: 0x9a9a9a, side: 0x6f6f6f, edge: 0x4b4b4b },
  rubble: { top: 0x8a8175, side: 0x635c53, edge: 0x443f39 },
  bridge: { top: 0xa8895f, side: 0x7a6344, edge: 0x53432e },
  rooftop: { top: 0x9c5a4a, side: 0x6f3f34, edge: 0x4b2b23 },
};

const FALLBACK_STYLE: TerrainStyle = { top: 0x6f8f4a, side: 0x4b6332, edge: 0x2a3a1e };

/** Style for a terrain surface; a neutral green if the id is unknown. */
export function terrainStyle(type: TerrainType): TerrainStyle {
  return TERRAIN_STYLE[type] ?? FALLBACK_STYLE;
}

/**
 * Multiply each RGB channel of a packed `0xRRGGBB` colour by `factor`
 * (`< 1` darkens, `> 1` lightens), clamped to a valid byte. Used to shade the
 * right-hand elevation face without a second palette entry.
 */
export function shadeColor(color: number, factor: number): number {
  const channel = (shift: number): number => {
    const value = (color >> shift) & 0xff;
    return Math.max(0, Math.min(255, Math.round(value * factor)));
  };
  return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

/* --------------------------------------------------------------------------
 * Tile geometry
 * ------------------------------------------------------------------------ */

/** A point in unzoomed world pixels. */
export interface ScreenPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * The four corners of a tile's top diamond, clockwise from the north corner:
 * `[north, east, south, west]`. `center` is the projected tile centre (already
 * including any elevation lift).
 */
export function diamondCorners(
  center: ScreenPoint,
  tileWidth: number = TILE_WIDTH,
  tileHeight: number = TILE_HEIGHT,
): [ScreenPoint, ScreenPoint, ScreenPoint, ScreenPoint] {
  const halfW = tileWidth / 2;
  const halfH = tileHeight / 2;
  return [
    { x: center.x, y: center.y - halfH },
    { x: center.x + halfW, y: center.y },
    { x: center.x, y: center.y + halfH },
    { x: center.x - halfW, y: center.y },
  ];
}

/** Flatten the top-diamond corners into a Pixi `poly` point list. */
export function diamondPoints(
  center: ScreenPoint,
  tileWidth: number = TILE_WIDTH,
  tileHeight: number = TILE_HEIGHT,
): number[] {
  return diamondCorners(center, tileWidth, tileHeight).flatMap((corner) => [corner.x, corner.y]);
}

/**
 * The two visible vertical faces of an elevation block, as flat point lists.
 * `heightPixels` is the total lift from the ground plane; faces run from the
 * south-west (`left`) and south-east (`right`) edges down to the base.
 * Returns `[left, right]`.
 */
export function blockSideFaces(
  center: ScreenPoint,
  heightPixels: number,
  tileWidth: number = TILE_WIDTH,
  tileHeight: number = TILE_HEIGHT,
): [number[], number[]] {
  const [, east, south, west] = diamondCorners(center, tileWidth, tileHeight);
  const left = [
    west.x,
    west.y,
    south.x,
    south.y,
    south.x,
    south.y + heightPixels,
    west.x,
    west.y + heightPixels,
  ];
  const right = [
    south.x,
    south.y,
    east.x,
    east.y,
    east.x,
    east.y + heightPixels,
    south.x,
    south.y + heightPixels,
  ];
  return [left, right];
}

/* --------------------------------------------------------------------------
 * Camera (pan / zoom)
 * ------------------------------------------------------------------------ */

/** World container transform: translation plus uniform scale. */
export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/** Zoom bounds keep a battlefield readable and prevent extreme scaling. */
export const MIN_ZOOM = 0.35;
export const MAX_ZOOM = 2.5;
export const DEFAULT_ZOOM = 1;

/** A camera at the origin and default zoom. */
export function createCamera(scale: number = DEFAULT_ZOOM): Camera {
  return { x: 0, y: 0, scale: clampZoom(scale) };
}

/** Clamp a zoom factor into `[min, max]`. */
export function clampZoom(scale: number, min: number = MIN_ZOOM, max: number = MAX_ZOOM): number {
  if (!Number.isFinite(scale)) return DEFAULT_ZOOM;
  return Math.min(max, Math.max(min, scale));
}

/** Translate the camera by a screen-space delta (drag panning). */
export function panCamera(camera: Camera, dx: number, dy: number): Camera {
  return { x: camera.x + dx, y: camera.y + dy, scale: camera.scale };
}

/**
 * Zoom by `factor` while keeping the world point under `pointer` (screen
 * pixels) visually fixed — the standard map-zoom feel. Zoom is clamped, and the
 * translation is recomputed so the anchor does not drift.
 */
export function zoomCameraAt(camera: Camera, factor: number, pointer: ScreenPoint): Camera {
  const scale = clampZoom(camera.scale * factor);
  const ratio = scale / camera.scale;
  return {
    scale,
    x: pointer.x - (pointer.x - camera.x) * ratio,
    y: pointer.y - (pointer.y - camera.y) * ratio,
  };
}

/** Axis-aligned bounds in world pixels. */
export interface Bounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

/**
 * Camera transform that centres `bounds` in a `viewWidth × viewHeight` viewport
 * at the given zoom. Used to frame the battlefield on first layout and to
 * re-centre on demand.
 */
export function centerCameraOnBounds(
  bounds: Bounds,
  viewWidth: number,
  viewHeight: number,
  scale: number = DEFAULT_ZOOM,
): Camera {
  const zoom = clampZoom(scale);
  const centerX = (bounds.minX + bounds.maxX) / 2;
  const centerY = (bounds.minY + bounds.maxY) / 2;
  return {
    scale: zoom,
    x: viewWidth / 2 - centerX * zoom,
    y: viewHeight / 2 - centerY * zoom,
  };
}

/**
 * World-space bounding box for a grid of `width × height` tiles, using the
 * unzoomed tile metrics. Handy for framing and for pan limits later.
 */
export function gridBounds(
  width: number,
  height: number,
  tileWidth: number = TILE_WIDTH,
  tileHeight: number = TILE_HEIGHT,
): Bounds {
  const maxX = (width - 1 - 0) * (tileWidth / 2);
  const minX = (0 - (height - 1)) * (tileWidth / 2);
  return {
    minX: minX - tileWidth / 2,
    maxX: maxX + tileWidth / 2,
    minY: -tileHeight / 2,
    maxY: (width - 1 + (height - 1)) * (tileHeight / 2) + tileHeight / 2,
  };
}
