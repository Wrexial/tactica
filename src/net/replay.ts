/**
 * Replays, spectator mode & post-action trading (T114).
 *
 * Tactica's engine contract is that a battle is fully described by a **seed +
 * setup + ordered command log** (`agents.md` §2, §7). T112's lockstep netcode
 * already leans on that to keep two peers in step; this module turns the same
 * fact outwards, into three player-facing features:
 *
 * 1. **Replays.** A {@link BattleReplay} is the recorded seed, deployment,
 *    participants and lockstep frames of a match. {@link replayFinalState}
 *    re-runs it through the pure {@link step} loop and returns the exact final
 *    battle; {@link serializeReplay} / {@link parseReplay} store it as text.
 * 2. **Spectating.** {@link BattleSpectator} walks a replay one command (or one
 *    frame) at a time and exposes the battle, the events each step produced and
 *    its state hash — so a third observer can watch a match without ever
 *    issuing a command.
 * 3. **Trading.** {@link resolveTrade} swaps **kit** (the quartermaster's
 *    reserve, `DepotInventory`) and **prisoners** (captives in the **Auxiliary
 *    Barracks**, mapping §10/§11) between two free companies. Every exchange is
 *    a pure, validated value operation: the two sides in, the two updated
 *    sides out.
 *
 * ```
 *   ReplayRecorder.recordFrame ─► BattleReplay ─┬─► replayFinalState  (state)
 *                                              ├─► BattleSpectator    (watch)
 *                                              └─► serialize / parse  (text)
 *
 *   TradeSide ─┐
 *              ├─► tradeBlockers ─► resolveTrade ─► { left', right' }
 *   TradeSide ─┘
 * ```
 *
 * ## Contract (`agents.md` §2, §3, §7, §9)
 *
 * - **Edge layer, not engine.** This lives under `src/net/`, so it may hold
 *   mutable session state (the recorder and the spectator cursor). It still
 *   contains no `Math.random` and no wall-clock reads: a replay and a trade are
 *   as reproducible as the deterministic engine beneath them.
 * - **Commands are the only mutation path.** A replay never edits a battle —
 *   every entry goes through {@link step}. Trading touches only the plain
 *   campaign values (`Company`-adjacent kit and barracks), never a live battle.
 * - **State in, state out.** {@link resolveTrade} and every barracks/inventory
 *   helper return **new** values; the inputs are never mutated. Structural
 *   sharing is fine.
 * - **Trust boundary.** {@link parseReplay} validates the version, the setup,
 *   every command and every participant before returning, so a corrupt save or
 *   a hostile packet fails loudly instead of desyncing a spectator.
 *
 * Reference: `docs/wiki/pages/Battle_system.md` (deterministic battle steps),
 * `docs/wiki/pages/Monster_Bank.md` (the capture/cajole loop). Fiction follows
 * `docs/NAPOLEONIC_MAPPING.md`: **Online skirmish** (link-cable battles, §10),
 * **Auxiliary Barracks** (Monster Bank, §10/§11), **kit** (equipment, §1) and
 * **prisoners** (captured irregulars, §11).
 */

import { isEquipmentKey } from "../data/equipment";
import {
  createBattle,
  step,
  type BattleRejection,
  type BattleSetup,
  type BattleState,
} from "../engine/battle";
import {
  BARRACKS_CAPACITY,
  barracksSize,
  captiveOf,
  createBarracks,
  type AuxiliaryBarracks,
  type AuxiliaryBarracksInit,
  type Captive,
} from "../engine/barracks";
import { isCommand, parseCommand, type Command } from "../engine/commands";
import {
  addToInventory,
  createDepotInventory,
  inventoryCount,
  removeFromInventory,
  type DepotInventory,
  type DepotInventoryInit,
} from "../engine/depot";
import { BATTLE_OUTCOMES, type BattleEvent, type BattleOutcome } from "../engine/events";
import {
  asEquipmentId,
  asUnitId,
  isValidId,
  type CompanyId,
  type EquipmentId,
  type UnitId,
} from "../engine/ids";
import type { Seed } from "../engine/rng";
import {
  BattleReplayError,
  hashBattleState,
  replayBattle,
  type BattleScript,
} from "../engine/serialize";
import type { PeerId, StateHash } from "./lockstep";

/* --------------------------------------------------------------------------
 * Tunables
 * ------------------------------------------------------------------------ */

/**
 * Replay format version. Bumping it is a breaking change: {@link parseReplay}
 * refuses any other value so an old viewer never mis-reads a new log (T104's
 * save-migration contract, applied to replays).
 */
export const REPLAY_VERSION = 1;

/* --------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------ */

/** Thrown when a replay is malformed or cannot be replayed. */
export class ReplayError extends Error {
  /** Index of the offending command, when the failure is command-scoped. */
  readonly commandIndex?: number;
  /** The engine's reason, when a command was refused. */
  readonly rejection?: BattleRejection;

  constructor(message: string, commandIndex?: number, rejection?: BattleRejection) {
    super(message);
    this.name = "ReplayError";
    if (commandIndex !== undefined) this.commandIndex = commandIndex;
    if (rejection !== undefined) this.rejection = rejection;
  }
}

/** Thrown when a trade request/agreement is malformed. */
export class TradeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TradeError";
  }
}

/* --------------------------------------------------------------------------
 * Replay values
 * ------------------------------------------------------------------------ */

/** One would-be combatant in a recorded match (the public match card). */
export interface ReplayParticipant {
  /** The lockstep peer id that commanded this company. */
  readonly peer: PeerId;
  /** Stable company identity (mapping §1 "Clan → Company"). */
  readonly companyId: CompanyId;
  /** Player-facing company name (the fiction layer). */
  readonly name: string;
}

/** A command attributed to the peer that issued it. */
export interface ReplayCommand {
  /** The peer that issued the order. */
  readonly peer: PeerId;
  /** The serialisable battle command itself. */
  readonly command: Command;
}

/** One lockstep frame: the commands resolved together, in application order. */
export interface ReplayFrame {
  /** Zero-based frame index (contiguous, assigned at capture). */
  readonly index: number;
  /** Every peer's commands for the frame, in canonical order. */
  readonly commands: readonly ReplayCommand[];
}

/** The summary stamped onto a completed replay. */
export interface ReplayResult {
  /** The battle outcome, or `null` for a ceasefire/capped match. */
  readonly outcome: BattleOutcome | null;
  /** Orders Tempo frames the match resolved. */
  readonly frames: number;
  /** Orders issued across every peer. */
  readonly commands: number;
  /** Fingerprint of the final battle; spectators can verify it. */
  readonly hash: StateHash;
}

/**
 * A complete recorded match: everything needed to replay or watch it. This is
 * a plain, serialisable value (`agents.md` §7) — the same seed + setup + frames
 * always reproduce the same battle and hash.
 */
export interface BattleReplay {
  /** Format version; see {@link REPLAY_VERSION}. */
  readonly version: number;
  /** Player-facing match label (never a game rule). */
  readonly matchId: string;
  /** The shared battle seed. */
  readonly seed: Seed;
  /** The shared, deterministic battle description. */
  readonly setup: BattleSetup;
  /** The companies that took part, by peer. */
  readonly participants: readonly ReplayParticipant[];
  /** Every resolved frame, oldest first. */
  readonly frames: readonly ReplayFrame[];
  /** The stamped result, or `null` while the match is still being recorded. */
  readonly result: ReplayResult | null;
}

/** Untrusted frame shape accepted by {@link createBattleReplay}. */
export interface ReplayFrameInit {
  readonly index?: number;
  readonly commands: readonly ReplayCommandInit[];
}

/** Untrusted command shape accepted by {@link createBattleReplay}. */
export interface ReplayCommandInit {
  readonly peer: PeerId;
  readonly command: unknown;
}

/** Authoring input for {@link createBattleReplay}. */
export interface BattleReplayInit {
  readonly matchId: string;
  readonly seed: Seed;
  readonly setup: BattleSetup;
  readonly participants: readonly ReplayParticipant[];
  readonly frames?: readonly ReplayFrameInit[];
  readonly result?: ReplayResult | null;
}

/* --------------------------------------------------------------------------
 * Validation helpers (fail fast at the save/network boundary)
 * ------------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPeerId(value: unknown): value is PeerId {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isSeed(value: unknown): value is Seed {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ReplayError(`${label} must be a non-empty string`);
  }
}

function normalizeParticipants(value: unknown): ReplayParticipant[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ReplayError("replay must list at least one participant");
  }
  const seen = new Set<PeerId>();
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new ReplayError(`participants[${index}] must be an object`);
    }
    if (!isPeerId(entry.peer)) {
      throw new ReplayError(`participants[${index}].peer must be a non-negative integer`);
    }
    if (seen.has(entry.peer)) {
      throw new ReplayError(`participants[${index}] duplicates peer ${entry.peer}`);
    }
    seen.add(entry.peer);
    if (!isValidId(entry.companyId)) {
      throw new ReplayError(`participants[${index}].companyId must be a non-empty id`);
    }
    if (typeof entry.name !== "string" || entry.name.trim().length === 0) {
      throw new ReplayError(`participants[${index}].name must be a non-empty string`);
    }
    return { peer: entry.peer, companyId: entry.companyId as CompanyId, name: entry.name };
  });
}

function normalizeReplayCommand(value: unknown, label: string): ReplayCommand {
  if (!isRecord(value)) {
    throw new ReplayError(`${label} must be an object`);
  }
  if (!isPeerId(value.peer)) {
    throw new ReplayError(`${label}.peer must be a non-negative integer`);
  }
  return { peer: value.peer, command: parseCommand(value.command, `${label}.command`) };
}

function normalizeFrames(value: unknown): ReplayFrame[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new ReplayError("replay.frames must be an array");
  }
  return value.map((frame, frameIndex) => {
    if (!isRecord(frame) || !Array.isArray(frame.commands)) {
      throw new ReplayError(`frames[${frameIndex}] must carry a commands array`);
    }
    return {
      index: frameIndex,
      commands: (frame.commands as unknown[]).map((entry, commandIndex) =>
        normalizeReplayCommand(entry, `frames[${frameIndex}].commands[${commandIndex}]`),
      ),
    };
  });
}

function normalizeResult(value: unknown): ReplayResult {
  if (!isRecord(value)) {
    throw new ReplayError("replay.result must be an object");
  }
  const outcome = value.outcome;
  if (outcome !== null && !(BATTLE_OUTCOMES as readonly string[]).includes(outcome as string)) {
    throw new ReplayError(`replay.result.outcome must be a battle outcome or null`);
  }
  const frames = value.frames;
  const commands = value.commands;
  if (typeof frames !== "number" || !Number.isInteger(frames) || frames < 0) {
    throw new ReplayError("replay.result.frames must be a non-negative integer");
  }
  if (typeof commands !== "number" || !Number.isInteger(commands) || commands < 0) {
    throw new ReplayError("replay.result.commands must be a non-negative integer");
  }
  if (typeof value.hash !== "string" || value.hash.length === 0) {
    throw new ReplayError("replay.result.hash must be a non-empty string");
  }
  return {
    outcome: outcome as BattleOutcome | null,
    frames,
    commands,
    hash: value.hash as StateHash,
  };
}

/* --------------------------------------------------------------------------
 * Creating & serialising replays
 * ------------------------------------------------------------------------ */

/**
 * Validate and normalise a replay. The battle setup is checked by
 * {@link createBattle} (so a replay can never be built over an impossible
 * field) and every command is cloned through `parseCommand`.
 *
 * @throws ReplayError on a malformed replay; `BattleSetupError` on a malformed
 *   setup.
 */
export function createBattleReplay(init: BattleReplayInit): BattleReplay {
  assertNonEmptyString(init.matchId, "replay.matchId");
  if (!isSeed(init.seed)) {
    throw new ReplayError("replay.seed must be a string or a finite number");
  }
  // Structural validation of the field (ids, tiles, occupancy, objective).
  createBattle(init.seed, init.setup);

  const participants = normalizeParticipants(init.participants);
  const frames = normalizeFrames(init.frames);
  const peerIds = new Set(participants.map((participant) => participant.peer));
  for (const frame of frames) {
    for (const entry of frame.commands) {
      if (!peerIds.has(entry.peer)) {
        throw new ReplayError(`frame ${frame.index} names unknown peer ${entry.peer}`);
      }
    }
  }
  const result =
    init.result === undefined || init.result === null ? null : normalizeResult(init.result);

  return {
    version: REPLAY_VERSION,
    matchId: init.matchId,
    seed: init.seed,
    setup: init.setup,
    participants,
    frames,
    result,
  };
}

/** Every command in a replay, flattened in frame/application order. */
export function flattenReplayCommands(replay: BattleReplay): Command[] {
  const commands: Command[] = [];
  for (const frame of replay.frames) {
    for (const entry of frame.commands) commands.push(entry.command);
  }
  return commands;
}

/** Total orders recorded across every frame. */
export function replayCommandCount(replay: BattleReplay): number {
  let total = 0;
  for (const frame of replay.frames) total += frame.commands.length;
  return total;
}

/** The engine {@link BattleScript} equivalent of a replay. */
export function replayScript(replay: BattleReplay): BattleScript {
  return { seed: replay.seed, setup: replay.setup, commands: flattenReplayCommands(replay) };
}

/**
 * Recompute a replay's final battle. Every recorded command must be accepted;
 * a rejection means the log and the seed/setup have diverged, so the failure is
 * surfaced as a {@link ReplayError} naming the command.
 */
export function replayFinalState(replay: BattleReplay): BattleState {
  try {
    return replayBattle(replayScript(replay));
  } catch (error) {
    if (error instanceof BattleReplayError) {
      throw new ReplayError(error.message, error.commandIndex, error.rejection);
    }
    throw error;
  }
}

/** Build the {@link ReplayResult} for a finished (or capped) replay. */
export function replayResultOf(replay: BattleReplay): ReplayResult {
  const state = replayFinalState(replay);
  return {
    outcome: state.phase === "finished" ? state.outcome : null,
    frames: replay.frames.length,
    commands: replayCommandCount(replay),
    hash: hashBattleState(state),
  };
}

/** Serialise a replay to canonical JSON text. */
export function serializeReplay(replay: BattleReplay): string {
  return JSON.stringify(replay);
}

/**
 * Parse and validate a replay from JSON. This is the trust boundary for a
 * replay file or a shared match log: the format version, setup, participants
 * and every command are checked, and the whole log is replayed once to prove
 * it is actually playable.
 *
 * @throws ReplayError when the text is not a valid, replayable battle.
 */
export function parseReplay(json: string, label = "replay"): BattleReplay {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ReplayError(`${label} JSON could not be parsed`);
  }
  if (!isRecord(parsed)) {
    throw new ReplayError(`${label} must be an object`);
  }
  if (parsed.version !== REPLAY_VERSION) {
    throw new ReplayError(
      `${label} has version ${String(parsed.version)} but this build reads version ${REPLAY_VERSION}`,
    );
  }
  let replay: BattleReplay;
  try {
    replay = createBattleReplay({
      matchId: parsed.matchId as string,
      seed: parsed.seed as Seed,
      setup: parsed.setup as BattleSetup,
      participants: parsed.participants as readonly ReplayParticipant[],
      frames: parsed.frames as readonly ReplayFrameInit[] | undefined,
      result: parsed.result as ReplayResult | null | undefined,
    });
  } catch (error) {
    if (error instanceof ReplayError) throw error;
    throw new ReplayError(
      `${label} is not a well-formed replay: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  // Prove the log replays cleanly (and fail loudly if it does not).
  replayFinalState(replay);
  return replay;
}

/* --------------------------------------------------------------------------
 * Recording
 * ------------------------------------------------------------------------ */

/** Configuration for a {@link ReplayRecorder}. */
export interface ReplayRecorderInit {
  readonly matchId: string;
  readonly seed: Seed;
  readonly setup: BattleSetup;
  readonly participants: readonly ReplayParticipant[];
}

/**
 * Captures a live match, frame by frame, into a {@link BattleReplay}.
 *
 * A lockstep loop calls {@link recordFrame} once per resolved frame with a map
 * of peer → commands (an empty array for a passing peer); the recorder keeps
 * the canonical application order (ascending peer id, submission order within a
 * peer) that the sessions already agreed on. {@link finish} stamps the result.
 *
 * ```ts
 * const recorder = new ReplayRecorder({ matchId, seed, setup, participants });
 * recorder.recordFrame(new Map([[0, [command]], [1, []]]));
 * const replay = recorder.finish(replayResultOf(recorder.replay));
 * ```
 */
export class ReplayRecorder {
  private readonly base: BattleReplay;
  private readonly frameList: ReplayFrame[] = [];

  constructor(init: ReplayRecorderInit) {
    // Reuse the replay validator so participants and setup are checked once.
    this.base = createBattleReplay({ ...init, frames: [] });
  }

  /** Frames captured so far. */
  get frameCount(): number {
    return this.frameList.length;
  }

  /**
   * Record one resolved frame. Commands are grouped by peer in ascending peer
   * order, matching the canonical lockstep application order.
   *
   * @throws ReplayError for an unknown peer or a malformed command.
   */
  recordFrame(commandsByPeer: ReadonlyMap<PeerId, readonly Command[]>): ReplayFrame {
    const peers = [...this.base.participants]
      .map((participant) => participant.peer)
      .sort((a, b) => a - b);
    const commands: ReplayCommand[] = [];
    for (const peer of peers) {
      for (const command of commandsByPeer.get(peer) ?? []) {
        if (!isCommand(command)) {
          throw new ReplayError(`peer ${peer} issued a malformed command`);
        }
        commands.push({ peer, command });
      }
    }
    for (const peer of commandsByPeer.keys()) {
      if (!peers.includes(peer)) {
        throw new ReplayError(`frame names unknown peer ${peer}`);
      }
    }
    const frame: ReplayFrame = { index: this.frameList.length, commands };
    this.frameList.push(frame);
    return frame;
  }

  /** The replay captured so far, with `result` stamped when supplied. */
  finish(result: ReplayResult | null = null): BattleReplay {
    return createBattleReplay({
      matchId: this.base.matchId,
      seed: this.base.seed,
      setup: this.base.setup,
      participants: this.base.participants,
      frames: this.frameList,
      result,
    });
  }

  /** Convenience alias for {@link finish} with no result. */
  get replay(): BattleReplay {
    return this.finish();
  }
}

/* --------------------------------------------------------------------------
 * Spectating
 * ------------------------------------------------------------------------ */

/**
 * A read-only view over a {@link BattleReplay}.
 *
 * The spectator owns its own battle, built from the replay's seed and setup,
 * and advances it one command at a time with the pure {@link step}. It never
 * accepts a command from the outside, so it can safely drive a UI for a third
 * party who is only watching. {@link seek} rebuilds from the seed to any point
 * in the log, so scrubbing is exact rather than approximate.
 */
export class BattleSpectator {
  /** The replay being watched. */
  readonly replay: BattleReplay;

  private readonly log: readonly ReplayCommand[];
  private readonly frameOf: readonly number[];
  private cursorValue = 0;
  private stateValue: BattleState;
  private lastEvents: readonly BattleEvent[] = [];

  constructor(replay: BattleReplay) {
    this.replay = replay;
    const log: ReplayCommand[] = [];
    const frameOf: number[] = [];
    for (const frame of replay.frames) {
      for (const entry of frame.commands) {
        log.push(entry);
        frameOf.push(frame.index);
      }
    }
    this.log = log;
    this.frameOf = frameOf;
    this.stateValue = createBattle(replay.seed, replay.setup);
  }

  /** The battle as of the current cursor. */
  get state(): BattleState {
    return this.stateValue;
  }

  /** Commands applied so far. */
  get cursor(): number {
    return this.cursorValue;
  }

  /** Commands in the whole log. */
  get total(): number {
    return this.log.length;
  }

  /** `true` once every recorded command has been applied. */
  get finished(): boolean {
    return this.cursorValue >= this.log.length;
  }

  /** The frame currently being watched (`frames.length` once finished). */
  get frameIndex(): number {
    if (this.finished) return this.replay.frames.length;
    return this.frameOf[this.cursorValue] as number;
  }

  /** Events produced by the most recent {@link step}/{@link stepFrame}. */
  get events(): readonly BattleEvent[] {
    return this.lastEvents;
  }

  /** Fingerprint of the battle at the cursor. */
  get hash(): StateHash {
    return hashBattleState(this.stateValue);
  }

  /** Apply the next command and return the events it produced. */
  step(): readonly BattleEvent[] {
    if (this.finished) return [];
    const entry = this.log[this.cursorValue] as ReplayCommand;
    const result = step(this.stateValue, entry.command);
    if (result.rejection !== undefined) {
      throw new ReplayError(
        `replay command ${this.cursorValue} (${entry.command.kind}) was rejected: ${result.rejection.message}`,
        this.cursorValue,
        result.rejection,
      );
    }
    this.stateValue = result.state;
    this.cursorValue += 1;
    this.lastEvents = result.events;
    return result.events;
  }

  /** Apply every remaining command of the current frame. */
  stepFrame(): readonly BattleEvent[] {
    if (this.finished) return [];
    const frame = this.frameOf[this.cursorValue] as number;
    const events: BattleEvent[] = [];
    while (!this.finished && this.frameOf[this.cursorValue] === frame) {
      for (const event of this.step()) events.push(event);
    }
    return events;
  }

  /**
   * Jump to an absolute command cursor, rebuilding from the seed so the result
   * is exact. Accepts `0` (the opening position) through {@link total}.
   */
  seek(cursor: number): void {
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > this.log.length) {
      throw new ReplayError(`seek target must be within [0, ${this.log.length}]`);
    }
    let state = createBattle(this.replay.seed, this.replay.setup);
    for (let index = 0; index < cursor; index++) {
      const entry = this.log[index] as ReplayCommand;
      const result = step(state, entry.command);
      if (result.rejection !== undefined) {
        throw new ReplayError(
          `replay command ${index} (${entry.command.kind}) was rejected: ${result.rejection.message}`,
          index,
          result.rejection,
        );
      }
      state = result.state;
    }
    this.stateValue = state;
    this.cursorValue = cursor;
    this.lastEvents = [];
  }
}

/* --------------------------------------------------------------------------
 * Trading — kit & prisoners
 * ------------------------------------------------------------------------ */

/**
 * One party to an exchange: the company's peer id plus everything it owns that
 * a trade can move — its **kit reserve** (`DepotInventory`) and its
 * **prisoners** (`AuxiliaryBarracks`).
 */
export interface TradeSide {
  readonly peer: PeerId;
  readonly inventory: DepotInventory;
  readonly barracks: AuxiliaryBarracks;
}

/** Authoring input for {@link createTradeSide}. */
export interface TradeSideInit {
  readonly peer: PeerId;
  readonly inventory?: DepotInventoryInit;
  readonly barracks?: AuxiliaryBarracksInit;
}

/** One line of a kit transfer: `count` copies of authored kit. */
export interface KitStack {
  readonly itemId: EquipmentId;
  readonly count: number;
}

/** Untrusted kit-stack shape accepted by {@link createTradeRequest}. */
export interface KitStackInit {
  readonly itemId: string;
  readonly count: number;
}

/** What one side offers in a trade: kit from its reserve and prisoners. */
export interface TradeRequest {
  readonly kit: readonly KitStack[];
  readonly prisoners: readonly UnitId[];
}

/** Untrusted request shape accepted by {@link createTradeRequest}. */
export interface TradeRequestInit {
  readonly kit?: readonly KitStackInit[];
  readonly prisoners?: readonly string[];
}

/** A bilateral exchange: `leftGives` goes to the right, `rightGives` to the left. */
export interface TradeAgreement {
  readonly left: PeerId;
  readonly right: PeerId;
  readonly leftGives: TradeRequest;
  readonly rightGives: TradeRequest;
}

/** Untrusted agreement shape accepted by {@link createTradeAgreement}. */
export interface TradeAgreementInit {
  readonly left: PeerId;
  readonly right: PeerId;
  readonly leftGives?: TradeRequestInit;
  readonly rightGives?: TradeRequestInit;
}

/** Why a trade cannot proceed right now (empty ⇒ it can). */
export type TradeBlocker =
  | "self-trade"
  | "wrong-peer"
  | "empty-trade"
  | "missing-kit"
  | "missing-prisoner"
  | "prisoner-conflict"
  | "receiver-pen-full";

/** The two updated sides returned by {@link resolveTrade}. */
export interface TradeResult {
  readonly left: TradeSide;
  readonly right: TradeSide;
  /** Total kit pieces that changed hands. */
  readonly movedKit: number;
  /** Total prisoners that changed hands. */
  readonly movedPrisoners: number;
}

/** Validate and normalise one trade side. */
export function createTradeSide(init: TradeSideInit): TradeSide {
  if (!isPeerId(init.peer)) {
    throw new TradeError("trade side peer must be a non-negative integer");
  }
  return {
    peer: init.peer,
    inventory: createDepotInventory(init.inventory ?? {}),
    barracks: createBarracks(init.barracks ?? {}),
  };
}

/**
 * Validate and normalise a trade request. Kit must name authored equipment in
 * positive integer counts, prisoners must be non-empty ids, and neither list
 * may repeat an entry (a duplicate would make the intent ambiguous).
 */
export function createTradeRequest(init: TradeRequestInit = {}): TradeRequest {
  const kit: KitStack[] = [];
  const seenKit = new Set<string>();
  for (const stack of init.kit ?? []) {
    if (!isEquipmentKey(stack.itemId)) {
      throw new TradeError(`trade offers unauthored kit: ${String(stack.itemId)}`);
    }
    if (!Number.isInteger(stack.count) || stack.count <= 0) {
      throw new TradeError(
        `trade kit count must be a positive integer, received ${String(stack.count)}`,
      );
    }
    if (seenKit.has(stack.itemId)) {
      throw new TradeError(`trade request lists ${stack.itemId} more than once`);
    }
    seenKit.add(stack.itemId);
    kit.push({ itemId: asEquipmentId(stack.itemId), count: stack.count });
  }

  const prisoners: UnitId[] = [];
  const seenPrisoners = new Set<string>();
  for (const id of init.prisoners ?? []) {
    if (!isValidId(id)) {
      throw new TradeError("trade prisoner ids must be non-empty strings");
    }
    if (seenPrisoners.has(id)) {
      throw new TradeError(`trade request lists prisoner ${id} more than once`);
    }
    seenPrisoners.add(id);
    prisoners.push(asUnitId(id));
  }

  return { kit, prisoners };
}

/** Validate and normalise a bilateral trade agreement. */
export function createTradeAgreement(init: TradeAgreementInit): TradeAgreement {
  if (!isPeerId(init.left) || !isPeerId(init.right)) {
    throw new TradeError("trade agreement peers must be non-negative integers");
  }
  return {
    left: init.left,
    right: init.right,
    leftGives: createTradeRequest(init.leftGives),
    rightGives: createTradeRequest(init.rightGives),
  };
}

/** The pen a side would hold after a trade (giving its own, receiving theirs). */
function finalCaptives(
  own: AuxiliaryBarracks,
  gives: readonly UnitId[],
  receives: readonly UnitId[],
  other: AuxiliaryBarracks,
): Captive[] {
  const kept = own.captives.filter((captive) => !gives.includes(captive.id));
  const incoming: Captive[] = [];
  for (const id of receives) {
    const captive = captiveOf(other, id);
    if (captive !== undefined) incoming.push(captive);
  }
  return [...kept, ...incoming];
}

function hasDuplicateCaptives(captives: readonly Captive[]): boolean {
  const seen = new Set<string>();
  for (const captive of captives) {
    if (seen.has(captive.id)) return true;
    seen.add(captive.id);
  }
  return false;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

/**
 * Every reason `agreement` cannot be resolved against `left` and `right`, in a
 * stable order. An empty array means {@link resolveTrade} will succeed.
 *
 * | Blocker              | Rule                                                 |
 * | -------------------- | ---------------------------------------------------- |
 * | `self-trade`         | a company cannot trade with itself                    |
 * | `wrong-peer`          | the agreement names peers other than the two sides   |
 * | `empty-trade`         | neither side offers anything                         |
 * | `missing-kit`         | a giver does not hold the offered kit                 |
 * | `missing-prisoner`    | a giver does not hold the offered prisoner            |
 * | `prisoner-conflict`   | the receiving pen would hold two captives with one id |
 * | `receiver-pen-full`   | the receiving pen would exceed {@link BARRACKS_CAPACITY} |
 */
export function tradeBlockers(
  left: TradeSide,
  right: TradeSide,
  agreement: TradeAgreement,
): readonly TradeBlocker[] {
  const blockers: TradeBlocker[] = [];

  if (left.peer === right.peer) blockers.push("self-trade");
  if (agreement.left !== left.peer || agreement.right !== right.peer) blockers.push("wrong-peer");

  const leftKit = agreement.leftGives.kit;
  const rightKit = agreement.rightGives.kit;
  const leftPrisoners = agreement.leftGives.prisoners;
  const rightPrisoners = agreement.rightGives.prisoners;

  if (
    leftKit.length === 0 &&
    rightKit.length === 0 &&
    leftPrisoners.length === 0 &&
    rightPrisoners.length === 0
  ) {
    blockers.push("empty-trade");
  }

  for (const stack of leftKit) {
    if (inventoryCount(left.inventory, stack.itemId) < stack.count) blockers.push("missing-kit");
  }
  for (const stack of rightKit) {
    if (inventoryCount(right.inventory, stack.itemId) < stack.count) blockers.push("missing-kit");
  }
  for (const id of leftPrisoners) {
    if (captiveOf(left.barracks, id) === undefined) blockers.push("missing-prisoner");
  }
  for (const id of rightPrisoners) {
    if (captiveOf(right.barracks, id) === undefined) blockers.push("missing-prisoner");
  }

  const leftPen = finalCaptives(left.barracks, leftPrisoners, rightPrisoners, right.barracks);
  const rightPen = finalCaptives(right.barracks, rightPrisoners, leftPrisoners, left.barracks);
  if (leftPen.length > BARRACKS_CAPACITY || rightPen.length > BARRACKS_CAPACITY) {
    blockers.push("receiver-pen-full");
  }
  if (hasDuplicateCaptives(leftPen) || hasDuplicateCaptives(rightPen)) {
    blockers.push("prisoner-conflict");
  }

  return unique(blockers);
}

/** `true` when {@link resolveTrade} would succeed. */
export function canTrade(left: TradeSide, right: TradeSide, agreement: TradeAgreement): boolean {
  return tradeBlockers(left, right, agreement).length === 0;
}

function shrinkKit(inventory: DepotInventory, kit: readonly KitStack[]): DepotInventory {
  let next = inventory;
  for (const stack of kit) next = removeFromInventory(next, stack.itemId, stack.count);
  return next;
}

function growKit(inventory: DepotInventory, kit: readonly KitStack[]): DepotInventory {
  let next = inventory;
  for (const stack of kit) next = addToInventory(next, stack.itemId, stack.count);
  return next;
}

function kitPieceCount(kit: readonly KitStack[]): number {
  let total = 0;
  for (const stack of kit) total += stack.count;
  return total;
}

/**
 * Resolve a bilateral trade: move `leftGives` from left to right and
 * `rightGives` from right to left. Both sides are immutable values; the
 * originals are untouched and two new {@link TradeSide}s are returned.
 *
 * @throws RangeError when any {@link TradeBlocker} applies.
 */
export function resolveTrade(
  left: TradeSide,
  right: TradeSide,
  agreement: TradeAgreement,
): TradeResult {
  const blockers = tradeBlockers(left, right, agreement);
  if (blockers.length > 0) {
    throw new RangeError(`cannot trade: ${blockers.join(", ")}`);
  }

  const leftInventory = growKit(
    shrinkKit(left.inventory, agreement.leftGives.kit),
    agreement.rightGives.kit,
  );
  const rightInventory = growKit(
    shrinkKit(right.inventory, agreement.rightGives.kit),
    agreement.leftGives.kit,
  );

  const leftBarracks = createBarracks({
    captives: finalCaptives(
      left.barracks,
      agreement.leftGives.prisoners,
      agreement.rightGives.prisoners,
      right.barracks,
    ),
  });
  const rightBarracks = createBarracks({
    captives: finalCaptives(
      right.barracks,
      agreement.rightGives.prisoners,
      agreement.leftGives.prisoners,
      left.barracks,
    ),
  });

  return {
    left: { peer: left.peer, inventory: leftInventory, barracks: leftBarracks },
    right: { peer: right.peer, inventory: rightInventory, barracks: rightBarracks },
    movedKit: kitPieceCount(agreement.leftGives.kit) + kitPieceCount(agreement.rightGives.kit),
    movedPrisoners: agreement.leftGives.prisoners.length + agreement.rightGives.prisoners.length,
  };
}

/** How many prisoners `side` currently holds. */
export function tradeSidePrisonerCount(side: TradeSide): number {
  return barracksSize(side.barracks);
}

/** How many copies of `itemId` `side` holds in its kit reserve. */
export function tradeSideKitCount(side: TradeSide, itemId: EquipmentId): number {
  return inventoryCount(side.inventory, itemId);
}
