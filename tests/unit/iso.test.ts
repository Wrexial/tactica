import { describe, expect, it } from "vitest";

import { screenToWorld, worldToScreen } from "../../src/render/iso";

const TILE_W = 64;
const TILE_H = 32;

describe("isometric projection", () => {
  it("round-trips grid coordinates on the ground plane", () => {
    const coords: Array<[number, number]> = [
      [0, 0],
      [3, 1],
      [7, 9],
      [-2, 4],
      [11, 11],
    ];
    for (const [gx, gy] of coords) {
      const p = worldToScreen(gx, gy, 0, TILE_W, TILE_H);
      const back = screenToWorld(p.x, p.y, TILE_W, TILE_H);
      expect(back.gx).toBeCloseTo(gx, 6);
      expect(back.gy).toBeCloseTo(gy, 6);
    }
  });

  it("raises tiles up the screen as elevation increases", () => {
    const ground = worldToScreen(2, 2, 0, TILE_W, TILE_H);
    const raised = worldToScreen(2, 2, 3, TILE_W, TILE_H);
    expect(raised.y).toBeLessThan(ground.y);
    expect(raised.x).toBe(ground.x);
    expect(ground.y - raised.y).toBeCloseTo(3 * (TILE_H / 2), 6);
  });

  it("uses diamond adjacency: +x is down-right, +y is down-left", () => {
    const origin = worldToScreen(0, 0, 0, TILE_W, TILE_H);
    const plusX = worldToScreen(1, 0, 0, TILE_W, TILE_H);
    const plusY = worldToScreen(0, 1, 0, TILE_W, TILE_H);
    expect(plusX.x).toBeGreaterThan(origin.x);
    expect(plusX.y).toBeGreaterThan(origin.y);
    expect(plusY.x).toBeLessThan(origin.x);
    expect(plusY.y).toBeGreaterThan(origin.y);
  });
});
