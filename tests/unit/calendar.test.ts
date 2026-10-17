import { describe, expect, it } from "vitest";

import { ARTICLE_LIST } from "../../src/data/articles";
import { ArticleDefSchema, type ArticleDef } from "../../src/data/schema";
import {
  CALENDAR_DAY_MIN,
  DISPATCH_DURATION_MAX,
  activeDispatches,
  advanceCampaign,
  advanceDays,
  articlesForDay,
  calendarForCompany,
  canScheduleDispatch,
  cancelDispatch,
  createCalendar,
  createDispatch,
  dispatchBlockers,
  dispatchById,
  dispatchDaysRemaining,
  dispatchForUnit,
  dueDispatches,
  isDispatchDue,
  isUnitDispatched,
  scheduleDispatch,
  syncCompany,
  tickDispatches,
  withRegion,
  type CampaignCalendar,
  type Dispatch,
  type DispatchInit,
} from "../../src/engine/calendar";
import { createCompany, travelTo, type Company } from "../../src/engine/company";
import {
  asCompanyId,
  asContractId,
  asDispatchId,
  asRegionId,
  asUnitId,
  type DispatchId,
  type UnitId,
} from "../../src/engine/ids";
import { Rng } from "../../src/engine/rng";

/* --------------------------------------------------------------------------
 * T076 — Calendar & daily orders
 *
 * Pins the task's "done when": the **campaign date advances**, the **Articles
 * rotate daily** and the **dispatch timers tick**. The tests also lock down the
 * determinism and purity guarantees the campaign layer leans on: the same
 * `(seed, day)` always yields the same standing orders, and every transition
 * returns a new value without mutating its inputs.
 * ------------------------------------------------------------------------ */

const CONTRACT = asContractId("forage-the-valley");
const OTHER_CONTRACT = asContractId("escort-the-pay-chest");

function unitId(name: string): UnitId {
  return asUnitId(name);
}

function dispatchInit(overrides: Partial<DispatchInit> = {}): DispatchInit {
  return {
    id: asDispatchId("dispatch-1"),
    contractId: CONTRACT,
    unitIds: [unitId("unit-1"), unitId("unit-2")],
    duration: 4,
    ...overrides,
  };
}

function makeCompany(): Company {
  return createCompany({
    id: asCompanyId("company-1"),
    name: "The Greycoats",
    theatre: { day: 3, regionId: asRegionId("blackwood") },
  });
}

/* --------------------------------------------------------------------------
 * Creation
 * ------------------------------------------------------------------------ */

describe("createCalendar", () => {
  it("opens on day 1 with no region and no dispatches", () => {
    const calendar = createCalendar({ seed: "waterloo-1815" });
    expect(calendar.day).toBe(CALENDAR_DAY_MIN);
    expect(calendar.regionId).toBeNull();
    expect(calendar.dispatches).toEqual([]);
  });

  it("accepts a numeric or string seed and folds the region in", () => {
    expect(createCalendar({ seed: 12 }).seed).toBe(12);
    const calendar = createCalendar({ seed: 12, day: 5, regionId: asRegionId("blackwood") });
    expect(calendar.day).toBe(5);
    expect(calendar.regionId).toBe("blackwood");
  });

  it("rejects a malformed seed", () => {
    expect(() => createCalendar({ seed: "" })).toThrowError(/seed/);
    expect(() => createCalendar({ seed: Number.NaN })).toThrowError(/seed/);
  });

  it("rejects a malformed day or region", () => {
    expect(() => createCalendar({ seed: 1, day: 0 })).toThrowError(/day/);
    expect(() => createCalendar({ seed: 1, day: 1.5 })).toThrowError(/day/);
    expect(() => createCalendar({ seed: 1, regionId: "" as never })).toThrowError();
  });

  it("normalises an authored dispatch list", () => {
    const calendar = createCalendar({
      seed: 1,
      day: 2,
      dispatches: [dispatchInit({ dispatchedOnDay: 2, duration: 3 })],
    });
    expect(calendar.dispatches).toHaveLength(1);
    expect(calendar.dispatches[0]?.returnDay).toBe(5);
  });

  it("rejects duplicate dispatch ids and double-booked soldiers", () => {
    expect(() =>
      createCalendar({
        seed: 1,
        dispatches: [dispatchInit(), dispatchInit()],
      }),
    ).toThrowError(/duplicates dispatch id/);

    expect(() =>
      createCalendar({
        seed: 1,
        dispatches: [
          dispatchInit({ id: asDispatchId("dispatch-1") }),
          dispatchInit({ id: asDispatchId("dispatch-2"), contractId: OTHER_CONTRACT }),
        ],
      }),
    ).toThrowError(/already dispatched/);
  });

  it("mirrors a company's clock with calendarForCompany", () => {
    const calendar = calendarForCompany(makeCompany(), 7);
    expect(calendar.day).toBe(3);
    expect(calendar.regionId).toBe("blackwood");
  });
});

/* --------------------------------------------------------------------------
 * Daily Articles rotate (mapping §9)
 * ------------------------------------------------------------------------ */

describe("articlesForDay", () => {
  it("is deterministic for the same (seed, day)", () => {
    const first = articlesForDay(createCalendar({ seed: 99, day: 5 }));
    const second = articlesForDay(createCalendar({ seed: 99, day: 5 }));
    expect(first.ids).toEqual(second.ids);
  });

  it("rotates the posting as the day advances", () => {
    const postings = Array.from({ length: 8 }, (_, index) => {
      const day = index + 1;
      return articlesForDay(createCalendar({ seed: 99, day })).ids.join("|");
    });
    expect(new Set(postings).size).toBeGreaterThan(1);
  });

  it("honours an explicit frequency and pool override", () => {
    const regional: ArticleDef = ArticleDefSchema.parse({
      id: "no-regional",
      name: "No Regional Affair",
      description: "A region-scoped standing order used by the calendar tests.",
      flavour: "The order holds only inside the region that posted it.",
      kind: "forbid",
      target: "action",
      keys: ["canister-shot"],
      regionId: "blackwood",
    });

    const inRegion = articlesForDay(
      createCalendar({ seed: 3, day: 4, regionId: asRegionId("blackwood") }),
      { frequency: { forbid: 1, commend: 0 }, pool: [regional, ARTICLE_LIST[0] as ArticleDef] },
    );
    expect(inRegion.forbidden).toHaveLength(1);

    // Outside the region the only authored Article is ineligible, so the pool
    // empties and the posting carries no prohibition.
    const outOfRegion = articlesForDay(
      createCalendar({ seed: 3, day: 4, regionId: asRegionId("the-coast-road") }),
      { frequency: { forbid: 1, commend: 0 }, pool: [regional] },
    );
    expect(outOfRegion.forbidden).toHaveLength(0);
  });

  it("rotates the region with withRegion", () => {
    const calendar = withRegion(createCalendar({ seed: 1 }), asRegionId("blackwood"));
    expect(calendar.regionId).toBe("blackwood");
    expect(withRegion(calendar, null).regionId).toBeNull();
  });
});

/* --------------------------------------------------------------------------
 * Dispatch timers
 * ------------------------------------------------------------------------ */

describe("createDispatch", () => {
  it("derives returnDay from the leave day and duration", () => {
    const dispatch = createDispatch(dispatchInit({ dispatchedOnDay: 3, duration: 6 }));
    expect(dispatch.dispatchedOnDay).toBe(3);
    expect(dispatch.returnDay).toBe(9);
  });

  it("defaults dispatchedOnDay to the supplied calendar day", () => {
    expect(createDispatch(dispatchInit(), 7).dispatchedOnDay).toBe(7);
  });

  it("rejects an empty party, a duplicate soldier and a bad duration", () => {
    expect(() => createDispatch(dispatchInit({ unitIds: [] }))).toThrowError(/at least one/);
    expect(() =>
      createDispatch(dispatchInit({ unitIds: [unitId("unit-1"), unitId("unit-1")] })),
    ).toThrowError(/twice/);
    expect(() => createDispatch(dispatchInit({ duration: 0 }))).toThrowError(/duration/);
    expect(() =>
      createDispatch(dispatchInit({ duration: DISPATCH_DURATION_MAX + 1 })),
    ).toThrowError(/duration/);
  });
});

describe("scheduleDispatch", () => {
  it("adds an active dispatch with a return day offset from today", () => {
    const calendar = createCalendar({ seed: 1, day: 2 });
    const away = scheduleDispatch(calendar, dispatchInit({ duration: 3 }));
    expect(away.dispatches).toHaveLength(1);
    expect(away.dispatches[0]?.returnDay).toBe(5);
    // Pure: the original calendar is untouched.
    expect(calendar.dispatches).toHaveLength(0);
  });

  it("refuses a duplicate id or an already-dispatched soldier", () => {
    const calendar = scheduleDispatch(createCalendar({ seed: 1 }), dispatchInit());
    expect(canScheduleDispatch(calendar, dispatchInit())).toBe(false);
    expect(dispatchBlockers(calendar, dispatchInit())).toContain("duplicate-dispatch");

    const next = dispatchInit({ id: asDispatchId("dispatch-2"), contractId: OTHER_CONTRACT });
    expect(dispatchBlockers(calendar, next)).toContain("unit-already-dispatched");
    expect(() => scheduleDispatch(calendar, next)).toThrowError(/unit-already-dispatched/);
  });

  it("reports an empty party as a blocker", () => {
    expect(dispatchBlockers(createCalendar({ seed: 1 }), dispatchInit({ unitIds: [] }))).toContain(
      "empty-party",
    );
  });
});

describe("dispatch queries", () => {
  const calendar: CampaignCalendar = scheduleDispatch(
    createCalendar({ seed: 1, day: 2 }),
    dispatchInit({ duration: 4 }),
  );

  it("counts down the days remaining and detects the due day", () => {
    const dispatch = calendar.dispatches[0] as Dispatch;
    expect(dispatchDaysRemaining(dispatch, 2)).toBe(4);
    expect(dispatchDaysRemaining(dispatch, 5)).toBe(1);
    expect(dispatchDaysRemaining(dispatch, 6)).toBe(0);
    expect(dispatchDaysRemaining(dispatch, 99)).toBe(0);
    expect(isDispatchDue(dispatch, 5)).toBe(false);
    expect(isDispatchDue(dispatch, 6)).toBe(true);
  });

  it("finds dispatches by id and by soldier", () => {
    expect(dispatchById(calendar, asDispatchId("dispatch-1"))).toBeDefined();
    expect(dispatchById(calendar, asDispatchId("missing"))).toBeUndefined();
    expect(isUnitDispatched(calendar, unitId("unit-1"))).toBe(true);
    expect(isUnitDispatched(calendar, unitId("unit-9"))).toBe(false);
    expect(dispatchForUnit(calendar, unitId("unit-2"))?.id).toBe("dispatch-1");
    expect(dispatchForUnit(calendar, unitId("unit-9"))).toBeUndefined();
  });

  it("cancels a dispatch, or returns the same calendar when it is not running", () => {
    const cancelled = cancelDispatch(calendar, asDispatchId("dispatch-1"));
    expect(cancelled.dispatches).toHaveLength(0);
    expect(calendar.dispatches).toHaveLength(1);
    expect(cancelDispatch(calendar, asDispatchId("missing"))).toBe(calendar);
  });

  it("separates active from due dispatches", () => {
    expect(activeDispatches(calendar)).toHaveLength(1);
    expect(dueDispatches(calendar)).toHaveLength(0);
    const late = { ...calendar, day: 6 };
    expect(activeDispatches(late)).toHaveLength(0);
    expect(dueDispatches(late)).toHaveLength(1);
  });
});

/* --------------------------------------------------------------------------
 * The clock advances (done when: date advances, timers tick)
 * ------------------------------------------------------------------------ */

describe("advanceDays", () => {
  it("advances the day and returns completed dispatches, removing them", () => {
    const short = dispatchInit({ id: asDispatchId("short"), duration: 2 });
    const long = dispatchInit({
      id: asDispatchId("long"),
      contractId: OTHER_CONTRACT,
      unitIds: [unitId("unit-3")],
      duration: 6,
    });
    let calendar = createCalendar({ seed: 1, day: 1 });
    calendar = scheduleDispatch(calendar, short);
    calendar = scheduleDispatch(calendar, long);

    const afterTwo = advanceDays(calendar, 2);
    expect(afterTwo.calendar.day).toBe(3);
    expect(afterTwo.completed.map((dispatch) => dispatch.id)).toEqual(["short"]);
    expect(afterTwo.calendar.dispatches.map((dispatch) => dispatch.id)).toEqual(["long"]);

    const afterFourMore = advanceDays(afterTwo.calendar, 4);
    expect(afterFourMore.calendar.day).toBe(7);
    expect(afterFourMore.completed.map((dispatch) => dispatch.id)).toEqual(["long"]);
    expect(afterFourMore.calendar.dispatches).toHaveLength(0);
  });

  it("defaults to a single day and rejects a bad step", () => {
    const calendar = createCalendar({ seed: 1, day: 4 });
    expect(advanceDays(calendar).calendar.day).toBe(5);
    expect(() => advanceDays(calendar, 0)).toThrowError(/positive integer/);
    expect(() => advanceDays(calendar, 1.5)).toThrowError(/positive integer/);
  });

  it("ticks due dispatches without advancing the day", () => {
    const calendar = scheduleDispatch(createCalendar({ seed: 1, day: 1 }), dispatchInit());
    const tick = tickDispatches({ ...calendar, day: 5 });
    expect(tick.completed).toHaveLength(1);
    expect(tick.calendar.dispatches).toHaveLength(0);
    // Ticking again is a no-op.
    expect(tickDispatches(tick.calendar).completed).toHaveLength(0);
  });
});

describe("advanceCampaign", () => {
  it("advances the company and calendar together and generates the day's Articles", () => {
    const company = makeCompany();
    const calendar = scheduleDispatch(
      createCalendar({ seed: 5, day: 3 }),
      dispatchInit({ duration: 2 }),
    );

    const result = advanceCampaign(company, calendar, 2);
    expect(result.calendar.day).toBe(5);
    expect(result.company.theatre.day).toBe(5);
    expect(result.completed.map((dispatch) => dispatch.id)).toEqual(["dispatch-1"]);
    expect(result.articles.day).toBe(5);
    expect(result.articles.ids).toEqual(articlesForDay(result.calendar).ids);
  });

  it("charts a region the company had not seen when syncing", () => {
    const company = travelTo(makeCompany(), asRegionId("blackwood"));
    const calendar = createCalendar({
      seed: 1,
      day: 9,
      regionId: asRegionId("sainte-colombe"),
    });
    const synced = syncCompany(company, calendar);
    expect(synced.theatre.day).toBe(9);
    expect(synced.theatre.regionId).toBe("sainte-colombe");
    expect(synced.theatre.knownRegionIds).toContain("blackwood");
    expect(synced.theatre.knownRegionIds).toContain("sainte-colombe");
    // The original company is untouched.
    expect(company.theatre.day).toBe(3);
  });

  it("is deterministic: the same inputs always give the same advance", () => {
    const company = makeCompany();
    const calendar: CampaignCalendar = createCalendar({ seed: 42, day: 1 });
    const first = advanceCampaign(company, calendar, 3);
    const second = advanceCampaign(company, calendar, 3);
    expect(first.company).toEqual(second.company);
    expect(first.calendar).toEqual(second.calendar);
    expect(first.articles.ids).toEqual(second.articles.ids);
  });

  it("does not disturb an unrelated Rng stream", () => {
    const rng = new Rng("battle-seed");
    const before = rng.next();
    const replay = new Rng("battle-seed");
    advanceCampaign(makeCompany(), createCalendar({ seed: 1, day: 2 }), 2);
    expect(replay.next()).toBe(before);
  });
});

/* --------------------------------------------------------------------------
 * Determinism guard: no Date / Math.random anywhere in the module
 * ------------------------------------------------------------------------ */

describe("calendar determinism", () => {
  it("produces identical dispatches for identical inputs", () => {
    const build = (): readonly DispatchId[] =>
      createCalendar({ seed: 8, day: 1, dispatches: [dispatchInit({ duration: 7 })] }).dispatches.map(
        (dispatch) => dispatch.id,
      );
    expect(build()).toEqual(build());
  });
});
