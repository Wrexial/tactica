import { describe, expect, it } from "vitest";

import { projectPoint, toScreen, worldToScreen } from "../../src/render/iso";
import { HUD_GAP, HUD_MARGIN, anchorFor } from "../../src/ui/unitHud";

/* --------------------------------------------------------------------------
 * T133 — Camera-aware projection + HUD anchor helper.
 *
 * The battlefield HUD places a per-character card next to a soldier's live
 * screen position. Two pure pieces back that: the `grid -> screen` projection
 * (`projectPoint`, which `Scene.project` wraps) and `anchorFor`, which mirrors
 * FFT Blue's edge-flip + clamp. Both are Pixi-free, so they are pinned here.
 * ------------------------------------------------------------------------ */

const TILE_HALF_HEIGHT = 16; // DEFAULT_TILE_HEIGHT / 2

describe("projectPoint", () => {
  it("equals worldToScreen for a camera at the origin", () => {
    const camera = { x: 0, y: 0, scale: 1 };
    for (const [gx, gy, gz] of [
      [0, 0, 0],
      [3, 1, 0],
      [2, 2, 3],
      [-1, 4, 1],
    ] as const) {
      expect(projectPoint(gx, gy, gz, camera)).toEqual(worldToScreen(gx, gy, gz));
    }
  });

  it("applies camera pan and zoom to the world point", () => {
    const world = worldToScreen(2, 2, 0);
    const camera = { x: 10, y: 20, scale: 2 };
    expect(projectPoint(2, 2, 0, camera)).toEqual(toScreen(world, camera));
    expect(projectPoint(2, 2, 0, camera)).toEqual({ x: world.x * 2 + 10, y: world.y * 2 + 20 });
  });

  it("lifts a raised tile up the screen by elevation × zoom", () => {
    const camera = { x: 0, y: 0, scale: 2 };
    const ground = projectPoint(2, 2, 0, camera);
    const raised = projectPoint(2, 2, 2, camera);
    expect(raised.x).toBe(ground.x);
    expect(ground.y - raised.y).toBeCloseTo(2 * TILE_HALF_HEIGHT * camera.scale, 6);
  });

  it("is deterministic: identical inputs give identical output", () => {
    const camera = { x: 37, y: -14, scale: 1.5 };
    expect(projectPoint(5, 7, 2, camera)).toEqual(projectPoint(5, 7, 2, camera));
  });
});

describe("anchorFor", () => {
  const viewport = { width: 800, height: 600 };
  const size = { width: 220, height: 140 };

  it("places the card to the right when there is room", () => {
    const anchor = anchorFor({ x: 100, y: 300 }, viewport, size);
    expect(anchor.side).toBe("right");
    expect(anchor.left).toBe(100 + HUD_GAP);
    // Vertically centred on the soldier.
    expect(anchor.top).toBe(300 - size.height / 2);
  });

  it("flips to the left at the right edge, exactly at the FFT Blue threshold", () => {
    // `ix + w > width - 10` flips; the last right placement satisfies `<=`.
    const lastRight = viewport.width - HUD_MARGIN - size.width - HUD_GAP;
    expect(anchorFor({ x: lastRight, y: 300 }, viewport, size).side).toBe("right");
    expect(anchorFor({ x: lastRight + 1, y: 300 }, viewport, size).side).toBe("left");

    const flipped = anchorFor({ x: 700, y: 300 }, viewport, size);
    expect(flipped).toEqual({
      left: 700 - HUD_GAP - size.width,
      top: 300 - size.height / 2,
      side: "left",
    });
  });

  it("clamps the top edge to the margin", () => {
    const anchor = anchorFor({ x: 100, y: 5 }, viewport, size);
    expect(anchor.top).toBe(HUD_MARGIN);
  });

  it("clamps the bottom edge to the viewport", () => {
    const anchor = anchorFor({ x: 100, y: 590 }, viewport, size);
    expect(anchor.top).toBe(viewport.height - size.height - HUD_MARGIN);
  });

  it("clamps a flipped card to the left margin", () => {
    const narrow = { width: 200, height: 600 };
    const anchor = anchorFor({ x: 190, y: 300 }, narrow, size);
    expect(anchor.side).toBe("left");
    expect(anchor.left).toBe(HUD_MARGIN);
  });

  it("keeps the margin when the viewport is smaller than the card", () => {
    const tiny = { width: 100, height: 100 };
    expect(anchorFor({ x: 50, y: 50 }, tiny, size)).toEqual({
      left: HUD_MARGIN,
      top: HUD_MARGIN,
      side: "left",
    });
  });

  it("is deterministic: identical inputs give identical output", () => {
    const a = anchorFor({ x: 420, y: 260 }, viewport, size);
    const b = anchorFor({ x: 420, y: 260 }, viewport, size);
    expect(a).toEqual(b);
  });
});
