import { describe, expect, it } from "vitest";

import { coord, type Coord } from "../../src/engine/grid";
import { isBattleEvent, type BattleEvent } from "../../src/engine/events";
import {
  applyFace,
  applyHold,
  applyWait,
  BRACE_DURATION_TICKS,
  BRACED_CONDITION,
} from "../../src/engine/actions/basic";
import {
  applyMove,
  MoveError,
  validateMove,
  type MoveValidation,
} from "../../src/engine/actions/move";
import { createBattle, findUnit, step, type BattleState } from "../../src/engine/battle";
import type { Command } from "../../src/engine/commands";
import { asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import { createTerrainMap, withTile, type TerrainMap } from "../../src/engine/terrain";
import { createUnit, getCondition, hasCondition, type Unit, type UnitInit } from "../../src/engine/unit";
import type { StatBlock } from "../../src/data/schema";

/* --------------------------------------------------------------------------
 * T025 — Move command
 *
 * These tests pin the task's "done when": **path validation**, movement
 * **cost**, **elevation/Climb** gating and the **movement events** a resolved
 * march emits. They also pin the guarantees the rest of the engine leans on —
 * purity, determinism, and rejection without mutation — because a battle is
 * replayed from a seed plus a command log (`agents.md` §2, §7).
 *
 * FFTA's movement model (mapping §12; `docs/wiki/pages/Move_(stat).md`) is the
 * contract: cardinal steps only, terrain cost to enter, a Climb premium for
 * uphill, impassable/occupied tiles block, and the march must fit Move.
 * ------------------------------------------------------------------------ */

const MARCHER = asUnitId("unit-marcher");
const BLOCKER = asUnitId("unit-blocker");

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

const MAP = createTerrainMap(6, 4, "field");

function makeState(units: readonly Unit[], map: TerrainMap = MAP): BattleState {
  return createBattle(1815, { map, units });
}

/** The default skirmish: the marcher at the NW corner, a slow ally far off. */
function defaultUnits(): Unit[] {
  return [
    makeUnit(MARCHER, coord(0, 0)),
    makeUnit(BLOCKER, coord(5, 3), { stats: { ...BASE_STATS, spd: 10 } }),
  ];
}

/** Run `validateMove` for the named soldier in `state`. */
function validate(state: BattleState, path: readonly Coord[], unitId = MARCHER): MoveValidation {
  const unit = findUnit(state, unitId);
  if (unit === undefined) throw new Error(`no soldier ${unitId}`);
  return validateMove(state, unit, path);
}

const STRAIGHT: readonly Coord[] = [coord(0, 0), coord(1, 0), coord(2, 0), coord(3, 0)];

/* --------------------------------------------------------------------------
 * validateMove — legal marches
 * ------------------------------------------------------------------------ */

describe("validateMove — legal marches", () => {
  it("accepts a straight march and prices the destination tiles", () => {
    const state = makeState(defaultUnits());
    const result = validate(state, STRAIGHT);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.path).toEqual(STRAIGHT);
    expect(result.from).toEqual(coord(0, 0));
    expect(result.to).toEqual(coord(3, 0));
    expect(result.cost).toBe(3);
    expect(result.facing).toBe("east");
  });

  it("treats a single-tile path as a free no-op facing unchanged", () => {
    const state = makeState(defaultUnits());
    const result = validate(state, [coord(0, 0)]);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.cost).toBe(0);
    expect(result.to).toEqual(coord(0, 0));
    expect(result.facing).toBe("north");
  });

  it("faces the direction of the final step after an L-shaped march", () => {
    const state = makeState(defaultUnits());
    const result = validate(state, [
      coord(0, 0),
      coord(1, 0),
      coord(1, 1),
      coord(1, 2),
    ]);

    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.to).toEqual(coord(1, 2));
    expect(result.facing).toBe("south");
  });

  it("allows a march that spends the Move budget exactly", () => {
    const state = makeState([
      makeUnit(MARCHER, coord(0, 0), { stats: { ...BASE_STATS, move: 3 } }),
      makeUnit(BLOCKER, coord(5, 3)),
    ]);
    expect(validate(state, STRAIGHT).valid).toBe(true);
  });

  it("allows the mover to leave the tile it stands on", () => {
    const state = makeState(defaultUnits());
    // The marcher's own tile is in the path (and therefore 'occupied' by
    // itself); that must never block the first step.
    expect(validate(state, STRAIGHT).valid).toBe(true);
  });

  it("charges rough terrain its full move cost", () => {
    let map = createTerrainMap(4, 1, "field");
    map = withTile(map, coord(1, 0), "wood");
    map = withTile(map, coord(2, 0), "marsh");
    const state = makeState([makeUnit(MARCHER, coord(0, 0), {
      stats: { ...BASE_STATS, move: 6 },
    })], map);

    const result = validate(state, [coord(0, 0), coord(1, 0), coord(2, 0), coord(3, 0)]);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.cost).toBe(1 + 2 + 3); // field + wood + marsh
  });
});

/* --------------------------------------------------------------------------
 * validateMove — rejections
 * ------------------------------------------------------------------------ */

describe("validateMove — rejects illegal paths", () => {
  it("rejects an empty path", () => {
    const state = makeState(defaultUnits());
    const result = validate(state, []);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejection.reason).toBe("empty-path");
  });

  it("rejects a path that does not start on the mover's tile", () => {
    const state = makeState(defaultUnits());
    const result = validate(state, [coord(1, 0), coord(2, 0)]);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejection.reason).toBe("not-from-origin");
  });

  it("rejects a non-contiguous path", () => {
    const state = makeState(defaultUnits());
    const result = validate(state, [coord(0, 0), coord(2, 0)]);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejection.reason).toBe("not-contiguous");
  });

  it("rejects a diagonal step", () => {
    const state = makeState(defaultUnits());
    const result = validate(state, [coord(0, 0), coord(1, 1)]);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejection.reason).toBe("not-contiguous");
  });

  it("rejects a path leaving the battlefield", () => {
    const state = makeState(defaultUnits());
    const result = validate(state, [coord(0, 0), coord(0, -1)]);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejection.reason).toBe("out-of-bounds");
  });

  it("rejects impassable terrain", () => {
    let map = createTerrainMap(3, 1, "field");
    map = withTile(map, coord(1, 0), "river");
    const state = makeState([makeUnit(MARCHER, coord(0, 0))], map);

    const result = validate(state, [coord(0, 0), coord(1, 0)]);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejection.reason).toBe("impassable");
    expect(result.rejection.at).toEqual(coord(1, 0));
  });

  it("rejects a tile another soldier holds", () => {
    const state = makeState([
      makeUnit(MARCHER, coord(0, 0)),
      makeUnit(BLOCKER, coord(2, 0)),
    ]);
    const result = validate(state, [coord(0, 0), coord(1, 0), coord(2, 0)]);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejection.reason).toBe("occupied");
    expect(result.rejection.at).toEqual(coord(2, 0));
  });

  it("rejects a march longer than the Move budget", () => {
    const state = makeState([
      makeUnit(MARCHER, coord(0, 0), { stats: { ...BASE_STATS, move: 2 } }),
      makeUnit(BLOCKER, coord(5, 3)),
    ]);
    const result = validate(state, STRAIGHT);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejection.reason).toBe("exceeds-move");
  });

  it("rejects malformed path values at the trust boundary", () => {
    const state = makeState(defaultUnits());
    const result = validate(state, [{}] as unknown as Coord[]);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejection.reason).toBe("malformed-path");
  });
});

/* --------------------------------------------------------------------------
 * validateMove — elevation & Climb
 * ------------------------------------------------------------------------ */

describe("validateMove — elevation & Climb", () => {
  it("charges a climb premium for every level gained", () => {
    let map = createTerrainMap(2, 1, "field");
    map = withTile(map, coord(1, 0), { terrain: "field", height: 1 });
    const state = makeState([makeUnit(MARCHER, coord(0, 0))], map);

    const result = validate(state, [coord(0, 0), coord(1, 0)]);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    // field move cost 1 + 1 per level climbed.
    expect(result.cost).toBe(2);
  });

  it("gates a climb above the mover's Climb", () => {
    let map = createTerrainMap(2, 1, "field");
    map = withTile(map, coord(1, 0), { terrain: "field", height: 3 });
    const state = makeState([makeUnit(MARCHER, coord(0, 0))], map);

    const result = validate(state, [coord(0, 0), coord(1, 0)]);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejection.reason).toBe("beyond-climb");
  });

  it("gates a descent on Climb too, but charges no premium", () => {
    let map = createTerrainMap(2, 1, { terrain: "field", height: 3 });
    map = withTile(map, coord(1, 0), { terrain: "field", height: 0 });
    const units = [
      makeUnit(MARCHER, coord(0, 0), {
        stats: { ...BASE_STATS, jump: 2, move: 4 },
      }),
    ];
    const tooSteep = makeState(units, map);
    expect(validate(tooSteep, [coord(0, 0), coord(1, 0)]).valid).toBe(false);

    const canDescend = makeState(
      [makeUnit(MARCHER, coord(0, 0), { stats: { ...BASE_STATS, jump: 3 } })],
      map,
    );
    const result = validate(canDescend, [coord(0, 0), coord(1, 0)]);
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.cost).toBe(1); // destination terrain only
  });

  it("counts climb premium against the Move budget", () => {
    let map = createTerrainMap(3, 1, "field");
    map = withTile(map, coord(1, 0), { terrain: "field", height: 1 });
    const state = makeState(
      [makeUnit(MARCHER, coord(0, 0), { stats: { ...BASE_STATS, move: 1 } })],
      map,
    );
    const result = validate(state, [coord(0, 0), coord(1, 0)]);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.rejection.reason).toBe("exceeds-move");
  });
});

/* --------------------------------------------------------------------------
 * applyMove
 * ------------------------------------------------------------------------ */

describe("applyMove", () => {
  it("moves the soldier and emits a full moved event", () => {
    const state = makeState(defaultUnits());
    const unit = findUnit(state, MARCHER)!;
    const events: Parameters<typeof applyMove>[3] = [];

    const next = applyMove(state, unit, STRAIGHT, events);

    const moved = findUnit(next, MARCHER)!;
    expect(moved.at).toEqual(coord(3, 0));
    expect(moved.facing).toBe("east");
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.kind).toBe("moved");
    if (event.kind !== "moved") return;
    expect(event.unitId).toBe(MARCHER);
    expect(event.from).toEqual(coord(0, 0));
    expect(event.to).toEqual(coord(3, 0));
    expect(event.path).toEqual(STRAIGHT);
    expect(event.facing).toBe("east");
    expect(isBattleEvent(event)).toBe(true);
  });

  it("emits nothing and returns the same state for a no-op path", () => {
    const state = makeState(defaultUnits());
    const unit = findUnit(state, MARCHER)!;
    const events: Parameters<typeof applyMove>[3] = [];

    const next = applyMove(state, unit, [coord(0, 0)], events);

    expect(next).toBe(state);
    expect(events).toEqual([]);
  });

  it("throws MoveError when handed an illegal path", () => {
    const state = makeState(defaultUnits());
    const unit = findUnit(state, MARCHER)!;
    expect(() => applyMove(state, unit, [coord(1, 0), coord(2, 0)], [])).toThrow(MoveError);
  });

  it("does not mutate the input state, unit or path", () => {
    const state = makeState(defaultUnits());
    const unit = findUnit(state, MARCHER)!;
    const before = JSON.stringify(state);
    const path = STRAIGHT.map((at) => ({ ...at }));

    applyMove(state, unit, path, []);

    expect(JSON.stringify(state)).toBe(before);
    expect(path).toEqual(STRAIGHT);
  });
});

/* --------------------------------------------------------------------------
 * step — Move integration
 * ------------------------------------------------------------------------ */

describe("step — move command", () => {
  it("resolves a march and leaves the turn open for an act", () => {
    const state = makeState(defaultUnits());
    const actor = state.currentActorId as UnitId;
    expect(actor).toBe(MARCHER);

    const command: Command = { kind: "move", unitId: actor, path: STRAIGHT };
    const result = step(state, command);

    expect(result.rejection).toBeUndefined();
    expect(result.events.map((event) => event.kind)).toEqual([
      "battleStarted",
      "unitDeployed",
      "unitDeployed",
      "turnStarted",
      "moved",
    ]);
    expect(findUnit(result.state, MARCHER)?.at).toEqual(coord(3, 0));
    // The free move keeps the Orders Tempo turn open (T115); a wait closes it.
    expect(result.state.currentActorId).toBe(actor);
    expect(result.state.hasMovedThisTurn).toBe(true);

    const closed = step(result.state, { kind: "wait", unitId: actor });
    expect(closed.rejection).toBeUndefined();
    expect(closed.state.hasMovedThisTurn).toBe(false);
    expect(closed.events.map((event) => event.kind)).toEqual(["turnEnded", "turnStarted"]);
    expect(result.events.every(isBattleEvent)).toBe(true);
  });

  it("rejects an illegal march without mutation", () => {
    const state = makeState([
      makeUnit(MARCHER, coord(0, 0), { stats: { ...BASE_STATS, move: 1 } }),
      // Slower ally, so the marcher is unambiguously the current actor (T122:
      // equal Speed now ties by id ascending, and "unit-blocker" sorts first).
      makeUnit(BLOCKER, coord(5, 3), { stats: { ...BASE_STATS, spd: 10 } }),
    ]);
    const command: Command = { kind: "move", unitId: MARCHER, path: STRAIGHT };

    const result = step(state, command);
    expect(result.rejection?.reason).toBe("illegal-move");
    expect(result.events).toEqual([]);
    expect(result.state).toBe(state);
  });

  it("leaves the input state byte-identical on a successful march", () => {
    const state = makeState(defaultUnits());
    const before = JSON.stringify(state);
    step(state, { kind: "move", unitId: MARCHER, path: STRAIGHT });
    expect(JSON.stringify(state)).toBe(before);
  });

  it("replays a march deterministically", () => {
    const run = (): { state: string; events: string } => {
      const state = makeState(defaultUnits());
      const result = step(state, { kind: "move", unitId: MARCHER, path: STRAIGHT });
      return { state: JSON.stringify(result.state), events: JSON.stringify(result.events) };
    };
    const first = run();
    expect(run()).toEqual(first);
  });
});

/* --------------------------------------------------------------------------
 * T026 — Wait / Facing / Hold
 *
 * These tests pin the basic-command contract: a **wait** passes without
 * touching the soldier, a **face** pivots in place and reports a `faced`
 * event, and a **hold** applies the **Braced** stance and reports it. They also
 * hold the line the rest of the engine relies on — purity, no mutation and a
 * deterministic reply — because these orders fold into the same command log as
 * moves and actions (`agents.md` §2, §7).
 * ------------------------------------------------------------------------ */

describe("T026 — Wait", () => {
  it("applyWait leaves the state and event stream untouched", () => {
    const state = makeState(defaultUnits());
    const unit = findUnit(state, MARCHER)!;
    const events: BattleEvent[] = [];

    const next = applyWait(state, unit, events);

    expect(next).toBe(state);
    expect(events).toEqual([]);
  });

  it("step resolves a wait and advances Orders Tempo", () => {
    const state = makeState(defaultUnits());
    const result = step(state, { kind: "wait", unitId: MARCHER });

    expect(result.rejection).toBeUndefined();
    expect(result.events.map((event) => event.kind)).toEqual([
      "battleStarted",
      "unitDeployed",
      "unitDeployed",
      "turnStarted",
      "turnEnded",
      "turnStarted",
    ]);
    expect(result.events.every(isBattleEvent)).toBe(true);
  });
});

describe("T026 — Face", () => {
  it("applyFace turns in place and emits a faced event", () => {
    const state = makeState(defaultUnits());
    const unit = findUnit(state, MARCHER)!;
    const events: BattleEvent[] = [];

    const next = applyFace(state, unit, "east", events);

    const turned = findUnit(next, MARCHER)!;
    expect(turned.facing).toBe("east");
    expect(turned.at).toEqual(coord(0, 0)); // facing never moves the soldier
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.kind).toBe("faced");
    if (event.kind !== "faced") return;
    expect(event.unitId).toBe(MARCHER);
    expect(event.from).toBe("north");
    expect(event.to).toBe("east");
    expect(isBattleEvent(event)).toBe(true);
  });

  it("applyFace is a no-op when already facing that way", () => {
    const state = makeState(defaultUnits());
    const unit = findUnit(state, MARCHER)!;
    const events: BattleEvent[] = [];

    const next = applyFace(state, unit, "north", events);

    expect(next).toBe(state);
    expect(events).toEqual([]);
  });

  it("applyFace does not mutate the input state", () => {
    const state = makeState(defaultUnits());
    const before = JSON.stringify(state);

    applyFace(state, findUnit(state, MARCHER)!, "south", []);

    expect(JSON.stringify(state)).toBe(before);
  });

  it("step resolves a face command and runs the turn", () => {
    const state = makeState(defaultUnits());
    const result = step(state, { kind: "face", unitId: MARCHER, facing: "east" });

    expect(result.rejection).toBeUndefined();
    expect(findUnit(result.state, MARCHER)?.facing).toBe("east");
    expect(result.events.map((event) => event.kind)).toEqual([
      "battleStarted",
      "unitDeployed",
      "unitDeployed",
      "turnStarted",
      "faced",
      "turnEnded",
      "turnStarted",
    ]);
    expect(result.events.every(isBattleEvent)).toBe(true);
  });
});

describe("T026 — Hold (brace)", () => {
  it("applyHold applies the Braced condition and emits conditionApplied", () => {
    const state = makeState(defaultUnits());
    const unit = findUnit(state, MARCHER)!;
    const events: BattleEvent[] = [];

    const next = applyHold(state, unit, events);

    const braced = findUnit(next, MARCHER)!;
    expect(hasCondition(braced, BRACED_CONDITION)).toBe(true);
    expect(getCondition(braced, BRACED_CONDITION)?.duration).toBe(BRACE_DURATION_TICKS);
    expect(events).toHaveLength(1);
    const event = events[0];
    expect(event.kind).toBe("conditionApplied");
    if (event.kind !== "conditionApplied") return;
    expect(event.unitId).toBe(MARCHER);
    expect(event.conditionId).toBe(BRACED_CONDITION);
    expect(event.duration).toBe(BRACE_DURATION_TICKS);
    expect(isBattleEvent(event)).toBe(true);
  });

  it("applyHold refreshes an existing brace without stacking it", () => {
    const state = makeState(defaultUnits());
    const once = applyHold(state, findUnit(state, MARCHER)!, []);
    const twice = applyHold(once, findUnit(once, MARCHER)!, []);

    const braced = findUnit(twice, MARCHER)!;
    expect(braced.conditions.filter((c) => c.conditionId === BRACED_CONDITION)).toHaveLength(1);
  });

  it("applyHold does not mutate the input state", () => {
    const state = makeState(defaultUnits());
    const before = JSON.stringify(state);

    applyHold(state, findUnit(state, MARCHER)!, []);

    expect(JSON.stringify(state)).toBe(before);
  });

  it("step resolves a hold, braces the soldier and runs the turn", () => {
    const state = makeState(defaultUnits());
    const result = step(state, { kind: "hold", unitId: MARCHER });

    expect(result.rejection).toBeUndefined();
    expect(hasCondition(findUnit(result.state, MARCHER)!, BRACED_CONDITION)).toBe(true);
    expect(result.events.map((event) => event.kind)).toEqual([
      "battleStarted",
      "unitDeployed",
      "unitDeployed",
      "turnStarted",
      "conditionApplied",
      "turnEnded",
      "turnStarted",
    ]);
    expect(result.events.every(isBattleEvent)).toBe(true);
  });

  it("replays a hold deterministically", () => {
    const run = (): { state: string; events: string } => {
      const state = makeState(defaultUnits());
      const result = step(state, { kind: "hold", unitId: MARCHER });
      return { state: JSON.stringify(result.state), events: JSON.stringify(result.events) };
    };
    const first = run();
    expect(run()).toEqual(first);
  });
});
