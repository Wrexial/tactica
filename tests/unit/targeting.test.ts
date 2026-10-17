import { describe, expect, it } from "vitest";

import { coord, type Coord } from "../../src/engine/grid";
import { createTerrainMap, heightAt, terrainAt, withTile } from "../../src/engine/terrain";
import {
  ELEVATION_RANGE_PER_LEVEL,
  MAX_ELEVATION_RANGE_DELTA,
  canTarget,
  effectiveRange,
  elevationRangeModifier,
  hasLineOfSight,
  lineOfSight,
  rangeBetween,
  tilesInRange,
  tilesOnLine,
  withinRange,
  type RangeProfile,
} from "../../src/engine/targeting";

/* --------------------------------------------------------------------------
 * T016 — Range & line of sight
 *
 * These tests pin the task's "done when": range checks (min/max, metric and
 * the elevation bonus) and line of sight blocked by **terrain** and
 * **elevation** are all verified. They also pin the guarantees the rest of the
 * engine leans on — determinism, purity, clean rejection of malformed input —
 * because targeting feeds the battle state machine and the AI.
 * ------------------------------------------------------------------------ */

/** A helper for building a flat map and replacing a single tile's height. */
function mapWithHeights(width: number, height: number, tiles: Record<string, number>) {
  let map = createTerrainMap(width, height, "field");
  for (const [key, elevation] of Object.entries(tiles)) {
    const [x, y] = key.split(",").map(Number);
    map = withTile(map, coord(x, y), { terrain: "field", height: elevation });
  }
  return map;
}

describe("rangeBetween", () => {
  it("uses Manhattan distance by default (a diamond)", () => {
    expect(rangeBetween(coord(0, 0), coord(3, 2))).toBe(5);
    expect(rangeBetween(coord(0, 0), coord(2, 2))).toBe(4);
  });

  it("uses Chebyshev distance when asked (a square)", () => {
    expect(rangeBetween(coord(0, 0), coord(3, 2), "chebyshev")).toBe(3);
    expect(rangeBetween(coord(0, 0), coord(2, 2), "chebyshev")).toBe(2);
  });
});

describe("effectiveRange — elevation", () => {
  const ranged: RangeProfile = { min: 1, max: 3, elevationBonus: true };
  const melee: RangeProfile = { min: 1, max: 1 };

  it("grants reach when firing downhill and removes it uphill", () => {
    expect(elevationRangeModifier(5, 0)).toBe(MAX_ELEVATION_RANGE_DELTA);
    expect(effectiveRange(ranged, 5, 0)).toBe(3 + MAX_ELEVATION_RANGE_DELTA);
    expect(effectiveRange(ranged, 0, 5)).toBe(3 - MAX_ELEVATION_RANGE_DELTA);
    expect(effectiveRange(ranged, 2, 2)).toBe(3);
  });

  it("caps the bonus at MAX_ELEVATION_RANGE_DELTA layers", () => {
    expect(effectiveRange(ranged, 15, 0)).toBe(3 + MAX_ELEVATION_RANGE_DELTA);
  });

  it("ignores elevation for profiles without the flag", () => {
    expect(effectiveRange(melee, 9, 0)).toBe(1);
  });

  it("never reduces the effective maximum below zero", () => {
    const short: RangeProfile = { min: 0, max: 1, elevationBonus: true };
    expect(effectiveRange(short, 0, 10)).toBe(0);
  });
});

describe("withinRange", () => {
  const profile: RangeProfile = { min: 1, max: 3 };

  it("accepts tiles between min and max and rejects outside them", () => {
    expect(withinRange(profile, coord(0, 0), coord(2, 0))).toBe(true);
    expect(withinRange(profile, coord(0, 0), coord(3, 0))).toBe(true);
    expect(withinRange(profile, coord(0, 0), coord(4, 0))).toBe(false);
  });

  it("enforces the minimum range (artillery cannot fire point-blank)", () => {
    expect(withinRange({ min: 2, max: 4 }, coord(0, 0), coord(1, 0))).toBe(false);
    expect(withinRange({ min: 2, max: 4 }, coord(0, 0), coord(2, 0))).toBe(true);
    expect(withinRange({ min: 0, max: 1 }, coord(0, 0), coord(0, 0))).toBe(true);
  });

  it("respects the profile's metric", () => {
    const diagonal = coord(1, 1);
    expect(withinRange({ min: 0, max: 1 }, coord(0, 0), diagonal)).toBe(false);
    expect(withinRange({ min: 0, max: 1, metric: "chebyshev" }, coord(0, 0), diagonal)).toBe(true);
  });

  it("applies the elevation bonus only when elevations are supplied", () => {
    const ranged: RangeProfile = { min: 0, max: 2, elevationBonus: true };
    expect(withinRange(ranged, coord(0, 0), coord(4, 0))).toBe(false);
    expect(withinRange(ranged, coord(0, 0), coord(4, 0), { observer: 3, target: 0 })).toBe(true);
  });

  it("rejects malformed profiles", () => {
    expect(() => withinRange({ min: 2, max: 1 }, coord(0, 0), coord(1, 0))).toThrow(RangeError);
    expect(() => withinRange({ min: -1, max: 3 }, coord(0, 0), coord(1, 0))).toThrow(RangeError);
    expect(() => withinRange({ min: 0, max: 1.5 }, coord(0, 0), coord(1, 0))).toThrow(RangeError);
  });
});

describe("tilesOnLine — Bresenham primitive", () => {
  it("returns a single tile for a zero-length line", () => {
    expect(tilesOnLine(coord(2, 2), coord(2, 2))).toEqual([coord(2, 2)]);
  });

  it("walks orthogonal lines exactly, endpoints included", () => {
    expect(tilesOnLine(coord(0, 0), coord(3, 0))).toEqual([
      coord(0, 0),
      coord(1, 0),
      coord(2, 0),
      coord(3, 0),
    ]);
    expect(tilesOnLine(coord(0, 3), coord(0, 0))).toEqual([
      coord(0, 3),
      coord(0, 2),
      coord(0, 1),
      coord(0, 0),
    ]);
  });

  it("walks an exact diagonal through the corner tiles", () => {
    expect(tilesOnLine(coord(0, 0), coord(2, 2))).toEqual([coord(0, 0), coord(1, 1), coord(2, 2)]);
  });

  it("resolves near-diagonal corner ties deterministically", () => {
    const first = tilesOnLine(coord(0, 0), coord(2, 1));
    const second = tilesOnLine(coord(0, 0), coord(2, 1));
    expect(first).toEqual(second);
    expect(first[0]).toEqual(coord(0, 0));
    expect(first[first.length - 1]).toEqual(coord(2, 1));
  });
});

describe("lineOfSight — terrain", () => {
  it("is clear across open ground, including the target's own tile", () => {
    const map = createTerrainMap(5, 1, "field");
    expect(hasLineOfSight(map, coord(0, 0), coord(4, 0))).toBe(true);
    expect(lineOfSight(map, coord(0, 0), coord(4, 0))).toEqual({ clear: true });
  });

  it("is blocked by an intervening wood, village or wall", () => {
    for (const blocking of ["wood", "village", "wall"] as const) {
      let map = createTerrainMap(5, 1, "field");
      map = withTile(map, coord(2, 0), blocking);
      const result = lineOfSight(map, coord(0, 0), coord(4, 0));
      expect(result.clear).toBe(false);
      expect(result.blockedBy).toEqual(coord(2, 0));
      expect(result.blocker).toBe("terrain");
    }
  });

  it("does not count the observer's or target's own blocking tile", () => {
    let map = createTerrainMap(5, 1, "field");
    map = withTile(map, coord(0, 0), "wood"); // observer in cover
    map = withTile(map, coord(4, 0), "wood"); // target in cover
    expect(hasLineOfSight(map, coord(0, 0), coord(4, 0))).toBe(true);
  });

  it("handles adjacent tiles with no intermediates", () => {
    let map = createTerrainMap(2, 1, "field");
    map = withTile(map, coord(1, 0), "wood");
    expect(hasLineOfSight(map, coord(0, 0), coord(1, 0))).toBe(true);
  });

  it("throws when an endpoint is off-grid", () => {
    const map = createTerrainMap(3, 3, "field");
    expect(() => lineOfSight(map, coord(-1, 0), coord(2, 2))).toThrow(RangeError);
    expect(() => hasLineOfSight(map, coord(0, 0), coord(3, 2))).toThrow(RangeError);
  });
});

describe("lineOfSight — elevation", () => {
  it("is blocked when ground rises above the interpolated sight line", () => {
    const map = mapWithHeights(5, 1, { "2,0": 4 });
    const result = lineOfSight(map, coord(0, 0), coord(4, 0));
    expect(result.clear).toBe(false);
    expect(result.blockedBy).toEqual(coord(2, 0));
    expect(result.blocker).toBe("elevation");
  });

  it("lets a unit on the ground see a target standing on high ground", () => {
    // Shooter at 0, target at 6, ridge midway at 4: the line skims the ridge.
    const map = mapWithHeights(5, 1, { "2,0": 4, "4,0": 6 });
    expect(hasLineOfSight(map, coord(0, 0), coord(4, 0))).toBe(true);
  });

  it("lets a shooter on high ground fire over a lower ridge", () => {
    const map = mapWithHeights(5, 1, { "0,0": 6, "2,0": 4 });
    expect(hasLineOfSight(map, coord(0, 0), coord(4, 0))).toBe(true);
  });

  it("still blocks when the ridge is taller than the sight line", () => {
    const map = mapWithHeights(5, 1, { "0,0": 6, "2,0": 5 });
    const result = lineOfSight(map, coord(0, 0), coord(4, 0));
    expect(result.clear).toBe(false);
    expect(result.blocker).toBe("elevation");
  });

  it("does not block flat ground at any elevation", () => {
    const map = mapWithHeights(5, 1, { "0,0": 3, "4,0": 3 });
    expect(hasLineOfSight(map, coord(0, 0), coord(4, 0))).toBe(true);
  });
});

describe("canTarget — combined range and sight", () => {
  const rifle: RangeProfile = { min: 1, max: 6 };

  it("accepts a visible target within range", () => {
    const map = createTerrainMap(8, 1, "field");
    const result = canTarget(map, coord(0, 0), coord(4, 0), rifle);
    expect(result.ok).toBe(true);
    expect(result.distance).toBe(4);
    expect(result.inRange).toBe(true);
    expect(result.lineOfSight).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("reports too-close and out-of-range distinctly", () => {
    const map = createTerrainMap(8, 1, "field");
    const tooClose = canTarget(map, coord(0, 0), coord(1, 0), { min: 3, max: 6 });
    expect(tooClose.ok).toBe(false);
    expect(tooClose.reason).toBe("too-close");

    const tooFar = canTarget(map, coord(0, 0), coord(7, 0), rifle);
    expect(tooFar.ok).toBe(false);
    expect(tooFar.reason).toBe("out-of-range");
  });

  it("reports blocked lines, preferring range over sight", () => {
    let map = createTerrainMap(8, 1, "field");
    map = withTile(map, coord(2, 0), "wood");
    const blocked = canTarget(map, coord(0, 0), coord(4, 0), rifle);
    expect(blocked.ok).toBe(false);
    expect(blocked.reason).toBe("blocked-terrain");
    expect(blocked.blockedBy).toEqual(coord(2, 0));

    // Out of range *and* blocked: range is reported first.
    const priority = canTarget(map, coord(0, 0), coord(7, 0), { min: 0, max: 3 });
    expect(priority.reason).toBe("out-of-range");
  });

  it("reports elevation blocking", () => {
    const map = mapWithHeights(8, 1, { "2,0": 4 });
    const result = canTarget(map, coord(0, 0), coord(4, 0), rifle);
    expect(result.reason).toBe("blocked-elevation");
  });

  it("can ignore line of sight for lobbed or area actions", () => {
    let map = createTerrainMap(8, 1, "field");
    map = withTile(map, coord(2, 0), "wall");
    const lobbed: RangeProfile = { min: 1, max: 6, requiresLineOfSight: false };
    expect(canTarget(map, coord(0, 0), coord(4, 0), lobbed).ok).toBe(true);
  });

  it("extends range from high ground for ranged profiles", () => {
    const map = mapWithHeights(8, 1, { "0,0": 3 });
    const ranged: RangeProfile = { min: 1, max: 2, elevationBonus: true };
    const result = canTarget(map, coord(0, 0), coord(4, 0), ranged);
    expect(result.range).toBe(2 + 3 * ELEVATION_RANGE_PER_LEVEL);
    expect(result.ok).toBe(true);

    const flat: RangeProfile = { min: 1, max: 2 };
    expect(canTarget(map, coord(0, 0), coord(4, 0), flat).ok).toBe(false);
  });

  it("throws on off-grid endpoints and malformed profiles", () => {
    const map = createTerrainMap(4, 4, "field");
    expect(() => canTarget(map, coord(0, 0), coord(4, 0), rifle)).toThrow(RangeError);
    expect(() => canTarget(map, coord(0, 0), coord(1, 0), { min: 3, max: 2 })).toThrow(RangeError);
  });
});

describe("tilesInRange — targeting overlay", () => {
  it("enumerates the diamond for a Manhattan profile", () => {
    const map = createTerrainMap(5, 5, "field");
    const tiles = tilesInRange(map, coord(2, 2), { min: 0, max: 2 });
    expect(tiles).toHaveLength(13);
    expect(tiles).toContainEqual(coord(0, 2));
    expect(tiles).toContainEqual(coord(2, 0));
    expect(tiles).not.toContainEqual(coord(0, 0)); // distance 4
  });

  it("enumerates the square for a Chebyshev profile", () => {
    const map = createTerrainMap(5, 5, "field");
    const tiles = tilesInRange(map, coord(2, 2), { min: 0, max: 1, metric: "chebyshev" });
    expect(tiles).toHaveLength(9);
    expect(tiles).toContainEqual(coord(1, 1));
  });

  it("filters out tiles hidden by blocking terrain", () => {
    let map = createTerrainMap(5, 1, "field");
    map = withTile(map, coord(1, 0), "wood");
    const tiles = tilesInRange(map, coord(0, 0), { min: 0, max: 3 });
    expect(tiles).toEqual([coord(0, 0), coord(1, 0)]);
  });

  it("is sorted deterministically by distance then y then x", () => {
    const map = createTerrainMap(5, 5, "field");
    const tiles = tilesInRange(map, coord(2, 2), { min: 0, max: 2 });
    const distances = tiles.map((at) => rangeBetween(coord(2, 2), at));
    for (let i = 1; i < distances.length; i++) {
      expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]);
    }
    expect(tilesInRange(map, coord(2, 2), { min: 0, max: 2 })).toEqual(tiles);
  });

  it("honours a minimum range by excluding close tiles", () => {
    const map = createTerrainMap(5, 1, "field");
    const tiles = tilesInRange(map, coord(0, 0), { min: 2, max: 4 });
    expect(tiles).toEqual([coord(2, 0), coord(3, 0), coord(4, 0)]);
  });

  it("throws when the origin is off-grid", () => {
    const map = createTerrainMap(3, 3, "field");
    expect(() => tilesInRange(map, coord(3, 0), { min: 0, max: 1 })).toThrow(RangeError);
  });
});

describe("purity and determinism", () => {
  it("does not mutate the map it inspects", () => {
    let map = createTerrainMap(5, 1, "field");
    map = withTile(map, coord(2, 0), { terrain: "wood", height: 2 });
    const before = map.tiles.map((tile) => ({ ...tile }));

    lineOfSight(map, coord(0, 0), coord(4, 0));
    canTarget(map, coord(0, 0), coord(4, 0), { min: 0, max: 6 });
    tilesInRange(map, coord(0, 0), { min: 0, max: 6 });

    expect(map.tiles).toEqual(before);
    expect(terrainAt(map, coord(2, 0))).toBe("wood");
    expect(heightAt(map, coord(2, 0))).toBe(2);
  });

  it("produces identical results across repeated calls", () => {
    const map = mapWithHeights(6, 4, { "3,1": 5 });
    const first = tilesInRange(map, coord(0, 0), { min: 0, max: 8 });
    const second = tilesInRange(map, coord(0, 0), { min: 0, max: 8 });
    expect(second).toEqual(first as Coord[]);
  });
});
