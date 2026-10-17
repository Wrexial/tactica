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
