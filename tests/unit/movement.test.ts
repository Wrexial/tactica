import { describe, expect, it } from "vitest";

import type { StatBlock } from "../../src/data/schema";
import { validateMove } from "../../src/engine/actions/move";
import { createBattle, findUnit, type BattleState } from "../../src/engine/battle";
import { coord, type Coord } from "../../src/engine/grid";
import { asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import { findPath, reachableWithin } from "../../src/engine/pathfinding";
import { createTerrainMap, withTile, type TerrainMap } from "../../src/engine/terrain";
import {
  aoeTiles,
  canTarget,
  hasLineOfSight,
  lineOfSight,
  resolveTargeting,
  tilesInRange,
  type AbilityTargeting,
  type PositionedTarget,
  type RangeProfile,
} from "../../src/engine/targeting";
import { createUnit, type Unit, type UnitInit, type UnitSide } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T032 — Movement & targeting tests (edge cases)
 *
 * T025 (move) and T028 (targeting) each ship their own happy-path suite. This
 * file deliberately hunts for the *corners* the task names:
 *
 * 1. **Blocked paths** — a goal held by an ally, chokepoints and single gaps,
 *    long legal detours vs. over-budget ones, bridges over impassable water,
 *    and loops back onto the mover's own tile.
 * 2. **AoE shapes** — every shape collapsing at size 0, dedup/order guarantees,
 *    map-edge clipping, the `line` orientation tie-break, and how areas split
 *    `affected` (friendly fire included) from `matched` (the target rule).
 * 3. **Elevation in LoS** — the exact boundary where a ridge *equals* the sight
 *    line (clear) versus one layer higher (blocked), diagonal sight lines,
 *    first-blocker precedence, and the high-ground range bonus feeding LoS.
 *
 * The geometry here is FFTA's, rethemed (mapping §12): cardinal movement with
 * terrain cost and Climb; range/LoS with smoke and high ground. Everything is
 * pure and deterministic, so every assertion is on exact values (`agents.md`
 * §2, §7).
 * ------------------------------------------------------------------------ */

const SOLDIER = asUnitId("unit-soldier");
const ALLY = asUnitId("unit-ally");
const FOE = asUnitId("unit-foe");
const PROVOST = asUnitId("unit-provost");

const BASE_STATS: StatBlock = {
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

function makeUnit(id: UnitId, at: Coord, overrides: Partial<UnitInit> = {}): Unit {
  return createUnit({
    id,
    name: `Soldier ${id}`,
    power: "france",
    postId: asPostId("fusilier"),
    level: 1,
    at,
    stats: { ...BASE_STATS },
    ...overrides,
  });
}

const DEFAULT_MAP = createTerrainMap(4, 1, "field");

function makeState(units: readonly Unit[], map: TerrainMap = DEFAULT_MAP): BattleState {
  return createBattle(1815, { map, units });
}

/** A map that starts open and replaces named tiles with an elevation. */
function mapWithHeights(width: number, height: number, tiles: Record<string, number>): TerrainMap {
  let map = createTerrainMap(width, height, "field");
  for (const [key, elevation] of Object.entries(tiles)) {
    const [x, y] = key.split(",").map(Number);
    map = withTile(map, coord(x, y), { terrain: "field", height: elevation });
  }
  return map;
}

/** Run `validateMove` for the named soldier in `state`. */
function validate(state: BattleState, path: readonly Coord[], unitId: UnitId = SOLDIER) {
  const unit = findUnit(state, unitId);
  if (unit === undefined) throw new Error(`no soldier ${unitId}`);
  return validateMove(state, unit, path);
}

/** Build a positioned combatant for the targeting predicates. */
function positioned(id: UnitId, side: UnitSide, at: Coord): PositionedTarget {
  return { id, side, at };
}

/* --------------------------------------------------------------------------
 * 1. Blocked paths — move validation
 * ------------------------------------------------------------------------ */

describe("T032 — blocked paths: validateMove", () => {
  it("rejects a march whose destination tile is held by another soldier", () => {
    const map = createTerrainMap(4, 1, "field");
    const state = makeState([makeUnit(SOLDIER, coord(0, 0)), makeUnit(ALLY, coord(2, 0))], map);

    const result = validate(state, [coord(0, 0), coord(1, 0), coord(2, 0)]);

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejection.reason).toBe("occupied");
    expect(result.rejection.at).toEqual(coord(2, 0));
  });

  it("rejects an impassable river but allows the bridge that spans it", () => {
    const river = withTile(createTerrainMap(3, 1, "field"), coord(1, 0), "river");
    const forded = withTile(createTerrainMap(3, 1, "field"), coord(1, 0), "bridge");
    const path = [coord(0, 0), coord(1, 0), coord(2, 0)];

    const blocked = validate(makeState([makeUnit(SOLDIER, coord(0, 0))], river), path);
    expect(blocked.valid).toBe(false);
    if (!blocked.valid) expect(blocked.rejection.reason).toBe("impassable");

    const crossed = validate(makeState([makeUnit(SOLDIER, coord(0, 0))], forded), path);
    expect(crossed.valid).toBe(true);
    if (crossed.valid) expect(crossed.cost).toBe(2);
  });

  it("routes a legal detour around a unit blocking the direct line", () => {
    const map = createTerrainMap(3, 3, "field");
    const state = makeState([makeUnit(SOLDIER, coord(1, 0)), makeUnit(ALLY, coord(1, 1))], map);

    // Straight down the column is refused...
    const straight = validate(state, [coord(1, 0), coord(1, 1), coord(1, 2)]);
    expect(straight.valid).toBe(false);

    // ...but a four-step detour around the blocker is within Move 4.
    const detour = validate(state, [
      coord(1, 0),
      coord(0, 0),
      coord(0, 1),
      coord(0, 2),
      coord(1, 2),
    ]);
    expect(detour.valid).toBe(true);
    if (!detour.valid) return;
    expect(detour.to).toEqual(coord(1, 2));
    expect(detour.cost).toBe(4);
  });

  it("rejects the same detour when it exceeds the Move budget", () => {
    const map = createTerrainMap(3, 3, "field");
    const state = makeState(
      [
        makeUnit(SOLDIER, coord(1, 0), { stats: { ...BASE_STATS, move: 3 } }),
        makeUnit(ALLY, coord(1, 1)),
      ],
      map,
    );

    const result = validate(state, [
      coord(1, 0),
      coord(0, 0),
      coord(0, 1),
      coord(0, 2),
      coord(1, 2),
    ]);

    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejection.reason).toBe("exceeds-move");
  });

  it("allows a march that loops back onto the mover's own tile", () => {
    // The mover is never its own obstacle, so stepping out and back is legal.
    const state = makeState([makeUnit(SOLDIER, coord(0, 0))]);
    const result = validate(state, [coord(0, 0), coord(1, 0), coord(0, 0)]);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.to).toEqual(coord(0, 0));
    expect(result.cost).toBe(2);
    expect(result.facing).toBe("west");
  });
});

/* --------------------------------------------------------------------------
 * 1. Blocked paths — pathfinding & reachable range
 * ------------------------------------------------------------------------ */

describe("T032 — blocked paths: pathfinding & reachable range", () => {
  /** A 5×3 field with a vertical wall at x=2 and a single gap at (2, 1). */
  function walledField(withGap: boolean): TerrainMap {
    let map = createTerrainMap(5, 3, "field");
    for (const y of [0, 1, 2]) {
      const isGap = withGap && y === 1;
      map = withTile(map, coord(2, y), isGap ? "field" : "wall");
    }
    return map;
  }

  it("threads the least-cost path through the single gap in a wall", () => {
    const map = walledField(true);
    const result = findPath(map, coord(0, 1), coord(4, 1), { climb: 0 });

    expect(result.found).toBe(true);
    expect(result.cost).toBe(4);
    expect(result.path).toContainEqual(coord(2, 1));
    // No tile west of the gap on the other rows is used to sneak across.
    for (const at of result.path) expect(at.x).toBeLessThanOrEqual(4);
  });

  it("reports no path when the wall has no gap", () => {
    const map = walledField(false);
    const result = findPath(map, coord(0, 1), coord(4, 1), { climb: 0 });

    expect(result.found).toBe(false);
    expect(result.path).toEqual([]);
    expect(result.cost).toBe(Number.POSITIVE_INFINITY);
  });

  it("reachableWithin stops at the wall and passes through the gap", () => {
    const map = walledField(true);
    const withinThree = reachableWithin(map, coord(0, 1), 3, { climb: 0 });

    // Through the gap: (3, 1) costs 3...
    expect(withinThree).toContainEqual({ at: coord(3, 1), cost: 3 });
    // ...but the far side at cost 4 is still one budget short.
    expect(withinThree.map((tile) => tile.at)).not.toContainEqual(coord(4, 1));
    // The wall tiles themselves never appear.
    expect(withinThree.map((tile) => tile.at)).not.toContainEqual(coord(2, 0));
    expect(withinThree.map((tile) => tile.at)).not.toContainEqual(coord(2, 2));
  });

  it("agrees with the A* cost for a route that must detour", () => {
    const map = walledField(true);
    const path = findPath(map, coord(0, 0), coord(4, 2), { climb: 0 });
    expect(path.found).toBe(true);

    const state = makeState(
      [makeUnit(SOLDIER, coord(0, 0), { stats: { ...BASE_STATS, move: 20 } })],
      map,
    );
    const marched = validate(state, path.path);

    expect(marched.valid).toBe(true);
    if (!marched.valid) return;
    expect(marched.cost).toBe(path.cost);
  });
});

/* --------------------------------------------------------------------------
 * 2. AoE shapes — enumeration edges
 * ------------------------------------------------------------------------ */

describe("T032 — aoeTiles shapes", () => {
  const OPEN = createTerrainMap(7, 7, "field");

  it("collapses every shape to the centre tile at size 0", () => {
    for (const shape of ["single", "cross", "square", "line", "field"] as const) {
      const tiles = aoeTiles(OPEN, coord(3, 3), shape, 0);
      if (shape === "field") {
        expect(tiles).toHaveLength(49);
      } else {
        expect(tiles).toEqual([coord(3, 3)]);
      }
    }
  });

  it("builds a plus with no duplicates (the centre is shared by both arms)", () => {
    const tiles = aoeTiles(OPEN, coord(3, 3), "cross", 2);
    expect(tiles).toHaveLength(1 + 4 * 2);
    expect(new Set(tiles.map((at) => `${at.x},${at.y}`)).size).toBe(tiles.length);
    expect(tiles.filter((at) => at.x === 3 && at.y === 3)).toHaveLength(1);
  });

  it("clips a square at a map corner instead of wrapping", () => {
    const tiles = aoeTiles(OPEN, coord(0, 0), "square", 1);
    expect(tiles).toEqual([coord(0, 0), coord(1, 0), coord(0, 1), coord(1, 1)]);
  });

  it("clips a horizontal line at a map edge", () => {
    const tiles = aoeTiles(OPEN, coord(0, 3), "line", 2);
    expect(tiles).toEqual([coord(0, 3), coord(1, 3), coord(2, 3)]);
  });

  it("breaks an exact-diagonal line tie toward the horizontal axis", () => {
    // origin (0, 0) → centre (2, 2) has |dx| === |dy|; the fallback is +x.
    expect(aoeTiles(OPEN, coord(2, 2), "line", 1, coord(0, 0))).toEqual([
      coord(1, 2),
      coord(2, 2),
      coord(3, 2),
    ]);
  });

  it("runs a line along the vertical axis when y dominates", () => {
    // origin below the centre points the line north (negative y).
    expect(aoeTiles(OPEN, coord(3, 3), "line", 1, coord(3, 5))).toEqual([
      coord(3, 2),
      coord(3, 3),
      coord(3, 4),
    ]);
  });

  it("points a line west when the origin lies east of the centre", () => {
    expect(aoeTiles(OPEN, coord(3, 3), "line", 1, coord(5, 3))).toEqual([
      coord(2, 3),
      coord(3, 3),
      coord(4, 3),
    ]);
  });

  it("returns deterministic, (y, x)-sorted tiles", () => {
    const first = aoeTiles(OPEN, coord(3, 3), "square", 1);
    expect(aoeTiles(OPEN, coord(3, 3), "square", 1)).toEqual(first);
    const sorted = [...first].sort((a, b) => a.y - b.y || a.x - b.x);
    expect(first).toEqual(sorted);
  });

  it("rejects an off-grid centre", () => {
    expect(() => aoeTiles(OPEN, coord(7, 0), "single", 0)).toThrow(RangeError);
    expect(() => aoeTiles(OPEN, coord(0, -1), "single", 0)).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * 2. AoE shapes — resolveTargeting integration
 * ------------------------------------------------------------------------ */

describe("T032 — resolveTargeting areas", () => {
  const hero = positioned(SOLDIER, "company", coord(0, 0));
  const ally = positioned(ALLY, "company", coord(2, 0));
  const foe = positioned(FOE, "enemy", coord(4, 0));

  const lineBlast: AbilityTargeting = {
    target: "enemy",
    range: { min: 1, max: 6 },
    aoeShape: "line",
    aoeSize: 2,
  };

  it("splits affected (friendly fire) from matched on a line area", () => {
    const map = createTerrainMap(7, 1, "field");
    const squad = [hero, ally, foe];

    const result = resolveTargeting(map, hero, squad, { kind: "unit", unitId: FOE }, lineBlast);

    expect(result.ok).toBe(true);
    // A size-2 line centred on the foe reaches x = 2..6 along +x from the hero.
    expect(result.tiles).toEqual([coord(2, 0), coord(3, 0), coord(4, 0), coord(5, 0), coord(6, 0)]);
    // The friendly at (2, 0) is caught in the blast even though it is not a
    // legal target; `affected` is everyone, `matched` only the enemies.
    expect(result.affected.map((unit) => unit.id)).toEqual([ally.id, foe.id]);
    expect(result.matched.map((unit) => unit.id)).toEqual([foe.id]);
  });

  it("clips an area at the map edge and reports the reduced footprint", () => {
    const map = createTerrainMap(3, 1, "field");
    const nearEdge = positioned(FOE, "enemy", coord(2, 0));

    const result = resolveTargeting(
      map,
      hero,
      [hero, nearEdge],
      { kind: "unit", unitId: nearEdge.id },
      lineBlast,
    );

    expect(result.ok).toBe(true);
    expect(result.tiles).toEqual([coord(0, 0), coord(1, 0), coord(2, 0)]);
    expect(result.affected.map((unit) => unit.id)).toEqual([hero.id, nearEdge.id]);
    expect(result.matched.map((unit) => unit.id)).toEqual([nearEdge.id]);
  });

  it("tags every occupant with a field effect while only matching hostiles", () => {
    const map = createTerrainMap(2, 2, "field");
    const a = positioned(SOLDIER, "company", coord(0, 0));
    const b = positioned(ALLY, "company", coord(1, 0));
    const c = positioned(FOE, "enemy", coord(0, 1));
    const prov = positioned(PROVOST, "neutral", coord(1, 1));
    const field: AbilityTargeting = {
      target: "any",
      range: { min: 1, max: 1 },
      aoeShape: "field",
      aoeSize: 0,
    };

    const result = resolveTargeting(map, a, [a, b, c, prov], { kind: "unit", unitId: c.id }, field);

    expect(result.ok).toBe(true);
    expect(result.tiles).toHaveLength(4);
    expect(result.affected.map((unit) => unit.id)).toEqual([a.id, b.id, c.id, prov.id]);
    // "any" is ally-or-enemy, never the neutral Provost Marshal (mapping §9).
    expect(result.matched.map((unit) => unit.id)).toEqual([a.id, b.id, c.id]);
  });

  it("defaults an omitted area to the single target tile", () => {
    const map = createTerrainMap(6, 1, "field");
    const single: AbilityTargeting = { target: "enemy", range: { min: 1, max: 6 } };

    const result = resolveTargeting(
      map,
      hero,
      [hero, ally, foe],
      { kind: "unit", unitId: FOE },
      single,
    );

    expect(result.tiles).toEqual([coord(4, 0)]);
    expect(result.affected.map((unit) => unit.id)).toEqual([foe.id]);
  });
});

/* --------------------------------------------------------------------------
 * 3. Elevation in line of sight
 * ------------------------------------------------------------------------ */

describe("T032 — lineOfSight elevation edges", () => {
  it("does not block when a ridge sits exactly on the sight line", () => {
    // Shooter eye 1 above the ground, target flat: the line at the midpoint is
    // at height 1, so a height-1 ridge merely touches it and is clear.
    const level = mapWithHeights(3, 1, { "1,0": 1 });
    expect(hasLineOfSight(level, coord(0, 0), coord(2, 0))).toBe(true);

    // One layer higher, and the ridge actually rises above the line.
    const taller = mapWithHeights(3, 1, { "1,0": 2 });
    const result = lineOfSight(taller, coord(0, 0), coord(2, 0));
    expect(result.clear).toBe(false);
    expect(result.blocker).toBe("elevation");
    expect(result.blockedBy).toEqual(coord(1, 0));
  });

  it("blocks a diagonal sight line over a raised centre", () => {
    const clear = mapWithHeights(3, 3, { "1,1": 1 });
    expect(hasLineOfSight(clear, coord(0, 0), coord(2, 2))).toBe(true);

    const blocked = mapWithHeights(3, 3, { "1,1": 2 });
    const result = lineOfSight(blocked, coord(0, 0), coord(2, 2));
    expect(result.clear).toBe(false);
    expect(result.blockedBy).toEqual(coord(1, 1));
    expect(result.blocker).toBe("elevation");
  });

  it("reports the first blocker, whether terrain or elevation", () => {
    let terrainFirst = createTerrainMap(5, 1, "field");
    terrainFirst = withTile(terrainFirst, coord(1, 0), "wood");
    terrainFirst = withTile(terrainFirst, coord(3, 0), { terrain: "field", height: 4 });
    expect(lineOfSight(terrainFirst, coord(0, 0), coord(4, 0))).toMatchObject({
      blocker: "terrain",
      blockedBy: coord(1, 0),
    });

    const elevationFirst = mapWithHeights(5, 1, { "1,0": 4 });
    const elevationBlocked = withTile(elevationFirst, coord(3, 0), "wood");
    expect(lineOfSight(elevationBlocked, coord(0, 0), coord(4, 0))).toMatchObject({
      blocker: "elevation",
      blockedBy: coord(1, 0),
    });
  });

  it("clears a descending sight line over a low ridge but not a tall one", () => {
    const lowRidge = mapWithHeights(5, 1, { "0,0": 4, "2,0": 2, "4,0": 0 });
    expect(hasLineOfSight(lowRidge, coord(0, 0), coord(4, 0))).toBe(true);

    const tallRidge = mapWithHeights(5, 1, { "0,0": 4, "2,0": 4, "4,0": 0 });
    expect(lineOfSight(tallRidge, coord(0, 0), coord(4, 0))).toMatchObject({
      clear: false,
      blocker: "elevation",
    });
  });

  it("does not let the target's own raised tile block the line", () => {
    // The target stands on a crag: it is an endpoint, never an intermediate.
    const map = mapWithHeights(5, 1, { "4,0": 6 });
    expect(hasLineOfSight(map, coord(0, 0), coord(4, 0))).toBe(true);
  });

  it("excludes every tile hidden behind a ridge from the range overlay", () => {
    const map = mapWithHeights(5, 1, { "2,0": 4 });
    const tiles = tilesInRange(map, coord(0, 0), { min: 0, max: 4 });

    // The ridge itself is a legal endpoint; everything beyond it is not.
    expect(tiles).toEqual([coord(0, 0), coord(1, 0), coord(2, 0)]);
  });

  it("reports blocked-elevation from canTarget", () => {
    const map = mapWithHeights(5, 1, { "2,0": 4 });
    const result = canTarget(map, coord(0, 0), coord(4, 0), { min: 1, max: 4 });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("blocked-elevation");
    expect(result.blockedBy).toEqual(coord(2, 0));
  });

  it("extends a ranged profile's reach from high ground when the line is clear", () => {
    const map = mapWithHeights(9, 1, { "0,0": 3 });
    const ranged: RangeProfile = { min: 1, max: 4, elevationBonus: true };

    const downhill = canTarget(map, coord(0, 0), coord(7, 0), ranged);
    expect(downhill.range).toBe(7); // 4 base + 3 layers of commanding ground
    expect(downhill.lineOfSight).toBe(true);
    expect(downhill.ok).toBe(true);

    const flat: RangeProfile = { min: 1, max: 4 };
    expect(canTarget(map, coord(0, 0), coord(7, 0), flat).ok).toBe(false);
  });
});
