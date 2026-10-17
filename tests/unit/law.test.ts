import { describe, expect, it } from "vitest";

import { ARTICLES } from "../../src/data/articles";
import { GUARD_SORTIES } from "../../src/data/guards";
import type { ArticleDef, StatBlock } from "../../src/data/schema";
import type { AbilityExecutionOptions, SteelEffect } from "../../src/engine/actions/ability";
import {
  executeGuardSortie,
  guardSortieSpec,
  guardSortieUnlockPredicate,
  unlockedGuardSorties,
  type GuardSortieOptions,
  type GuardSortieSpec,
} from "../../src/engine/actions/guardSortie";
import { executeVolley, scaleVolleyPower, type VolleySpec } from "../../src/engine/actions/volley";
import { createBattle, findUnit, type BattleState } from "../../src/engine/battle";
import { unitTarget, type Target } from "../../src/engine/commands";
import { isBattleEvent, type BattleEvent } from "../../src/engine/events";
import { coord, type Coord } from "../../src/engine/grid";
import { asAbilityId, asArticleId, asPostId, asUnitId, type UnitId } from "../../src/engine/ids";
import {
  applyCourtMartial,
  articleSubjectOfAction,
  commission,
  detectArticles,
  escalateBreach,
  firstBreach,
  generateDailyArticles,
} from "../../src/engine/rules/articles";
import {
  GUARD_SORTIE_COST,
  HONOUR_LEGAL_KO,
  awardCommended,
  honourAwardForEvent,
  honourEventFor,
  resolveHonourEvent,
  spendHonour,
} from "../../src/engine/rules/honour";
import { Rng } from "../../src/engine/rng";
import { createTerrainMap } from "../../src/engine/terrain";
import {
  HONOUR_MAX,
  createUnit,
  type Unit,
  type UnitInit,
  type UnitSide,
} from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T067 — Article system tests
 *
 * This is the **integration** suite for the Articles of War. The individual
 * pieces are already tested piecemeal (T055–T062); here they are driven end to
 * end, in the order a real battle meets them:
 *
 * ```text
 *   resolved action ──► detectArticles   (T056)  which Article did it break?
 *          │
 *          ▼
 *     escalateBreach  (T057)  Reprimand (Yellow) or Court-Martial (Red)?
 *          │
 *          ▼
 *   applyCourtMartial  (T058)  a Red Card removes the soldier;
 *          │                   a commander's removal ends the action
 *          ▼
 *   honourEventFor / resolveHonourEvent  (T060)  legal KOs and commended acts
 *          │                                     bank Honour (cap 10, no stacking)
 *          ▼
 *   executeVolley   (T061)  spend Honour; adjacent allies chain in
 *   executeGuardSortie (T062)  spend 10 Honour; strike the whole field
 * ```
 *
 * The suite pins the task's "done when": the **full violation → card → removal
 * flow**, the **Honour economy**, and both Honour sinks (**Volley** and **Guard
 * Sortie**). It also re-checks the engine's contracts where the layers meet —
 * purity, deterministic ordering and well-formed events — because a battle
 * replays from a seed plus a command log (`agents.md` §2).
 * ------------------------------------------------------------------------ */

const BASE_STATS: StatBlock = {
  hp: 60,
  mp: 20,
  atk: 20,
  def: 8,
  mag: 10,
  res: 8,
  spd: 20,
  move: 4,
  jump: 2,
};

/**
 * The standing orders in force for this suite. A deliberately small posting so
 * every test can name the Article it expects a breach to land on:
 * three forbidding orders (one of them grave) and two commended acts.
 */
const POSTING: readonly ArticleDef[] = [
  ARTICLES["no-fire"], // forbid element "fire"
  ARTICLES["no-rifle"], // forbid weapon "rifle"
  ARTICLES["no-poison"], // forbid condition "poison" (court-martial on first offence)
  ARTICLES["commend-volley-fire"], // commend action "volley-fire" (honour 2)
  ARTICLES["commend-musket"], // commend weapon "musket" (honour 1)
];

const COMMANDER_ID = asUnitId("unit-commander");
const SOLDIER_ID = asUnitId("unit-soldier");
const HERO_ID = asUnitId("unit-hero");
const ENEMY_ID = asUnitId("unit-enemy");

/** A minimal, valid soldier fixture; only what a test uses needs overriding. */
function makeUnit(
  id: UnitId,
  at: Coord,
  side: UnitSide = "company",
  overrides: Partial<UnitInit> = {},
): Unit {
  return createUnit({
    id,
    name: `Soldier ${id}`,
    power: "france",
    postId: asPostId("fusilier"),
    side,
    level: 1,
    at,
    stats: { ...BASE_STATS },
    ...overrides,
  });
}

/**
 * The company for the enforcement flow: a commander, the soldier who will
 * offend, a second soldier who never does, and an enemy. The offender is always
 * {@link SOLDIER_ID}.
 */
function lawRoster(): Unit[] {
  return [
    makeUnit(COMMANDER_ID, coord(1, 1)),
    makeUnit(SOLDIER_ID, coord(2, 1)),
    makeUnit(HERO_ID, coord(3, 1)),
    makeUnit(ENEMY_ID, coord(11, 7), "enemy"),
  ];
}

/* ==========================================================================
 * Full violation → card → removal flow (T055–T058)
 * ======================================================================== */

describe("Articles of War — full enforcement flow", () => {
  it("runs violation → Reprimand → second violation → Court-Martial → removal", () => {
    const units = lawRoster();
    const offender = units.find((unit) => unit.id === SOLDIER_ID);
    expect(offender).toBeDefined();

    // 1. A resolved action exposes its facts; detection names the breach.
    const subject = articleSubjectOfAction({ id: "canister-shot", element: "fire" });
    const verdict = detectArticles(POSTING, subject);
    expect(verdict.unlawful).toBe(true);
    expect(verdict.broken.map((match) => match.article.id)).toEqual(["no-fire"]);
    const breach = firstBreach(verdict);
    expect(breach?.article.id).toBe("no-fire");

    // 2. A first, non-lethal offence draws a Reprimand (Yellow Card).
    const first = escalateBreach(breach!.article, { reprimands: 0 });
    expect(first).toEqual({ severity: "reprimand", reprimands: 1 });

    // 3. A second offence draws a Court-Martial (Red Card).
    const second = escalateBreach(breach!.article, { reprimands: first.reprimands });
    expect(second).toEqual({ severity: "courtMartial", reprimands: 1 });

    // 4. The Red Card removes the soldier from the field.
    const removal = applyCourtMartial(
      { units, commanderId: COMMANDER_ID, tick: 6 },
      { unitId: offender!.id, articleId: asArticleId(breach!.article.id) },
    );
    expect(removal.removed).toBe(offender);
    expect(removal.units.map((unit) => unit.id)).not.toContain(SOLDIER_ID);
    expect(removal.commander).toBe(false);
    expect(removal.finished).toBe(false);
    expect(removal.outcome).toBeNull();
    expect(removal.events.map((event) => event.kind)).toEqual([
      "courtMartialIssued",
      "unitRemoved",
    ]);
    for (const event of removal.events) expect(isBattleEvent(event)).toBe(true);
  });

  it("keeps every soldier not convicted, in their original order", () => {
    const units = lawRoster();
    const removal = applyCourtMartial(
      { units },
      { unitId: SOLDIER_ID, articleId: asArticleId("no-fire") },
    );
    expect(removal.units.map((unit) => unit.id)).toEqual([COMMANDER_ID, HERO_ID, ENEMY_ID]);
    // Structural sharing: the survivors are the very same unit objects.
    expect(removal.units[0]).toBe(units[0]);
    expect(removal.units[1]).toBe(units[2]);
  });

  it("opens a grave order at Court-Martial on a clean record", () => {
    const subject = articleSubjectOfAction({
      id: "envenomed-ball",
      effects: [{ inflicts: ["poison"] }],
    });
    const breach = firstBreach(detectArticles(POSTING, subject));
    expect(breach?.article.id).toBe("no-poison");
    expect(escalateBreach(breach!.article, { reprimands: 0 })).toEqual({
      severity: "courtMartial",
      reprimands: 0,
    });
  });

  it("turns a first offence into a Court-Martial when it caused an illegal KO", () => {
    const breach = firstBreach(detectArticles(POSTING, { elements: ["fire"] }));
    expect(escalateBreach(breach!.article, { reprimands: 0, illegalKo: true })).toEqual({
      severity: "courtMartial",
      reprimands: 0,
    });
  });

  it("ends the action in defeat when the commander is court-martialled", () => {
    const units = lawRoster();
    const removal = applyCourtMartial(
      { units, commanderId: COMMANDER_ID, tick: 9 },
      { unitId: COMMANDER_ID, articleId: asArticleId("no-dark") },
    );

    expect(removal.commander).toBe(true);
    expect(removal.finished).toBe(true);
    expect(removal.outcome).toBe("companyDefeat");
    expect(removal.events.map((event) => event.kind)).toEqual([
      "courtMartialIssued",
      "unitRemoved",
      "battleEnded",
    ]);
    expect(removal.events[2]).toMatchObject({ kind: "battleEnded", outcome: "companyDefeat" });
  });

  it("a Commission caps escalation at a Reprimand and stays the removal", () => {
    const article = ARTICLES["no-poison"]; // grave: would be a Red Card for anyone else
    expect(escalateBreach(article, { reprimands: 0, commissioned: true })).toEqual({
      severity: "reprimand",
      reprimands: 1,
    });

    const units = lawRoster();
    const removal = applyCourtMartial(
      { units, commissions: [commission(HERO_ID)], tick: 4 },
      { unitId: HERO_ID, articleId: asArticleId(article.id) },
    );
    expect(removal.immune).toBe(true);
    expect(removal.removed).toBeUndefined();
    expect(removal.units).toBe(units);
    expect(removal.events).toEqual([]);
  });

  it("is pure: the input roster is never mutated and the ruling is reproducible", () => {
    const units = lawRoster();
    const before = JSON.stringify(units);
    const request = { unitId: SOLDIER_ID, articleId: asArticleId("no-fire") };

    const first = applyCourtMartial({ units, tick: 3 }, request);
    const second = applyCourtMartial({ units, tick: 3 }, request);

    expect(JSON.stringify(units)).toBe(before);
    expect(second.units.map((unit) => unit.id)).toEqual(first.units.map((unit) => unit.id));
    expect(second.events).toEqual(first.events);
  });

  it("checks an action against the day's generated posting, not the whole pool", () => {
    const day = generateDailyArticles("waterloo-1815", 12);
    const verdict = detectArticles(day.articles, {
      actionId: "canister-shot",
      elements: ["fire"],
      weaponTypes: ["rifle"],
      inflicts: ["poison"],
    });

    for (const match of verdict.broken) {
      expect(day.forbidden.map((article) => article.id)).toContain(match.article.id);
      expect(match.article.kind).toBe("forbid");
    }
    for (const match of verdict.commended) {
      expect(day.commended.map((article) => article.id)).toContain(match.article.id);
      expect(match.article.kind).toBe("commend");
    }
  });
});

/* ==========================================================================
 * The Honour economy (T060)
 * ======================================================================== */

describe("Honour economy driven by the Articles", () => {
  it("banks one Honour for a legal KO and the authored value for a commended act", () => {
    const actor = makeUnit(SOLDIER_ID, coord(2, 1), "company", { judgePoints: 0 });

    // A legal KO: the action broke no active Article.
    const clean = detectArticles(POSTING, articleSubjectOfAction({ id: "bayonet-charge" }));
    expect(clean.unlawful).toBe(false);
    const legal = resolveHonourEvent(actor, honourEventFor(clean, true), 1);
    expect(legal.amount).toBe(HONOUR_LEGAL_KO);
    expect(legal.unit.judgePoints).toBe(1);
    expect(legal.events.map((event) => event.kind)).toEqual(["honourChanged"]);

    // A commended act awards the Article's authored honour.
    const commended = resolveHonourEvent(
      actor,
      honourEventFor(detectArticles(POSTING, { actionId: "volley-fire" }), false),
      2,
    );
    expect(commended.amount).toBe(ARTICLES["commend-volley-fire"].honour);
    expect(commended.events.map((event) => event.kind)).toEqual(["commended", "honourChanged"]);
  });

  it("never stacks a KO and a commendation on one event", () => {
    const detection = detectArticles(POSTING, {
      actionId: "volley-fire",
      weaponTypes: ["musket"],
    });
    const event = honourEventFor(detection, true);

    expect(event.commended?.map((article) => article.id)).toEqual([
      "commend-volley-fire",
      "commend-musket",
    ]);
    // The best single award wins; the KO point is not added on top.
    expect(honourAwardForEvent(event)).toEqual({
      amount: ARTICLES["commend-volley-fire"].honour,
      reason: "commended",
    });
  });

  it("awards nothing for an unlawful KO — the Court-Martial is the answer instead", () => {
    const actor = makeUnit(SOLDIER_ID, coord(2, 1), "company", { judgePoints: 4 });
    const detection = detectArticles(POSTING, { elements: ["fire"] });
    expect(detection.unlawful).toBe(true);

    const change = resolveHonourEvent(actor, honourEventFor(detection, true));
    expect(change.amount).toBe(0);
    expect(change.unit).toBe(actor);
    expect(change.events).toEqual([]);
  });

  it("caps Honour at ten and reports only what was actually banked", () => {
    const atNine = makeUnit(SOLDIER_ID, coord(2, 1), "company", {
      judgePoints: HONOUR_MAX - 1,
    });
    const capped = awardCommended(atNine, 3);
    expect(capped.amount).toBe(1);
    expect(capped.unit.judgePoints).toBe(HONOUR_MAX);
    expect(awardCommended(capped.unit, 2).events).toEqual([]);
  });

  it("spends Honour on a Volley and a Guard Sortie through the shared economy", () => {
    const rich = makeUnit(SOLDIER_ID, coord(2, 1), "company", { judgePoints: HONOUR_MAX });

    const volley = spendHonour(rich, 3, "volley", 2);
    expect(volley.amount).toBe(3);
    expect(volley.unit.judgePoints).toBe(7);
    expect(volley.events[0]).toMatchObject({
      kind: "honourChanged",
      delta: -3,
      reason: "volley",
    });

    const sortie = spendHonour(rich, GUARD_SORTIE_COST, "guardSortie", 3);
    expect(sortie.amount).toBe(GUARD_SORTIE_COST);
    expect(sortie.unit.judgePoints).toBe(0);
    expect(sortie.events[0]).toMatchObject({
      kind: "honourChanged",
      delta: -GUARD_SORTIE_COST,
      reason: "guardSortie",
    });
  });

  it("is pure: an award returns a new unit and leaves the input untouched", () => {
    const actor = makeUnit(SOLDIER_ID, coord(2, 1), "company", { judgePoints: 3 });
    const before = JSON.stringify(actor);
    awardCommended(actor, 2);
    expect(JSON.stringify(actor)).toBe(before);
  });
});

/* ==========================================================================
 * Volleys (T061) — the first Honour sink
 * ======================================================================== */

const V_ACTOR = asUnitId("v-actor");
const V_ALLY_A = asUnitId("v-ally-a");
const V_ALLY_B = asUnitId("v-ally-b");
const V_FAR = asUnitId("v-far");
const V_ENEMY = asUnitId("v-enemy");
const V_MAP = createTerrainMap(8, 6, "field");

/**
 * A firing line: the initiator and two neighbours around the mark, plus a
 * distant ally that must **not** chain in at the adjacent default range.
 */
function volleyBattle(actorJudgePoints = 8): BattleState {
  return createBattle(1815, {
    map: V_MAP,
    units: [
      makeUnit(V_ACTOR, coord(3, 3), "company", { judgePoints: actorJudgePoints }),
      makeUnit(V_ALLY_A, coord(4, 2), "company"),
      makeUnit(V_ALLY_B, coord(4, 4), "company"),
      makeUnit(V_FAR, coord(6, 5), "company"),
      makeUnit(V_ENEMY, coord(4, 3), "enemy", {
        stats: { ...BASE_STATS, hp: 500, def: 10 },
      }),
    ],
  });
}

function volleyActorOf(state: BattleState): Unit {
  const actor = findUnit(state, V_ACTOR);
  if (actor === undefined) throw new Error("volley actor missing");
  return actor;
}

function steel(power: number): SteelEffect {
  return { kind: "steel", power };
}

function volleyFire(overrides: Partial<VolleySpec> = {}): VolleySpec {
  return {
    id: asAbilityId("volley-fire"),
    mpCost: 0,
    chargeTime: 0,
    range: 1,
    power: 100,
    target: "enemy",
    hitRate: 100,
    effects: [steel(100)],
    ...overrides,
  };
}

/** A guaranteed-hit volley so damage assertions are about scaling, not luck. */
const SURE_HIT: AbilityExecutionOptions = { evasionOf: () => 0 };

function runVolley(
  state: BattleState,
  spec: VolleySpec,
  honour: number,
  target: Target = unitTarget(V_ENEMY),
  options: AbilityExecutionOptions = SURE_HIT,
): ReturnType<typeof executeVolley> {
  return executeVolley(state, volleyActorOf(state), spec, target, honour, new Rng("t067"), options);
}

function totalDamage(events: readonly BattleEvent[]): number {
  return events.reduce((sum, event) => (event.kind === "damaged" ? sum + event.amount : sum), 0);
}

describe("Volleys — spending Honour with the company", () => {
  it("spends the initiator's Honour and chains adjacent allies, but not distant ones", () => {
    const state = volleyBattle(8);
    const result = runVolley(state, volleyFire(), 3);

    expect(result.ok).toBe(true);
    expect(result.honourSpent).toBe(3);
    expect(findUnit(result.state, V_ACTOR)?.judgePoints).toBe(5);

    expect(result.linkers).toEqual([V_ALLY_A, V_ALLY_B]);
    const chained = result.events
      .filter((event) => event.kind === "volleyChained")
      .map((event) => event.unitId);
    expect(chained).toEqual([V_ALLY_A, V_ALLY_B]);
    expect(chained).not.toContain(V_FAR);
    expect(findUnit(result.state, V_ALLY_A)?.judgePoints).toBe(0);
    expect(findUnit(result.state, V_ALLY_B)?.judgePoints).toBe(0);

    expect(result.events.every(isBattleEvent)).toBe(true);
  });

  it("scales the volley's damage with the Honour committed", () => {
    const low = runVolley(volleyBattle(8), volleyFire(), 1);
    const high = runVolley(volleyBattle(8), volleyFire(), 5);

    expect(totalDamage(high.events)).toBeGreaterThan(totalDamage(low.events));
    expect(findUnit(high.state, V_ENEMY)!.hp).toBeLessThan(findUnit(low.state, V_ENEMY)!.hp);
    // The FFTA combo curve: (10 + 4 × honour) / 10.
    expect(scaleVolleyPower(100, 5)).toBe(300);
  });

  it("refuses a commitment larger than the pool without spending a point", () => {
    const state = volleyBattle(2);
    const result = runVolley(state, volleyFire(), 5);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("insufficient-honour");
    expect(result.honourSpent).toBe(0);
    expect(result.state).toBe(state);
    expect(findUnit(result.state, V_ACTOR)?.judgePoints).toBe(2);
  });

  it("a commended volley banks Honour back through detection", () => {
    const detection = detectArticles(POSTING, { actionId: "volley-fire" });
    const actor = makeUnit(V_ACTOR, coord(3, 3), "company", { judgePoints: 0 });
    const change = resolveHonourEvent(actor, honourEventFor(detection, false), 1);

    expect(change.amount).toBe(2);
    expect(change.unit.judgePoints).toBe(2);
  });
});

/* ==========================================================================
 * Guard Sorties (T062) — the second Honour sink
 * ======================================================================== */

const G_CALLER = asUnitId("g-caller");
const G_ALLY = asUnitId("g-ally");
const G_ENEMY_A = asUnitId("g-enemy-a");
const G_ENEMY_B = asUnitId("g-enemy-b");
const G_MAP = createTerrainMap(14, 10, "field");

/** A callable field: the caller holds Honour and enemies are spread far apart. */
function guardBattle(callerJudgePoints = HONOUR_MAX): BattleState {
  return createBattle(1815, {
    map: G_MAP,
    units: [
      makeUnit(G_CALLER, coord(1, 1), "company", { judgePoints: callerJudgePoints }),
      makeUnit(G_ALLY, coord(1, 2), "company"),
      makeUnit(G_ENEMY_A, coord(12, 8), "enemy", { stats: { ...BASE_STATS, hp: 900 } }),
      makeUnit(G_ENEMY_B, coord(2, 7), "enemy", { stats: { ...BASE_STATS, hp: 900 } }),
    ],
  });
}

function callerOf(state: BattleState): Unit {
  const caller = findUnit(state, G_CALLER);
  if (caller === undefined) throw new Error("guard sortie caller missing");
  return caller;
}

function oldGuard(): GuardSortieSpec {
  return guardSortieSpec(GUARD_SORTIES["old-guard"]);
}

const UNLOCK_ALL: GuardSortieOptions = { isUnlocked: () => true };

function runGuard(
  state: BattleState,
  spec: GuardSortieSpec,
  options: GuardSortieOptions = UNLOCK_ALL,
): ReturnType<typeof executeGuardSortie> {
  return executeGuardSortie(state, callerOf(state), spec, new Rng("t067"), options);
}

function damageTo(events: readonly BattleEvent[], unitId: UnitId): number {
  return events.reduce(
    (sum, event) =>
      event.kind === "damaged" && event.unitId === unitId ? sum + event.amount : sum,
    0,
  );
}

describe("Guard Sorties — spending the full Honour cap", () => {
  it("costs ten Honour, empties the pool, and strikes the whole enemy field", () => {
    const result = runGuard(guardBattle(HONOUR_MAX), oldGuard());

    expect(result.ok).toBe(true);
    expect(result.honourSpent).toBe(GUARD_SORTIE_COST);
    expect(findUnit(result.state, G_CALLER)?.judgePoints).toBe(0);
    expect(result.targets).toEqual([G_ENEMY_A, G_ENEMY_B]);
    expect(damageTo(result.events, G_ENEMY_A)).toBeGreaterThan(0);
    expect(damageTo(result.events, G_ENEMY_B)).toBeGreaterThan(0);
    expect(damageTo(result.events, G_ALLY)).toBe(0);
    expect(result.events.every(isBattleEvent)).toBe(true);
  });

  it("refuses a formation the story has not yet met", () => {
    const state = guardBattle();
    const result = runGuard(state, oldGuard(), {
      isUnlocked: guardSortieUnlockPredicate(1),
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("locked");
    expect(result.honourSpent).toBe(0);
    expect(result.state).toBe(state);
    expect(unlockedGuardSorties(1)).toEqual([]);
    expect(unlockedGuardSorties(2)).toContain("old-guard");
  });

  it("answers once the campaign reaches the formation's chapter", () => {
    const result = runGuard(guardBattle(), oldGuard(), {
      isUnlocked: guardSortieUnlockPredicate(2),
    });
    expect(result.ok).toBe(true);
    expect(result.honourSpent).toBe(GUARD_SORTIE_COST);
  });

  it("refuses a caller short of the ten-Honour cost", () => {
    const state = guardBattle(HONOUR_MAX - 1);
    const result = runGuard(state, oldGuard());

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("insufficient-honour");
    expect(result.state).toBe(state);
    expect(findUnit(result.state, G_CALLER)?.judgePoints).toBe(HONOUR_MAX - 1);
  });

  it("Honour earned from commendations can fund the sortie", () => {
    // Five commended volleys at two Honour apiece fill the pool to the cap.
    let caller = makeUnit(G_CALLER, coord(1, 1), "company", { judgePoints: 0 });
    for (let i = 0; i < 5; i++) {
      caller = awardCommended(caller, ARTICLES["commend-volley-fire"].honour).unit;
    }
    expect(caller.judgePoints).toBe(HONOUR_MAX);

    const state = createBattle(1815, {
      map: G_MAP,
      units: [
        caller,
        makeUnit(G_ALLY, coord(1, 2), "company"),
        makeUnit(G_ENEMY_A, coord(12, 8), "enemy", { stats: { ...BASE_STATS, hp: 900 } }),
        makeUnit(G_ENEMY_B, coord(2, 7), "enemy", { stats: { ...BASE_STATS, hp: 900 } }),
      ],
    });

    const result = executeGuardSortie(state, caller, oldGuard(), new Rng("t067"), {
      isUnlocked: guardSortieUnlockPredicate(2),
    });
    expect(result.ok).toBe(true);
    expect(result.honourSpent).toBe(GUARD_SORTIE_COST);
    expect(findUnit(result.state, G_CALLER)?.judgePoints).toBe(0);
  });
});
