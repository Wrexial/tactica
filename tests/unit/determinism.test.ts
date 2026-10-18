import { describe, expect, it } from "vitest";

import { createBattle, step, type BattleSetup, type BattleState } from "../../src/engine/battle";
import type { Command } from "../../src/engine/commands";
import { coord } from "../../src/engine/grid";
import { asAbilityId, asPostId, asUnitId } from "../../src/engine/ids";
import {
  BattleReplayError,
  BattleSerializationError,
  canonicalStringify,
  deserializeBattleState,
  deserializeCommandLog,
  hashBattleState,
  hashString,
  hashValue,
  isBattleState,
  parseBattleState,
  replayBattle,
  serializeBattleState,
  serializeCommandLog,
  type BattleScript,
} from "../../src/engine/serialize";
import { createTerrainMap, withTile } from "../../src/engine/terrain";
import { createUnit, type Unit } from "../../src/engine/unit";
import type { StatBlock } from "../../src/data/schema";

/* --------------------------------------------------------------------------
 * T023 — State serialise + hash + determinism
 *
 * The task's "done when": a scripted battle replayed from a seed + command log
 * produces an identical state hash. These tests pin the three guarantees the
 * rest of the plan depends on:
 *   1. replay is deterministic (same seed + setup + commands ⇒ same hash);
 *   2. serialisation is canonical and lossless (round-trip preserves the hash);
 *   3. hashing is content-based, not key-order-based, so a rebuilt-but-equal
 *      state fingerprints identically.
 * Only `wait` is implemented in T022, so a "scripted battle" is a run of waits
 * that walks the Orders Tempo order; the machinery is command-kind agnostic and
 * will cover move/act logs unchanged once T024+ land.
 * ------------------------------------------------------------------------ */

const BASE_STATS: StatBlock = {
  hp: 60,
  mp: 20,
  atk: 12,
  def: 8,
  mag: 4,
  res: 6,
  spd: 12,
  move: 4,
  jump: 2,
};

/** A small battlefield with varied terrain so serialisation exercises tiles. */
const MAP = withTile(withTile(createTerrainMap(8, 6, "field"), coord(2, 2), "wood"), coord(5, 4), {
  terrain: "redoubt",
  height: 2,
});

function soldier(
  id: string,
  at: { x: number; y: number },
  overrides: Partial<StatBlock> = {},
): Unit {
  return createUnit({
    id: asUnitId(id),
    name: `Soldier ${id}`,
    power: "france",
    postId: asPostId("fusilier"),
    side: id.startsWith("enemy") ? "enemy" : "company",
    level: 1,
    at,
    stats: { ...BASE_STATS, ...overrides },
  });
}

/** A setup with two tied fast soldiers, a slower ally and an enemy. */
function makeSetup(): BattleSetup {
  return {
    map: MAP,
    units: [
      soldier("unit-a", coord(1, 1), { spd: 20 }),
      soldier("unit-b", coord(2, 1), { spd: 20 }),
      soldier("unit-c", coord(3, 1), { spd: 15 }),
      soldier("enemy-d", coord(6, 4), { spd: 12 }),
    ],
  };
}

/** A setup where every soldier ties, to force the stable id tie-break to matter. */
function tiedSetup(): BattleSetup {
  return {
    map: MAP,
    units: [
      soldier("unit-a", coord(1, 1), { spd: 20 }),
      soldier("unit-b", coord(2, 1), { spd: 20 }),
      soldier("unit-c", coord(3, 1), { spd: 20 }),
    ],
  };
}

/**
 * Run a battle forward, recording the acting soldier's `wait` at each turn.
 * The log is a fixed, seed-derived script that can be replayed exactly.
 */
function recordScript(seed: string, setup: BattleSetup, turns: number): BattleScript {
  let state = createBattle(seed, setup);
  const commands: Command[] = [];
  for (let i = 0; i < turns; i++) {
    const actor = state.currentActorId;
    if (actor === null) break;
    const command: Command = { kind: "wait", unitId: actor };
    commands.push(command);
    state = step(state, command).state;
  }
  return { seed, setup, commands };
}

/* --------------------------------------------------------------------------
 * Live action resolution (T117)
 *
 * An `act` now lands its effect through `step` (T041/T042/T043), so a replay of
 * a damaging command reduces HP identically every time.
 * ------------------------------------------------------------------------ */

describe("determinism — effects resolved through step", () => {
  const ACTOR = asUnitId("unit-a");
  const FOE = asUnitId("enemy-d");
  const BLADE = asAbilityId("scripted-blade");

  /** A scripted duel: a Speed-1 actor and a Speed-0 target with a Steel action. */
  function combatSetup(): BattleSetup {
    return {
      map: createTerrainMap(8, 6, "field"),
      units: [
        soldier("unit-a", coord(1, 1), { spd: 1 }),
        soldier("enemy-d", coord(3, 1), { spd: 0 }),
      ],
      abilities: [
        {
          id: BLADE,
          mpCost: 0,
          chargeTime: 0,
          range: 5,
          power: 100,
          target: "enemy",
          effects: [{ kind: "steel", power: 100 }],
        },
      ],
    };
  }

  const actCommand: Command = {
    kind: "act",
    unitId: ACTOR,
    abilityId: BLADE,
    target: { kind: "unit", unitId: FOE },
  };

  it("deals damage and replays byte-identically from the seed + log", () => {
    const script: BattleScript = {
      seed: "t117-combat",
      setup: combatSetup(),
      commands: [actCommand],
    };

    const first = step(createBattle(script.seed, script.setup), actCommand);
    expect(first.rejection).toBeUndefined();
    expect(first.events.some((event) => event.kind === "damaged")).toBe(true);
    // atk 12, foe def 8 → base 8, ×100/100.
    expect(first.state.units.find((unit) => unit.id === FOE)?.hp).toBe(52);

    const replayed = replayBattle(script);
    expect(hashBattleState(replayed)).toBe(hashBattleState(first.state));
    expect(hashBattleState(replayBattle(script))).toBe(hashBattleState(replayed));
    expect(hashBattleState(replayed)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("keeps a full effect exchange pure", () => {
    const state = createBattle("t117-purity", combatSetup());
    const before = JSON.stringify(state);

    step(state, actCommand);

    expect(JSON.stringify(state)).toBe(before);
  });
});

/* --------------------------------------------------------------------------
 * The headline guarantee
 * ------------------------------------------------------------------------ */

describe("determinism — replay from seed + command log", () => {
  it("produces an identical state hash for the same script", () => {
    const script = recordScript("austerlitz", makeSetup(), 12);
    expect(script.commands.length).toBeGreaterThan(0);

    const first = replayBattle(script);
    const second = replayBattle(script);

    expect(second).toEqual(first);
    expect(hashBattleState(second)).toBe(hashBattleState(first));
    expect(hashBattleState(first)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("actually advances the battle (the script is not a no-op)", () => {
    const script = recordScript("austerlitz", makeSetup(), 12);
    const start = createBattle(script.seed, script.setup);
    const end = replayBattle(script);

    expect(end.tempo.tick).toBeGreaterThan(start.tempo.tick);
    expect(end.started).toBe(true);
    expect(end).not.toEqual(start);
  });

  it("replays from a serialised, reparsed command log", () => {
    const script = recordScript("waterloo-1815", makeSetup(), 10);
    const json = serializeCommandLog(script.commands);
    const parsed = deserializeCommandLog(json);
    expect(parsed).toEqual(script.commands);

    const fromLog = replayBattle({ ...script, commands: parsed });
    const original = replayBattle(script);
    expect(hashBattleState(fromLog)).toBe(hashBattleState(original));
  });

  it("changes the hash when the command log changes", () => {
    const script = recordScript("austerlitz", makeSetup(), 9);
    const shortened: BattleScript = { ...script, commands: script.commands.slice(0, -1) };
    expect(shortened.commands.length).toBe(script.commands.length - 1);
    expect(hashBattleState(replayBattle(shortened))).not.toBe(
      hashBattleState(replayBattle(script)),
    );
  });

  it("breaks same-charge ties by a stable id order, independent of the seed", () => {
    const orderFor = (seed: string): string =>
      recordScript(seed, tiedSetup(), 9)
        .commands.map((command) => command.unitId)
        .join(",");
    const alpha = orderFor("alpha");
    expect(alpha).toBe(orderFor("beta"));
    expect(alpha).toBe(orderFor("gamma"));
    // unit-a < unit-b < unit-c lexicographically, so the tied cycle follows ids.
    expect(alpha.startsWith("unit-a,unit-b,unit-c")).toBe(true);
  });

  it("refuses a replay log whose commands the rules reject", () => {
    const script = recordScript("austerlitz", makeSetup(), 5);
    const ghost: Command = { kind: "wait", unitId: asUnitId("unit-ghost") };
    const bad: BattleScript = { ...script, commands: [ghost, ...script.commands] };

    let caught: unknown;
    try {
      replayBattle(bad);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BattleReplayError);
    expect((caught as BattleReplayError).commandIndex).toBe(0);
    expect((caught as BattleReplayError).rejection.reason).toBe("unknown-unit");
  });

  it("does not mutate the authored setup while replaying", () => {
    const script = recordScript("austerlitz", makeSetup(), 6);
    const before = JSON.stringify(script.setup);
    replayBattle(script);
    expect(JSON.stringify(script.setup)).toBe(before);
  });
});

/* --------------------------------------------------------------------------
 * Canonical serialisation and round-tripping
 * ------------------------------------------------------------------------ */

describe("serialize — canonical and lossless", () => {
  it("sorts object keys recursively", () => {
    expect(canonicalStringify({ b: 2, a: 1 })).toBe('{"a":1,"b":2}');
    expect(canonicalStringify({ z: { d: 4, c: 3 }, a: 1 })).toBe('{"a":1,"z":{"c":3,"d":4}}');
    expect(canonicalStringify([{ b: 1, a: 2 }])).toBe('[{"a":2,"b":1}]');
  });

  it("omits undefined properties like JSON.stringify", () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe('{"a":1}');
  });

  it("throws on non-finite numbers and cycles", () => {
    expect(() => canonicalStringify({ a: Number.NaN })).toThrow(BattleSerializationError);
    expect(() => canonicalStringify({ a: Number.POSITIVE_INFINITY })).toThrow(
      BattleSerializationError,
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cyclic: any = {};
    cyclic.self = cyclic;
    expect(() => canonicalStringify(cyclic)).toThrow(BattleSerializationError);
  });

  it("round-trips a replayed battle and preserves its hash", () => {
    const state = replayBattle(recordScript("quatre-bras", makeSetup(), 11));
    const json = serializeBattleState(state);
    const restored = deserializeBattleState(json);

    expect(isBattleState(restored)).toBe(true);
    expect(restored).toEqual(state);
    expect(hashBattleState(restored)).toBe(hashBattleState(state));
    // Canonical: re-serialising the restored state yields the same text.
    expect(serializeBattleState(restored)).toBe(json);
  });

  it("is deterministic string-for-string across separate replays", () => {
    const script = recordScript("borodino", makeSetup(), 9);
    expect(serializeBattleState(replayBattle(script))).toBe(
      serializeBattleState(replayBattle(script)),
    );
  });
});

/* --------------------------------------------------------------------------
 * Hashing is content-based
 * ------------------------------------------------------------------------ */

describe("hash — content, not key order", () => {
  it("ignores object key order", () => {
    expect(hashValue({ a: 1, b: [2, { d: 4, c: 3 }] })).toBe(
      hashValue({ b: [2, { c: 3, d: 4 }], a: 1 }),
    );
  });

  it("separates different content", () => {
    expect(hashString("lines-of-glory")).not.toBe(hashString("lines-of-glory "));
    expect(hashValue({ a: 1 })).not.toBe(hashValue({ a: 2 }));
  });

  it("is a stable 16-character hex digest", () => {
    const digest = hashString("lines-of-glory");
    expect(digest).toMatch(/^[0-9a-f]{16}$/);
    expect(hashString("lines-of-glory")).toBe(digest);
  });
});

/* --------------------------------------------------------------------------
 * Trust boundary
 * ------------------------------------------------------------------------ */

describe("deserialize — rejects malformed input", () => {
  it("rejects unparseable JSON and non-states", () => {
    expect(() => deserializeBattleState("not json")).toThrow(BattleSerializationError);
    expect(() => deserializeBattleState('{"seed":1}')).toThrow(BattleSerializationError);
    expect(() => parseBattleState(null)).toThrow(BattleSerializationError);
    expect(() => parseBattleState([])).toThrow(BattleSerializationError);
  });

  it("rejects a battle whose soldiers were emptied", () => {
    const state = replayBattle(recordScript("austerlitz", makeSetup(), 4));
    expect(isBattleState({ ...state, units: [] })).toBe(false);
    expect(isBattleState({ ...state, phase: "paused" })).toBe(false);
  });

  it("rejects a soldier with out-of-range resources", () => {
    const state = replayBattle(recordScript("austerlitz", makeSetup(), 4));
    const tampered: BattleState = {
      ...state,
      units: state.units.map((unit) =>
        unit.id === state.units[0].id ? { ...unit, hp: unit.stats.hp + 1 } : unit,
      ),
    };
    expect(isBattleState(tampered)).toBe(false);
  });

  it("rejects a command log that is not an array", () => {
    expect(() => deserializeCommandLog('{"kind":"wait"}')).toThrow(BattleSerializationError);
    expect(() => deserializeCommandLog("not json")).toThrow(BattleSerializationError);
  });
});
