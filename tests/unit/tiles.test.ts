import { describe, expect, it } from "vitest";

import { TERRAIN_TYPES } from "../../src/engine/terrain";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  TILE_HEIGHT,
  TILE_WIDTH,
  blockSideFaces,
  centerCameraOnBounds,
  clampZoom,
  createCamera,
  diamondCorners,
  diamondPoints,
  gridBounds,
  panCamera,
  shadeColor,
  terrainStyle,
  zoomCameraAt,
} from "../../src/render/tiles";

describe("terrain palette", () => {
  it("provides a style for every engine terrain type", () => {
    for (const type of TERRAIN_TYPES) {
      const style = terrainStyle(type);
      expect(style.top).toBeTypeOf("number");
      expect(style.side).toBeTypeOf("number");
      expect(style.edge).toBeTypeOf("number");
    }
  });
});

describe("shadeColor", () => {
  it("darkens each channel and keeps the packed shape", () => {
    expect(shadeColor(0x808080, 0.5)).toBe(0x404040);
  });

  it("clamps channels to 0..255", () => {
    expect(shadeColor(0xffffff, 4)).toBe(0xffffff);
    expect(shadeColor(0x000000, 4)).toBe(0x000000);
  });
});

describe("tile geometry", () => {
  it("returns diamond corners in N/E/S/W order", () => {
    const [north, east, south, west] = diamondCorners({ x: 100, y: 200 });
    expect(north).toEqual({ x: 100, y: 200 - TILE_HEIGHT / 2 });
    expect(east).toEqual({ x: 100 + TILE_WIDTH / 2, y: 200 });
    expect(south).toEqual({ x: 100, y: 200 + TILE_HEIGHT / 2 });
    expect(west).toEqual({ x: 100 - TILE_WIDTH / 2, y: 200 });
  });

  it("flattens the diamond into a point list", () => {
    const points = diamondPoints({ x: 0, y: 0 });
    expect(points).toHaveLength(8);
    expect(points.slice(0, 2)).toEqual([0, -TILE_HEIGHT / 2]);
  });

  it("builds two elevation faces that reach the ground plane", () => {
    const [left, right] = blockSideFaces({ x: 0, y: 0 }, TILE_HEIGHT);
    expect(left).toHaveLength(8);
    expect(right).toHaveLength(8);
    // The base south corner of each face is lifted by the full block height.
    expect(left[5]).toBe(TILE_HEIGHT / 2 + TILE_HEIGHT);
    expect(right[7]).toBe(TILE_HEIGHT / 2 + TILE_HEIGHT);
  });
});

describe("camera", () => {
  it("clamps zoom into the allowed range", () => {
    expect(clampZoom(0.01)).toBe(MIN_ZOOM);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(1)).toBe(1);
    expect(clampZoom(Number.NaN)).toBe(1);
  });

  it("pans by a screen-space delta without changing zoom", () => {
    const camera = createCamera(1.5);
    const moved = panCamera(camera, 12, -8);
    expect(moved).toEqual({ x: 12, y: -8, scale: 1.5 });
    expect(camera).toEqual({ x: 0, y: 0, scale: 1.5 });
  });

  it("keeps the pointer anchored while zooming", () => {
    const camera = { x: 10, y: 20, scale: 1 };
    const pointer = { x: 100, y: 50 };
    const worldX = (pointer.x - camera.x) / camera.scale;
    const worldY = (pointer.y - camera.y) / camera.scale;

    const zoomed = zoomCameraAt(camera, 2, pointer);
    expect(zoomed.scale).toBe(2);
    expect(zoomed.x + worldX * zoomed.scale).toBeCloseTo(pointer.x, 6);
    expect(zoomed.y + worldY * zoomed.scale).toBeCloseTo(pointer.y, 6);
  });

  it("centres bounds in the viewport", () => {
    const camera = centerCameraOnBounds(
      { minX: -100, minY: -50, maxX: 100, maxY: 50 },
      800,
      600,
      1,
    );
    // The bounds centre (0, 0) maps to the viewport centre.
    expect(camera.x).toBe(400);
    expect(camera.y).toBe(300);
  });

  it("computes grid bounds that contain the corner tiles", () => {
    const bounds = gridBounds(2, 2);
    expect(bounds.minX).toBeLessThan(bounds.maxX);
    expect(bounds.minY).toBeLessThan(bounds.maxY);
    // The east-most tile centre sits on the +x edge, one half-tile from maxX.
    expect(bounds.maxX).toBeCloseTo(TILE_WIDTH, 6);
  });
});
