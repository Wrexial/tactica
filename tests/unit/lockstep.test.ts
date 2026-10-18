import { describe, expect, it } from "vitest";

import { createBattle, step, type BattleSetup, type BattleState } from "../../src/engine/battle";
import type { Command } from "../../src/engine/commands";
import { coord } from "../../src/engine/grid";
import { asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import { hashBattleState } from "../../src/engine/serialize";
import { createTerrainMap } from "../../src/engine/terrain";
import { createUnit, type Unit } from "../../src/engine/unit";
import type { StatBlock } from "../../src/data/schema";
import {
  LockstepDesyncError,
  LockstepError,
  LockstepSession,
  type HashReport,
} from "../../src/net/lockstep";

/* --------------------------------------------------------------------------
 * T112 — Lockstep netcode
 *
 * The task's "done when": a deterministic command-log lockstep with state-hash
 * desync detection. These tests pin:
 *   1. two independent sessions fed the same commands — in any network arrival
 *      order — produce identical battles and frame hashes;
 *   2. frames apply commands in a canonical (peer-ascending) order;
 *   3. a session refuses to resolve until every peer has reported;
 *   4. differing simulations are caught by comparing frame hashes.
 * ------------------------------------------------------------------------ */

const SEED = "austerlitz-1805";

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

function makeSession(
  localPeer: 0 | 1,
  setup: BattleSetup = makeSetup(),
  peers: readonly (0 | 1)[] = [0, 1],
): LockstepSession {
  return new LockstepSession({ seed: SEED, setup, peers, localPeer });
}

/** The current actor's `wait`, or `null` once nobody can act. */
function waitForCurrentActor(state: BattleState): Command | null {
  const actor = state.currentActorId;
  return actor === null ? null : { kind: "wait", unitId: actor };
}

/** Record a deterministic run of waits, one frame each, from a reference sim. */
function recordWaits(setup: BattleSetup, turns: number): Command[] {
  let state = createBattle(SEED, setup);
  const commands: Command[] = [];
  for (let i = 0; i < turns; i++) {
    const command = waitForCurrentActor(state);
    if (command === null) break;
    commands.push(command);
    state = step(state, command).state;
  }
  return commands;
}

/* --------------------------------------------------------------------------
 * Initial state
 * ------------------------------------------------------------------------ */

describe("LockstepSession — initial state", () => {
  it("mirrors the single-player battle and its initial hash", () => {
    const setup = makeSetup();
    const session = makeSession(0);

    const expected = createBattle(SEED, setup);
    expect(session.state).toEqual(expected);
    expect(session.initialHash).toBe(hashBattleState(expected));
    expect(session.latestHash()).toBe(session.initialHash);
    expect(session.frame).toBe(0);
    expect(session.frames).toHaveLength(0);
    expect(session.latestFrame()).toBeUndefined();
  });

  it("validates the peer set", () => {
    const setup = makeSetup();
    expect(() => new LockstepSession({ seed: SEED, setup, peers: [], localPeer: 0 })).toThrow(
      LockstepError,
    );
    expect(() => new LockstepSession({ seed: SEED, setup, peers: [0, 0], localPeer: 0 })).toThrow(
      LockstepError,
    );
    expect(() => new LockstepSession({ seed: SEED, setup, peers: [0, 1], localPeer: 2 })).toThrow(
      LockstepError,
    );
  });
});

/* --------------------------------------------------------------------------
 * Frame readiness
 * ------------------------------------------------------------------------ */

describe("LockstepSession — frame readiness", () => {
  it("waits for every peer before resolving", () => {
    const session = makeSession(0);
    expect(session.isReady()).toBe(false);
    expect(session.pendingPeers()).toEqual([0, 1]);

    session.submit();
    expect(session.isReady()).toBe(false);
    expect(session.pendingPeers()).toEqual([1]);
    expect(() => session.resolve()).toThrow(LockstepError);

    session.receive(1);
    expect(session.isReady()).toBe(true);
    expect(session.pendingPeers()).toEqual([]);

    const frame = session.resolve();
    expect(frame.index).toBe(0);
    expect(frame.commands).toHaveLength(0);
    expect(frame.events).toHaveLength(0);
    expect(frame.rejections).toHaveLength(0);
    expect(frame.hash).toBe(hashBattleState(frame.state));
    expect(session.frame).toBe(1);
    expect(session.hashAt(0)).toBe(frame.hash);
    expect(session.latestHash()).toBe(frame.hash);
  });

  it("allows `pass()` as an empty submission", () => {
    const session = makeSession(0);
    session.pass();
    session.receive(1);
    expect(session.resolve().commands).toHaveLength(0);
  });

  it("rejects double submission, unknown peers and malformed commands", () => {
    const session = makeSession(0);
    session.pass();
    expect(() => session.pass()).toThrow(LockstepError);
    expect(() => session.receive(9)).toThrow(LockstepError);
    expect(() => session.receive(0)).toThrow(LockstepError);

    const other = makeSession(0);
    expect(() => other.submit({ kind: "wait" } as unknown as Command)).toThrow(LockstepError);
  });
});

/* --------------------------------------------------------------------------
 * Deterministic agreement
 * ------------------------------------------------------------------------ */

describe("LockstepSession — deterministic agreement", () => {
  it("matches hashes across two sessions regardless of arrival order", () => {
    const setup = makeSetup();
    const commands = recordWaits(setup, 8);
    expect(commands.length).toBeGreaterThan(0);

    const keystone = makeSession(0, setup);
    const ally = makeSession(1, setup);
    expect(keystone.initialHash).toBe(ally.initialHash);

    for (const command of commands) {
      // Keystone receives its own command then the ally's empty report.
      keystone.submit(command);
      keystone.receive(1);
      const keystoneFrame = keystone.resolve();

      // Ally receives the report first, then submits its own.
      ally.receive(0, command);
      ally.pass();
      const allyFrame = ally.resolve();

      expect(allyFrame.hash).toBe(keystoneFrame.hash);
      expect(allyFrame.state).toEqual(keystoneFrame.state);
    }

    expect(keystone.state).toEqual(ally.state);
    expect(hashBattleState(keystone.state)).toBe(keystone.latestHash());
    expect(ally.latestHash()).toBe(keystone.latestHash());
  });

  it("applies same-frame commands in canonical peer order", () => {
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

    // Peer 0 marches (keeps the turn open), peer 1 then closes it with wait.
    const keystone = makeSession(0, setup);
    keystone.submit(move);
    keystone.receive(1, wait);
    const first = keystone.resolve();

    // The mirror session supplies the same two commands in the other order.
    const ally = makeSession(1, setup);
    ally.receive(0, move);
    ally.submit(wait);
    const second = ally.resolve();

    expect(first.commands.map((entry) => entry.peer)).toEqual([0, 1]);
    expect(first.rejections).toHaveLength(0);
    expect(first.events.some((event) => event.kind === "moved")).toBe(true);
    expect(first.hash).toBe(second.hash);

    const moved = first.state.units.find((unit) => unit.id === actor);
    expect(moved?.at).toEqual({ x: 3, y: 2 });
  });

  it("records rule rejections instead of throwing, and keeps stepping", () => {
    const setup = makeSetup();
    const actor = createBattle(SEED, setup).currentActorId as UnitId;
    const ghost: Command = { kind: "wait", unitId: asUnitId("unit-ghost") };
    const real: Command = { kind: "wait", unitId: actor };

    // The ghost command is applied first (peer 0) and refused; the real wait
    // (peer 1) still resolves and ends the turn.
    const session = makeSession(0, setup, [0, 1]);
    session.submit(ghost);
    session.receive(1, real);
    const frame = session.resolve();

    expect(frame.rejections).toHaveLength(1);
    expect(frame.rejections[0].command.peer).toBe(0);
    expect(frame.rejections[0].rejection.reason).toBe("unknown-unit");
    expect(frame.events.some((event) => event.kind === "turnEnded")).toBe(true);
  });
});

/* --------------------------------------------------------------------------
 * Desync detection
 * ------------------------------------------------------------------------ */

describe("LockstepSession — desync detection", () => {
  it("agrees on matching reports", () => {
    const setup = makeSetup();
    const keystone = makeSession(0, setup);
    const ally = makeSession(1, setup);
    const command = waitForCurrentActor(keystone.state);
    expect(command).not.toBeNull();

    keystone.submit(command as Command);
    keystone.receive(1);
    keystone.resolve();

    ally.receive(0, command as Command);
    ally.pass();
    ally.resolve();

    const report = ally.localReport(0);
    expect(keystone.compareHash(report)).toBeNull();
    expect(() => keystone.verifyHash(report)).not.toThrow();
  });

  it("flags a mismatched frame hash as a desync", () => {
    const setup = makeSetup();
    const keystone = makeSession(0, setup);
    const ally = makeSession(1, setup);
    const actor = keystone.state.currentActorId as UnitId;
    const wait: Command = { kind: "wait", unitId: actor };

    keystone.submit(wait);
    keystone.receive(1);
    const local = keystone.resolve();

    // The ally simulated a different order (a march plus the wait), so its
    // battle diverges immediately.
    ally.receive(0);
    ally.submit(
      {
        kind: "move",
        unitId: actor,
        path: [
          { x: 2, y: 2 },
          { x: 3, y: 2 },
        ],
      },
      wait,
    );
    const remote = ally.resolve();

    expect(local.hash).not.toBe(remote.hash);

    const report = ally.localReport(0);
    const desync = keystone.compareHash(report);
    expect(desync).toEqual({
      frame: 0,
      localHash: local.hash,
      remoteHash: remote.hash,
      remotePeer: 1,
    });
    expect(() => keystone.verifyHash(report)).toThrow(LockstepDesyncError);
  });

  it("refuses to compare hashes for frames it has not resolved", () => {
    const session = makeSession(0);
    expect(session.hashAt(0)).toBeUndefined();
    const report: HashReport = { peer: 1, frame: 0, hash: "0".repeat(16) };
    expect(() => session.compareHash(report)).toThrow(LockstepError);
    expect(() => session.localReport(3)).toThrow(LockstepError);
  });

  it("defaults localReport() to the latest resolved frame", () => {
    const setup = makeSetup();
    const session = makeSession(0, setup);
    const commands = recordWaits(setup, 2);
    for (const command of commands) {
      session.submit(command);
      session.receive(1);
      session.resolve();
    }
    const report = session.localReport();
    expect(report.frame).toBe(commands.length - 1);
    expect(report.hash).toBe(session.latestHash());
    expect(report.peer).toBe(0);
  });
});
