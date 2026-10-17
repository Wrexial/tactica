import { describe, expect, it } from "vitest";

import { ARTICLES } from "../../src/data/articles";
import type { StatBlock } from "../../src/data/schema";
import { coord } from "../../src/engine/grid";
import { asPostId, asUnitId } from "../../src/engine/ids";
import { HONOUR_MAX, createUnit, type Unit, type UnitInit } from "../../src/engine/unit";
import { detectArticles } from "../../src/engine/rules/articles";
import {
  GUARD_SORTIE_COST,
  HONOUR_AWARD_REASONS,
  HONOUR_LEGAL_KO,
  HONOUR_SPEND_REASONS,
  awardCommended,
  awardHonour,
  awardLegalKo,
  canAffordHonour,
  honourAwardForEvent,
  honourEventFor,
  honourRoom,
  isHonourAwardReason,
  isHonourMaxed,
  isHonourSpendReason,
  resolveHonourEvent,
  spendHonour,
} from "../../src/engine/rules/honour";

/* --------------------------------------------------------------------------
 * T060 — Honour economy
 *
 * Pins the task's "done when": **Honour from legal KOs and commended acts; cap
 * 10; no stacking for one event.** The engine
 * (`src/engine/rules/honour.ts`) is the pure state machine; the commended
 * amounts are authored data (`ArticleDef.honour`, T054) and the legal-KO award
 * is a re-authored balance constant. The tests also pin purity and determinism,
 * because a battle replays from a seed plus a command log (`agents.md` §2).
 * ------------------------------------------------------------------------ */

const STATS: StatBlock = {
  hp: 80,
  mp: 20,
  atk: 20,
  def: 20,
  mag: 20,
  res: 20,
  spd: 20,
  move: 4,
  jump: 2,
};

function makeUnit(overrides: Partial<UnitInit> = {}): Unit {
  return createUnit({
    id: asUnitId("unit-soldier"),
    name: "Sgt. Aubry",
    power: "france",
    postId: asPostId("fusilier"),
    level: 1,
    at: coord(2, 3),
    stats: { ...STATS },
    ...overrides,
  });
}

/* --------------------------------------------------------------------------
 * Data — the authored Honour knobs
 * ------------------------------------------------------------------------ */

describe("Honour tunables", () => {
  it("awards one Honour per legal KO and costs ten for a Guard Sortie", () => {
    // FFTA: one Judge Point per legal KO; Totema cost 10 = the cap.
    expect(HONOUR_LEGAL_KO).toBe(1);
    expect(GUARD_SORTIE_COST).toBe(10);
    expect(GUARD_SORTIE_COST).toBe(HONOUR_MAX);
  });

  it("exposes the reason vocabularies and runtime guards", () => {
    expect(HONOUR_AWARD_REASONS).toEqual(["legalKo", "commended"]);
    expect(HONOUR_SPEND_REASONS).toEqual(["volley", "guardSortie", "penalty"]);
    for (const reason of HONOUR_AWARD_REASONS) expect(isHonourAwardReason(reason)).toBe(true);
    for (const reason of HONOUR_SPEND_REASONS) expect(isHonourSpendReason(reason)).toBe(true);
    expect(isHonourAwardReason("volley")).toBe(false);
    expect(isHonourSpendReason("legalKo")).toBe(false);
    expect(isHonourAwardReason(7)).toBe(false);
    expect(isHonourSpendReason(null)).toBe(false);
  });
});

/* --------------------------------------------------------------------------
 * The no-stacking rule
 * ------------------------------------------------------------------------ */

describe("honourAwardForEvent — one event, one award", () => {
  it("awards the legal-KO point for a legal knockout", () => {
    expect(honourAwardForEvent({ legalKo: true })).toEqual({
      amount: HONOUR_LEGAL_KO,
      reason: "legalKo",
    });
  });

  it("awards the authored honour for a commended act", () => {
    expect(honourAwardForEvent({ commended: [ARTICLES["commend-volley-fire"]] })).toEqual({
      amount: 2,
      reason: "commended",
    });
  });

  it("does not stack a legal KO with a commended act", () => {
    // FFTA: "Judge Points cannot be stacked." The event grants the larger
    // single award, never the sum.
    const award = honourAwardForEvent({
      legalKo: true,
      commended: [ARTICLES["commend-volley-fire"]], // honour 2
    });
    expect(award).toEqual({ amount: 2, reason: "commended" });
    expect(award.amount).not.toBe(HONOUR_LEGAL_KO + 2);

    // Ties go to the more specific commendation, still a single award.
    expect(honourAwardForEvent({ legalKo: true, commended: [ARTICLES["commend-musket"]] })).toEqual(
      { amount: 1, reason: "commended" },
    );
  });

  it("does not sum several commendations on one event", () => {
    // Volley Fire (2) + Colours (3) + Musket (1) would sum to 6 if stacked.
    const award = honourAwardForEvent({
      commended: [
        ARTICLES["commend-volley-fire"],
        ARTICLES["commend-colours"],
        ARTICLES["commend-musket"],
      ],
    });
    expect(award).toEqual({ amount: 3, reason: "commended" });
  });

  it("ignores non-commend Articles and empty events", () => {
    expect(honourAwardForEvent({ commended: [ARTICLES["no-fire"]] })).toEqual({
      amount: 0,
      reason: null,
    });
    expect(honourAwardForEvent({})).toEqual({ amount: 0, reason: null });
    expect(honourAwardForEvent({ legalKo: false, commended: [] })).toEqual({
      amount: 0,
      reason: null,
    });
  });
});

/* --------------------------------------------------------------------------
 * Detection → event bridge (T056 integration)
 * ------------------------------------------------------------------------ */

describe("honourEventFor — translating an Article verdict", () => {
  it("treats a KO that broke no Article as legal", () => {
    const detection = detectArticles([ARTICLES["commend-musket"], ARTICLES["no-fire"]], {
      weaponTypes: ["musket"],
    });
    expect(detection.unlawful).toBe(false);

    const event = honourEventFor(detection, true);
    expect(event.legalKo).toBe(true);
    expect(event.commended).toEqual([ARTICLES["commend-musket"]]);
    expect(honourAwardForEvent(event).reason).toBe("commended");
  });

  it("treats a KO that broke an Article as illegal and unworthy of Honour", () => {
    const detection = detectArticles(
      [ARTICLES["no-fire"]],
      { elements: ["fire"] }, // breaks No Incendiary, and no KO credit
    );
    expect(detection.unlawful).toBe(true);

    const event = honourEventFor(detection, true);
    expect(event.legalKo).toBe(false);
    expect(honourAwardForEvent(event)).toEqual({ amount: 0, reason: null });
  });

  it("never credits a legal KO without a knockout", () => {
    const detection = detectArticles([ARTICLES["commend-musket"]], { weaponTypes: ["musket"] });
    expect(honourEventFor(detection, false).legalKo).toBe(false);
  });

  it("omits the commended key when nothing was commended", () => {
    const detection = detectArticles([ARTICLES["no-fire"]], { weaponTypes: ["musket"] });
    expect(honourEventFor(detection, false)).toEqual({ legalKo: false });
  });
});

/* --------------------------------------------------------------------------
 * Applying awards
 * ------------------------------------------------------------------------ */

describe("awardLegalKo / awardCommended — the resource moves", () => {
  it("banks a legal-KO point and emits honourChanged", () => {
    const unit = makeUnit({ judgePoints: 3 });
    const result = awardLegalKo(unit, 7);

    expect(result.amount).toBe(HONOUR_LEGAL_KO);
    expect(result.unit.judgePoints).toBe(4);
    expect(result.events).toEqual([
      {
        kind: "honourChanged",
        tick: 7,
        unitId: unit.id,
        delta: 1,
        honourAfter: 4,
        reason: "legalKo",
      },
    ]);
  });

  it("banks a commendation and narrates it before the resource change", () => {
    const unit = makeUnit();
    const result = awardCommended(unit, 2, 11);

    expect(result.amount).toBe(2);
    expect(result.unit.judgePoints).toBe(2);
    expect(result.events.map((event) => event.kind)).toEqual(["commended", "honourChanged"]);
    expect(result.events[0]).toMatchObject({ kind: "commended", tick: 11, honour: 2 });
    expect(result.events[1]).toMatchObject({
      kind: "honourChanged",
      delta: 2,
      honourAfter: 2,
      reason: "commended",
    });
  });

  it("caps a large award at the maximum and reports only what was banked", () => {
    const unit = makeUnit({ judgePoints: 9 });
    const result = awardCommended(unit, 3, 4);

    expect(result.amount).toBe(1);
    expect(result.unit.judgePoints).toBe(HONOUR_MAX);
    expect(result.events[1]).toMatchObject({ kind: "honourChanged", delta: 1, honourAfter: 10 });
    // The narration reports the points actually banked, not the article's value.
    expect(result.events[0]).toMatchObject({ kind: "commended", honour: 1 });
  });

  it("is a no-op at the cap and for a zero-value commendation", () => {
    const maxed = makeUnit({ judgePoints: HONOUR_MAX });
    const capped = awardLegalKo(maxed);
    expect(capped.unit).toBe(maxed);
    expect(capped.amount).toBe(0);
    expect(capped.events).toEqual([]);

    const zero = awardCommended(makeUnit(), 0);
    expect(zero.unit.judgePoints).toBe(0);
    expect(zero.events).toEqual([]);
  });

  it("never mutates the input unit", () => {
    const unit = makeUnit({ judgePoints: 3 });
    const before = JSON.stringify(unit);
    awardLegalKo(unit);
    awardCommended(unit, 2);
    expect(JSON.stringify(unit)).toBe(before);
  });

  it("rejects malformed amounts, reasons and ticks", () => {
    expect(() => awardHonour(makeUnit(), -1, "legalKo")).toThrow(RangeError);
    expect(() => awardHonour(makeUnit(), 1.5, "legalKo")).toThrow(RangeError);
    expect(() => awardHonour(makeUnit(), 1, "nonsense" as never)).toThrow(RangeError);
    expect(() => awardHonour(makeUnit(), 1, "legalKo", -1)).toThrow(RangeError);
    expect(() => awardCommended(makeUnit(), -2)).toThrow(RangeError);
  });
});

describe("resolveHonourEvent — the battle-facing entry point", () => {
  it("resolves a legal KO through to the pool", () => {
    const detection = detectArticles([ARTICLES["no-fire"]], { actionId: "bayonet-charge" });
    const unit = makeUnit({ judgePoints: 5 });
    const result = resolveHonourEvent(unit, honourEventFor(detection, true), 3);

    expect(result.amount).toBe(1);
    expect(result.unit.judgePoints).toBe(6);
    expect(result.events).toHaveLength(1);
  });

  it("resolves a commended act without double-counting a KO", () => {
    const detection = detectArticles([ARTICLES["commend-volley-fire"]], {
      actionId: "volley-fire",
    });
    const unit = makeUnit({ judgePoints: 8 });
    const result = resolveHonourEvent(unit, honourEventFor(detection, true), 9);

    // Commended (2) beats the legal-KO point (1); total gain is 2, not 3.
    expect(result.amount).toBe(2);
    expect(result.unit.judgePoints).toBe(HONOUR_MAX);
    expect(result.events.map((event) => event.kind)).toEqual(["commended", "honourChanged"]);
  });

  it("is a no-op for an unlawful KO and for an event that earns nothing", () => {
    const unit = makeUnit({ judgePoints: 4 });
    const detection = detectArticles([ARTICLES["no-fire"]], { elements: ["fire"] });

    expect(resolveHonourEvent(unit, honourEventFor(detection, true)).unit).toBe(unit);
    expect(resolveHonourEvent(unit, {}).unit).toBe(unit);
    expect(resolveHonourEvent(unit, {}).events).toEqual([]);
  });

  it("is deterministic", () => {
    const detection = detectArticles([ARTICLES["commend-musket"]], { weaponTypes: ["musket"] });
    const event = honourEventFor(detection, true);
    const unit = makeUnit();
    expect(resolveHonourEvent(unit, event, 4)).toEqual(resolveHonourEvent(unit, event, 4));
  });
});

/* --------------------------------------------------------------------------
 * Spending (T061 / T062)
 * ------------------------------------------------------------------------ */

describe("spendHonour — Volleys and Guard Sorties", () => {
  it("pays a Guard Sortie's ten Honour and empties the pool", () => {
    const unit = makeUnit({ judgePoints: HONOUR_MAX });
    const result = spendHonour(unit, GUARD_SORTIE_COST, "guardSortie", 20);

    expect(result.amount).toBe(10);
    expect(result.unit.judgePoints).toBe(0);
    expect(result.events[0]).toMatchObject({
      kind: "honourChanged",
      delta: -10,
      honourAfter: 0,
      reason: "guardSortie",
    });
  });

  it("clamps an over-spend and reports the actual cost", () => {
    const unit = makeUnit({ judgePoints: 3 });
    const result = spendHonour(unit, 5, "volley", 2);

    expect(result.amount).toBe(3);
    expect(result.unit.judgePoints).toBe(0);
    expect(result.events[0]).toMatchObject({ kind: "honourChanged", delta: -3 });
  });

  it("is a no-op for a zero cost or an empty pool", () => {
    const unit = makeUnit({ judgePoints: 0 });
    expect(spendHonour(unit, 4, "volley").unit).toBe(unit);
    expect(spendHonour(unit, 4, "volley").events).toEqual([]);

    const rich = makeUnit({ judgePoints: 5 });
    expect(spendHonour(rich, 0, "volley").unit).toBe(rich);
  });

  it("rejects malformed costs and reasons", () => {
    expect(() => spendHonour(makeUnit(), -1, "volley")).toThrow(RangeError);
    expect(() => spendHonour(makeUnit(), 1.5, "volley")).toThrow(RangeError);
    expect(() => spendHonour(makeUnit(), 1, "legalKo" as never)).toThrow(RangeError);
    expect(() => spendHonour(makeUnit(), 1, "volley", -1)).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Queries
 * ------------------------------------------------------------------------ */

describe("Honour queries", () => {
  it("reports affordability, room and the cap", () => {
    const unit = makeUnit({ judgePoints: 7 });
    expect(canAffordHonour(unit, 7)).toBe(true);
    expect(canAffordHonour(unit, 8)).toBe(false);
    expect(honourRoom(unit)).toBe(3);
    expect(isHonourMaxed(unit)).toBe(false);

    const maxed = makeUnit({ judgePoints: HONOUR_MAX });
    expect(honourRoom(maxed)).toBe(0);
    expect(isHonourMaxed(maxed)).toBe(true);
  });

  it("rejects a malformed affordability cost", () => {
    expect(() => canAffordHonour(makeUnit(), -1)).toThrow(RangeError);
  });
});
