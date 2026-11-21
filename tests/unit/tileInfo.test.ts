import { describe, expect, it } from "vitest";

import type { StatBlock } from "../../src/data/schema";
import { coord } from "../../src/engine/grid";
import { asPostId, asUnitId } from "../../src/engine/ids";
import { createTerrainMap, withTile } from "../../src/engine/terrain";
import { createUnit } from "../../src/engine/unit";
import { tileInfoFor } from "../../src/ui/tileInfo";

/* --------------------------------------------------------------------------
 * T145 — Tile inspection: terrain, elevation and effects.
 *
 * `tileInfoFor` is the pure projection behind the anchored tile card. It reads
 * engine terrain facts (name, height, cost, passable/sight/water flags) and the
 * soldiers on the board, and returns a display value without mutating anything.
 * ------------------------------------------------------------------------ */

const STATS: StatBlock = {
  hp: 60,
  mp: 20,
  atk: 12,
  def: 8,
  mag: 4,
  res: 6,
  spd: 30,
  move: 4,
  jump: 2,
};

/** A 4×3 board with one of each interesting surface at a distinct height. */
function board() {
  let map = createTerrainMap(4, 3, "field");
  map = withTile(map, coord(1, 0), { terrain: "wood", height: 2 });
  map = withTile(map, coord(2, 0), { terrain: "river", height: 0 });
  map = withTile(map, coord(3, 0), { terrain: "hill", height: 3 });
  return map;
}

function soldier(id: string, x: number, y: number) {
  return createUnit({
    id: asUnitId(id),
    name: `Soldier ${id}`,
    power: "france",
    postId: asPostId("fusilier"),
    level: 1,
    at: coord(x, y),
    stats: STATS,
  });
}

describe("tileInfoFor", () => {
  it("describes an open field with no reference", () => {
    const info = tileInfoFor(board(), coord(0, 0));
    expect(info).not.toBeNull();
    expect(info).toMatchObject({
      at: { x: 0, y: 0 },
      terrain: "field",
      name: "Open Field",
      category: "open",
      height: 0,
      elevationDelta: null,
      moveCost: 1,
      passable: true,
      blocksSight: false,
      water: false,
      occupant: null,
    });
  });

  it("reports a rough, sight-blocking wood and its climb from a reference", () => {
    const info = tileInfoFor(board(), coord(1, 0), coord(0, 0));
    expect(info).toMatchObject({
      terrain: "wood",
      name: "Wood",
      category: "rough",
      height: 2,
      elevationDelta: 2,
      moveCost: 2,
      passable: true,
      blocksSight: true,
      water: false,
    });
  });

  it("reports impassable water with its authored cost", () => {
    const info = tileInfoFor(board(), coord(2, 0));
    expect(info).toMatchObject({
      terrain: "river",
      name: "River",
      category: "water",
      moveCost: 99,
      passable: false,
      blocksSight: false,
      water: true,
    });
  });

  it("signs the elevation delta when descending from a raised reference", () => {
    const info = tileInfoFor(board(), coord(0, 0), coord(3, 0));
    expect(info?.height).toBe(0);
    expect(info?.elevationDelta).toBe(-3);
  });

  it("drops the delta when the reference is off the map", () => {
    const info = tileInfoFor(board(), coord(0, 0), coord(-1, 0));
    expect(info?.elevationDelta).toBeNull();
  });

  it("returns null for an off-grid tile instead of throwing", () => {
    expect(tileInfoFor(board(), coord(-1, 0))).toBeNull();
    expect(tileInfoFor(board(), coord(4, 0))).toBeNull();
    expect(tileInfoFor(board(), coord(0, 3))).toBeNull();
  });

  it("finds the soldier standing on the tile", () => {
    const aubry = soldier("aubry", 0, 0);
    const info = tileInfoFor(board(), coord(0, 0), null, [aubry]);
    expect(info?.occupant?.id).toBe("aubry");
    expect(info?.occupant?.name).toBe("Soldier aubry");

    const empty = tileInfoFor(board(), coord(3, 0), null, [aubry]);
    expect(empty?.occupant).toBeNull();
  });

  it("does not mutate the map or the unit list", () => {
    const map = board();
    const units = [soldier("aubry", 0, 0)];
    const beforeMap = JSON.stringify(map);
    const beforeUnits = JSON.stringify(units);

    tileInfoFor(map, coord(1, 0), coord(0, 0), units);

    expect(JSON.stringify(map)).toBe(beforeMap);
    expect(JSON.stringify(units)).toBe(beforeUnits);
  });

  it("is deterministic for identical inputs", () => {
    const map = board();
    const units = [soldier("aubry", 0, 0)];
    expect(tileInfoFor(map, coord(1, 0), coord(0, 0), units)).toEqual(
      tileInfoFor(map, coord(1, 0), coord(0, 0), units),
    );
  });
});
