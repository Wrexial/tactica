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

import { allCoords, type Coord } from "../engine/grid";
import { heightAt, type TerrainMap, type TerrainType } from "../engine/terrain";
import { worldToScreen } from "./iso";

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
 * Terrain decoration
 * ------------------------------------------------------------------------ */

/**
 * A Pixi-free drawing primitive for one terrain detail, positioned relative to
 * a tile's **top-face centre** in unzoomed world pixels. `scene.ts` translates
 * these into Pixi calls; tests inspect them directly in Node. Keeping details
 * as plain data (rather than Pixi objects) preserves the render layer's split
 * between geometry (`tiles.ts`) and drawing (`scene.ts`).
 */
export type TileDrawOp =
  | {
      readonly kind: "circle";
      readonly x: number;
      readonly y: number;
      readonly radius: number;
      readonly color: number;
      readonly alpha: number;
    }
  | {
      readonly kind: "poly";
      readonly points: readonly number[];
      readonly color: number;
      readonly alpha: number;
    }
  | {
      readonly kind: "line";
      readonly points: readonly number[];
      readonly width: number;
      readonly color: number;
      readonly alpha: number;
    };

/**
 * Re-authored detail colours (mapping §14, D6). These sit on top of the flat
 * {@link TERRAIN_STYLE} fills to give each surface a readable silhouette:
 * trees, houses, water ripples, earthworks and so on.
 */
const DECO = {
  grass: 0x4f7a34,
  grassLight: 0x8fb45a,
  rut: 0xc9b184,
  trunk: 0x5b3f27,
  canopy: 0x2f5d2c,
  canopyLight: 0x52863f,
  house: 0xd8c9a8,
  roof: 0x9c4a3c,
  roofRidge: 0x6e3329,
  water: 0x9fd8ec,
  waterDeep: 0x5a9cc0,
  mud: 0x6b6244,
  reed: 0x6f8a3f,
  earth: 0x7a5c3a,
  earthLight: 0x9a7a4f,
  gabion: 0xb59a6a,
  wallStone: 0x9a9a9a,
  wallStoneDark: 0x6b6b6b,
  plank: 0xb08c58,
  plankDark: 0x7d6236,
  tile: 0xb5614d,
  tileDark: 0x823f30,
  smoke: 0x8a8a8a,
} as const;

function circle(x: number, y: number, radius: number, color: number, alpha = 1): TileDrawOp {
  return { kind: "circle", x, y, radius, color, alpha };
}

function poly(points: readonly number[], color: number, alpha = 1): TileDrawOp {
  return { kind: "poly", points, color, alpha };
}

function line(points: readonly number[], width: number, color: number, alpha = 1): TileDrawOp {
  return { kind: "line", points, width, color, alpha };
}

/** Open ground: a scatter of grass tufts, varied by {@link terrainVariant}. */
function fieldDecorations(variant: number): TileDrawOp[] {
  const spots: ReadonlyArray<readonly [number, number]> = [
    [-16, 2],
    [-4, -5],
    [8, 4],
    [18, -2],
    [-9, 8],
  ];
  const ops: TileDrawOp[] = [];
  spots.forEach(([x, y], index) => {
    if ((index + variant) % 2 !== 0) return;
    ops.push(circle(x, y, 2, index % 2 === 0 ? DECO.grass : DECO.grassLight, 0.85));
  });
  return ops;
}

/** A road: paired cart ruts running across the tile. */
function roadDecorations(variant: number): TileDrawOp[] {
  const offset = variant % 2 === 0 ? 0 : 2;
  return [
    line([-22 - offset, 2, -8, -1, 6, 2, 20, -1], 1.5, DECO.rut, 0.7),
    line([-20 - offset, 8, -6, 5, 8, 8, 22, 5], 1.5, DECO.rut, 0.55),
  ];
}

/** A wood: a small stand of trees (trunk, canopy and canopy highlight). */
function woodDecorations(variant: number): TileDrawOp[] {
  const trees: ReadonlyArray<readonly [number, number, number]> = [
    [-12, 2, 7],
    [8, -6, 8],
    [16, 8, 6],
  ];
  const ops: TileDrawOp[] = [];
  trees.forEach(([x, y, r], index) => {
    if ((index + variant) % 3 === 0) return;
    ops.push(line([x, y, x, y - r], 2.5, DECO.trunk, 0.95));
    ops.push(circle(x, y - r - 1, r, DECO.canopy, 0.95));
    ops.push(circle(x - r * 0.3, y - r - 1 - r * 0.25, r * 0.45, DECO.canopyLight, 0.6));
  });
  return ops;
}

/** A village: a gabled house with a chimney plume. */
function villageDecorations(): TileDrawOp[] {
  return [
    poly([-11, 2, 0, -5, 11, 2, 0, 9], DECO.house, 1),
    poly([-11, 2, 0, -5, 0, -13, -11, -4], DECO.roof, 1),
    poly([11, 2, 0, -5, 0, -13, 11, -4], DECO.roofRidge, 1),
    line([0, -13, 0, 9], 1, DECO.roofRidge, 0.55),
    circle(6, 4, 1.6, DECO.smoke, 0.4),
  ];
}

/** A river: ripple lines and a deeper channel patch. */
function riverDecorations(variant: number): TileDrawOp[] {
  const shift = variant % 2 === 0 ? 0 : 2;
  return [
    line([-18, -2 + shift, -6, 1 + shift, 4, -2 + shift, 16, 1 + shift], 1.5, DECO.water, 0.7),
    line([-14, 5 - shift, -2, 8 - shift, 8, 5 - shift, 18, 8 - shift], 1.5, DECO.water, 0.5),
    circle(2, 2, 3, DECO.waterDeep, 0.35),
  ];
}

/** A marsh: muddy patches with reed clusters. */
function marshDecorations(variant: number): TileDrawOp[] {
  const ops: TileDrawOp[] = [circle(-8, 2, 5, DECO.mud, 0.5), circle(10, -3, 4, DECO.mud, 0.45)];
  const blade = (x: number, y: number): void => {
    ops.push(line([x, y, x - 1, y - 7], 1.2, DECO.reed, 0.9));
    ops.push(line([x, y, x + 2, y - 6], 1.2, DECO.reed, 0.8));
  };
  if (variant % 2 === 0) {
    blade(-8, 5);
    blade(8, 4);
    blade(12, 8);
  } else {
    blade(-12, 3);
    blade(4, 6);
  }
  return ops;
}

/** Rising ground: contour lines reading as a slope. */
function hillDecorations(): TileDrawOp[] {
  return [
    line([-22, 6, -8, 1, 6, 6, 20, 1], 1.4, DECO.earthLight, 0.6),
    line([-16, 11, -4, 7, 8, 11, 18, 7], 1.4, DECO.earthLight, 0.45),
  ];
}

/** A redoubt: an earthen parapet across the front with gabion baskets. */
function redoubtDecorations(): TileDrawOp[] {
  return [
    poly([-20, 6, 0, 13, 20, 6, 20, 10, 0, 17, -20, 10], DECO.earth, 0.95),
    line([-20, 6, 0, 13, 20, 6], 2, DECO.earthLight, 0.8),
    circle(-12, 0, 3, DECO.gabion, 0.9),
    circle(12, 0, 3, DECO.gabion, 0.9),
  ];
}

/** Stone wall: a course of masonry with joint ticks. */
function wallDecorations(): TileDrawOp[] {
  const ops: TileDrawOp[] = [line([-24, 2, 24, 2], 5, DECO.wallStone, 1)];
  for (let x = -20; x <= 20; x += 8) {
    ops.push(line([x, -1, x, 5], 1, DECO.wallStoneDark, 0.7));
  }
  return ops;
}

/** Rubble: scattered broken blocks. */
function rubbleDecorations(variant: number): TileDrawOp[] {
  const chunks: ReadonlyArray<readonly [number, number, number]> = [
    [-12, 2, 5],
    [-2, -5, 4],
    [8, 4, 6],
    [16, -1, 4],
    [2, 9, 5],
  ];
  const ops: TileDrawOp[] = [];
  chunks.forEach(([x, y, r], index) => {
    if ((index + variant) % 2 === 0) return;
    ops.push(poly([x, y - r, x + r, y, x, y + r, x - r, y], DECO.wallStoneDark, 0.9));
  });
  return ops;
}

/** A bridge: plank seams between two rails. */
function bridgeDecorations(): TileDrawOp[] {
  const ops: TileDrawOp[] = [];
  for (let x = -24; x <= 24; x += 8) {
    ops.push(line([x, -10, x, 10], 1, DECO.plankDark, 0.5));
  }
  ops.push(line([-26, -12, 26, -12], 2, DECO.plank, 0.9));
  ops.push(line([-26, 12, 26, 12], 2, DECO.plank, 0.9));
  return ops;
}

/** A rooftop: shingles and a chimney, so it reads above the wall line. */
function rooftopDecorations(): TileDrawOp[] {
  return [
    poly([-18, 0, 0, -9, 18, 0, 0, 9], DECO.tile, 0.9),
    line([-9, 4.5, 0, -4.5, 9, 4.5], 1.5, DECO.tileDark, 0.8),
    line([-18, 0, 0, 9, 18, 0], 1.5, DECO.tileDark, 0.6),
    poly([6, -6, 10, -8, 12, -4, 8, -2], DECO.wallStoneDark, 0.9),
  ];
}

/** Options for {@link tileDecorations}. */
export interface TileDecorationOptions {
  /** Stable variation selector, e.g. from {@link terrainVariant}. */
  readonly variant?: number;
}

/**
 * Detail primitives for one terrain surface, positioned relative to the tile's
 * top-face centre. Every surface renders something distinct, so a battlefield
 * reads at a glance: fields have tufts, woods have trees, villages houses,
 * rivers ripples, redoubts earthworks. `variant` (0–3) breaks up repetition
 * deterministically; no randomness is used (mapping §14, D12, `agents.md` §2).
 */
export function tileDecorations(
  type: TerrainType,
  options: TileDecorationOptions = {},
): readonly TileDrawOp[] {
  const variant = Math.abs(Math.trunc(options.variant ?? 0)) % 4;
  switch (type) {
    case "field":
      return fieldDecorations(variant);
    case "road":
      return roadDecorations(variant);
    case "wood":
      return woodDecorations(variant);
    case "village":
      return villageDecorations();
    case "river":
      return riverDecorations(variant);
    case "marsh":
      return marshDecorations(variant);
    case "hill":
      return hillDecorations();
    case "redoubt":
      return redoubtDecorations();
    case "wall":
      return wallDecorations();
    case "rubble":
      return rubbleDecorations(variant);
    case "bridge":
      return bridgeDecorations();
    case "rooftop":
      return rooftopDecorations();
    default:
      return [];
  }
}

/**
 * Stable, seed-free variation index (0–3) for a tile. Uses integer mixing only
 * so the same map always renders identically (`agents.md` §2).
 */
export function terrainVariant(x: number, y: number): number {
  return Math.abs((x * 73856093) ^ (y * 19349663)) % 4;
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

/**
 * Horizontal band lines marking each internal elevation level on a block's
 * visible faces. Returns one flat `[west, south, east]` chevron per level above
 * the ground, so a stepped tile reads as stacked layers rather than one tall
 * slab. `levels` is the tile's elevation; each level is {@link ELEVATION_STEP}
 * pixels tall. Returns an empty list for flat or single-level tiles.
 */
export function blockLevelLines(
  center: ScreenPoint,
  levels: number,
  tileWidth: number = TILE_WIDTH,
  tileHeight: number = TILE_HEIGHT,
): number[][] {
  const [, east, south, west] = diamondCorners(center, tileWidth, tileHeight);
  const lines: number[][] = [];
  for (let level = 1; level < levels; level++) {
    const lift = level * ELEVATION_STEP;
    lines.push([west.x, west.y + lift, south.x, south.y + lift, east.x, east.y + lift]);
  }
  return lines;
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

/* --------------------------------------------------------------------------
 * Screen ↔ world and tile picking
 * ------------------------------------------------------------------------ */

/**
 * Convert a point in canvas pixels to **unzoomed world pixels** under `camera`.
 * The inverse of applying the camera transform (`world.position` / `scale`) to
 * a world point; pair with {@link pickTile} to turn a pointer into a tile.
 */
export function worldFromScreen(camera: Camera, screen: ScreenPoint): ScreenPoint {
  return {
    x: (screen.x - camera.x) / camera.scale,
    y: (screen.y - camera.y) / camera.scale,
  };
}

/**
 * The tile under a point in **unzoomed world space**, or `null` when the point
 * falls outside every tile.
 *
 * Elevation-aware: a tile's clickable diamond is its raised top face (the same
 * diamond `scene.ts` draws), so the search walks tiles front to back — the
 * draw order reversed — and returns the first diamond that contains the point.
 * This is what lets mouse and touch input pick the correct tile on a stepped
 * battlefield (T030). Pure and Pixi-free, so it is unit-testable in Node.
 */
export function pickTile(
  map: TerrainMap,
  world: ScreenPoint,
  tileWidth: number = TILE_WIDTH,
  tileHeight: number = TILE_HEIGHT,
): Coord | null {
  const halfW = tileWidth / 2;
  const halfH = tileHeight / 2;
  const frontToBack = allCoords(map.grid).sort((a, b) => {
    const depth = b.x + b.y - (a.x + a.y); // larger depth (nearer) first
    if (depth !== 0) return depth;
    return a.y - b.y; // ties: the more northerly tile sits on top
  });

  for (const at of frontToBack) {
    const center = worldToScreen(at.x, at.y, heightAt(map, at), tileWidth, tileHeight);
    const dx = Math.abs(world.x - center.x) / halfW;
    const dy = Math.abs(world.y - center.y) / halfH;
    if (dx + dy <= 1) return { x: at.x, y: at.y };
  }
  return null;
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
