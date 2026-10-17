import { describe, expect, it } from "vitest";

import type { StatBlock } from "../../src/data/schema";
import { isBattleEvent } from "../../src/engine/events";
import { coord, type Coord, type Facing } from "../../src/engine/grid";
import { asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import {
  FALL_DAMAGE_PER_LEVEL,
  MAX_SHOVE_CHAIN,
  isShoveMode,
  resolveShove,
  SHOVE_MODES,
  type ShoveContext,
  type ShoveRequest,
} from "../../src/engine/rules/shove";
import { createTerrainMap, withTile, type TerrainMap } from "../../src/engine/terrain";
import { createUnit, type Unit, type UnitInit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T044 — Shove (knockback)
 *
 * The task's "done when" is **push/pull with collision and elevation
 * handling**. These tests pin that geometry — stopping at walls, the map edge
 * and occupied tiles; chaining a line of troops; Climb-gated steps and falls —
 * plus the guarantees the rest of the engine leans on: purity, determinism and
 * event well-formedness (`agents.md` §2, §7, §9).
 *
 * FFTA documents no knockback formula, so the collision/elevation model and
 * fall damage are authored (see the module header and mapping §12).
 * ------------------------------------------------------------------------ */

const TARGET = asUnitId("unit-target");
const BLOCKER = asUnitId("unit-blocker");
const THIRD = asUnitId("unit-third");

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

function makeContext(
  units: readonly Unit[],
  map: TerrainMap = createTerrainMap(8, 8, "field"),
  tick = 0,
): ShoveContext {
  return { map, units, tick };
}

function request(overrides: Partial<ShoveRequest> = {}): ShoveRequest {
  return { unitId: TARGET, direction: "east", distance: 1, ...overrides };
}

/** The tile a soldier ends on, or `undefined` when it is not on the field. */
function positionOf(context: ShoveContext, id: UnitId): Coord | undefined {
  return context.units.find((unit) => unit.id === id)?.at;
}

function unitById(units: readonly Unit[], id: UnitId): Unit | undefined {
  return units.find((unit) => unit.id === id);
}

/* --------------------------------------------------------------------------
 * Push
 * ------------------------------------------------------------------------ */

describe("resolveShove — push", () => {
  it("pushes a soldier one tile in the given direction", () => {
    const context = makeContext([makeUnit(TARGET, coord(2, 2))]);
    const result = resolveShove(context, request());

    expect(positionOf({ ...context, units: result.units }, TARGET)).toEqual(coord(3, 2));
    expect(result.moved).toEqual([
      { unitId: TARGET, from: coord(2, 2), to: coord(3, 2), tiles: 1, fallen: 0 },
    ]);
    expect(result.events).toEqual([
      { kind: "shoved", tick: 0, unitId: TARGET, from: coord(2, 2), to: coord(3, 2) },
    ]);
  });

  it("pushes across several tiles", () => {
    const context = makeContext([makeUnit(TARGET, coord(1, 1))]);
    const result = resolveShove(context, request({ distance: 3 }));

    expect(unitById(result.units, TARGET)?.at).toEqual(coord(4, 1));
    expect(result.moved[0]?.tiles).toBe(3);
    // One `shoved` event per tile, in travel order.
    expect(result.events.map((event) => (event.kind === "shoved" ? event.to : null))).toEqual([
      coord(2, 1),
      coord(3, 1),
      coord(4, 1),
    ]);
  });

  it("treats a zero distance as a no-op", () => {
    const context = makeContext([makeUnit(TARGET, coord(2, 2))]);
    const result = resolveShove(context, request({ distance: 0 }));

    expect(unitById(result.units, TARGET)?.at).toEqual(coord(2, 2));
    expect(result.moved).toEqual([]);
    expect(result.events).toEqual([]);
  });

  it("stops at the map edge", () => {
    const context = makeContext([makeUnit(TARGET, coord(6, 2))]);
    const result = resolveShove(context, request({ distance: 5 }));

    // 8-wide grid: the last legal tile east is x = 7.
    expect(unitById(result.units, TARGET)?.at).toEqual(coord(7, 2));
    expect(result.moved[0]?.tiles).toBe(1);
  });

  it("stops at impassable terrain", () => {
    const map = withTile(createTerrainMap(8, 8, "field"), coord(4, 2), "wall");
    const context = makeContext([makeUnit(TARGET, coord(2, 2))], map);
    const result = resolveShove(context, request({ distance: 3 }));

    expect(unitById(result.units, TARGET)?.at).toEqual(coord(3, 2));
    expect(result.moved[0]?.tiles).toBe(1);
  });

  it("does not move at all into an immediately impassable tile", () => {
    const map = withTile(createTerrainMap(8, 8, "field"), coord(3, 2), "river");
    const context = makeContext([makeUnit(TARGET, coord(2, 2))], map);
    const result = resolveShove(context, request());

    expect(unitById(result.units, TARGET)?.at).toEqual(coord(2, 2));
    expect(result.moved).toEqual([]);
    expect(result.events).toEqual([]);
  });
});

/* --------------------------------------------------------------------------
 * Collision
 * ------------------------------------------------------------------------ */

describe("resolveShove — collision", () => {
  it("stops at another soldier when chaining is off", () => {
    const context = makeContext([makeUnit(TARGET, coord(2, 2)), makeUnit(BLOCKER, coord(3, 2))]);
    const result = resolveShove(context, request({ distance: 2 }));

    expect(unitById(result.units, TARGET)?.at).toEqual(coord(2, 2));
    expect(unitById(result.units, BLOCKER)?.at).toEqual(coord(3, 2));
    expect(result.moved).toEqual([]);
  });

  it("shoves the blocker too when chaining is on", () => {
    const context = makeContext([makeUnit(TARGET, coord(2, 2)), makeUnit(BLOCKER, coord(3, 2))]);
    const result = resolveShove(context, request({ chain: true }));

    expect(unitById(result.units, TARGET)?.at).toEqual(coord(3, 2));
    expect(unitById(result.units, BLOCKER)?.at).toEqual(coord(4, 2));
    // The far end of the chain moves first, so the tile is vacated in time.
    expect(result.events).toEqual([
      { kind: "shoved", tick: 0, unitId: BLOCKER, from: coord(3, 2), to: coord(4, 2) },
      { kind: "shoved", tick: 0, unitId: TARGET, from: coord(2, 2), to: coord(3, 2) },
    ]);
  });

  it("drives a whole line of three troops back", () => {
    const context = makeContext([
      makeUnit(TARGET, coord(1, 2)),
      makeUnit(BLOCKER, coord(2, 2)),
      makeUnit(THIRD, coord(3, 2)),
    ]);
    const result = resolveShove(context, request({ chain: true, distance: 2 }));

    expect(unitById(result.units, TARGET)?.at).toEqual(coord(3, 2));
    expect(unitById(result.units, BLOCKER)?.at).toEqual(coord(4, 2));
    expect(unitById(result.units, THIRD)?.at).toEqual(coord(5, 2));
    expect(result.moved.map((step) => step.unitId)).toEqual([THIRD, BLOCKER, TARGET]);
  });

  it("stops the line when the chain runs into a wall", () => {
    const map = withTile(createTerrainMap(8, 8, "field"), coord(4, 2), "wall");
    const context = makeContext(
      [makeUnit(TARGET, coord(1, 2)), makeUnit(BLOCKER, coord(2, 2))],
      map,
    );
    const result = resolveShove(context, request({ chain: true, distance: 3 }));

    // The blocker can reach (3,2) but not the wall at (4,2); the target follows
    // only as far as (2,2), never overlapping the blocker.
    expect(unitById(result.units, TARGET)?.at).toEqual(coord(2, 2));
    expect(unitById(result.units, BLOCKER)?.at).toEqual(coord(3, 2));
    expect(result.moved.find((step) => step.unitId === TARGET)?.tiles).toBe(1);
  });

  it("treats a chained line at the chain ceiling as blocked", () => {
    // Build a line one longer than the guard so the head cannot advance. The
    // map must be wide enough to hold every soldier on the line.
    const ids = Array.from({ length: MAX_SHOVE_CHAIN + 2 }, (_, index) =>
      asUnitId(`unit-line-${index}`),
    );
    const units = ids.map((id, index) => makeUnit(id, coord(index, 4)));
    const context = makeContext(units, createTerrainMap(MAX_SHOVE_CHAIN + 4, 8, "field"));

    const result = resolveShove(context, request({ unitId: ids[0], chain: true, distance: 1 }));

    // The recursion refuses at the ceiling, so nobody moves.
    expect(result.moved).toEqual([]);
    expect(result.units.map((unit) => unit.at)).toEqual(units.map((unit) => unit.at));
  });
});

/* --------------------------------------------------------------------------
 * Pull
 * ------------------------------------------------------------------------ */

describe("resolveShove — pull", () => {
  it("drags the target back towards the shover", () => {
    // The shover stands west of the target at (2,2); direction is the shover →
    // target vector (east), so a pull moves the target west.
    const context = makeContext([makeUnit(TARGET, coord(5, 2))]);
    const result = resolveShove(context, request({ direction: "east", mode: "pull", distance: 2 }));

    expect(unitById(result.units, TARGET)?.at).toEqual(coord(3, 2));
    expect(result.moved).toEqual([
      { unitId: TARGET, from: coord(5, 2), to: coord(3, 2), tiles: 2, fallen: 0 },
    ]);
  });

  it("moves opposite the push for every cardinal", () => {
    const cases: ReadonlyArray<[Facing, Coord, Coord]> = [
      // direction, push destination, pull destination (from (2,4))
      ["north", coord(2, 3), coord(2, 5)],
      ["east", coord(3, 4), coord(1, 4)],
      ["south", coord(2, 5), coord(2, 3)],
      ["west", coord(1, 4), coord(3, 4)],
    ];
    for (const [direction, pushedTo, pulledTo] of cases) {
      const origin = [makeUnit(TARGET, coord(2, 4))];
      const pushed = resolveShove(makeContext(origin), request({ direction, distance: 1 }));
      expect(unitById(pushed.units, TARGET)?.at).toEqual(pushedTo);

      const pulled = resolveShove(
        makeContext([makeUnit(TARGET, coord(2, 4))]),
        request({ direction, distance: 1, mode: "pull" }),
      );
      expect(unitById(pulled.units, TARGET)?.at).toEqual(pulledTo);
    }
  });
});

/* --------------------------------------------------------------------------
 * Elevation
 * ------------------------------------------------------------------------ */

describe("resolveShove — elevation", () => {
  it("refuses to shove a soldier up too steep a slope", () => {
    let map = createTerrainMap(8, 8, "field");
    map = withTile(map, coord(3, 2), { terrain: "hill", height: 3 });
    const context = makeContext([makeUnit(TARGET, coord(2, 2))], map);

    const result = resolveShove(context, request());
    expect(unitById(result.units, TARGET)?.at).toEqual(coord(2, 2));
    expect(result.moved).toEqual([]);
  });

  it("allows an uphill step within Climb", () => {
    let map = createTerrainMap(8, 8, "field");
    map = withTile(map, coord(3, 2), { terrain: "hill", height: 2 });
    const context = makeContext([makeUnit(TARGET, coord(2, 2))], map);

    const result = resolveShove(context, request());
    expect(unitById(result.units, TARGET)?.at).toEqual(coord(3, 2));
    expect(result.moved[0]?.fallen).toBe(0);
  });

  it("allows a downhill step within Climb without harm", () => {
    let map = createTerrainMap(8, 8, "field");
    map = withTile(map, coord(2, 2), { terrain: "hill", height: 3 });
    map = withTile(map, coord(3, 2), { terrain: "hill", height: 1 });
    const context = makeContext([makeUnit(TARGET, coord(2, 2))], map);

    const result = resolveShove(context, request());
    expect(unitById(result.units, TARGET)?.at).toEqual(coord(3, 2));
    expect(result.moved[0]?.fallen).toBe(0);
    expect(result.events.every((event) => event.kind === "shoved")).toBe(true);
  });

  it("stops at a drop steeper than Climb when falls are not allowed", () => {
    let map = createTerrainMap(8, 8, "field");
    map = withTile(map, coord(2, 2), { terrain: "hill", height: 5 });

    const withoutFall = resolveShove(
      makeContext([makeUnit(TARGET, coord(2, 2))], map),
      request({ allowFall: false }),
    );
    expect(withoutFall.moved).toEqual([]);
    expect(unitById(withoutFall.units, TARGET)?.at).toEqual(coord(2, 2));

    // The same shove with falls enabled crosses the ledge and takes damage.
    const withFall = resolveShove(
      makeContext([makeUnit(TARGET, coord(2, 2))], map),
      request({ allowFall: true }),
    );
    expect(withFall.moved).toHaveLength(1);
    expect(unitById(withFall.units, TARGET)?.hp).toBeLessThan(60);
  });

  it("turns a steep drop into a fall and deals damage", () => {
    let map = createTerrainMap(8, 8, "field");
    map = withTile(map, coord(2, 2), { terrain: "hill", height: 4 });
    const context = makeContext([makeUnit(TARGET, coord(2, 2))], map);

    const result = resolveShove(context, request({ allowFall: true }));

    // Drop of 4, Climb 2 → fall of 2 levels → 2 × FALL_DAMAGE_PER_LEVEL.
    expect(unitById(result.units, TARGET)?.at).toEqual(coord(3, 2));
    expect(result.moved[0]?.fallen).toBe(2);
    expect(unitById(result.units, TARGET)?.hp).toBe(60 - 2 * FALL_DAMAGE_PER_LEVEL);
    expect(result.events).toEqual([
      { kind: "shoved", tick: 0, unitId: TARGET, from: coord(2, 2), to: coord(3, 2) },
      {
        kind: "damaged",
        tick: 0,
        unitId: TARGET,
        amount: 2 * FALL_DAMAGE_PER_LEVEL,
        hpAfter: 60 - 2 * FALL_DAMAGE_PER_LEVEL,
        damageType: "none",
        critical: false,
        fatal: false,
      },
    ]);
  });

  it("accumulates fall damage across several falling steps", () => {
    let map = createTerrainMap(8, 8, "field");
    map = withTile(map, coord(1, 2), { terrain: "hill", height: 8 });
    map = withTile(map, coord(2, 2), { terrain: "hill", height: 5 });
    map = withTile(map, coord(3, 2), { terrain: "hill", height: 2 });
    const context = makeContext([makeUnit(TARGET, coord(1, 2))], map);

    const result = resolveShove(context, request({ distance: 2, allowFall: true }));

    // Two 3-level drops; Climb 2 → one fallen level each (5 damage each).
    expect(unitById(result.units, TARGET)?.at).toEqual(coord(3, 2));
    expect(result.moved[0]?.fallen).toBe(2);
    expect(unitById(result.units, TARGET)?.hp).toBe(60 - 2 * FALL_DAMAGE_PER_LEVEL);
  });

  it("emits outOfAction when a fall is fatal", () => {
    let map = createTerrainMap(8, 8, "field");
    map = withTile(map, coord(2, 2), { terrain: "hill", height: 6 });
    const context = makeContext([makeUnit(TARGET, coord(2, 2), { hp: 3 })], map);

    const result = resolveShove(context, request({ allowFall: true }));

    expect(unitById(result.units, TARGET)?.hp).toBe(0);
    expect(result.events).toContainEqual({
      kind: "damaged",
      tick: 0,
      unitId: TARGET,
      amount: 3,
      hpAfter: 0,
      damageType: "none",
      critical: false,
      fatal: true,
    });
    expect(result.events).toContainEqual({ kind: "outOfAction", tick: 0, unitId: TARGET });
  });

  it("does not pile fall damage onto an already downed soldier", () => {
    let map = createTerrainMap(8, 8, "field");
    map = withTile(map, coord(2, 2), { terrain: "hill", height: 4 });
    const context = makeContext([makeUnit(TARGET, coord(2, 2), { hp: 0 })], map);

    const result = resolveShove(context, request({ allowFall: true }));

    // It is still displaced, but only the `shoved` event is emitted.
    expect(unitById(result.units, TARGET)?.at).toEqual(coord(3, 2));
    expect(result.events).toEqual([
      { kind: "shoved", tick: 0, unitId: TARGET, from: coord(2, 2), to: coord(3, 2) },
    ]);
  });

  it("applies fall damage to every soldier in a chain", () => {
    // A height-6 plateau ending in a cliff at (4,2); two troops are driven off
    // its edge and both take fall damage.
    let map = createTerrainMap(8, 8, "field");
    map = withTile(map, coord(1, 2), { terrain: "hill", height: 6 });
    map = withTile(map, coord(2, 2), { terrain: "hill", height: 6 });
    map = withTile(map, coord(3, 2), { terrain: "hill", height: 6 });
    const context = makeContext(
      [makeUnit(TARGET, coord(1, 2)), makeUnit(BLOCKER, coord(2, 2))],
      map,
    );

    const result = resolveShove(context, request({ chain: true, distance: 3, allowFall: true }));

    expect(unitById(result.units, BLOCKER)?.hp).toBeLessThan(60);
    expect(unitById(result.units, TARGET)?.hp).toBeLessThan(60);
    expect(result.events.filter((event) => event.kind === "damaged")).toHaveLength(2);
  });
});

/* --------------------------------------------------------------------------
 * Determinism, purity and event shape
 * ------------------------------------------------------------------------ */

describe("resolveShove — contracts", () => {
  const map = createTerrainMap(8, 8, "field");
  const units = [makeUnit(TARGET, coord(2, 2)), makeUnit(BLOCKER, coord(3, 2))];
  const context = makeContext(units, map, 12);

  it("is deterministic for the same context and request", () => {
    const first = resolveShove(context, request({ chain: true }));
    const second = resolveShove(context, request({ chain: true }));
    expect(second.units).toEqual(first.units);
    expect(second.events).toEqual(first.events);
    expect(second.moved).toEqual(first.moved);
  });

  it("does not mutate the input units or carry state between calls", () => {
    const snapshot = JSON.parse(JSON.stringify(units));
    const first = resolveShove(context, request({ chain: true }));
    const second = resolveShove(context, request({ chain: true }));

    expect(units).toEqual(snapshot);
    expect(second.events).toEqual(first.events);
    expect(second.moved).toEqual(first.moved);
  });

  it("stamps every event with the context tick and a valid shape", () => {
    const result = resolveShove(context, request({ chain: true }));
    expect(result.events.length).toBeGreaterThan(0);
    for (const event of result.events) {
      expect(event.tick).toBe(12);
      expect(isBattleEvent(event)).toBe(true);
    }
  });

  it("returns a fresh roster rather than the input array", () => {
    const result = resolveShove(context, request({ chain: true }));
    expect(result.units).not.toBe(units);
  });
});

/* --------------------------------------------------------------------------
 * Validation and guards
 * ------------------------------------------------------------------------ */

describe("resolveShove — validation", () => {
  it("throws for a soldier who is not on the field", () => {
    const context = makeContext([makeUnit(TARGET, coord(2, 2))]);
    expect(() => resolveShove(context, request({ unitId: asUnitId("ghost") }))).toThrow(RangeError);
  });

  it("rejects an unknown direction, mode or distance", () => {
    const context = makeContext([makeUnit(TARGET, coord(2, 2))]);
    expect(() => resolveShove(context, request({ direction: "up" as Facing }))).toThrow(RangeError);
    expect(() => resolveShove(context, request({ mode: "sideways" as never }))).toThrow(RangeError);
    expect(() => resolveShove(context, request({ distance: -1 }))).toThrow(RangeError);
    expect(() => resolveShove(context, request({ distance: 1.5 }))).toThrow(RangeError);
  });

  it("rejects a malformed tick", () => {
    const context = makeContext(
      [makeUnit(TARGET, coord(2, 2))],
      createTerrainMap(8, 8, "field"),
      -1,
    );
    expect(() => resolveShove(context, request())).toThrow(RangeError);
  });

  it("exposes the closed mode set and its guard", () => {
    expect(SHOVE_MODES).toEqual(["push", "pull"]);
    expect(isShoveMode("push")).toBe(true);
    expect(isShoveMode("pull")).toBe(true);
    expect(isShoveMode("toss")).toBe(false);
    expect(isShoveMode(3)).toBe(false);
  });
});
