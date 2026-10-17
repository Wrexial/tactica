import { describe, expect, it } from "vitest";

import { coord, type Coord } from "../../src/engine/grid";
import { isBattleEvent, type BattleEvent } from "../../src/engine/events";
import {
  BattleSetupError,
  createBattle,
  findUnit,
  step,
  validateCommand,
  type BattleSetup,
  type BattleState,
} from "../../src/engine/battle";
import { buildActionCatalogue, type ActionSpec } from "../../src/engine/actions/resolve";
import type { Command } from "../../src/engine/commands";
import { asAbilityId, asGuardSortieId, asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import { createTerrainMap } from "../../src/engine/terrain";
import {
  TEMPO_THRESHOLD,
  createOrdersTempo,
  previewTurns,
  speedLookup,
} from "../../src/engine/turn";
import { createUnit, withHp, withPosition, type Unit, type UnitInit } from "../../src/engine/unit";
import type { Objective } from "../../src/engine/objectives";
import type { StatBlock } from "../../src/data/schema";

/* --------------------------------------------------------------------------
 * T022 — Battle create/step
 *
 * These tests pin the task's "done when":
 *   - `createBattle(seed, setup)` builds a deterministic, validated battle and
 *     hands the first Orders Tempo turn to the fastest soldier;
 *   - `step(state, command)` returns a new state plus ordered events, running
 *     one turn per command; and
 *   - an **invalid command is rejected without mutation** — same state object,
 *     no events, a populated rejection reason.
 * They also pin the guarantees later phases lean on: purity, deterministic
 * replay from a seed, and JSON-serialisable state/events.
 * ------------------------------------------------------------------------ */

const FAST = asUnitId("unit-fast");
const SLOW = asUnitId("unit-slow");

const BASE_STATS: StatBlock = {
  hp: 60,
  mp: 20,
  atk: 12,
  def: 8,
  mag: 4,
  res: 6,
  spd: 10,
  move: 4,
  jump: 2,
};

const MAP = createTerrainMap(6, 4, "field");

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

function makeSetup(units: readonly Unit[] = defaultUnits()): BattleSetup {
  return { map: MAP, units };
}

/* Actions used by the T024 pipeline tests. `mpCost`/`chargeTime` are the only
 * numbers the pipeline reads; range/power are carried for T028/T041. */
const INSTANT_ACTION: ActionSpec = {
  id: asAbilityId("rifle-volley"),
  mpCost: 5,
  chargeTime: 0,
  range: 5,
  power: 100,
};
const SHORT_CHARGE: ActionSpec = {
  id: asAbilityId("case-shot"),
  mpCost: 3,
  chargeTime: 2,
  range: 4,
  power: 80,
};
const LONG_CHARGE: ActionSpec = {
  id: asAbilityId("grand-battery"),
  mpCost: 0,
  chargeTime: 10,
  range: 8,
  power: 120,
};

function makeActionSetup(
  abilities: readonly ActionSpec[],
  units: readonly Unit[] = defaultUnits(),
): BattleSetup {
  return { map: MAP, units, abilities };
}

/** An `act` command from the current actor at `abilityId` (defaults to self). */
function actCommand(state: BattleState, abilityId = INSTANT_ACTION.id): Command {
  return {
    kind: "act",
    unitId: state.currentActorId as UnitId,
    abilityId,
    target: { kind: "self" },
  };
}

function defaultUnits(): Unit[] {
  return [
    makeUnit(FAST, coord(1, 1), { stats: { ...BASE_STATS, spd: 30 } }),
    makeUnit(SLOW, coord(3, 2), { stats: { ...BASE_STATS, spd: 10 } }),
  ];
}

/** A `wait` order for whichever soldier currently holds the turn. */
function wait(state: BattleState, unitId: UnitId = state.currentActorId as UnitId): Command {
  return { kind: "wait", unitId };
}

/** Step `count` waits, returning the final state and every event emitted. */
function waitThrough(
  start: BattleState,
  count: number,
): { state: BattleState; events: BattleEvent[] } {
  let state = start;
  const events: BattleEvent[] = [];
  for (let i = 0; i < count; i++) {
    const actor = state.currentActorId;
    if (actor === null) break;
    const result = step(state, wait(state, actor));
    state = result.state;
    events.push(...result.events);
  }
  return { state, events };
}

/** The `turnStarted` actors from an event stream, in order. */
function startedActors(events: readonly BattleEvent[]): UnitId[] {
  return events.flatMap((event) => (event.kind === "turnStarted" ? [event.unitId] : []));
}

/* --------------------------------------------------------------------------
 * createBattle
 * ------------------------------------------------------------------------ */

describe("createBattle — construction", () => {
  it("deploys every soldier and gives the first turn to the fastest", () => {
    const state = createBattle(1815, makeSetup());

    expect(state.seed).toBe(1815);
    expect(state.phase).toBe("active");
    expect(state.outcome).toBeNull();
    expect(state.started).toBe(false);
    expect(state.units.map((unit) => unit.id)).toEqual([FAST, SLOW]);
    expect(state.tempo.entries.map((entry) => entry.unitId)).toEqual([FAST, SLOW]);
    expect(state.currentActorId).toBe(FAST);
    // Speed 30 reaches the threshold of 100 on tick 4.
    expect(state.tempo.tick).toBe(4);
    expect(state.tempo.threshold).toBe(TEMPO_THRESHOLD);
  });

  it("honours a custom threshold and starting charge", () => {
    const state = createBattle(1, {
      ...makeSetup(),
      threshold: 40,
      initialCharge: { [SLOW]: 40 },
    });
    expect(state.tempo.threshold).toBe(40);
    // The pre-charged slow soldier is ready immediately on tick 0.
    expect(state.currentActorId).toBe(SLOW);
    expect(state.tempo.tick).toBe(0);
  });

  it("leaves no actor when nobody can charge", () => {
    const still = [
      makeUnit(FAST, coord(1, 1), { stats: { ...BASE_STATS, spd: 0 } }),
      makeUnit(SLOW, coord(3, 2), { stats: { ...BASE_STATS, spd: 0 } }),
    ];
    const state = createBattle(1, makeSetup(still));
    expect(state.currentActorId).toBeNull();
  });

  it("is deterministic for a seed", () => {
    expect(JSON.stringify(createBattle("waterloo", makeSetup()))).toBe(
      JSON.stringify(createBattle("waterloo", makeSetup())),
    );
  });

  it("does not mutate the authored setup", () => {
    const setup = makeSetup();
    const before = JSON.stringify(setup);
    createBattle(7, setup);
    expect(JSON.stringify(setup)).toBe(before);
  });
});

describe("createBattle — validation", () => {
  it("rejects an empty roster", () => {
    expect(() => createBattle(1, makeSetup([]))).toThrow(BattleSetupError);
  });

  it("rejects duplicate soldier ids", () => {
    const units = [makeUnit(FAST, coord(1, 1)), makeUnit(FAST, coord(2, 2))];
    expect(() => createBattle(1, makeSetup(units))).toThrow(/duplicate soldier id/);
  });

  it("rejects tiles outside the map", () => {
    const units = [makeUnit(FAST, coord(99, 99))];
    expect(() => createBattle(1, makeSetup(units))).toThrow(/outside the/);
  });

  it("rejects two soldiers sharing a tile", () => {
    const units = [makeUnit(FAST, coord(1, 1)), makeUnit(SLOW, coord(1, 1))];
    expect(() => createBattle(1, makeSetup(units))).toThrow(/share tile/);
  });

  it("rejects a map whose tiles do not match its grid", () => {
    const broken: BattleSetup = {
      map: { grid: MAP.grid, tiles: MAP.tiles.slice(0, 5) },
      units: defaultUnits(),
    };
    expect(() => createBattle(1, broken)).toThrow(/tiles/);
  });
});

/* --------------------------------------------------------------------------
 * validateCommand
 * ------------------------------------------------------------------------ */

describe("validateCommand", () => {
  it("accepts a legal wait from the acting soldier", () => {
    const state = createBattle(1, makeSetup());
    expect(validateCommand(state, wait(state))).toBeNull();
  });

  it("refuses a wait from the wrong soldier", () => {
    const state = createBattle(1, makeSetup());
    expect(validateCommand(state, wait(state, SLOW))?.reason).toBe("not-your-turn");
  });
});

/* --------------------------------------------------------------------------
 * step — turn lifecycle
 * ------------------------------------------------------------------------ */

describe("step — turn lifecycle", () => {
  it("announces the battle and runs exactly one turn per command", () => {
    const state = createBattle(1815, makeSetup());

    const first = step(state, wait(state));
    expect(first.rejection).toBeUndefined();
    expect(first.events.map((event) => event.kind)).toEqual([
      "battleStarted",
      "unitDeployed",
      "unitDeployed",
      "turnStarted",
      "turnEnded",
      "turnStarted",
    ]);
    expect(first.state).not.toBe(state);
    expect(first.state.started).toBe(true);
    expect(startedActors(first.events)).toEqual(
      previewTurns(
        createOrdersTempo([FAST, SLOW], { seed: 1815 }),
        speedLookup({ [FAST]: 30, [SLOW]: 10 }),
        2,
      ),
    );

    const second = step(first.state, wait(first.state));
    expect(second.events.map((event) => event.kind)).toEqual(["turnEnded", "turnStarted"]);
  });

  it("emits only well-formed, JSON-serialisable events", () => {
    const { events } = waitThrough(createBattle(1815, makeSetup()), 3);
    expect(events.every(isBattleEvent)).toBe(true);
    expect(JSON.parse(JSON.stringify(events))).toEqual(events);
  });

  it("follows the same actor order as the Orders Tempo forecast", () => {
    const seed = "quatre-bras";
    const speedOf = speedLookup({ [FAST]: 30, [SLOW]: 10 });
    const expected = previewTurns(createOrdersTempo([FAST, SLOW], { seed }), speedOf, 7);

    const { events } = waitThrough(createBattle(seed, makeSetup()), 6);
    expect(startedActors(events)).toEqual(expected);
  });

  it("leaves the input state byte-identical on a successful step", () => {
    const state = createBattle(1815, makeSetup());
    const before = JSON.stringify(state);
    step(state, wait(state));
    expect(JSON.stringify(state)).toBe(before);
  });
});

/* --------------------------------------------------------------------------
 * step — rejection without mutation
 * ------------------------------------------------------------------------ */

describe("step — rejection without mutation", () => {
  it("rejects a malformed command", () => {
    const state = createBattle(1, makeSetup());
    const malformed = { kind: "wait" } as unknown as Command;

    const result = step(state, malformed);
    expect(result.rejection?.reason).toBe("malformed");
    expect(result.events).toEqual([]);
    expect(result.state).toBe(state);
  });

  it("rejects a soldier who is not on the field", () => {
    const state = createBattle(1, makeSetup());
    const result = step(state, { kind: "wait", unitId: asUnitId("unit-ghost") });
    expect(result.rejection?.reason).toBe("unknown-unit");
    expect(result.state).toBe(state);
  });

  it("rejects a command from the wrong soldier", () => {
    const state = createBattle(1, makeSetup());
    const result = step(state, wait(state, SLOW));
    expect(result.rejection?.reason).toBe("not-your-turn");
    expect(result.state).toBe(state);
  });

  it("rejects when nobody is ready to act", () => {
    const still = [
      makeUnit(FAST, coord(1, 1), { stats: { ...BASE_STATS, spd: 0 } }),
      makeUnit(SLOW, coord(3, 2), { stats: { ...BASE_STATS, spd: 0 } }),
    ];
    const state = createBattle(1, makeSetup(still));
    const result = step(state, { kind: "wait", unitId: FAST });
    expect(result.rejection?.reason).toBe("no-actor");
    expect(result.state).toBe(state);
  });

  it("rejects a command from a soldier who is out of action", () => {
    const state = createBattle(1, makeSetup());
    const actor = state.currentActorId as UnitId;
    const downed: BattleState = {
      ...state,
      units: state.units.map((unit) => (unit.id === actor ? withHp(unit, 0) : unit)),
    };
    const result = step(downed, { kind: "wait", unitId: actor });
    expect(result.rejection?.reason).toBe("unit-out-of-action");
    expect(result.state).toBe(downed);
  });

  it("rejects any command once the battle has ended", () => {
    const state = createBattle(1, makeSetup());
    const finished: BattleState = { ...state, phase: "finished", outcome: "draw" };
    const result = step(finished, wait(state));
    expect(result.rejection?.reason).toBe("battle-over");
    expect(result.state).toBe(finished);
  });

  it("accepts the basic face and hold orders from the acting soldier", () => {
    const state = createBattle(1, makeSetup());
    const actor = state.currentActorId as UnitId;

    const face: Command = { kind: "face", unitId: actor, facing: "east" };
    expect(validateCommand(state, face)).toBeNull();

    const hold: Command = { kind: "hold", unitId: actor };
    expect(validateCommand(state, hold)).toBeNull();
  });

  it("refuses commands whose effects have not landed yet", () => {
    const state = createBattle(1, makeSetup());
    const actor = state.currentActorId as UnitId;

    const volley: Command = {
      kind: "volley",
      unitId: actor,
      abilityId: asAbilityId("rifle-volley"),
      target: { kind: "self" },
      honour: 1,
    };
    expect(validateCommand(state, volley)?.reason).toBe("unsupported");

    const guardSortie: Command = { kind: "guardSortie", unitId: actor, guardSortieId: asGuardSortieId("old-guard") };
    expect(validateCommand(state, guardSortie)?.reason).toBe("unsupported");
  });
});

/* --------------------------------------------------------------------------
 * T024 — action resolution pipeline (declare → charge → resolve → end-turn)
 * ------------------------------------------------------------------------ */

describe("step — action resolution pipeline", () => {
  it("resolves an instant action: declare, pay Élan, resolve, end turn", () => {
    const state = createBattle(1815, makeActionSetup([INSTANT_ACTION]));
    const actor = state.currentActorId as UnitId;
    const mpBefore = findUnit(state, actor)!.mp;

    const result = step(state, actCommand(state));
    expect(result.rejection).toBeUndefined();
    expect(result.events.map((event) => event.kind)).toEqual([
      "battleStarted",
      "unitDeployed",
      "unitDeployed",
      "turnStarted",
      "abilityUsed",
      "mpChanged",
      "abilityResolved",
      "turnEnded",
      "turnStarted",
    ]);

    const paid = findUnit(result.state, actor)!;
    expect(paid.mp).toBe(mpBefore - INSTANT_ACTION.mpCost);
    expect(result.state.pendingActions).toEqual([]);
    expect(result.state.tempo.entries.every((entry) => entry.pending.length === 0)).toBe(true);
  });

  it("announces a charging action and resolves it when its timer elapses", () => {
    const state = createBattle(1815, makeActionSetup([SHORT_CHARGE]));
    const actor = state.currentActorId as UnitId;

    const result = step(state, actCommand(state, SHORT_CHARGE.id));
    // The two-tick charge elapses while Orders Tempo waits for the next actor,
    // so declaration and resolution land in the same step, in pipeline order.
    expect(result.events.map((event) => event.kind)).toEqual([
      "battleStarted",
      "unitDeployed",
      "unitDeployed",
      "turnStarted",
      "abilityUsed",
      "mpChanged",
      "chargeStarted",
      "turnEnded",
      "chargeResolved",
      "abilityResolved",
      "turnStarted",
    ]);

    const started = result.events.find(
      (event): event is Extract<BattleEvent, { kind: "chargeStarted" }> =>
        event.kind === "chargeStarted",
    );
    expect(started).toMatchObject({
      unitId: actor,
      abilityId: SHORT_CHARGE.id,
      ticks: SHORT_CHARGE.chargeTime,
    });
    expect(result.state.pendingActions).toEqual([]);
  });

  it("keeps a long charge pending until the tempo clock reaches it", () => {
    const state = createBattle(1815, makeActionSetup([LONG_CHARGE]));
    const actor = state.currentActorId as UnitId;

    const first = step(state, actCommand(state, LONG_CHARGE.id));
    expect(first.state.pendingActions).toHaveLength(1);
    expect(first.state.pendingActions[0]).toMatchObject({
      unitId: actor,
      abilityId: LONG_CHARGE.id,
      declaredTick: state.tempo.tick,
    });
    expect(first.events.map((event) => event.kind)).toEqual([
      "battleStarted",
      "unitDeployed",
      "unitDeployed",
      "turnStarted",
      "abilityUsed",
      "chargeStarted",
      "turnEnded",
      "turnStarted",
    ]);
    expect(first.events.some((event) => event.kind === "mpChanged")).toBe(false);

    // Wait through the turns until the charge finally resolves.
    let working = first.state;
    const later: BattleEvent[] = [];
    for (let i = 0; i < 40 && working.pendingActions.length > 0; i++) {
      const nextActor = working.currentActorId;
      if (nextActor === null) break;
      const result = step(working, { kind: "wait", unitId: nextActor });
      working = result.state;
      later.push(...result.events);
    }

    expect(working.pendingActions).toEqual([]);
    expect(later.map((event) => event.kind)).toContain("chargeResolved");
    expect(later.map((event) => event.kind)).toContain("abilityResolved");
    expect(working.tempo.entries.every((entry) => entry.pending.length === 0)).toBe(true);
  });

  it("emits only well-formed events and leaves the input untouched", () => {
    const state = createBattle(1815, makeActionSetup([INSTANT_ACTION, SHORT_CHARGE]));
    const before = JSON.stringify(state);

    const result = step(state, actCommand(state, INSTANT_ACTION.id));
    expect(result.events.every(isBattleEvent)).toBe(true);
    expect(JSON.parse(JSON.stringify(result.events))).toEqual(result.events);
    expect(JSON.stringify(state)).toBe(before);
  });

  it("resolves a soldier-targeted action and records the named target", () => {
    const state = createBattle(1815, makeActionSetup([INSTANT_ACTION]));
    const actor = state.currentActorId as UnitId;
    const target = state.units.find((unit) => unit.id !== actor)!;

    const result = step(state, {
      kind: "act",
      unitId: actor,
      abilityId: INSTANT_ACTION.id,
      target: { kind: "unit", unitId: target.id },
    });

    const used = result.events.find(
      (event): event is Extract<BattleEvent, { kind: "abilityUsed" }> =>
        event.kind === "abilityUsed",
    );
    const resolved = result.events.find(
      (event): event is Extract<BattleEvent, { kind: "abilityResolved" }> =>
        event.kind === "abilityResolved",
    );
    expect(used?.targetId).toBe(target.id);
    expect(used?.at).toEqual(target.at);
    expect(resolved?.targetId).toBe(target.id);
  });

  it("rejects an action this battle does not know", () => {
    const state = createBattle(1815, makeActionSetup([INSTANT_ACTION]));
    const result = step(state, actCommand(state, asAbilityId("unknown-action")));
    expect(result.rejection?.reason).toBe("unknown-ability");
    expect(result.state).toBe(state);
    expect(result.events).toEqual([]);
  });

  it("rejects an action the soldier cannot afford", () => {
    const expensive: ActionSpec = {
      ...INSTANT_ACTION,
      id: asAbilityId("grand-barrage"),
      mpCost: 999,
    };
    const state = createBattle(1815, makeActionSetup([expensive]));
    const result = step(state, actCommand(state, expensive.id));
    expect(result.rejection?.reason).toBe("insufficient-elan");
    expect(result.state).toBe(state);
  });

  it("rejects a target that is not on the field", () => {
    const state = createBattle(1815, makeActionSetup([INSTANT_ACTION]));
    const actor = state.currentActorId as UnitId;
    const result = step(state, {
      kind: "act",
      unitId: actor,
      abilityId: INSTANT_ACTION.id,
      target: { kind: "unit", unitId: asUnitId("unit-ghost") },
    });
    expect(result.rejection?.reason).toBe("invalid-target");

    const offMap = step(state, {
      kind: "act",
      unitId: actor,
      abilityId: INSTANT_ACTION.id,
      target: { kind: "tile", at: coord(99, 99) },
    });
    expect(offMap.rejection?.reason).toBe("invalid-target");
  });

  it("replays an action log deterministically from a seed", () => {
    const setup = makeActionSetup([INSTANT_ACTION, SHORT_CHARGE]);
    const play = (): string => {
      let state = createBattle("sainte-colombe", setup);
      const commands: Command[] = [actCommand(state, INSTANT_ACTION.id)];
      state = step(state, commands[0]).state;
      while (state.currentActorId !== null && commands.length < 8) {
        const command: Command = { kind: "wait", unitId: state.currentActorId };
        commands.push(command);
        state = step(state, command).state;
      }
      return JSON.stringify(state);
    };
    expect(play()).toBe(play());
  });
});

/* --------------------------------------------------------------------------
 * T115 — native move-and-act turn
 *
 * A `move` no longer ends the Orders Tempo turn: it records that the march is
 * spent and leaves the actor to follow up with an `act` (or close the turn with
 * `wait` / `hold`). The move remains a real command in the replay log.
 * ------------------------------------------------------------------------ */

describe("step — native move-and-act turn (T115)", () => {
  it("leaves the turn open after a move so an act can follow", () => {
    const state = createBattle(1815, makeActionSetup([INSTANT_ACTION]));
    const actor = state.currentActorId as UnitId;

    const moved = step(state, {
      kind: "move",
      unitId: actor,
      path: [coord(1, 1), coord(2, 1)],
    });
    expect(moved.rejection).toBeUndefined();
    expect(moved.state.currentActorId).toBe(actor);
    expect(moved.state.hasMovedThisTurn).toBe(true);
    // The free move emits only `moved`; it does not spend the turn.
    expect(moved.events.map((event) => event.kind)).toEqual([
      "battleStarted",
      "unitDeployed",
      "unitDeployed",
      "turnStarted",
      "moved",
    ]);

    const acted = step(moved.state, actCommand(moved.state));
    expect(acted.rejection).toBeUndefined();
    expect(acted.events.map((event) => event.kind)).toContain("turnEnded");
    expect(acted.events.map((event) => event.kind)).toContain("abilityResolved");
    expect(acted.state.hasMovedThisTurn).toBe(false);
  });

  it("closes a move-only turn with an explicit wait", () => {
    const state = createBattle(1815, makeSetup());
    const actor = state.currentActorId as UnitId;

    const moved = step(state, {
      kind: "move",
      unitId: actor,
      path: [coord(1, 1), coord(2, 1)],
    });
    expect(moved.state.hasMovedThisTurn).toBe(true);

    const waited = step(moved.state, wait(moved.state));
    expect(waited.rejection).toBeUndefined();
    expect(waited.state.hasMovedThisTurn).toBe(false);
    expect(waited.events.map((event) => event.kind)).toEqual(["turnEnded", "turnStarted"]);
  });

  it("refuses a second march in the same turn without mutation", () => {
    const state = createBattle(1815, makeSetup());
    const actor = state.currentActorId as UnitId;
    const moved = step(state, {
      kind: "move",
      unitId: actor,
      path: [coord(1, 1), coord(2, 1)],
    });

    const again = step(moved.state, {
      kind: "move",
      unitId: actor,
      path: [coord(2, 1), coord(3, 1)],
    });
    expect(again.rejection?.reason).toBe("already-moved");
    expect(again.state).toBe(moved.state);
    expect(again.events).toEqual([]);
  });

  it("replays a move-then-act log deterministically", () => {
    const play = (): string => {
      let state = createBattle("trafalgar", makeActionSetup([INSTANT_ACTION]));
      const actor = state.currentActorId as UnitId;
      state = step(state, {
        kind: "move",
        unitId: actor,
        path: [coord(1, 1), coord(2, 1)],
      }).state;
      state = step(state, actCommand(state)).state;
      return JSON.stringify(state);
    };
    expect(play()).toBe(play());
  });
});

describe("buildActionCatalogue", () => {
  it("indexes specs by id and copies them", () => {
    const catalogue = buildActionCatalogue([INSTANT_ACTION]);
    expect(catalogue[INSTANT_ACTION.id]).toEqual(INSTANT_ACTION);
    expect(catalogue[INSTANT_ACTION.id]).not.toBe(INSTANT_ACTION);
  });

  it("rejects duplicate or malformed specs", () => {
    expect(() => buildActionCatalogue([INSTANT_ACTION, INSTANT_ACTION])).toThrow(/duplicate/);
    expect(() => buildActionCatalogue([{ ...INSTANT_ACTION, chargeTime: -1 }])).toThrow(
      /chargeTime/,
    );
  });
});

/* --------------------------------------------------------------------------
 * Determinism
 * ------------------------------------------------------------------------ */

describe("step — determinism", () => {
  it("replays identically from the same seed and command log", () => {
    const play = (): string => {
      const { state } = waitThrough(createBattle("austerlitz", makeSetup()), 10);
      return JSON.stringify(state);
    };
    expect(play()).toBe(play());
  });

  it("uses the seed to break same-charge ties", () => {
    const tied = [
      makeUnit(FAST, coord(1, 1), { stats: { ...BASE_STATS, spd: 20 } }),
      makeUnit(SLOW, coord(3, 2), { stats: { ...BASE_STATS, spd: 20 } }),
      makeUnit(asUnitId("unit-third"), coord(5, 3), { stats: { ...BASE_STATS, spd: 20 } }),
    ];
    const orderFor = (seed: string): string => {
      const { events } = waitThrough(createBattle(seed, makeSetup(tied)), 8);
      return startedActors(events).join(",");
    };
    expect(new Set([orderFor("alpha"), orderFor("beta"), orderFor("gamma")]).size).toBeGreaterThan(
      1,
    );
  });

  it("exposes the deployed soldier through findUnit", () => {
    const state = createBattle(1, makeSetup());
    expect(findUnit(state, FAST)?.id).toBe(FAST);
    expect(findUnit(state, asUnitId("unit-ghost"))).toBeUndefined();
  });
});

/* --------------------------------------------------------------------------
 * T031 — win/lose objectives
 *
 * These pin the task's "done when": annihilation, rout, survive-N and
 * capture/defend objectives each conclude the battle and emit a single
 * `battleEnded` event with the outcome stated from the company's point of view.
 * ------------------------------------------------------------------------ */

const OBJECTIVE_MAP = createTerrainMap(6, 4, "field");

/** A company soldier and one hostile, so enemy-counting objectives are real. */
function objectiveRoster(): Unit[] {
  return [
    makeUnit(FAST, coord(1, 1), { stats: { ...BASE_STATS, spd: 30 } }),
    makeUnit(SLOW, coord(3, 2), { side: "enemy", stats: { ...BASE_STATS, spd: 10 } }),
  ];
}

function makeObjectiveBattle(
  objective: Objective,
  units: readonly Unit[] = objectiveRoster(),
): BattleState {
  return createBattle(1815, { map: OBJECTIVE_MAP, units, objective });
}

/** Put the named soldier out of action, leaving the rest of the state intact. */
function downed(state: BattleState, unitId: UnitId): BattleState {
  return {
    ...state,
    units: state.units.map((unit) => (unit.id === unitId ? withHp(unit, 0) : unit)),
  };
}

/** The `battleEnded` events in a stream (there must never be more than one). */
function battleEndedEvents(events: readonly BattleEvent[]): BattleEvent[] {
  return events.filter((event) => event.kind === "battleEnded");
}

describe("step — win/lose objectives (T031)", () => {
  it("annihilation: wins when the last enemy is out of action", () => {
    const start = makeObjectiveBattle({ kind: "annihilation" });
    const enemy = start.units.find((unit) => unit.side === "enemy") as Unit;

    const result = step(downed(start, enemy.id), wait(downed(start, enemy.id)));
    expect(result.state.phase).toBe("finished");
    expect(result.state.outcome).toBe("companyVictory");
    expect(battleEndedEvents(result.events)).toHaveLength(1);
    // Nothing opens a turn after the battle has ended.
    expect(result.events[result.events.length - 1]?.kind).toBe("battleEnded");
  });

  it("annihilation: loses if the company is wiped out", () => {
    // The enemy is fastest, so it holds the turn while the company is down.
    const start = makeObjectiveBattle({ kind: "annihilation" }, [
      makeUnit(FAST, coord(1, 1), { stats: { ...BASE_STATS, spd: 10 } }),
      makeUnit(SLOW, coord(3, 2), { side: "enemy", stats: { ...BASE_STATS, spd: 30 } }),
    ]);
    expect(start.currentActorId).toBe(SLOW);

    const wiped = downed(start, FAST);
    const result = step(wiped, wait(wiped));
    expect(result.state.outcome).toBe("companyDefeat");
    expect(battleEndedEvents(result.events)).toHaveLength(1);
  });

  it("rout: breaks the enemy once enough soldiers are out of action", () => {
    const start = makeObjectiveBattle({ kind: "rout", defeated: 1 });
    const enemy = start.units.find((unit) => unit.side === "enemy") as Unit;

    const first = step(start, wait(start));
    expect(first.state.phase).toBe("active");
    expect(first.state.objective?.turnsElapsed).toBe(1);

    const broke = step(downed(first.state, enemy.id), wait(downed(first.state, enemy.id)));
    expect(broke.state.phase).toBe("finished");
    expect(broke.state.outcome).toBe("companyVictory");
    expect(broke.events.map((event) => event.kind)).toContain("battleEnded");
  });

  it("survive: wins when the mission clock reaches the required turns", () => {
    const start = makeObjectiveBattle({ kind: "survive", turns: 2 });

    const first = step(start, wait(start));
    expect(first.state.phase).toBe("active");
    expect(first.state.objective).toMatchObject({ turnsElapsed: 1 });

    const second = step(first.state, wait(first.state));
    expect(second.state.phase).toBe("finished");
    expect(second.state.outcome).toBe("companyVictory");
    expect(battleEndedEvents(second.events)).toHaveLength(1);
  });

  it("capture: seizes the point when a company soldier occupies it", () => {
    const start = makeObjectiveBattle({ kind: "capture", at: coord(3, 1) });
    const actor = start.currentActorId as UnitId;

    // A native move leaves the turn open (T115), so the objective is scored
    // only once the turn is closed with an explicit wait.
    const moved = step(start, {
      kind: "move",
      unitId: actor,
      path: [coord(1, 1), coord(2, 1), coord(3, 1)],
    });
    expect(moved.rejection).toBeUndefined();
    expect(moved.state.phase).toBe("active");
    expect(moved.state.hasMovedThisTurn).toBe(true);

    const result = step(moved.state, wait(moved.state));
    expect(result.state.phase).toBe("finished");
    expect(result.state.outcome).toBe("companyVictory");
    expect(result.events[result.events.length - 1]?.kind).toBe("battleEnded");
  });

  it("defend: holds the point for the required turns", () => {
    const start = makeObjectiveBattle({ kind: "defend", at: coord(1, 1), turns: 2 });

    const first = step(start, wait(start));
    expect(first.state.phase).toBe("active");
    expect(first.state.objective?.heldTurns).toBe(1);

    const second = step(first.state, wait(first.state));
    expect(second.state.phase).toBe("finished");
    expect(second.state.outcome).toBe("companyVictory");
  });

  it("defend: fails if the enemy takes the point", () => {
    const start = makeObjectiveBattle({ kind: "defend", at: coord(3, 2), turns: 3 });
    const result = step(start, wait(start));
    expect(result.state.phase).toBe("finished");
    expect(result.state.outcome).toBe("companyDefeat");
    expect(battleEndedEvents(result.events)).toHaveLength(1);
  });

  it("rejects every later command once the objective has ended the battle", () => {
    const start = makeObjectiveBattle({ kind: "survive", turns: 1 });
    const finished = step(start, wait(start)).state;
    expect(finished.phase).toBe("finished");

    const actor = finished.units[0].id;
    const result = step(finished, { kind: "wait", unitId: actor });
    expect(result.rejection?.reason).toBe("battle-over");
    expect(result.state).toBe(finished);
  });

  it("leaves a sandbox battle (no objective) running", () => {
    const start = createBattle(1815, { map: OBJECTIVE_MAP, units: objectiveRoster() });
    let state = start;
    for (let i = 0; i < 6 && state.currentActorId !== null; i++) {
      state = step(state, { kind: "wait", unitId: state.currentActorId }).state;
    }
    expect(state.objective).toBeNull();
    expect(state.phase).toBe("active");
  });

  it("rejects a malformed objective at creation", () => {
    const malformed = { kind: "rout", defeated: 0 } as unknown as Objective;
    expect(() => makeObjectiveBattle(malformed)).toThrow(BattleSetupError);
  });

  it("carries objective progress through a move made earlier in the state", () => {
    const start = makeObjectiveBattle({ kind: "capture", at: coord(2, 1) });
    const actor = start.currentActorId as UnitId;
    const moved: BattleState = {
      ...start,
      units: start.units.map((unit) =>
        unit.id === actor ? withPosition(unit, coord(2, 1)) : unit,
      ),
    };
    const result = step(moved, wait(moved));
    expect(result.state.outcome).toBe("companyVictory");
    expect(result.events.some((event) => event.kind === "battleEnded")).toBe(true);
  });
});
