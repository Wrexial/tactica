import { describe, expect, it } from "vitest";

import type { Company } from "../../src/engine/company";
import { coord } from "../../src/engine/grid";
import { asCompanyId, asPostId, asUnitId } from "../../src/engine/ids";
import { createPostAssignment } from "../../src/engine/progression/posts";
import { createUnit, type Unit } from "../../src/engine/unit";
import type { StatBlock } from "../../src/data/schema";
import {
  Lobby,
  LobbyError,
  aiSkirmishPolicy,
  closestOpponent,
  createLobbyCompany,
  deploySkirmish,
  leftoverTicket,
  lobbyCompanyFromCompany,
  matchmake,
  runSkirmish,
  type LobbyCompany,
  type LobbySeat,
} from "../../src/net/lobby";

/* --------------------------------------------------------------------------
 * T113 — Lobby & matchmaking
 *
 * The task's "done when": a 1v1 skirmish between two free companies. These
 * tests pin the pieces the e2e drives:
 *   1. matchmaking picks a deterministic, closest-rated opponent;
 *   2. the lobby seats two companies, demands both be ready, then starts;
 *   3. deployment puts the two rosters on opposite sides of one shared battle;
 *   4. both peers' lockstep sessions stay byte-identical across a whole match.
 * ------------------------------------------------------------------------ */

const SEED = "sainte-colombe-1809";

/**
 * Battle-worthy line-soldier stats. Authored here rather than derived from a
 * post because this suite exercises the lobby/net path, not T018's growth
 * tables — and the utility AI needs Move and Speed to have a real action.
 */
const SKIRMISH_STATS: StatBlock = {
  hp: 24,
  mp: 12,
  atk: 14,
  def: 6,
  mag: 4,
  res: 6,
  spd: 29,
  move: 4,
  jump: 2,
};

/** Build one soldier's roster member for a lobby company. */
function makeMember(index: number) {
  const assignment = createPostAssignment({
    primaryPostId: asPostId("fusilier"),
    power: "france",
  });
  const unit: Unit = createUnit({
    id: asUnitId(`unit-${index}`),
    name: `Soldier ${index}`,
    power: "france",
    postId: asPostId("fusilier"),
    level: 1,
    at: coord(0, 0),
    stats: { ...SKIRMISH_STATS, spd: SKIRMISH_STATS.spd + index },
  });
  return { unit, assignment, recruitedOnDay: 1 };
}

/** A lobby company of `size` identical line soldiers. */
function makeCompany(id: string, name: string, rating: number, size = 2): LobbyCompany {
  return createLobbyCompany({
    id: asCompanyId(id),
    name,
    rating,
    roster: Array.from({ length: size }, (_, index) => makeMember(index)),
  });
}

/** Seat two companies and start their match. */
function startMatch(
  home = makeCompany("home", "The Greycoats", 10),
  away = makeCompany("away", "The Red Roses", 40),
) {
  const lobby = new Lobby({ matchId: "match-1", seed: SEED });
  lobby.join(home);
  lobby.join(away);
  lobby.setReady(0);
  lobby.setReady(1);
  return lobby.start();
}

/* --------------------------------------------------------------------------
 * Companies
 * ------------------------------------------------------------------------ */

describe("LobbyCompany", () => {
  it("validates identity, rating and roster", () => {
    const roster = [makeMember(0)];
    expect(() => createLobbyCompany({ id: asCompanyId("c"), name: "", rating: 0, roster })).toThrow(
      LobbyError,
    );
    expect(() =>
      createLobbyCompany({ id: asCompanyId("c"), name: "A", rating: -1, roster }),
    ).toThrow(LobbyError);
    expect(() => createLobbyCompany({ id: asCompanyId("c"), name: "A", roster: [] })).toThrow(
      LobbyError,
    );
    expect(() =>
      createLobbyCompany({
        id: asCompanyId("c"),
        name: "A",
        roster: [makeMember(0), makeMember(0)],
      }),
    ).toThrow(LobbyError);
  });

  it("derives a match card from a campaign company", () => {
    const company = {
      id: asCompanyId("company-1"),
      name: "The Greycoats",
      roster: [makeMember(0)],
    } satisfies Pick<Company, "id" | "name" | "roster">;

    const card = lobbyCompanyFromCompany(company, 7);
    expect(card.id).toBe("company-1");
    expect(card.name).toBe("The Greycoats");
    expect(card.rating).toBe(7);
    expect(card.roster).toHaveLength(1);
  });
});

/* --------------------------------------------------------------------------
 * Matchmaking
 * ------------------------------------------------------------------------ */

describe("matchmaking", () => {
  const pool = [makeCompany("a", "A", 5), makeCompany("b", "B", 30), makeCompany("c", "C", 90)];

  it("picks the closest-rated opponent, tie-broken by pool order", () => {
    expect(closestOpponent(makeCompany("me", "Me", 28), pool)?.id).toBe("b");
    expect(closestOpponent(makeCompany("me", "Me", 5), pool)?.id).toBe("a");
    // 30 and 5 are equidistant from 17.5 → the earliest (5) wins.
    expect(closestOpponent(makeCompany("me", "Me", 17), pool)?.id).toBe("a");
    expect(closestOpponent(makeCompany("me", "Me", 0), [])).toBeNull();
  });

  it("never matches a company against itself", () => {
    const company = makeCompany("solo", "Solo", 50);
    expect(closestOpponent(company, [company])).toBeNull();
  });

  it("greedily pairs a queue and leaves an odd ticket behind", () => {
    const pairings = matchmake([
      { ticket: 0, company: pool[0] as LobbyCompany },
      { ticket: 1, company: pool[1] as LobbyCompany },
      { ticket: 2, company: pool[2] as LobbyCompany },
    ]);
    expect(pairings).toHaveLength(1);
    // Ticket 0 matches ticket 1 (|5-30|=25) over ticket 2 (|5-90|=85).
    expect(pairings[0]?.home.id).toBe("a");
    expect(pairings[0]?.away.id).toBe("b");

    const queue = [
      { ticket: 0, company: pool[0] as LobbyCompany },
      { ticket: 1, company: pool[1] as LobbyCompany },
      { ticket: 2, company: pool[2] as LobbyCompany },
    ];
    expect(leftoverTicket(queue)?.company.id).toBe("c");
    expect(leftoverTicket(queue.slice(0, 2))).toBeNull();

    // A (0) matches C (10) over B (100), so the middle ticket is left over —
    // not merely the last one in the queue.
    const skewed = [
      { ticket: 0, company: makeCompany("a2", "A", 0) },
      { ticket: 1, company: makeCompany("b2", "B", 100) },
      { ticket: 2, company: makeCompany("c2", "C", 10) },
    ];
    expect(leftoverTicket(skewed)?.company.id).toBe("b2");
  });
});

/* --------------------------------------------------------------------------
 * Lobby handshake
 * ------------------------------------------------------------------------ */

describe("Lobby", () => {
  it("seats entrants, requires readiness and then starts", () => {
    const lobby = new Lobby({ matchId: "m", seed: SEED });
    expect(lobby.isFull).toBe(false);
    expect(lobby.canStart).toBe(false);

    const home = lobby.join(makeCompany("home", "Home", 10));
    expect(home.peer).toBe(0);
    const away = lobby.join(makeCompany("away", "Away", 20));
    expect(away.peer).toBe(1);
    expect(lobby.isFull).toBe(true);
    expect(lobby.canStart).toBe(false);
    expect(() => lobby.start()).toThrow(LobbyError);

    lobby.setReady(0);
    expect(lobby.canStart).toBe(false);
    lobby.setReady(1);
    expect(lobby.canStart).toBe(true);

    const match = lobby.start();
    expect(match.peers).toEqual([0, 1]);
    expect(match.seed).toBe(SEED);
  });

  it("refuses a full lobby, a duplicate company and an unknown seat", () => {
    const lobby = new Lobby({ matchId: "m", seed: SEED });
    lobby.join(makeCompany("home", "Home", 10));
    lobby.join(makeCompany("away", "Away", 20));
    expect(() => lobby.join(makeCompany("third", "Third", 30))).toThrow(LobbyError);

    const other = new Lobby({ matchId: "m", seed: SEED });
    other.join(makeCompany("home", "Home", 10));
    expect(() => other.join(makeCompany("home", "Home", 10))).toThrow(LobbyError);
    expect(() => other.setReady(9)).toThrow(LobbyError);
  });
});

/* --------------------------------------------------------------------------
 * Deployment
 * ------------------------------------------------------------------------ */

describe("deploySkirmish", () => {
  it("puts the two companies on opposite sides of one shared battle", () => {
    const deployment = deploySkirmish(SEED, [
      { peer: 0, company: makeCompany("home", "Home", 10), state: "ready" },
      { peer: 1, company: makeCompany("away", "Away", 20), state: "ready" },
    ]);

    expect(deployment.peers).toEqual([0, 1]);
    expect(deployment.sideOfPeer.get(0)).toBe("company");
    expect(deployment.sideOfPeer.get(1)).toBe("enemy");
    expect(deployment.setup.units).toHaveLength(4);
    expect(deployment.setup.objective).toEqual({ kind: "annihilation" });

    for (const unit of deployment.setup.units) {
      const peer = deployment.peerOfUnit.get(unit.id);
      expect(peer).toBe(unit.side === "company" ? 0 : 1);
      expect(unit.id.startsWith(`${peer}:`)).toBe(true);
    }
  });

  it("caps the fielded roster and is a pure function of the seed and seats", () => {
    const seats: readonly LobbySeat[] = [
      { peer: 0, company: makeCompany("home", "Home", 10, 6), state: "ready" },
      { peer: 1, company: makeCompany("away", "Away", 20, 6), state: "ready" },
    ];
    const first = deploySkirmish(SEED, seats);
    const second = deploySkirmish(SEED, seats);
    expect(first.setup.units).toHaveLength(8); // 4 per side, capped
    expect(second.setup).toEqual(first.setup);
  });
});

/* --------------------------------------------------------------------------
 * The match
 * ------------------------------------------------------------------------ */

describe("LobbyMatch", () => {
  it("keeps both peers' sessions in lockstep across a whole skirmish", () => {
    const match = startMatch();
    const result = runSkirmish(match, { maxFrames: 24 });

    expect(result.agreed).toBe(true);
    expect(result.reports).toHaveLength(2);
    expect(result.reports[0]?.hash).toBe(result.reports[1]?.hash);
    expect(result.frames).toBeGreaterThan(0);
    expect(result.commands).toBe(result.frames);

    // The two sessions expose the same battle value, byte for byte.
    expect(match.sessionFor(1).state).toEqual(match.sessionFor(0).state);
  });

  it("supports a pluggable policy", () => {
    const match = startMatch();
    let calls = 0;
    const result = runSkirmish(match, {
      maxFrames: 6,
      policy: (_state, actorId) => {
        calls += 1;
        return { kind: "wait", unitId: actorId };
      },
    });
    expect(result.agreed).toBe(true);
    expect(calls).toBe(result.commands);
    expect(calls).toBeGreaterThan(0);
  });

  it("plays a full action with the utility AI, keeping both peers agreed", () => {
    const match = startMatch();
    const result = runSkirmish(match, { policy: aiSkirmishPolicy, maxFrames: 48 });
    expect(result.agreed).toBe(true);
    expect(result.frames).toBe(48);
    expect(result.commands).toBe(result.frames);
    // The engine's `step` still only declares/resolves actions (the effect
    // executor, T041, is wired by later work), so a volley exchange may reach
    // the frame cap as a ceasefire. Either way every peer must agree.
    expect(result.reports[0]?.hash).toBe(result.reports[1]?.hash);
    expect(result.state.phase).toBe("active");
  });
});
