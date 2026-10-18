/**
 * Lobby & matchmaking (T113) — the online **1v1 skirmish** between two free
 * companies.
 *
 * Tactica's whole netcode contract is "an initial state plus an ordered command
 * log" (`agents.md` §2, §7): T112's {@link LockstepSession} already makes every
 * peer agree on a battle without ever sending battle state. This module owns
 * the layer *above* lockstep — the way two players find each other, agree on a
 * match, deploy their companies and then drive the agreed simulation from
 * either side of the wire.
 *
 * ```
 *   LobbyCompany ─┐
 *                 ├─► Lobby.join / setReady / start ─► LobbyMatch
 *   matchmaking   ┘                                      │
 *                                                        ├─► two LockstepSessions
 *                                                        │   (peer 0 vs peer 1)
 *                                                        └─► runSkirmish()
 *                                                                │
 *                                                                └─► agreed state + hash
 * ```
 *
 * ## What this module owns
 *
 * 1. **Companies in the lobby.** A {@link LobbyCompany} is a free company's
 *    public match card: its identity, its matchmaking **rating** and the
 *    {@link RosterMember}s it fields (mapping §1 "Clan → Company", §10
 *    "link-cable multiplayer → online skirmish").
 * 2. **Matchmaking.** {@link closestOpponent} pairs a company with the closest
 *    rating in a pool (deterministic tie-break) and {@link matchmake} pairs a
 *    whole queue greedily. No randomness, no clock — the pool order is the
 *    tie-break, so a test or a replay always finds the same opponent.
 * 3. **The lobby itself.** A {@link Lobby} seats up to two companies, tracks
 *    each seat's **ready** state and, once everyone is ready, {@link Lobby.start
 *    starts} the match. The seat/ready handshake mirrors the real client-server
 *    shape while staying a plain, serialisable value.
 * 4. **Deployment.** {@link deploySkirmish} turns two company rosters into a
 *    symmetric {@link BattleSetup}: the home company fights as `company`, the
 *    rival as `enemy`, each side mirrored on a small bridge-and-ford field. The
 *    seed is shared, so both peers build a byte-identical battle.
 * 5. **The match.** A {@link LobbyMatch} holds one {@link LockstepSession} per
 *    peer. {@link LobbyMatch.resolve} feeds every peer's commands to every
 *    peer's session in canonical order and throws {@link LockstepDesyncError}
 *    the moment two simulations disagree.
 * 6. **A headless skirmish runner.** {@link runSkirmish} plays a whole 1v1
 *    action to a standstill (or the frame cap) with a pluggable command
 *    {@link SkirmishPolicy} — by default T095's utility AI — and reports the
 *    outcome together with both peers' hashes.
 *
 * ## Contract (`agents.md` §2, §3, §7, §9)
 *
 * - **Edge layer, not engine.** This lives under `src/net/`, so it may hold
 *   mutable session/seat state and import `src/ai`; nothing in `src/engine/`
 *   imports it. It still contains no `Math.random` and no wall-clock reads, so
 *   a match is as reproducible as the battle beneath it.
 * - **Commands are the only mutation path.** Every order is a serialisable
 *   {@link Command} fed straight to `step` through {@link LockstepSession}; the
 *   lobby never edits a battle directly.
 * - **Data-driven & original.** The field, the deploy cap and the skirmish
 *   actions are named constants here so a balance pass (Phase 13) can retune
 *   them; all names are original Napoleonic fiction, never FFTA prose.
 *
 * Reference: `docs/wiki/pages/Final_Fantasy_Tactics_Advance.md` (link-cable
 * battles) and `docs/wiki/pages/Battle_system.md` (deterministic battle steps);
 * fiction follows `docs/NAPOLEONIC_MAPPING.md` (two free companies meeting in a
 * lawless skirmish).
 */

import { chooseCommand } from "../ai/utility";
import type { ActionSpec } from "../engine/actions/resolve";
import { type BattleSetup, type BattleState } from "../engine/battle";
import type { Company, RosterMember } from "../engine/company";
import { isCommand, type Command } from "../engine/commands";
import type { BattleOutcome } from "../engine/events";
import { coord, type Coord, type Facing } from "../engine/grid";
import { asAbilityId, asUnitId, type CompanyId, type UnitId } from "../engine/ids";
import type { Seed } from "../engine/rng";
import { createTerrainMap, withTile, type TerrainMap } from "../engine/terrain";
import { createUnit, type Unit, type UnitSide } from "../engine/unit";
import {
  LockstepDesyncError,
  LockstepSession,
  type HashReport,
  type LockstepFrame,
  type PeerId,
  type StateHash,
} from "./lockstep";

/* --------------------------------------------------------------------------
 * Tunables (Phase 13 owns the final balance pass)
 * ------------------------------------------------------------------------ */

/** Width of the skirmish field (a small detachment action, mapping §0). */
export const SKIRMISH_WIDTH = 10;

/** Height of the skirmish field. */
export const SKIRMISH_HEIGHT = 8;

/**
 * Most soldiers one company may field in a skirmish. FFTA link battles are
 * small-squad actions (mapping §0); a bigger roster still only deploys this
 * many, chosen in roster order so the pick is deterministic.
 */
export const SKIRMISH_DEPLOY_LIMIT = 4;

/**
 * Hard cap on the Orders Tempo frames {@link runSkirmish} will play before it
 * calls a **ceasefire**. A frame is one lockstep tick (usually one order), so
 * this is generous for a small action while keeping a stuck or passive match
 * from running forever.
 */
export const SKIRMISH_MAX_FRAMES = 160;

/**
 * Cap on the destination tiles the utility AI explores per decision. A skirmish
 * runs many decisions in a row, so a modest budget keeps a whole match inside
 * an interactive frame (T099's perf contract).
 */
export const SKIRMISH_SEARCH_LIMIT = 12;

/** The actions both companies may use in a skirmish (authored, rebalanced later). */
export const SKIRMISH_ACTIONS: readonly ActionSpec[] = [
  // A volley at range: the workhorse of a line action.
  { id: asAbilityId("skirmish-volley"), mpCost: 0, chargeTime: 0, range: 5, power: 90 },
  // A closing bayonet thrust for the melee.
  { id: asAbilityId("skirmish-bayonet"), mpCost: 0, chargeTime: 0, range: 1, power: 120 },
];

/* --------------------------------------------------------------------------
 * Errors
 * ------------------------------------------------------------------------ */

/** Thrown for lobby protocol misuse: a full lobby, a bad seat, a premature start. */
export class LobbyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LobbyError";
  }
}

/* --------------------------------------------------------------------------
 * Companies
 * ------------------------------------------------------------------------ */

/**
 * A free company as the lobby sees it: the public match card other players are
 * matched against. It carries only what a match needs — identity, the
 * matchmaking **rating** and the roster that will take the field.
 */
export interface LobbyCompany {
  /** Stable company identity (shared with `engine/company`'s `Company`). */
  readonly id: CompanyId;
  /** Player-facing company name (the fiction layer). */
  readonly name: string;
  /** Matchmaking rating; higher means a more seasoned company. */
  readonly rating: number;
  /** Soldiers the company can field, in deployment order. */
  readonly roster: readonly RosterMember[];
}

/** Authoring input for {@link createLobbyCompany}. */
export interface LobbyCompanyInit {
  readonly id: CompanyId;
  readonly name: string;
  /** Defaults to `0` (a fresh company). */
  readonly rating?: number;
  readonly roster: readonly RosterMember[];
}

/** Validate and normalise a lobby company, failing loudly at the boundary. */
export function createLobbyCompany(init: LobbyCompanyInit): LobbyCompany {
  if (typeof init.name !== "string" || init.name.trim().length === 0) {
    throw new LobbyError("lobby company name must be a non-empty string");
  }
  const rating = init.rating ?? 0;
  if (!Number.isInteger(rating) || rating < 0) {
    throw new LobbyError(
      `lobby company rating must be a non-negative integer, received ${String(rating)}`,
    );
  }
  if (!Array.isArray(init.roster) || init.roster.length === 0) {
    throw new LobbyError("lobby company must field at least one soldier");
  }
  const seen = new Set<string>();
  for (const member of init.roster) {
    if (seen.has(member.unit.id)) {
      throw new LobbyError(`lobby company roster duplicates unit id ${member.unit.id}`);
    }
    seen.add(member.unit.id);
  }
  return { id: init.id, name: init.name, rating, roster: init.roster };
}

/**
 * Build a lobby match card from a campaign {@link Company}. The rating is
 * optional and defaults to `0`; the company's economy and theatre are
 * deliberately not copied — a lobby only needs identity, rating and roster.
 */
export function lobbyCompanyFromCompany(
  company: Pick<Company, "id" | "name" | "roster">,
  rating = 0,
): LobbyCompany {
  return createLobbyCompany({
    id: company.id,
    name: company.name,
    rating,
    roster: company.roster,
  });
}

/* --------------------------------------------------------------------------
 * Matchmaking
 * ------------------------------------------------------------------------ */

/** One company waiting in the matchmaking queue. */
export interface MatchTicket {
  /** The company waiting for an opponent. */
  readonly company: LobbyCompany;
  /**
   * The ticket's place in the queue. Assigned by the caller (a counter), not by
   * a clock, so the same queue always matches the same way.
   */
  readonly ticket: number;
}

/** Two companies matched to fight a 1v1 skirmish. */
export interface LobbyPairing {
  /** The company that will fight as `company`. */
  readonly home: LobbyCompany;
  /** The company that will fight as `enemy`. */
  readonly away: LobbyCompany;
}

/**
 * The opponent whose rating is closest to `company`'s, or `null` for an empty
 * pool. Ties are broken by pool order (the earliest ticket wins), and the
 * company itself is never matched (same id). Deterministic: the same pool and
 * company always yield the same opponent.
 */
export function closestOpponent(
  company: LobbyCompany,
  pool: readonly LobbyCompany[],
): LobbyCompany | null {
  let best: LobbyCompany | null = null;
  let bestDistance = Infinity;
  for (const candidate of pool) {
    if (candidate.id === company.id) continue;
    const distance = Math.abs(candidate.rating - company.rating);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

/** The pairings and the single ticket (if any) a greedy pass leaves behind. */
interface GreedyMatchmaking {
  readonly pairings: readonly LobbyPairing[];
  readonly leftover: MatchTicket | null;
}

/**
 * One greedy pass over a queue: take the earliest ticket, find its closest
 * opponent among the rest, pair them and remove both. Deterministic and
 * total-order free, so a test can pin the exact pairing.
 */
function greedyMatchmaking(tickets: readonly MatchTicket[]): GreedyMatchmaking {
  const remaining = [...tickets];
  const pairings: LobbyPairing[] = [];
  while (remaining.length >= 2) {
    const home = remaining.shift() as MatchTicket;
    const opponentIndex = closestIndexOf(home.company, remaining);
    const away = remaining.splice(opponentIndex, 1)[0] as MatchTicket;
    pairings.push({ home: home.company, away: away.company });
  }
  return { pairings, leftover: remaining[0] ?? null };
}

/**
 * Greedily pair a matchmaking queue. An odd ticket is left unpaired (and
 * reported by {@link leftoverTicket}).
 */
export function matchmake(tickets: readonly MatchTicket[]): readonly LobbyPairing[] {
  return greedyMatchmaking(tickets).pairings;
}

/** The single ticket left unpaired by {@link matchmake}, or `null`. */
export function leftoverTicket(tickets: readonly MatchTicket[]): MatchTicket | null {
  return greedyMatchmaking(tickets).leftover;
}

/** Index within `pool` of the closest-rated company (ties by pool order). */
function closestIndexOf(company: LobbyCompany, pool: readonly MatchTicket[]): number {
  let bestIndex = -1;
  let bestDistance = Infinity;
  for (let index = 0; index < pool.length; index++) {
    const candidate = pool[index]?.company;
    if (candidate === undefined || candidate.id === company.id) continue;
    const distance = Math.abs(candidate.rating - company.rating);
    if (distance < bestDistance) {
      bestIndex = index;
      bestDistance = distance;
    }
  }
  return bestIndex < 0 ? 0 : bestIndex;
}

/* --------------------------------------------------------------------------
 * Lobby seats
 * ------------------------------------------------------------------------ */

/** How far along a seat is: joined, or joined and ready to fight. */
export const LOBBY_SEAT_STATES = ["joined", "ready"] as const;
export type LobbySeatState = (typeof LOBBY_SEAT_STATES)[number];

/** One company seated in a lobby. */
export interface LobbySeat {
  /** The peer id the seat will use for the whole match (0 or 1). */
  readonly peer: PeerId;
  /** The seated company. */
  readonly company: LobbyCompany;
  /** Whether the company has confirmed it is ready to start. */
  readonly state: LobbySeatState;
}

/** Configuration for a {@link Lobby}. */
export interface LobbyConfig {
  /** A label for the match (logged with the result, never a game rule). */
  readonly matchId: string;
  /** The battle seed both peers will share. */
  readonly seed: Seed;
  /** Seats in the lobby; defaults to 2 (a 1v1 skirmish). */
  readonly size?: number;
}

/* --------------------------------------------------------------------------
 * Lobby
 * ------------------------------------------------------------------------ */

/**
 * A two-seat lobby: companies {@link join}, mark themselves {@link setReady}
 * and, once all seats are ready, the match {@link start | starts}.
 *
 * The lobby is deliberately not a network transport — it is the handshake a
 * transport can carry. Each transition is validated (`LobbyError`) so a client
 * cannot start a half-filled or not-ready match.
 */
export class Lobby {
  /** The label both peers tag the match with. */
  readonly matchId: string;
  /** The shared battle seed. */
  readonly seed: Seed;
  private readonly maxSeats: number;
  private readonly seatList: LobbySeat[] = [];

  constructor(config: LobbyConfig) {
    if (typeof config.matchId !== "string" || config.matchId.trim().length === 0) {
      throw new LobbyError("lobby matchId must be a non-empty string");
    }
    const size = config.size ?? 2;
    if (!Number.isInteger(size) || size < 2) {
      throw new LobbyError(`lobby size must be an integer >= 2, received ${String(size)}`);
    }
    this.matchId = config.matchId;
    this.seed = config.seed;
    this.maxSeats = size;
  }

  /** Total seats in the lobby. */
  get size(): number {
    return this.maxSeats;
  }

  /** Seats in join order (peer ids ascend from `0`). */
  get seats(): readonly LobbySeat[] {
    return this.seatList;
  }

  /** `true` when every seat is taken. */
  get isFull(): boolean {
    return this.seatList.length >= this.maxSeats;
  }

  /** `true` when the lobby is full and every seat is ready. */
  get canStart(): boolean {
    return this.isFull && this.seatList.every((seat) => seat.state === "ready");
  }

  /** Peer ids of the seated companies, in join order. */
  get peers(): readonly PeerId[] {
    return this.seatList.map((seat) => seat.peer);
  }

  /**
   * Seat a company, assigning it the next free peer id. Duplicate companies
   * (same id) are refused so a player cannot be matched against themselves.
   */
  join(company: LobbyCompany): LobbySeat {
    if (this.isFull) throw new LobbyError("the lobby is full");
    if (this.seatList.some((seat) => seat.company.id === company.id)) {
      throw new LobbyError(`company ${company.id} is already seated`);
    }
    const seat: LobbySeat = { peer: this.seatList.length, company, state: "joined" };
    this.seatList.push(seat);
    return seat;
  }

  /** Mark the seat at `peer` ready. Idempotent; unknown peers are refused. */
  setReady(peer: PeerId): LobbySeat {
    const seat = this.seat(peer);
    if (seat.state === "ready") return seat;
    const updated: LobbySeat = { ...seat, state: "ready" };
    this.seatList[this.seatList.indexOf(seat)] = updated;
    return updated;
  }

  /** The seat at `peer`, or throw {@link LobbyError}. */
  seat(peer: PeerId): LobbySeat {
    const seat = this.seatList.find((candidate) => candidate.peer === peer);
    if (seat === undefined) throw new LobbyError(`no seat for peer ${peer}`);
    return seat;
  }

  /**
   * Start the match, building a {@link LobbyMatch}. Requires {@link canStart}.
   * The lobby is left full and ready so a caller may keep it for a rematch with
   * a fresh seed by constructing a new lobby.
   */
  start(): LobbyMatch {
    if (!this.isFull) throw new LobbyError("cannot start: the lobby is not full");
    if (!this.canStart) throw new LobbyError("cannot start: not every seat is ready");
    const deployment = deploySkirmish(this.seed, this.seatList);
    return new LobbyMatch(this.matchId, this.seed, deployment);
  }
}

/* --------------------------------------------------------------------------
 * Deployment
 * ------------------------------------------------------------------------ */

/**
 * The deterministic pairing of companies to battlefield units: the shared
 * {@link BattleSetup}, the side each peer fights for, and the lookup from a
 * deployed unit back to the peer that commands it.
 */
export interface SkirmishDeployment {
  /** The seed both peers were configured with (mirrored for convenience). */
  readonly seed: Seed;
  /** The shared, deterministic battle description. */
  readonly setup: BattleSetup;
  /** Participants in canonical (ascending peer id) order. */
  readonly peers: readonly PeerId[];
  /** Which side each peer fights for (`company` vs `enemy`). */
  readonly sideOfPeer: ReadonlyMap<PeerId, UnitSide>;
  /** The peer that commands each deployed unit. */
  readonly peerOfUnit: ReadonlyMap<UnitId, PeerId>;
  /** The company each peer fields. */
  readonly companyOfPeer: ReadonlyMap<PeerId, LobbyCompany>;
}

/** A mostly open field with a low ridge on each flank — the skirmish ground. */
function buildSkirmishMap(): TerrainMap {
  let map = createTerrainMap(SKIRMISH_WIDTH, SKIRMISH_HEIGHT, "field");
  const place = (x: number, y: number, height: number): void => {
    map = withTile(map, coord(x, y), { terrain: "hill", height });
  };
  // Symmetric rises to give elevation some texture without walling the lanes.
  place(3, 1, 1);
  place(3, SKIRMISH_HEIGHT - 2, 1);
  place(SKIRMISH_WIDTH - 4, 1, 1);
  place(SKIRMISH_WIDTH - 4, SKIRMISH_HEIGHT - 2, 1);
  return map;
}

/** The deployment lane for a side, centred vertically, at most `count` tiles. */
function deployLane(side: UnitSide, count: number): Coord[] {
  const x = side === "company" ? 1 : SKIRMISH_WIDTH - 2;
  const startY = Math.max(0, Math.floor((SKIRMISH_HEIGHT - count) / 2));
  const tiles: Coord[] = [];
  for (let index = 0; index < count; index++) {
    tiles.push(coord(x, startY + index));
  }
  return tiles;
}

/** The direction a side faces its opponent. */
function facingFor(side: UnitSide): Facing {
  return side === "company" ? "east" : "west";
}

/**
 * Deploy `seat`'s company on `side`. Up to {@link SKIRMISH_DEPLOY_LIMIT}
 * soldiers take the field, in roster order, rebuilt with a peer-scoped id, the
 * correct side and facing, and full health. Rebuilding through `createUnit`
 * (T017) means a malformed roster fails here rather than corrupting the match.
 */
function deployCompany(seat: LobbySeat, side: UnitSide): Unit[] {
  const company = seat.company;
  const fielded = company.roster.slice(0, SKIRMISH_DEPLOY_LIMIT);
  const lane = deployLane(side, fielded.length);
  return fielded.map((member, index) =>
    createUnit({
      ...member.unit,
      // Namespace the id by peer so two companies with overlapping unit ids
      // (a real possibility across saves) never collide on one field.
      id: asUnitId(`${seat.peer}:${member.unit.id}`),
      side,
      at: lane[index] as Coord,
      facing: facingFor(side),
      // A skirmish deploys fresh: full health and Élan, no lingering conditions
      // or Honour carried in from a previous action.
      hp: undefined,
      mp: undefined,
      judgePoints: 0,
      conditions: [],
    }),
  );
}

/**
 * Build the shared skirmish {@link BattleSetup} for two seated companies: peer
 * 0 fights as `company`, peer 1 as `enemy`, on a symmetric field with the
 * shared {@link SKIRMISH_ACTIONS} and an **annihilation** objective. The
 * objective gives the action a decisive end condition once ability effects are
 * applied through `step`; until then the frame cap in {@link runSkirmish}
 * closes the match as a ceasefire.
 *
 * The setup is a pure function of the seed and the seats, so both peers derive
 * a byte-identical battle from the same lobby.
 */
export function deploySkirmish(seed: Seed, seats: readonly LobbySeat[]): SkirmishDeployment {
  if (seats.length < 2) {
    throw new LobbyError(`a skirmish needs at least two companies, received ${seats.length}`);
  }
  const peers = seats.map((seat) => seat.peer);
  const sideOfPeer = new Map<PeerId, UnitSide>();
  const companyOfPeer = new Map<PeerId, LobbyCompany>();
  const units: Unit[] = [];
  const peerOfUnit = new Map<UnitId, PeerId>();

  seats.forEach((seat, index) => {
    const side: UnitSide = index === 0 ? "company" : "enemy";
    sideOfPeer.set(seat.peer, side);
    companyOfPeer.set(seat.peer, seat.company);
    for (const unit of deployCompany(seat, side)) {
      peerOfUnit.set(unit.id, seat.peer);
      units.push(unit);
    }
  });

  const setup: BattleSetup = {
    map: buildSkirmishMap(),
    units,
    abilities: SKIRMISH_ACTIONS,
    objective: { kind: "annihilation" },
  };

  return { seed, setup, peers, sideOfPeer, peerOfUnit, companyOfPeer };
}

/* --------------------------------------------------------------------------
 * The match
 * ------------------------------------------------------------------------ */

/**
 * One live 1v1 skirmish, as seen from every peer at once. Each peer holds its
 * own {@link LockstepSession} over the same seed and deployment; a transport
 * would ship each peer only its own view, but keeping both here is what lets a
 * test (or an offline demo) drive and audit both sides in lockstep.
 */
export class LobbyMatch {
  /** The lobby's label for the match. */
  readonly matchId: string;
  /** The shared battle seed. */
  readonly seed: Seed;
  /** The shared deployment (map, units, sides). */
  readonly deployment: SkirmishDeployment;

  private readonly sessionsByPeer: ReadonlyMap<PeerId, LockstepSession>;

  constructor(matchId: string, seed: Seed, deployment: SkirmishDeployment) {
    this.matchId = matchId;
    this.seed = seed;
    this.deployment = deployment;
    const sessions = new Map<PeerId, LockstepSession>();
    for (const peer of deployment.peers) {
      sessions.set(
        peer,
        new LockstepSession({
          seed,
          setup: deployment.setup,
          peers: deployment.peers,
          localPeer: peer,
        }),
      );
    }
    this.sessionsByPeer = sessions;
  }

  /** Participants in canonical order. */
  get peers(): readonly PeerId[] {
    return this.deployment.peers;
  }

  /** The session for one peer; throws {@link LobbyError} for an unknown peer. */
  sessionFor(peer: PeerId): LockstepSession {
    const session = this.sessionsByPeer.get(peer);
    if (session === undefined) throw new LobbyError(`no session for peer ${peer}`);
    return session;
  }

  /** A reference view of the battle (the first peer's session). */
  get state(): BattleState {
    return this.sessionFor(this.deployment.peers[0] as PeerId).state;
  }

  /** The frame currently being collected (all sessions share the index). */
  get frame(): number {
    return this.sessionFor(this.deployment.peers[0] as PeerId).frame;
  }

  /**
   * Apply one lockstep frame: feed every peer's commands into every peer's
   * session in canonical order, resolve them all, and return one
   * {@link LockstepFrame} per peer.
   *
   * Any peer's commands are validated by the session (`isCommand`); a command
   * the rules refuse is recorded on the frame rather than thrown. If the peers'
   * resulting hashes differ, the match has desynced and
   * {@link LockstepDesyncError} is thrown with a {@link DesyncReport} naming the
   * offending peer.
   */
  resolve(commandsByPeer: ReadonlyMap<PeerId, readonly Command[]>): readonly LockstepFrame[] {
    for (const peer of commandsByPeer.keys()) {
      if (!this.deployment.peers.includes(peer)) {
        throw new LobbyError(`command map names unknown peer ${peer}`);
      }
    }
    for (const [peer, commands] of commandsByPeer) {
      for (const command of commands) {
        if (!isCommand(command)) {
          throw new LobbyError(`peer ${peer} issued a malformed command`);
        }
      }
    }

    const frames: LockstepFrame[] = [];
    const framePeers: PeerId[] = [];
    for (const peer of this.deployment.peers) {
      const session = this.sessionFor(peer);
      session.submit(...(commandsByPeer.get(peer) ?? []));
      for (const other of this.deployment.peers) {
        if (other === peer) continue;
        session.receive(other, ...(commandsByPeer.get(other) ?? []));
      }
      frames.push(session.resolve());
      framePeers.push(peer);
    }

    const reference = frames[0] as LockstepFrame;
    for (let index = 1; index < frames.length; index++) {
      const frame = frames[index] as LockstepFrame;
      if (frame.hash !== reference.hash) {
        throw new LockstepDesyncError({
          frame: frame.index,
          localHash: reference.hash,
          remoteHash: frame.hash,
          remotePeer: framePeers[index] as PeerId,
        });
      }
    }
    return frames;
  }

  /**
   * Every peer's hash report for `frame` (default: the latest resolved frame).
   * A caller shares these and compares them with `verifyHash`; a healthy match
   * reports one hash for all peers.
   */
  hashReports(frame?: number): readonly HashReport[] {
    return this.deployment.peers.map((peer) => this.sessionFor(peer).localReport(frame));
  }
}

/* --------------------------------------------------------------------------
 * Headless skirmish runner
 * ------------------------------------------------------------------------ */

/** Context handed to a {@link SkirmishPolicy} alongside the battle and actor. */
export interface SkirmishPolicyContext {
  /** The peer that commands the actor. */
  readonly peer: PeerId;
  /** The shared deployment. */
  readonly deployment: SkirmishDeployment;
}

/**
 * Chooses one order for the acting soldier. Must return a legal, serialisable
 * {@link Command} for `actorId`. A peer only ever chooses for its own soldiers.
 */
export type SkirmishPolicy = (
  state: BattleState,
  actorId: UnitId,
  context: SkirmishPolicyContext,
) => Command;

/**
 * The default skirmish policy: T095's utility AI, capped to a small per-decision
 * search so a whole match stays interactive. It issues only orders the engine
 * accepts and never consults a clock or `Math.random`.
 */
export const aiSkirmishPolicy: SkirmishPolicy = (state, actorId) =>
  chooseCommand(state, actorId, { maxDestinations: SKIRMISH_SEARCH_LIMIT });

/** Options for {@link runSkirmish}. */
export interface SkirmishOptions {
  /** Command chooser; defaults to {@link aiSkirmishPolicy}. */
  readonly policy?: SkirmishPolicy;
  /** Hard frame cap; defaults to {@link SKIRMISH_MAX_FRAMES}. */
  readonly maxFrames?: number;
}

/** The result of a completed (or capped) 1v1 skirmish. */
export interface SkirmishResult {
  /** The lobby's match label. */
  readonly matchId: string;
  /** The shared seed. */
  readonly seed: Seed;
  /** The final battle, per the first peer's session. */
  readonly state: BattleState;
  /** The engine outcome when the action ended, else `null` for a ceasefire. */
  readonly outcome: BattleOutcome | null;
  /** Orders Tempo frames resolved. */
  readonly frames: number;
  /** Orders issued across both peers. */
  readonly commands: number;
  /** Different events observed, in order. */
  readonly events: number;
  /** One hash report per peer; all equal in a healthy match. */
  readonly reports: readonly HashReport[];
  /** `true` when every peer's final hash agreed. */
  readonly agreed: boolean;
  /** The shared deployment. */
  readonly deployment: SkirmishDeployment;
}

/**
 * Play a whole 1v1 skirmish headlessly. Each frame, the peer that commands the
 * current actor is asked for one order via `policy` (the other peers pass);
 * the frame is applied to every session and hashed. The loop stops when the
 * battle finishes, when the frame cap is reached, or when the current actor is
 * commanded by no peer.
 *
 * Because every order goes through the lockstep sessions, `runSkirmish` is
 * itself deterministic: the same match and policy always produce the same
 * result and hashes.
 */
export function runSkirmish(match: LobbyMatch, options: SkirmishOptions = {}): SkirmishResult {
  const maxFrames = options.maxFrames ?? SKIRMISH_MAX_FRAMES;
  const policy = options.policy ?? aiSkirmishPolicy;
  const peers = match.peers;

  let frames = 0;
  let commands = 0;
  let eventCount = 0;

  while (
    match.state.phase === "active" &&
    match.state.currentActorId !== null &&
    frames < maxFrames
  ) {
    const actorId = match.state.currentActorId;
    const owner = match.deployment.peerOfUnit.get(actorId) ?? null;
    if (owner === null) break; // an unowned (neutral) actor cannot advance a 1v1.

    const byPeer = new Map<PeerId, readonly Command[]>();
    for (const peer of peers) byPeer.set(peer, []);
    const command = policy(match.state, actorId, { peer: owner, deployment: match.deployment });
    byPeer.set(owner, [command]);

    const resolved = match.resolve(byPeer);
    const frame = resolved[0];
    if (frame !== undefined) eventCount += frame.events.length;
    commands += 1;
    frames += 1;
  }

  const reports = match.hashReports();
  const initial = reports[0]?.hash as StateHash | undefined;
  const agreed = reports.every((report) => report.hash === initial);

  return {
    matchId: match.matchId,
    seed: match.seed,
    state: match.state,
    outcome: match.state.phase === "finished" ? match.state.outcome : null,
    frames,
    commands,
    events: eventCount,
    reports,
    agreed,
    deployment: match.deployment,
  };
}
