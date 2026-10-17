import { describe, expect, it } from "vitest";

import { coord } from "../../src/engine/grid";
import { createTerrainMap } from "../../src/engine/terrain";
import {
  AREA_COLOR,
  AREA_HIT_COLOR,
  CURSOR_COLOR,
  DANGER_COLOR,
  ELEVATION_DOWN_COLOR,
  ELEVATION_UP_COLOR,
  MOVE_RANGE_COLOR,
  PATH_COLOR,
  TARGET_RANGE_COLOR,
  createOverlay,
  elevationGlyph,
  innerDiamondPoints,
} from "../../src/render/overlay";
import { TILE_WIDTH, diamondPoints } from "../../src/render/tiles";

/* --------------------------------------------------------------------------
 * T085 — Targeting overlay
 *
 * The overlay is presentation-only: it draws the tiles it is handed and owns no
 * state. These tests pin its Pixi-free geometry helpers and the palette, and
 * check that every layer can be set and cleared idempotently without touching
 * the map it is given.
 * ------------------------------------------------------------------------ */

describe("targeting overlay palette", () => {
  it("gives every layer a distinct colour", () => {
    const colors = [
      MOVE_RANGE_COLOR,
      TARGET_RANGE_COLOR,
      AREA_COLOR,
      AREA_HIT_COLOR,
      DANGER_COLOR,
      ELEVATION_UP_COLOR,
      ELEVATION_DOWN_COLOR,
      PATH_COLOR,
      CURSOR_COLOR,
    ];
    expect(new Set(colors).size).toBe(colors.length);
    for (const color of colors) {
      expect(color).toBeGreaterThanOrEqual(0);
      expect(color).toBeLessThanOrEqual(0xffffff);
    }
  });
});

describe("elevationGlyph", () => {
  const center = { x: 100, y: 50 };

  it("draws nothing on level ground or for a non-finite delta", () => {
    expect(elevationGlyph(center, 0)).toBeNull();
    expect(elevationGlyph(center, Number.NaN)).toBeNull();
  });

  it("points up for higher ground and down for lower ground", () => {
    const up = elevationGlyph(center, 2);
    const down = elevationGlyph(center, -1);
    expect(up?.direction).toBe("up");
    expect(up?.color).toBe(ELEVATION_UP_COLOR);
    expect(down?.direction).toBe("down");
    expect(down?.color).toBe(ELEVATION_DOWN_COLOR);
  });

  it("returns finite chevron points centred on the tile", () => {
    for (const delta of [1, -3]) {
      const glyph = elevationGlyph(center, delta);
      expect(glyph?.points).toHaveLength(6);
      for (const value of glyph?.points ?? []) {
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});

describe("innerDiamondPoints", () => {
  it("insets a diamond inside the tile's top face", () => {
    const center = { x: 0, y: 0 };
    const outer = diamondPoints(center);
    const inner = innerDiamondPoints(center);
    expect(inner).toHaveLength(8);
    // Every inner corner is closer to the centre than the outer half-width.
    for (let i = 0; i < inner.length; i += 2) {
      expect(Math.abs(inner[i])).toBeLessThan(TILE_WIDTH / 2);
    }
    expect(Math.max(...outer.map((value) => Math.abs(value)))).toBeGreaterThan(
      Math.max(...inner.map((value) => Math.abs(value))),
    );
  });
});

describe("createOverlay", () => {
  const map = createTerrainMap(5, 5, "field");

  it("stacks one layer per highlight, in tactical order", () => {
    const overlay = createOverlay();
    // danger, move, target, area, path, elevation, cursor
    expect(overlay.container.children).toHaveLength(7);
  });

  it("sets and clears every layer idempotently", () => {
    const overlay = createOverlay();
    const tiles = [coord(1, 1), coord(2, 2)];
    const elevation = { at: coord(2, 2), delta: 1 };

    expect(() => {
      overlay.setDangerZone(tiles, map);
      overlay.setMoveRange(tiles, map);
      overlay.setTargetRange(tiles, map);
      overlay.setArea({ tiles, hits: [coord(1, 1)] }, map);
      overlay.setElevationPreview(elevation, map);
      overlay.setPath([coord(0, 0), coord(1, 1)], map);
      overlay.setCursor(coord(1, 1), map);
      // Re-setting must redraw from scratch rather than accumulate.
      overlay.setDangerZone(tiles, map);
      overlay.setArea({ tiles: [], hits: [] }, map);
      overlay.setElevationPreview(null, map);
      overlay.setCursor(null, map);
      overlay.clear();
    }).not.toThrow();
  });

  it("accepts empty highlight lists without complaint", () => {
    const overlay = createOverlay();
    const before = overlay.container.children.length;
    overlay.clear();
    overlay.setMoveRange([], map);
    overlay.setTargetRange([], map);
    overlay.setDangerZone([], map);
    overlay.setArea({ tiles: [] }, map);
    overlay.setElevationPreview(null, map);
    overlay.setPath([], map);
    overlay.setCursor(null, map);
    expect(overlay.container.children).toHaveLength(before);
  });
});
