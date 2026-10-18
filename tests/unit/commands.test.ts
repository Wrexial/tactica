import { describe, expect, it } from "vitest";

import { coord } from "../../src/engine/grid";
import {
  COMMAND_KINDS,
  CommandError,
  commandUnitId,
  deserializeCommand,
  isCommand,
  isCommandKind,
  isTarget,
  parseCommand,
  selfTarget,
  serializeCommand,
  tileTarget,
  unitTarget,
} from "../../src/engine/commands";
import type { Command } from "../../src/engine/commands";
import { asAbilityId, asGuardSortieId, asUnitId } from "../../src/engine/ids";

/* --------------------------------------------------------------------------
 * T020 — Command types
 *
 * These tests pin the task's "done when": every command is a discriminated
 * union, round-trips through JSON unchanged, and validates at a trust boundary
 * (`isCommand` / `parseCommand`). They also lock in the engine's purity rules:
 * commands are plain data with no engine state attached.
 * ------------------------------------------------------------------------ */

const HERO = asUnitId("unit-hero");
const FOE = asUnitId("unit-foe");
const RIFLE = asAbilityId("rifle-volley");
const OLD_GUARD = asGuardSortieId("old-guard");

/** One representative instance of every command kind. */
const EXAMPLES: readonly Command[] = [
  { kind: "move", unitId: HERO, path: [coord(0, 0), coord(1, 0), coord(1, 1)] },
  { kind: "act", unitId: HERO, abilityId: RIFLE, target: unitTarget(FOE) },
  { kind: "wait", unitId: HERO },
  { kind: "face", unitId: HERO, facing: "east" },
  { kind: "hold", unitId: HERO },
  { kind: "volley", unitId: HERO, abilityId: RIFLE, target: tileTarget(coord(4, 2)), honour: 3 },
  { kind: "guardSortie", unitId: HERO, guardSortieId: OLD_GUARD },
];

describe("Commands — shapes", () => {
  it("covers every declared command kind", () => {
    expect(EXAMPLES.map((command) => command.kind).sort()).toEqual([...COMMAND_KINDS].sort());
  });

  it("reads the actor from any command without narrowing", () => {
    for (const command of EXAMPLES) {
      expect(commandUnitId(command)).toBe(HERO);
    }
  });

  it("builds each target shape", () => {
    expect(selfTarget()).toEqual({ kind: "self" });
    expect(tileTarget(coord(2, 5))).toEqual({ kind: "tile", at: { x: 2, y: 5 } });
    expect(unitTarget(FOE)).toEqual({ kind: "unit", unitId: FOE });
  });

  it("copies coordinates so later mutation of the input cannot leak in", () => {
    const at = { x: 1, y: 2 };
    const target = tileTarget(at);
    at.x = 99;
    expect(target).toEqual({ kind: "tile", at: { x: 1, y: 2 } });
  });
});

describe("Commands — serialisability", () => {
  it.each(EXAMPLES)("round-trips a $kind command through JSON", (command) => {
    const restored = JSON.parse(JSON.stringify(command)) as Command;
    expect(restored).toEqual(command);
    expect(isCommand(restored)).toBe(true);
  });

  it("round-trips through serializeCommand / deserializeCommand", () => {
    for (const command of EXAMPLES) {
      const json = serializeCommand(command);
      expect(typeof json).toBe("string");
      expect(deserializeCommand(json)).toEqual(command);
    }
  });

  it("returns a detached clone from parseCommand", () => {
    const source = { kind: "move", unitId: HERO, path: [coord(0, 0), coord(2, 0)] } as const;
    const parsed = parseCommand(source);
    expect(parsed).toEqual(source);
    expect(parsed).not.toBe(source);
    if (parsed.kind === "move") {
      expect(parsed.path).not.toBe(source.path);
      expect(parsed.path[0]).not.toBe(source.path[0]);
    }
  });

  it("strips foreign fields during parse", () => {
    const parsed = parseCommand({
      kind: "wait",
      unitId: HERO,
      smuggled: "state",
    });
    expect(parsed).toEqual({ kind: "wait", unitId: HERO });
  });
});

describe("Commands — folded move clause (T124)", () => {
  const FOLDED: Command = {
    kind: "act",
    unitId: HERO,
    abilityId: RIFLE,
    target: selfTarget(),
    move: { to: coord(2, 1), order: "before" },
  };

  it("accepts and round-trips a folded act", () => {
    expect(isCommand(FOLDED)).toBe(true);
    expect(JSON.parse(JSON.stringify(FOLDED))).toEqual(FOLDED);
    expect(deserializeCommand(serializeCommand(FOLDED))).toEqual(FOLDED);
  });

  it("requires an explicit order and copies the destination", () => {
    expect(isCommand({ ...FOLDED, move: { to: coord(2, 1) } })).toBe(false);
    expect(isCommand({ ...FOLDED, move: { to: coord(2, 1), order: "sideways" } })).toBe(false);

    const to = { x: 2, y: 1 };
    const source: Command = {
      kind: "act",
      unitId: HERO,
      abilityId: RIFLE,
      target: selfTarget(),
      move: { to, order: "after" },
    };
    const parsed = parseCommand(source);
    to.x = 99;
    expect(parsed).toMatchObject({ move: { to: { x: 2, y: 1 }, order: "after" } });
  });

  it("strips foreign fields nested inside the clause", () => {
    const parsed = parseCommand({
      ...FOLDED,
      move: { to: coord(2, 1), order: "before", smuggled: true },
    });
    expect(parsed).toEqual(FOLDED);
  });
});

describe("Commands — validation", () => {
  it("accepts every example", () => {
    for (const command of EXAMPLES) {
      expect(isCommand(command)).toBe(true);
    }
  });

  it.each([
    null,
    undefined,
    42,
    "move",
    [],
    {},
    { kind: "move", unitId: HERO }, // missing path
    { kind: "move", unitId: HERO, path: [{ x: 0.5, y: 1 }] }, // fractional tile
    { kind: "act", unitId: HERO, abilityId: RIFLE }, // missing target
    { kind: "act", unitId: HERO, abilityId: RIFLE, target: { kind: "tile" } }, // bad tile
    { kind: "face", unitId: HERO, facing: "up" }, // not a cardinal facing
    { kind: "volley", unitId: HERO, abilityId: RIFLE, target: selfTarget(), honour: -1 },
    { kind: "volley", unitId: HERO, abilityId: RIFLE, target: selfTarget(), honour: 1.5 },
    { kind: "guardSortie", unitId: HERO }, // missing id
    { kind: "teleport", unitId: HERO }, // unknown kind
    { kind: "wait", unitId: "" }, // empty actor id
  ])("rejects malformed value %#", (value) => {
    expect(isCommand(value)).toBe(false);
    expect(() => parseCommand(value)).toThrow(CommandError);
  });

  it("describes the rejected label in the error", () => {
    expect(() => parseCommand({ kind: "wait", unitId: "" }, "replay[7]")).toThrow(/replay\[7\]/);
  });

  it("rejects unparseable JSON", () => {
    expect(() => deserializeCommand("{not json")).toThrow(CommandError);
  });

  it("validates targets independently", () => {
    expect(isTarget({ kind: "self" })).toBe(true);
    expect(isTarget({ kind: "unit", unitId: FOE })).toBe(true);
    expect(isTarget({ kind: "tile", at: coord(0, 0) })).toBe(true);
    expect(isTarget({ kind: "tile", at: { x: 0, y: "1" } })).toBe(false);
    expect(isTarget({ kind: "nope" })).toBe(false);
    expect(isTarget(null)).toBe(false);
  });

  it("guards command kinds", () => {
    for (const kind of COMMAND_KINDS) {
      expect(isCommandKind(kind)).toBe(true);
    }
    expect(isCommandKind("charge")).toBe(false);
    expect(isCommandKind(3)).toBe(false);
  });
});
