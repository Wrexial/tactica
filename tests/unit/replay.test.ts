import { describe, expect, it } from "vitest";

import type { StatBlock } from "../../src/data/schema";
import { BARRACKS_CAPACITY, createCaptive, createIrregularDef } from "../../src/engine/barracks";
import { createBattle, step, type BattleSetup, type BattleState } from "../../src/engine/battle";
import type { Command } from "../../src/engine/commands";
import { coord } from "../../src/engine/grid";
import {
  asCompanyId,
  asEnemyId,
  asEquipmentId,
  asPostId,
  asUnitId,
  type UnitId,
} from "../../src/engine/ids";
import { hashBattleState } from "../../src/engine/serialize";
import { createTerrainMap } from "../../src/engine/terrain";
import { createUnit, type Unit } from "../../src/engine/unit";
import {
  BattleSpectator,
  ReplayError,
  ReplayRecorder,
  TradeError,
  canTrade,
  createTradeAgreement,
  createTradeRequest,
  createTradeSide,
  parseReplay,
  replayFinalState,
  resolveTrade,
  serializeReplay,
  tradeBlockers,
  tradeSideKitCount,
  tradeSidePrisonerCount,
  type ReplayParticipant,
} from "../../src/net/replay";

/* --------------------------------------------------------------------------
 * T114 — Replays, trading & spectator
 *
 * The task's "done when": replay a battle from seed + command log; trade kit
 * and prisoners. These tests pin:
 *   1. a recorded seed + setup + command log replays to the exact final state;
 *   2. a replay round-trips through text and a spectator can scrub it exactly;
 *   3. a malformed/degenerate replay is refused at the boundary;
 *   4. kit and prisoners move between two companies, immutably, with the
 *      expected blockers.
 * ------------------------------------------------------------------------ */

const SEED = "wagram-1809";

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

const MAP = createTerrainMap(6, 4, "field");

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

/** An open field with one fast company soldier and one slow enemy. */
function makeSetup(): BattleSetup {
  return {
    map: MAP,
    units: [
      soldier("unit-a", coord(2, 2), { spd: 20 }),
      soldier("enemy-b", coord(4, 2), { spd: 5 }),
    ],
  };
}

const PARTICIPANTS: readonly ReplayParticipant[] = [
  { peer: 0, companyId: asCompanyId("greycoats"), name: "The Greycoats" },
  { peer: 1, companyId: asCompanyId("red-roses"), name: "The Red Roses" },
];

/** Which peer commands each deployed soldier. */
const OWNER: Readonly<Record<string, number>> = { "unit-a": 0, "enemy-b": 1 };

/** Record a deterministic run of `wait`s, one frame per turn. */
function buildReplay(turns = 6): {
  replay: ReturnType<ReplayRecorder["finish"]>;
  commands: Command[];
} {
  const setup = makeSetup();
  const recorder = new ReplayRecorder({
    matchId: "skirmish-1",
    seed: SEED,
    setup,
    participants: PARTICIPANTS,
  });

  let state: BattleState = createBattle(SEED, setup);
  const commands: Command[] = [];
  for (let i = 0; i < turns; i++) {
    const actor = state.currentActorId;
    if (actor === null) break;
    const command: Command = { kind: "wait", unitId: actor };
    const byPeer = new Map<number, readonly Command[]>([
      [0, []],
      [1, []],
    ]);
    byPeer.set(OWNER[actor] ?? 0, [command]);
    recorder.recordFrame(byPeer);
    state = step(state, command).state;
    commands.push(command);
  }
  return { replay: recorder.finish(), commands };
}

/** Apply a flat command list to a fresh battle (the reference simulation). */
function simulate(commands: readonly Command[]): BattleState {
  let state = createBattle(SEED, makeSetup());
  for (const command of commands) state = step(state, command).state;
  return state;
}

/* --------------------------------------------------------------------------
 * Replay
 * ------------------------------------------------------------------------ */

describe("replay — seed + command log", () => {
  it("replays to the exact reference final state", () => {
    const { replay, commands } = buildReplay(6);
    expect(commands.length).toBeGreaterThan(0);
    expect(replay.version).toBe(1);
    expect(replay.frames).toHaveLength(commands.length);

    const expected = simulate(commands);
    const replayed = replayFinalState(replay);
    expect(replayed).toEqual(expected);
    expect(hashBattleState(replayed)).toBe(hashBattleState(expected));
  });

  it("round-trips through text and preserves the final state", () => {
    const { replay, commands } = buildReplay(6);
    const text = serializeReplay(replay);
    const parsed = parseReplay(text);
    expect(parsed).toEqual(replay);
    expect(replayFinalState(parsed)).toEqual(simulate(commands));
  });

  it("records commands in canonical peer order", () => {
    const setup = makeSetup();
    const actor = createBattle(SEED, setup).currentActorId as UnitId;
    const move: Command = {
      kind: "move",
      unitId: actor,
      path: [
        { x: 2, y: 2 },
        { x: 3, y: 2 },
      ],
    };
    const wait: Command = { kind: "wait", unitId: actor };

    const recorder = new ReplayRecorder({
      matchId: "skirmish-1",
      seed: SEED,
      setup,
      participants: PARTICIPANTS,
    });
    // Peer 1 reports first here, but the frame must be stored peer-ascending.
    recorder.recordFrame(
      new Map([
        [1, [wait]],
        [0, [move]],
      ]),
    );
    const replay = recorder.finish();
    expect(replay.frames[0]?.commands.map((entry) => entry.peer)).toEqual([0, 1]);

    // Replaying applies peer 0's move, then peer 1's wait (which closes the
    // turn). Had the order been reversed (wait then move) the move would be
    // refused as out of turn, so a clean replay proves the ordering.
    const afterMove = step(createBattle(SEED, setup), move).state;
    expect(replayFinalState(replay)).toEqual(step(afterMove, wait).state);
  });

  it("refuses malformed or degenerate replays at the boundary", () => {
    const { replay } = buildReplay(4);
    expect(() => parseReplay("{")).toThrow(ReplayError);

    const wrongVersion = JSON.parse(serializeReplay(replay)) as Record<string, unknown>;
    wrongVersion.version = 99;
    expect(() => parseReplay(JSON.stringify(wrongVersion))).toThrow(ReplayError);

    const badCommand = JSON.parse(serializeReplay(replay)) as {
      frames: { commands: { command: unknown }[] }[];
    };
    (badCommand.frames[0] as { commands: { command: unknown }[] }).commands[0].command = {
      kind: "wait",
    };
    expect(() => parseReplay(JSON.stringify(badCommand))).toThrow();

    const badPeer = JSON.parse(serializeReplay(replay)) as {
      frames: { commands: { peer: number; command: Command }[] }[];
    };
    (badPeer.frames[0] as { commands: { peer: number; command: Command }[] }).commands.push({
      peer: 9,
      command: { kind: "wait", unitId: asUnitId("unit-a") },
    });
    expect(() => parseReplay(JSON.stringify(badPeer))).toThrow(ReplayError);
  });
});

describe("spectator", () => {
  it("walks the log one command at a time and seeks exactly", () => {
    const { replay, commands } = buildReplay(6);
    const spectator = new BattleSpectator(replay);

    expect(spectator.total).toBe(commands.length);
    expect(spectator.cursor).toBe(0);
    expect(spectator.frameIndex).toBe(0);
    expect(spectator.hash).toBe(hashBattleState(createBattle(SEED, makeSetup())));

    while (!spectator.finished) spectator.step();
    expect(spectator.cursor).toBe(commands.length);
    expect(spectator.frameIndex).toBe(replay.frames.length);
    expect(spectator.state).toEqual(simulate(commands));

    spectator.seek(0);
    expect(spectator.cursor).toBe(0);
    expect(spectator.finished).toBe(false);
    expect(spectator.state).toEqual(createBattle(SEED, makeSetup()));

    spectator.seek(commands.length);
    expect(spectator.state).toEqual(simulate(commands));
    expect(spectator.hash).toBe(hashBattleState(simulate(commands)));

    expect(() => spectator.seek(-1)).toThrow(ReplayError);
    expect(() => spectator.seek(commands.length + 1)).toThrow(ReplayError);
  });

  it("steps a whole frame at once", () => {
    const { replay, commands } = buildReplay(2);
    const spectator = new BattleSpectator(replay);
    const events = spectator.stepFrame();
    expect(Array.isArray(events)).toBe(true);
    // Frame 0 had exactly one command, so one command is consumed.
    expect(spectator.cursor).toBe(Math.min(1, commands.length));
  });
});

/* --------------------------------------------------------------------------
 * Trading — kit & prisoners
 * ------------------------------------------------------------------------ */

const BAND = createIrregularDef({
  id: asEnemyId("river-guerrillas"),
  name: "River Guerrillas",
  level: 1,
  stats: { ...BASE_STATS },
  capturable: true,
});

function captive(id: string) {
  return createCaptive({ id: asUnitId(id), irregular: BAND, capturedOnDay: 1 });
}

describe("trading — kit & prisoners", () => {
  it("moves kit and prisoners between two companies", () => {
    const left = createTradeSide({
      peer: 0,
      inventory: { "cavalry-sabre": 2, "line-uniform": 1 },
      barracks: { captives: [captive("prisoner-a")] },
    });
    const right = createTradeSide({
      peer: 1,
      inventory: { "cavalry-sabre": 1, "water-canteen": 3 },
      barracks: { captives: [captive("prisoner-b")] },
    });

    const agreement = createTradeAgreement({
      left: 0,
      right: 1,
      leftGives: { kit: [{ itemId: "cavalry-sabre", count: 1 }], prisoners: ["prisoner-a"] },
      rightGives: { kit: [{ itemId: "water-canteen", count: 2 }] },
    });

    expect(canTrade(left, right, agreement)).toBe(true);
    const result = resolveTrade(left, right, agreement);

    expect(tradeSideKitCount(result.left, asEquipmentId("cavalry-sabre"))).toBe(1);
    expect(tradeSideKitCount(result.left, asEquipmentId("water-canteen"))).toBe(2);
    expect(tradeSideKitCount(result.right, asEquipmentId("cavalry-sabre"))).toBe(2);
    expect(tradeSideKitCount(result.right, asEquipmentId("water-canteen"))).toBe(1);
    expect(result.left.barracks.captives.map((c) => c.id)).toEqual([]);
    expect(result.right.barracks.captives.map((c) => c.id)).toEqual(["prisoner-b", "prisoner-a"]);
    expect(result.movedKit).toBe(3);
    expect(result.movedPrisoners).toBe(1);
    expect(tradeSidePrisonerCount(result.right)).toBe(2);

    // Inputs are untouched.
    expect(tradeSideKitCount(left, asEquipmentId("cavalry-sabre"))).toBe(2);
    expect(left.barracks.captives.map((c) => c.id)).toEqual(["prisoner-a"]);
    expect(tradeSideKitCount(right, asEquipmentId("water-canteen"))).toBe(3);
  });

  it("reports every blocker instead of applying a bad trade", () => {
    const left = createTradeSide({
      peer: 0,
      inventory: { "cavalry-sabre": 1 },
      barracks: { captives: [captive("prisoner-a")] },
    });
    const right = createTradeSide({
      peer: 1,
      inventory: {},
      barracks: { captives: [captive("prisoner-b")] },
    });

    const selfTrade = createTradeAgreement({
      left: 0,
      right: 0,
      leftGives: { kit: [{ itemId: "cavalry-sabre", count: 1 }] },
    });
    expect(tradeBlockers(left, left, selfTrade)).toContain("self-trade");

    const empty = createTradeAgreement({ left: 0, right: 1 });
    expect(tradeBlockers(left, right, empty)).toContain("empty-trade");

    const missingKit = createTradeAgreement({
      left: 0,
      right: 1,
      leftGives: { kit: [{ itemId: "cavalry-sabre", count: 5 }] },
    });
    expect(tradeBlockers(left, right, missingKit)).toContain("missing-kit");

    const missingPrisoner = createTradeAgreement({
      left: 0,
      right: 1,
      leftGives: { prisoners: ["prisoner-ghost"] },
    });
    expect(tradeBlockers(left, right, missingPrisoner)).toContain("missing-prisoner");

    const wrongPeer = createTradeAgreement({
      left: 5,
      right: 6,
      leftGives: { kit: [{ itemId: "cavalry-sabre", count: 1 }] },
    });
    expect(tradeBlockers(left, right, wrongPeer)).toContain("wrong-peer");

    expect(() => resolveTrade(left, right, missingKit)).toThrow(RangeError);
  });

  it("blocks an overfull receiving pen and a prisoner id collision", () => {
    const giver = createTradeSide({
      peer: 0,
      inventory: { "cavalry-sabre": 1 },
      barracks: { captives: [captive("prisoner-a")] },
    });
    const fullPen = createTradeSide({
      peer: 1,
      inventory: {},
      barracks: {
        captives: Array.from({ length: BARRACKS_CAPACITY }, (_, index) => captive(`full-${index}`)),
      },
    });
    const overflow = createTradeAgreement({
      left: 0,
      right: 1,
      leftGives: { prisoners: ["prisoner-a"] },
    });
    expect(tradeBlockers(giver, fullPen, overflow)).toContain("receiver-pen-full");

    const sharedLeft = createTradeSide({
      peer: 0,
      inventory: { "cavalry-sabre": 1 },
      barracks: { captives: [captive("prisoner-x")] },
    });
    const sharedRight = createTradeSide({
      peer: 1,
      inventory: {},
      barracks: { captives: [captive("prisoner-x")] },
    });
    const collision = createTradeAgreement({
      left: 0,
      right: 1,
      leftGives: { kit: [{ itemId: "cavalry-sabre", count: 1 }] },
      rightGives: { prisoners: ["prisoner-x"] },
    });
    expect(tradeBlockers(sharedLeft, sharedRight, collision)).toContain("prisoner-conflict");
  });

  it("validates requests at the boundary", () => {
    expect(() =>
      createTradeRequest({
        kit: [
          { itemId: "cavalry-sabre", count: 1 },
          { itemId: "cavalry-sabre", count: 2 },
        ],
      }),
    ).toThrow(TradeError);
    expect(() => createTradeRequest({ kit: [{ itemId: "not-real", count: 1 }] })).toThrow(
      TradeError,
    );
    expect(() => createTradeRequest({ kit: [{ itemId: "cavalry-sabre", count: 0 }] })).toThrow(
      TradeError,
    );
    expect(() => createTradeRequest({ prisoners: ["p", "p"] })).toThrow(TradeError);
  });
});
