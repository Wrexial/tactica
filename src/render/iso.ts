/**
 * Isometric projection helpers for the square-isometric grid (locked decision
 * D10). The grid uses "diamond" tiles; elevation raises a tile up the screen.
 *
 * Convention: +x runs down-right, +y runs down-left, +z (elevation) runs up.
 */
export interface Point {
  x: number;
  y: number;
}

export interface GridPoint {
  gx: number;
  gy: number;
}

export const DEFAULT_TILE_WIDTH = 64;
export const DEFAULT_TILE_HEIGHT = 32;

export function worldToScreen(
  gx: number,
  gy: number,
  gz = 0,
  tileWidth: number = DEFAULT_TILE_WIDTH,
  tileHeight: number = DEFAULT_TILE_HEIGHT,
): Point {
  return {
    x: (gx - gy) * (tileWidth / 2),
    y: (gx + gy) * (tileHeight / 2) - gz * (tileHeight / 2),
  };
}

/** Inverse of {@link worldToScreen} on the ground plane (ignores elevation). */
export function screenToWorld(
  sx: number,
  sy: number,
  tileWidth: number = DEFAULT_TILE_WIDTH,
  tileHeight: number = DEFAULT_TILE_HEIGHT,
): GridPoint {
  const halfW = tileWidth / 2;
  const halfH = tileHeight / 2;
  return {
    gx: (sy / halfH + sx / halfW) / 2,
    gy: (sy / halfH - sx / halfW) / 2,
  };
}

/**
 * A camera/viewport transform: uniform `scale` plus translation, applied to
 * **unzoomed world pixels** to produce canvas pixels.
 *
 * Structurally identical to `tiles.ts`'s `Camera`, but declared here so this
 * leaf module never has to import the camera module back (`tiles.ts` imports
 * {@link worldToScreen} from here, so the reverse edge would be a cycle).
 */
export interface ViewTransform {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
}

/**
 * Apply a camera's pan and zoom to an **unzoomed world-space** point, giving
 * canvas pixels. The inverse of `tiles.ts`'s `worldFromScreen`; kept beside
 * {@link worldToScreen} so the whole `grid -> world -> screen` chain stays
 * Pixi-free and unit-testable in Node.
 */
export function toScreen(world: Point, camera: ViewTransform): Point {
  return { x: world.x * camera.scale + camera.x, y: world.y * camera.scale + camera.y };
}

/**
 * Full `grid -> screen` projection for a grid cell raised by `gz` elevation
 * levels, viewed through `camera`. This is exactly the chain `Scene.project`
 * runs, exposed as a pure function so the HUD anchor maths can be tested
 * without a canvas (`tests/unit/unitHud.test.ts`).
 */
export function projectPoint(gx: number, gy: number, gz: number, camera: ViewTransform): Point {
  return toScreen(worldToScreen(gx, gy, gz), camera);
}
