import { describe, expect, it } from "vitest";

import { coord, coordEquals, type Coord } from "../../src/engine/grid";
import {
  CLIMB_COST_PER_LEVEL,
  createTerrainMap,
  getTerrainDef,
  stepCost,
  terrainTileAt,
  withTile,
  type TerrainMap,
} from "../../src/engine/terrain";
import {
  findPath,
  reachableWithin,
  type PathResult,
  type ReachableTile,
} from "../../src/engine/pathfinding";

/* --------------------------------------------------------------------------
 * T015 — Pathfinding (A*)
 *
 * Movement (T025) and the move-range overlay (T027/T030) both stand on A*. These
 * tests pin the contract from the task's "done when": the returned path is the
 * **least-cost** route, and it honours **terrain cost**, the **Climb** limit on
 * elevation, and **occupied** tiles. They also pin the guarantees the rest of
 * the engine relies on — determinism, contiguity, and clean rejection of
 * malformed input — because the engine is replayed from a seed + command log
 * (`agents.md` §2, §7).
 * ------------------------------------------------------------------------ */

/** Every consecutive pair in a path must be orthogonally adjacent. */
function isContiguous(path: readonly Coord[]): boolean {
  for (let i = 1; i < path.length; i++) {
    const dx = Math.abs(path[i].x - path[i - 1].x);
    const dy = Math.abs(path[i].y - path[i - 1].y);
    if (dx + dy !== 1) return false;
  }
  return true;
}

/** Recompute a path's movement cost from the same rules A* uses. */
function sumStepCost(map: TerrainMap, path: readonly Coord[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += stepCost(terrainTileAt(map, path[i - 1]), terrainTileAt(map, path[i]));
  }
  return total;
}

describe("findPath — open ground", () => {
  it("returns the straight least-cost path across a corridor", () => {
    const map = createTerrainMap(5, 1, "field");
    const result = findPath(map, coord(0, 0), coord(4, 0), { climb: 0 });

    expect(result.found).toBe(true);
    expect(result.cost).toBe(4);
    expect(result.path).toEqual([coord(0, 0), coord(1, 0), coord(2, 0), coord(3, 0), coord(4, 0)]);
  });

  it("returns a single-tile path when origin and destination match", () => {
    const map = createTerrainMap(3, 3, "field");
    const result = findPath(map, coord(2, 2), coord(2, 2), { climb: 0 });

    expect(result.found).toBe(true);
    expect(result.cost).toBe(0);
    expect(result.path).toEqual([coord(2, 2)]);
  });

  it("only ever moves to orthogonally adjacent tiles", () => {
    const map = createTerrainMap(6, 4, "field");
    const result = findPath(map, coord(0, 0), coord(5, 3), { climb: 0 });

    expect(result.found).toBe(true);
    expect(isContiguous(result.path)).toBe(true);
    expect(result.path[0]).toEqual(coord(0, 0));
    expect(result.path[result.path.length - 1]).toEqual(coord(5, 3));
    expect(result.cost).toBe(sumStepCost(map, result.path));
  });
});

describe("findPath — terrain cost", () => {
  it("charges the destination tile's move cost", () => {
    let map = createTerrainMap(3, 1, "field");
    map = withTile(map, coord(1, 0), "wood");

    const result = findPath(map, coord(0, 0), coord(2, 0), { climb: 0 });

    expect(result.found).toBe(true);
    expect(result.cost).toBe(getTerrainDef("field").moveCost + getTerrainDef("wood").moveCost);
    expect(result.path).toEqual([coord(0, 0), coord(1, 0), coord(2, 0)]);
  });

  it("prefers a longer, cheaper detour over expensive ground", () => {
    // A 5×3 field with a marsh ridge along the middle row. Walking straight
    // costs 3 + 3 + 3 + 1 = 10; stepping around it costs 6.
    let map = createTerrainMap(5, 3, "field");
    for (const x of [1, 2, 3]) map = withTile(map, coord(x, 1), "marsh");

    const result = findPath(map, coord(0, 1), coord(4, 1), { climb: 0 });

    expect(result.found).toBe(true);
    expect(result.cost).toBe(6);
    expect(result.cost).toBe(sumStepCost(map, result.path));
    // The least-cost route avoids every marsh tile.
    for (const at of result.path) expect(terrainTileAt(map, at).terrain).not.toBe("marsh");
  });
});

describe("findPath — elevation & Climb", () => {
  it("refuses a step beyond the mover's Climb", () => {
    let map = createTerrainMap(2, 1, "field");
    map = withTile(map, coord(1, 0), { terrain: "field", height: 3 });

    const blocked = findPath(map, coord(0, 0), coord(1, 0), { climb: 2 });
    expect(blocked.found).toBe(false);
    expect(blocked.path).toEqual([]);
    expect(blocked.cost).toBe(Number.POSITIVE_INFINITY);

    const allowed = findPath(map, coord(0, 0), coord(1, 0), { climb: 3 });
    expect(allowed.found).toBe(true);
    expect(allowed.cost).toBe(1 + 3 * CLIMB_COST_PER_LEVEL);
  });

  it("gates descent on Climb too, but does not charge a climb premium", () => {
    let map = createTerrainMap(2, 1, { terrain: "field", height: 3 });
    map = withTile(map, coord(1, 0), { terrain: "field", height: 0 });

    // A 3-level drop needs Climb ≥ 3, exactly like a climb.
    expect(findPath(map, coord(0, 0), coord(1, 0), { climb: 2 }).found).toBe(false);

    const down = findPath(map, coord(0, 0), coord(1, 0), { climb: 3 });
    expect(down.found).toBe(true);
    // Step cost is the destination terrain only; descending is free of premium.
    expect(down.cost).toBe(getTerrainDef("field").moveCost);
  });

  it("routes around an unclimbable ridge when a way exists", () => {
    // A 2-tile-high wall across the top two rows; only the bottom row connects.
    let map = createTerrainMap(3, 3, "field");
    map = withTile(map, coord(1, 0), { terrain: "hill", height: 2 });
    map = withTile(map, coord(1, 1), { terrain: "hill", height: 2 });

    const result = findPath(map, coord(0, 1), coord(2, 1), { climb: 1 });
    expect(result.found).toBe(true);
    expect(result.path).not.toContainEqual(coord(1, 0));
    expect(result.path).not.toContainEqual(coord(1, 1));
    expect(result.cost).toBe(4); // down, across, across, up — all level-0 field
  });
});

describe("findPath — occupied & impassable tiles", () => {
  it("detours around a single occupied tile", () => {
    const map = createTerrainMap(3, 3, "field");
    const occupied = [coord(1, 0)];
    const result = findPath(map, coord(0, 0), coord(2, 0), { climb: 0, occupied });

    expect(result.found).toBe(true);
    expect(result.path).not.toContainEqual(coord(1, 0));
    expect(result.cost).toBe(4);
    expect(isContiguous(result.path)).toBe(true);
  });

  it("treats an occupied tile as a wall when it seals the goal", () => {
    const map = createTerrainMap(3, 3, "field");
    const occupied = [coord(1, 0), coord(1, 1), coord(1, 2)];
    const result = findPath(map, coord(0, 1), coord(2, 1), { climb: 0, occupied });

    expect(result.found).toBe(false);
    expect(result.path).toEqual([]);
  });

  it("lets a unit leave the tile it is standing on", () => {
    const map = createTerrainMap(3, 1, "field");
    // The origin is in the occupied set (the mover itself); it must not block.
    const result = findPath(map, coord(0, 0), coord(2, 0), {
      climb: 0,
      occupied: [coord(0, 0)],
    });

    expect(result.found).toBe(true);
    expect(result.cost).toBe(2);
  });

  it("treats impassable terrain as a wall and routes around it", () => {
    let map = createTerrainMap(3, 3, "field");
    map = withTile(map, coord(1, 0), "river");

    const result = findPath(map, coord(0, 0), coord(2, 0), { climb: 0 });
    expect(result.found).toBe(true);
    expect(result.path).not.toContainEqual(coord(1, 0));
    expect(result.cost).toBe(4);
  });

  it("reports no path when impassable terrain seals the goal", () => {
    let map = createTerrainMap(3, 1, "field");
    map = withTile(map, coord(1, 0), "wall");

    const result = findPath(map, coord(0, 0), coord(2, 0), { climb: 0 });
    expect(result.found).toBe(false);
    expect(result.path).toEqual([]);
    expect(result.cost).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("findPath — budgets & edge cases", () => {
  it("honours a maxCost movement budget", () => {
    const map = createTerrainMap(5, 1, "field");

    expect(findPath(map, coord(0, 0), coord(4, 0), { climb: 0, maxCost: 3 }).found).toBe(false);

    const within = findPath(map, coord(0, 0), coord(4, 0), { climb: 0, maxCost: 4 });
    expect(within.found).toBe(true);
    expect(within.cost).toBe(4);
  });

  it("is deterministic across repeated calls", () => {
    let map = createTerrainMap(6, 6, "field");
    map = withTile(map, coord(2, 2), "wood");
    map = withTile(map, coord(3, 3), "marsh");
    map = withTile(map, coord(1, 4), "river");

    const first: PathResult = findPath(map, coord(0, 0), coord(5, 5), { climb: 1 });
    const second: PathResult = findPath(map, coord(0, 0), coord(5, 5), { climb: 1 });
    expect(second).toEqual(first);
  });

  it("does not mutate the map or its inputs", () => {
    const map = createTerrainMap(3, 3, "field");
    const snapshot = JSON.parse(JSON.stringify(map)) as TerrainMap;
    const from = Object.freeze(coord(0, 0));
    const to = Object.freeze(coord(2, 2));

    findPath(map, from, to, { climb: 0 });

    expect(map).toEqual(snapshot);
    expect(from).toEqual({ x: 0, y: 0 });
    expect(to).toEqual({ x: 2, y: 2 });
  });

  it("throws for endpoints outside the map", () => {
    const map = createTerrainMap(2, 2, "field");
    expect(() => findPath(map, coord(-1, 0), coord(0, 0))).toThrow(RangeError);
    expect(() => findPath(map, coord(0, 0), coord(2, 0))).toThrow(RangeError);
    expect(() => findPath(map, coord(0, 0), coord(0, 2))).toThrow(RangeError);
  });

  it("throws for invalid Climb and budget values", () => {
    const map = createTerrainMap(2, 1, "field");
    expect(() => findPath(map, coord(0, 0), coord(1, 0), { climb: -1 })).toThrow(RangeError);
    expect(() => findPath(map, coord(0, 0), coord(1, 0), { climb: 1.5 })).toThrow(RangeError);
    expect(() => findPath(map, coord(0, 0), coord(1, 0), { maxCost: -1 })).toThrow(RangeError);
    expect(() => findPath(map, coord(0, 0), coord(1, 0), { maxCost: Number.NaN })).toThrow(
      RangeError,
    );
  });
});

describe("reachableWithin — move range", () => {
  it("returns the origin plus every tile within the budget", () => {
    const map = createTerrainMap(3, 3, "field");
    const tiles = reachableWithin(map, coord(1, 1), 1, { climb: 0 });

    expect(tiles).toEqual<ReachableTile[]>([
      { at: coord(1, 1), cost: 0 },
      { at: coord(1, 0), cost: 1 },
      { at: coord(0, 1), cost: 1 },
      { at: coord(2, 1), cost: 1 },
      { at: coord(1, 2), cost: 1 },
    ]);
  });

  it("reaches the whole field at budget 2 and is stably ordered", () => {
    const map = createTerrainMap(3, 3, "field");
    const tiles = reachableWithin(map, coord(1, 1), 2, { climb: 0 });

    expect(tiles).toHaveLength(9);
    expect(tiles[0]).toEqual({ at: coord(1, 1), cost: 0 });
    expect(tiles[tiles.length - 1]?.cost).toBe(2);
    // Sorted by (cost, y, x): the four corners come last, in reading order.
    expect(tiles.slice(5)).toEqual<ReachableTile[]>([
      { at: coord(0, 0), cost: 2 },
      { at: coord(2, 0), cost: 2 },
      { at: coord(0, 2), cost: 2 },
      { at: coord(2, 2), cost: 2 },
    ]);
  });

  it("excludes occupied tiles", () => {
    const map = createTerrainMap(3, 3, "field");
    const tiles = reachableWithin(map, coord(1, 1), 1, {
      climb: 0,
      occupied: [coord(1, 0)],
    });

    expect(tiles.map((tile) => tile.at)).not.toContainEqual(coord(1, 0));
    expect(tiles).toHaveLength(4);
  });

  it("excludes tiles beyond the Climb limit", () => {
    // A 1×3 corridor with an unclimbable ramp in the middle.
    let map = createTerrainMap(3, 1, "field");
    map = withTile(map, coord(1, 0), { terrain: "field", height: 3 });

    const tiles = reachableWithin(map, coord(0, 0), 10, { climb: 2 });
    expect(tiles).toEqual<ReachableTile[]>([{ at: coord(0, 0), cost: 0 }]);
  });

  it("respects terrain cost when expanding", () => {
    let map = createTerrainMap(3, 1, "field");
    map = withTile(map, coord(1, 0), "wood");

    const tiles = reachableWithin(map, coord(0, 0), 3, { climb: 0 });
    // field 0 → wood 2 → field 3; all reachable, with the far tile costed at 3.
    expect(tiles).toEqual<ReachableTile[]>([
      { at: coord(0, 0), cost: 0 },
      { at: coord(1, 0), cost: 2 },
      { at: coord(2, 0), cost: 3 },
    ]);
  });

  it("throws for an out-of-bounds origin or a negative budget", () => {
    const map = createTerrainMap(2, 2, "field");
    expect(() => reachableWithin(map, coord(2, 0), 1)).toThrow(RangeError);
    expect(() => reachableWithin(map, coord(0, 0), -1)).toThrow(RangeError);
  });
});

describe("path validity invariant", () => {
  it("every returned step is legal under the same move rules", () => {
    let map = createTerrainMap(7, 5, "field");
    map = withTile(map, coord(2, 1), "wood");
    map = withTile(map, coord(4, 3), "marsh");
    map = withTile(map, coord(3, 2), { terrain: "hill", height: 2 });
    map = withTile(map, coord(5, 1), "river");

    const occupied = [coord(1, 1), coord(4, 1)];
    const result = findPath(map, coord(0, 0), coord(6, 4), { climb: 1, occupied });

    expect(result.found).toBe(true);
    expect(isContiguous(result.path)).toBe(true);
    for (const at of result.path) {
      const tile = terrainTileAt(map, at);
      expect(getTerrainDef(tile.terrain).passable).toBe(true);
      expect(occupied.some((blocked) => coordEquals(blocked, at))).toBe(false);
    }
    expect(result.cost).toBe(sumStepCost(map, result.path));
  });
});
