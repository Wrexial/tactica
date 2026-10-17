import { describe, expect, it } from "vitest";

import {
  FACING_OFFSETS,
  FACINGS,
  addCoords,
  allCoords,
  assertInBounds,
  chebyshevDistance,
  coord,
  coordEquals,
  coordKey,
  coordToIndex,
  createGrid,
  facingTo,
  inBounds,
  indexToCoord,
  isAdjacent,
  isFacing,
  iterateCoords,
  manhattanDistance,
  neighbour,
  neighbours,
  neighboursInGrid,
  oppositeFacing,
  parseCoordKey,
  rotateFacing,
  subtractCoords,
  tileCount,
} from "../../src/engine/grid";
import type { Coord, Facing } from "../../src/engine/grid";
import {
  CLIMB_COST_PER_LEVEL,
  MAX_HEIGHT,
  MIN_HEIGHT,
  TERRAIN,
  TERRAIN_TYPES,
  blocksSightAt,
  canClimb,
  createTerrainMap,
  elevationDelta,
  getTerrainDef,
  heightAt,
  isPassableAt,
  isTerrainType,
  moveCostAt,
  stepCost,
  terrainAt,
  terrainTileAt,
  terrainTileCount,
  withTile,
} from "../../src/engine/terrain";

/* --------------------------------------------------------------------------
 * T013 — Coordinates & grid model
 *
 * The grid is the coordinate space every later mechanic stands on: movement
 * (T015), range/LoS (T016), unit position/facing (T017) and the isometric
 * renderer (T029). These tests pin down three guarantees:
 *   1. Coordinates behave as plain, immutable, serialisable values.
 *   2. Bounds checks accept exactly the integer tiles of the rectangle.
 *   3. Adjacency and cardinal facing are exact, deterministic and don't depend
 *      on the isometric projection.
 * ------------------------------------------------------------------------ */

describe("Coord", () => {
  it("builds plain, JSON-safe coordinate objects", () => {
    const at = coord(3, 5);
    expect(at).toEqual({ x: 3, y: 5 });
    expect(JSON.parse(JSON.stringify(at))).toEqual(at);
  });

  it("compares structurally", () => {
    expect(coordEquals(coord(1, 2), { x: 1, y: 2 })).toBe(true);
    expect(coordEquals(coord(1, 2), coord(2, 1))).toBe(false);
  });

  it("round-trips through a string key", () => {
    for (const at of [coord(0, 0), coord(4, 7), coord(-2, 9), coord(12, -3)]) {
      expect(parseCoordKey(coordKey(at))).toEqual(at);
    }
  });

  it("rejects malformed keys", () => {
    expect(parseCoordKey("")).toBeUndefined();
    expect(parseCoordKey("1")).toBeUndefined();
    expect(parseCoordKey("1;2")).toBeUndefined();
    expect(parseCoordKey("a,b")).toBeUndefined();
    expect(parseCoordKey("1,2,3")).toBeUndefined();
  });

  it("adds and subtracts offset vectors without mutating inputs", () => {
    const a = Object.freeze(coord(2, 3));
    const b = Object.freeze(coord(4, -1));
    expect(addCoords(a, b)).toEqual({ x: 6, y: 2 });
    expect(subtractCoords(a, b)).toEqual({ x: -2, y: 4 });
    expect(a).toEqual({ x: 2, y: 3 });
    expect(b).toEqual({ x: 4, y: -1 });
  });

  it("computes manhattan and chebyshev distances", () => {
    expect(manhattanDistance(coord(0, 0), coord(3, 4))).toBe(7);
    expect(chebyshevDistance(coord(0, 0), coord(3, 4))).toBe(4);
    expect(manhattanDistance(coord(5, 5), coord(5, 5))).toBe(0);
    // Diagonal steps are 2 manhattan but 1 chebyshev.
    expect(manhattanDistance(coord(0, 0), coord(1, 1))).toBe(2);
    expect(chebyshevDistance(coord(0, 0), coord(1, 1))).toBe(1);
  });
});

describe("cardinal facing", () => {
  it("lists the four directions clockwise", () => {
    expect(FACINGS).toEqual(["north", "east", "south", "west"]);
  });

  it("uses axis-based offsets (north = -y, east = +x)", () => {
    // These are grid axes, not screen angles; the isometric renderer maps them
    // to the diamond's diagonals.
    expect(FACING_OFFSETS).toEqual({
      north: { x: 0, y: -1 },
      east: { x: 1, y: 0 },
      south: { x: 0, y: 1 },
      west: { x: -1, y: 0 },
    });
  });

  it("guards untrusted facing values", () => {
    for (const facing of FACINGS) expect(isFacing(facing)).toBe(true);
    expect(isFacing("up")).toBe(false);
    expect(isFacing("NORTH")).toBe(false);
    expect(isFacing(null)).toBe(false);
    expect(isFacing(2)).toBe(false);
  });

  it("reports the opposite facing for every direction", () => {
    const expected: Record<Facing, Facing> = {
      north: "south",
      east: "west",
      south: "north",
      west: "east",
    };
    for (const facing of FACINGS) {
      expect(oppositeFacing(facing)).toBe(expected[facing]);
      expect(oppositeFacing(oppositeFacing(facing))).toBe(facing);
    }
  });

  it("rotates clockwise, wraps and supports negatives", () => {
    expect(rotateFacing("north", 1)).toBe("east");
    expect(rotateFacing("north", 3)).toBe("west");
    expect(rotateFacing("east", 4)).toBe("east");
    expect(rotateFacing("east", 5)).toBe("south");
    expect(rotateFacing("north", -1)).toBe("west");
    expect(rotateFacing("north", -5)).toBe("west");
    expect(rotateFacing("south")).toBe("west"); // default one quarter-turn
  });

  it("steps one tile in the given direction", () => {
    const origin = coord(4, 4);
    expect(neighbour(origin, "north")).toEqual({ x: 4, y: 3 });
    expect(neighbour(origin, "east")).toEqual({ x: 5, y: 4 });
    expect(neighbour(origin, "south")).toEqual({ x: 4, y: 5 });
    expect(neighbour(origin, "west")).toEqual({ x: 3, y: 4 });
    // Stepping off the edge stays mathematically valid; bounds are checked
    // separately via `inBounds`.
    expect(neighbour(coord(0, 0), "north")).toEqual({ x: 0, y: -1 });
  });

  it("returns four neighbours in facing order", () => {
    expect(neighbours(coord(1, 1))).toEqual([
      coord(1, 0),
      coord(2, 1),
      coord(1, 2),
      coord(0, 1),
    ]);
  });

  it("filters neighbours to those inside the grid", () => {
    expect(neighboursInGrid(createGrid(3, 3), coord(1, 1))).toEqual([
      coord(1, 0),
      coord(2, 1),
      coord(1, 2),
      coord(0, 1),
    ]);
    // A corner has only two legal neighbours.
    expect(neighboursInGrid(createGrid(3, 3), coord(0, 0))).toEqual([coord(1, 0), coord(0, 1)]);
    // A 1×1 grid has none.
    expect(neighboursInGrid(createGrid(1, 1), coord(0, 0))).toEqual([]);
  });

  it("treats only edge-sharing tiles as adjacent", () => {
    const origin = coord(2, 2);
    for (const facing of FACINGS) {
      expect(isAdjacent(origin, neighbour(origin, facing))).toBe(true);
    }
    expect(isAdjacent(origin, origin)).toBe(false);
    expect(isAdjacent(origin, coord(3, 3))).toBe(false); // diagonal
    expect(isAdjacent(origin, coord(4, 2))).toBe(false); // two away
  });

  it("derives the facing between orthogonally adjacent tiles", () => {
    const origin = coord(2, 2);
    expect(facingTo(origin, coord(2, 1))).toBe("north");
    expect(facingTo(origin, coord(3, 2))).toBe("east");
    expect(facingTo(origin, coord(2, 3))).toBe("south");
    expect(facingTo(origin, coord(1, 2))).toBe("west");
  });

  it("returns undefined when a single facing is undefined", () => {
    const origin = coord(2, 2);
    expect(facingTo(origin, origin)).toBeUndefined(); // same tile
    expect(facingTo(origin, coord(3, 3))).toBeUndefined(); // diagonal
    expect(facingTo(origin, coord(4, 2))).toBeUndefined(); // not adjacent
    expect(facingTo(origin, coord(2, 4))).toBeUndefined();
  });
});

describe("Grid bounds", () => {
  it("creates a validated rectangular grid", () => {
    const grid = createGrid(8, 4);
    expect(grid).toEqual({ width: 8, height: 4 });
    expect(tileCount(grid)).toBe(32);
  });

  it("rejects non-positive or fractional dimensions", () => {
    expect(() => createGrid(0, 4)).toThrow(RangeError);
    expect(() => createGrid(8, 0)).toThrow(RangeError);
    expect(() => createGrid(-1, 4)).toThrow(RangeError);
    expect(() => createGrid(8, -1)).toThrow(RangeError);
    expect(() => createGrid(2.5, 4)).toThrow(RangeError);
    expect(() => createGrid(8, 4.5)).toThrow(RangeError);
    expect(() => createGrid(Number.NaN, 4)).toThrow(RangeError);
  });

  it("accepts exactly the integer tiles of the rectangle", () => {
    const grid = createGrid(3, 2);
    for (const at of allCoords(grid)) expect(inBounds(grid, at)).toBe(true);

    expect(inBounds(grid, coord(2, 1))).toBe(true); // far corner
    expect(inBounds(grid, coord(3, 0))).toBe(false); // x too large
    expect(inBounds(grid, coord(0, 2))).toBe(false); // y too large
    expect(inBounds(grid, coord(-1, 0))).toBe(false); // negative
    expect(inBounds(grid, coord(0, -1))).toBe(false);
  });

  it("never treats a fractional position as a tile", () => {
    const grid = createGrid(4, 4);
    expect(inBounds(grid, coord(1.5, 1))).toBe(false);
    expect(inBounds(grid, coord(1, 2.5))).toBe(false);
  });

  it("assertInBounds throws a descriptive error for off-grid tiles", () => {
    const grid = createGrid(3, 3);
    expect(() => assertInBounds(grid, coord(1, 1))).not.toThrow();
    expect(() => assertInBounds(grid, coord(3, 1), "target")).toThrowError(RangeError);
    expect(() => assertInBounds(grid, coord(3, 1), "target")).toThrowError(/target/);
    expect(() => assertInBounds(grid, coord(3, 1))).toThrowError(/3×3/);
  });
});

describe("flat tile indexing", () => {
  it("maps coordinates to row-major indices and back", () => {
    const grid = createGrid(4, 3);
    expect(coordToIndex(grid, coord(0, 0))).toBe(0);
    expect(coordToIndex(grid, coord(3, 0))).toBe(3);
    expect(coordToIndex(grid, coord(0, 1))).toBe(4);
    expect(coordToIndex(grid, coord(2, 2))).toBe(10);

    for (let index = 0; index < tileCount(grid); index++) {
      expect(coordToIndex(grid, indexToCoord(grid, index))).toBe(index);
    }
  });

  it("rejects out-of-bounds coordinates and indices", () => {
    const grid = createGrid(2, 2);
    expect(() => coordToIndex(grid, coord(2, 0))).toThrow(RangeError);
    expect(() => indexToCoord(grid, -1)).toThrow(RangeError);
    expect(() => indexToCoord(grid, 4)).toThrow(RangeError);
    expect(() => indexToCoord(grid, 1.5)).toThrow(RangeError);
  });
});

describe("deterministic iteration", () => {
  it("walks every tile in row-major order", () => {
    const grid = createGrid(3, 2);
    const expected: Coord[] = [
      coord(0, 0),
      coord(1, 0),
      coord(2, 0),
      coord(0, 1),
      coord(1, 1),
      coord(2, 1),
    ];
    expect([...iterateCoords(grid)]).toEqual(expected);
    expect(allCoords(grid)).toEqual(expected);
  });

  it("returns a fresh array each call", () => {
    const grid = createGrid(2, 2);
    const first = allCoords(grid);
    first.push(coord(99, 99));
    expect(allCoords(grid)).toHaveLength(4);
  });

  it("is stable across repeated calls (determinism)", () => {
    const grid = createGrid(5, 5);
    expect(allCoords(grid)).toEqual(allCoords(grid));
  });
});

/* --------------------------------------------------------------------------
 * T014 — Terrain & elevation
 *
 * Terrain is the data movement (T015) and sight (T016) are built on. These
 * tests pin the authored contract: every surface has a passability/move-cost
 * entry, elevation is an integer layer, and stepping between tiles obeys
 * terrain cost plus the Climb (FFTA "Jump") limit.
 * ------------------------------------------------------------------------ */

describe("terrain registry", () => {
  it("defines every terrain type exactly once", () => {
    expect(Object.keys(TERRAIN).sort()).toEqual([...TERRAIN_TYPES].sort());
    for (const type of TERRAIN_TYPES) {
      expect(TERRAIN[type].id).toBe(type);
    }
  });

  it("gives every terrain a Napoleonic name and mechanical description", () => {
    for (const type of TERRAIN_TYPES) {
      const def = getTerrainDef(type);
      expect(def.name.length).toBeGreaterThan(0);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.name).not.toMatch(/TBD|placeholder/i);
    }
  });

  it("uses positive integer move costs and sane impassable tiles", () => {
    for (const type of TERRAIN_TYPES) {
      const def = getTerrainDef(type);
      expect(Number.isInteger(def.moveCost)).toBe(true);
      expect(def.moveCost).toBeGreaterThan(0);
      // An impassable surface never needs a real cost; a passable one must be
      // affordable (1–3 in our authored balance).
      if (def.passable) expect(def.moveCost).toBeLessThanOrEqual(3);
    }
  });

  it("makes open ground cheap and river/wall impassable", () => {
    expect(getTerrainDef("field").moveCost).toBe(1);
    expect(getTerrainDef("field").passable).toBe(true);
    expect(getTerrainDef("river").passable).toBe(false);
    expect(getTerrainDef("river").water).toBe(true);
    expect(getTerrainDef("wall").passable).toBe(false);
  });

  it("lets woods and villages block line of sight", () => {
    expect(getTerrainDef("wood").blocksSight).toBe(true);
    expect(getTerrainDef("village").blocksSight).toBe(true);
    expect(getTerrainDef("field").blocksSight).toBe(false);
    expect(getTerrainDef("redoubt").blocksSight).toBe(false);
  });

  it("guards terrain keys at the boundary", () => {
    for (const type of TERRAIN_TYPES) expect(isTerrainType(type)).toBe(true);
    expect(isTerrainType("swamp")).toBe(false);
    expect(isTerrainType("FIELD")).toBe(false);
    expect(isTerrainType(null)).toBe(false);
  });
});

describe("elevation rules", () => {
  it("measures the absolute height difference", () => {
    expect(elevationDelta(0, 0)).toBe(0);
    expect(elevationDelta(0, 3)).toBe(3);
    expect(elevationDelta(5, 2)).toBe(3);
  });

  it("gates a step on the mover's Climb, up or down", () => {
    expect(canClimb(2, 0, 2)).toBe(true);
    expect(canClimb(2, 0, 3)).toBe(false);
    expect(canClimb(1, 4, 3)).toBe(true);
    expect(canClimb(1, 4, 2)).toBe(false);
    expect(canClimb(0, 1, 1)).toBe(true);
  });

  it("charges a premium for climbing but not for descending", () => {
    const low = { terrain: "field", height: 0 } as const;
    const high = { terrain: "field", height: 2 } as const;
    expect(stepCost(low, low)).toBe(1);
    expect(stepCost(low, high)).toBe(1 + 2 * CLIMB_COST_PER_LEVEL);
    expect(stepCost(high, low)).toBe(1); // downhill pays base only
  });

  it("adds terrain cost on top of the climb premium", () => {
    const field = { terrain: "field", height: 0 } as const;
    const wood = { terrain: "wood", height: 1 } as const;
    expect(stepCost(field, wood)).toBe(getTerrainDef("wood").moveCost + CLIMB_COST_PER_LEVEL);
  });
});

describe("terrain maps", () => {
  it("creates a validated rectangle filled with one terrain", () => {
    const map = createTerrainMap(4, 3, "field");
    expect(map.grid).toEqual({ width: 4, height: 3 });
    expect(terrainTileCount(map)).toBe(12);
    for (const at of allCoords(map.grid)) {
      expect(terrainAt(map, at)).toBe("field");
      expect(heightAt(map, at)).toBe(MIN_HEIGHT);
    }
  });

  it("accepts a full tile spec to seed elevation", () => {
    const map = createTerrainMap(2, 2, { terrain: "hill", height: 3 });
    expect(heightAt(map, coord(1, 1))).toBe(3);
    expect(terrainAt(map, coord(1, 1))).toBe("hill");
  });

  it("rejects unknown terrain and out-of-range elevations", () => {
    // @ts-expect-error — deliberately invalid terrain key at runtime.
    expect(() => createTerrainMap(2, 2, "swamp")).toThrow(RangeError);
    expect(() => createTerrainMap(2, 2, { terrain: "field", height: -1 })).toThrow(RangeError);
    expect(() => createTerrainMap(2, 2, { terrain: "field", height: MAX_HEIGHT + 1 })).toThrow(
      RangeError,
    );
    expect(() => createTerrainMap(2, 2, { terrain: "field", height: 1.5 })).toThrow(RangeError);
  });

  it("rejects invalid grid dimensions through createGrid", () => {
    expect(() => createTerrainMap(0, 4)).toThrow(RangeError);
    expect(() => createTerrainMap(4, -1)).toThrow(RangeError);
  });

  it("reads terrain, passability, cost and sight per tile", () => {
    let map = createTerrainMap(3, 1, "field");
    map = withTile(map, coord(1, 0), "wood");
    map = withTile(map, coord(2, 0), "river");

    expect(terrainTileAt(map, coord(1, 0))).toEqual({ terrain: "wood", height: MIN_HEIGHT });
    expect(isPassableAt(map, coord(0, 0))).toBe(true);
    expect(isPassableAt(map, coord(2, 0))).toBe(false);
    expect(moveCostAt(map, coord(1, 0))).toBe(2);
    expect(blocksSightAt(map, coord(1, 0))).toBe(true);
    expect(blocksSightAt(map, coord(0, 0))).toBe(false);
  });

  it("throws on off-grid access", () => {
    const map = createTerrainMap(2, 2, "field");
    expect(() => terrainTileAt(map, coord(2, 0))).toThrow(RangeError);
    expect(() => heightAt(map, coord(0, 2))).toThrow(RangeError);
  });

  it("withTile returns a fresh map and leaves the input untouched", () => {
    const before = createTerrainMap(2, 1, "field");
    const after = withTile(before, coord(0, 0), { terrain: "redoubt", height: 2 });

    expect(terrainAt(before, coord(0, 0))).toBe("field");
    expect(heightAt(before, coord(0, 0))).toBe(MIN_HEIGHT);
    expect(terrainAt(after, coord(0, 0))).toBe("redoubt");
    expect(heightAt(after, coord(0, 0))).toBe(2);
    expect(after).not.toBe(before);
    expect(after.tiles).not.toBe(before.tiles);
  });

  it("round-trips through JSON (serialisable for saves/replays)", () => {
    const map = createTerrainMap(2, 2, { terrain: "hill", height: 4 });
    expect(JSON.parse(JSON.stringify(map))).toEqual(map);
  });
});
