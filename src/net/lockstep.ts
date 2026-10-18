/**
 * Lockstep netcode (T112) — deterministic command log + state-hash desync
 * detection.
 *
 * Tactica's whole engine is built so that a battle is fully described by an
 * **initial state plus an ordered list of commands** (`agents.md` §2, §7). That
 * makes online play a solved problem of *agreement* rather than state transfer:
 * every peer holds the same seed/setup, broadcasts the commands it issues, and
 * applies **every** peer's commands in the same deterministic order. If the
 * simulations stay in step, no battle state ever crosses the wire — only small
 * command messages do (mapping §12, decision D15).
 *
 * This module owns the two halves of that contract:
 *
 * 1. **Frame-based command log.** A {@link LockstepSession} collects the
 *    commands each peer issues for the current *frame* (a lockstep tick). Once
 *    every peer has reported — including peers with nothing to say — the frame
 *    is {@link LockstepSession.resolve | resolved} by applying commands in a
 *    canonical order (`peer` ascending, then submission order within a peer)
 *    through the pure {@link step} function.
 * 2. **State-hash desync detection.** After each frame the session fingerprints
 *    its battle with `hashBattleState` (`src/engine/serialize.ts`). Peers
 *    exchange these {@link HashReport}s, and a mismatch is surfaced as a
 *    {@link LockstepDesyncError}. The hash is content-based, so a single
 *    diverging die roll, tie-break or rule branch is caught immediately rather
 *    than silently desyncing the match.
 *
 * Design notes:
 * - This layer is **not** part of `src/engine/`; it may hold mutable session
 *   state and is the natural home for transport concerns. It still contains no
 *   `Math.random` and no wall-clock reads: frames advance only when the caller
 *   resolves them, so a session is as reproducible as the engine beneath it.
 * - Commands are still *the only* mutation path (they are fed straight to
 *   `step`). A rejected command does not throw here; it is recorded on the
 *   {@link LockstepFrame} so both peers can compare notes. In a correct match
 *   the same command is rejected identically everywhere and the hashes agree.
 * - The transport (WebSocket/WebRTC/loopback) is deliberately out of scope:
 *   callers hand this module `submit` (local) and `receive` (remote) and read
 *   `resolve`/`verifyHash`. {@link LockstepConfig.peers} lists participants in
 *   the canonical application order.
 *
 * Reference: `docs/wiki/pages/Battle_system.md` for deterministic battle steps;
 * fiction follows `docs/NAPOLEONIC_MAPPING.md` (a free company skirmish).
 */

import {
  createBattle,
  step,
  type BattleRejection,
  type BattleSetup,
  type BattleState,
} from "../engine/battle";
import { isCommand, type Command } from "../engine/commands";
import type { BattleEvent } from "../engine/events";
import type { Seed } from "../engine/rng";
import { hashBattleState } from "../engine/serialize";

/* --------------------------------------------------------------------------
 * Identifiers, hashes and wire values
 * ------------------------------------------------------------------------ */

/** Stable identifier for one participant in a lockstep match (a non-negative integer). */
export type PeerId = number;

/** A battle fingerprint produced by `hashBattleState` (16 hex characters). */
export type StateHash = string;

/**
 * A command attributed to the peer that issued it and the frame it belongs to.
 * This is the unit of the lockstep log: it is plain, JSON-safe data (the
 * {@link Command} already is), so it can be sent over the network, stored and
 * replayed verbatim.
 */
export interface LockstepCommand {
  /** The lockstep frame this command was issued in. */
  readonly frame: number;
  /** The peer that issued it. */
  readonly peer: PeerId;
  /** The serialisable battle order itself. */
  readonly command: Command;
}

/**
 * A command the engine refused while resolving a frame. Recorded (rather than
 * thrown) so a session can keep stepping and so both peers can compare the same
 * rejection instead of crashing on a stray packet.
 */
export interface LockstepRejection {
  /** The tagged command that was refused. */
  readonly command: LockstepCommand;
  /** Why the battle layer refused it; see {@link BattleRejection}. */
  readonly rejection: BattleRejection;
}

/**
 * The outcome of resolving one lockstep frame: the commands applied (in
 * canonical order), the events they produced, the resulting battle and its
 * fingerprint.
 */
export interface LockstepFrame {
  /** Zero-based frame index. */
  readonly index: number;
  /** Every peer's commands for this frame, in application order. */
  readonly commands: readonly LockstepCommand[];
  /** Engine events in resolution order (empty for an empty frame). */
  readonly events: readonly BattleEvent[];
  /** Commands the rules refused, in application order. */
  readonly rejections: readonly LockstepRejection[];
  /** The battle after the frame. */
  readonly state: BattleState;
  /** Fingerprint of {@link state}; compare across peers to detect desync. */
  readonly hash: StateHash;
}

/**
 * One peer's post-frame fingerprint, exchanged over the transport so everyone
 * can agree the simulations match. `frame` must name a resolved frame.
 */
export interface HashReport {
  /** The peer that computed the hash. */
  readonly peer: PeerId;
  /** The frame the hash belongs to. */
  readonly frame: number;
  /** The reported fingerprint. */
  readonly hash: StateHash;
}

/** A disagreement between this session and a remote peer about a frame. */
export interface DesyncReport {
  /** The frame whose hashes differ. */
  readonly frame: number;
  /** This session's fingerprint for the frame. */
  readonly localHash: StateHash;
  /** The fingerprint the remote peer reported. */
  readonly remoteHash: StateHash;
  /** The peer whose hash disagreed. */
  readonly remotePeer: PeerId;
}

/* --------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------ */

/** Thrown for protocol misuse: unknown peers, double submissions, bad frames. */
export class LockstepError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LockstepError";
  }
}

/**
 * Thrown by {@link LockstepSession.verifyHash} when a peer's frame hash does not
 * match this session's. Carries the {@link DesyncReport} so a caller can log,
 * surrender or re-sync explicitly.
 */
export class LockstepDesyncError extends LockstepError {
  /** The details of the disagreement. */
  readonly report: DesyncReport;

  constructor(report: DesyncReport) {
    super(
      `lockstep desync at frame ${report.frame}: peer ${report.remotePeer} reported ` +
        `${report.remoteHash} but the local simulation hashed ${report.localHash}`,
    );
    this.name = "LockstepDesyncError";
    this.report = report;
  }
}

/* --------------------------------------------------------------------------
 * Configuration and helpers
 * ------------------------------------------------------------------------ */

/**
 * Everything a session needs to start: the deterministic battle description
 * (`seed` + `setup`, unchanged from single-player) and the participant set.
 */
export interface LockstepConfig {
  /** Seed the shared battle is created from. */
  readonly seed: Seed;
  /** The shared, deterministic battle setup. */
  readonly setup: BattleSetup;
  /** Every participant, in any order; ids must be unique non-negative integers. */
  readonly peers: readonly PeerId[];
  /** The peer this session acts for. Must appear in {@link peers}. */
  readonly localPeer: PeerId;
}

/** Validate + canonicalise the peer list (ascending id order). */
function normalizePeers(peers: readonly PeerId[]): PeerId[] {
  if (!Array.isArray(peers) || peers.length === 0) {
    throw new LockstepError("a lockstep match needs at least one peer");
  }
  const seen = new Set<number>();
  for (const peer of peers) {
    if (!Number.isInteger(peer) || peer < 0) {
      throw new LockstepError(`peer id must be a non-negative integer, received ${String(peer)}`);
    }
    if (seen.has(peer)) {
      throw new LockstepError(`duplicate peer id ${peer}`);
    }
    seen.add(peer);
  }
  return [...peers].sort((a, b) => a - b);
}

/* --------------------------------------------------------------------------
 * Session
 * ------------------------------------------------------------------------ */

/**
 * A single peer's view of a lockstep match.
 *
 * Lifecycle for one frame:
 * 1. Each peer calls {@link submit} with the commands it wants to issue this
 *    frame (possibly none — `submit()` / {@link pass}).
 * 2. Remote commands arrive via {@link receive}.
 * 3. Once {@link isReady} is `true`, calling {@link resolve} applies the
 *    frame's commands in canonical order, advances the battle and returns a
 *    {@link LockstepFrame} carrying the new {@link StateHash}.
 * 4. Peers share `{ peer, frame, hash }` reports; {@link verifyHash} throws
 *    {@link LockstepDesyncError} on the first mismatch.
 *
 * ```ts
 * const session = new LockstepSession({ seed, setup, peers: [0, 1], localPeer: 0 });
 * session.submit({ kind: "wait", unitId: actorId });
 * session.receive(1); // peer 1 has nothing to add
 * const frame = session.resolve();
 * socket.send(session.localReport(frame.index));
 * ```
 */
export class LockstepSession {
  private readonly peerOrder: readonly PeerId[];
  private readonly localPeer: PeerId;
  private readonly initialBattle: BattleState;
  private readonly initialHashValue: StateHash;

  private battle: BattleState;
  private frameIndex = 0;

  /** Commands per peer for the frame currently being collected. */
  private submissions = new Map<PeerId, readonly Command[]>();
  /** Every resolved frame, in order. */
  private readonly resolved: LockstepFrame[] = [];
  /** Fingerprints by frame index; `hashes[n]` is the state after frame `n`. */
  private readonly hashes: StateHash[] = [];

  constructor(config: LockstepConfig) {
    this.peerOrder = normalizePeers(config.peers);
    if (!this.peerOrder.includes(config.localPeer)) {
      throw new LockstepError(
        `local peer ${config.localPeer} is not one of the match peers (${this.peerOrder.join(", ")})`,
      );
    }
    this.localPeer = config.localPeer;
    this.initialBattle = createBattle(config.seed, config.setup);
    this.battle = this.initialBattle;
    this.initialHashValue = hashBattleState(this.initialBattle);
  }

  /* ------------------------------ queries ------------------------------ */

  /** The frame currently collecting commands. */
  get frame(): number {
    return this.frameIndex;
  }

  /** The current battle, after every resolved frame. */
  get state(): BattleState {
    return this.battle;
  }

  /** The fingerprint of the battle before any frame was resolved. */
  get initialHash(): StateHash {
    return this.initialHashValue;
  }

  /** Every frame this session has resolved, oldest first. */
  get frames(): readonly LockstepFrame[] {
    return this.resolved;
  }

  /** The most recently resolved frame, or `undefined` before the first. */
  latestFrame(): LockstepFrame | undefined {
    return this.resolved[this.resolved.length - 1];
  }

  /** The latest fingerprint: the last frame's, or the initial one. */
  latestHash(): StateHash {
    return this.latestFrame()?.hash ?? this.initialHashValue;
  }

  /** Whether every peer has reported for the current frame. */
  isReady(): boolean {
    return this.peerOrder.every((peer) => this.submissions.has(peer));
  }

  /** Peers that have not yet reported for the current frame, in canonical order. */
  pendingPeers(): readonly PeerId[] {
    return this.peerOrder.filter((peer) => !this.submissions.has(peer));
  }

  /** The fingerprint of a resolved frame, or `undefined` if it has not resolved. */
  hashAt(frame: number): StateHash | undefined {
    return this.hashes[frame];
  }

  /* ----------------------------- submitting ---------------------------- */

  /**
   * Report the local peer's commands for the current frame. Call with no
   * arguments (or use {@link pass}) to report that there is nothing to issue.
   * Throws if the local peer has already reported this frame.
   */
  submit(...commands: Command[]): void {
    this.record(this.localPeer, commands);
  }

  /** Report that the local peer has no command this frame. */
  pass(): void {
    this.submit();
  }

  /**
   * Report a remote peer's commands for the current frame. Throws for the local
   * peer (use {@link submit}), unknown peers, a second report and malformed
   * commands.
   */
  receive(peer: PeerId, ...commands: Command[]): void {
    if (peer === this.localPeer) {
      throw new LockstepError("the local peer reports through submit(), not receive()");
    }
    this.record(peer, commands);
  }

  private record(peer: PeerId, commands: readonly Command[]): void {
    if (!this.peerOrder.includes(peer)) {
      throw new LockstepError(`unknown peer ${peer} (match peers: ${this.peerOrder.join(", ")})`);
    }
    if (this.submissions.has(peer)) {
      throw new LockstepError(`peer ${peer} already reported for frame ${this.frameIndex}`);
    }
    for (const command of commands) {
      if (!isCommand(command)) {
        throw new LockstepError(
          `peer ${peer} reported a malformed command in frame ${this.frameIndex}`,
        );
      }
    }
    // Copy the array so a caller cannot mutate a frame's log after the fact.
    this.submissions.set(peer, commands.slice());
  }

  /* ------------------------------ resolving ---------------------------- */

  /**
   * Apply the current frame and advance the clock. Requires {@link isReady};
   * throws {@link LockstepError} while any peer is still outstanding.
   *
   * Commands are applied in canonical order — by ascending peer id, and within
   * a peer in submission order — so every session that receives the same
   * reports produces the same state and hash, regardless of network arrival
   * order. Each command goes through the pure {@link step}; refusals are
   * collected on the returned {@link LockstepFrame} rather than thrown.
   */
  resolve(): LockstepFrame {
    if (!this.isReady()) {
      throw new LockstepError(
        `frame ${this.frameIndex} is not ready; waiting on peer(s) ${this.pendingPeers().join(", ")}`,
      );
    }

    const commands: LockstepCommand[] = [];
    for (const peer of this.peerOrder) {
      for (const command of this.submissions.get(peer) ?? []) {
        commands.push({ frame: this.frameIndex, peer, command });
      }
    }

    let state = this.battle;
    const events: BattleEvent[] = [];
    const rejections: LockstepRejection[] = [];
    for (const tagged of commands) {
      const result = step(state, tagged.command);
      if (result.rejection !== undefined) {
        rejections.push({ command: tagged, rejection: result.rejection });
        continue;
      }
      state = result.state;
      for (const event of result.events) events.push(event);
    }

    const hash = hashBattleState(state);
    const frame: LockstepFrame = {
      index: this.frameIndex,
      commands,
      events,
      rejections,
      state,
      hash,
    };

    this.battle = state;
    this.resolved.push(frame);
    this.hashes.push(hash);
    this.frameIndex += 1;
    this.submissions = new Map();

    return frame;
  }

  /* -------------------------- desync detection ------------------------- */

  /**
   * Build this peer's {@link HashReport} for a resolved frame. Defaults to the
   * most recently resolved frame. Throws {@link LockstepError} when the frame
   * has not resolved yet.
   */
  localReport(frame: number = this.resolved.length - 1): HashReport {
    const hash = this.hashAt(frame);
    if (hash === undefined) {
      throw new LockstepError(`cannot report frame ${frame}: it has not been resolved`);
    }
    return { peer: this.localPeer, frame, hash };
  }

  /**
   * Compare a remote {@link HashReport} against this session's fingerprint for
   * the same frame. Returns `null` when they agree, a {@link DesyncReport} when
   * they differ, and throws {@link LockstepError} if the frame is unknown here.
   */
  compareHash(report: HashReport): DesyncReport | null {
    const localHash = this.hashAt(report.frame);
    if (localHash === undefined) {
      throw new LockstepError(
        `cannot compare frame ${report.frame}: it has not been resolved locally`,
      );
    }
    if (localHash === report.hash) return null;
    return {
      frame: report.frame,
      localHash,
      remoteHash: report.hash,
      remotePeer: report.peer,
    };
  }

  /**
   * Like {@link compareHash} but throws {@link LockstepDesyncError} on a
   * mismatch. This is the "fail fast" entry point a transport calls for every
   * incoming report.
   */
  verifyHash(report: HashReport): void {
    const desync = this.compareHash(report);
    if (desync !== null) throw new LockstepDesyncError(desync);
  }
}
