import { describe, expect, it } from "vitest";

import { POSTS } from "../../src/data/posts";
import {
  CAMPAIGN_DAY_MIN,
  COMPANY_NAME_MAX,
  CROWNS_MIN,
  CompanyError,
  HONOURS_MIN,
  RECRUIT_BASE_FEE,
  RECRUIT_FEE_PER_LEVEL,
  RECRUIT_LEVEL_MIN,
  ROSTER_MAX,
  ROSTER_MIN,
  addCrowns,
  addMember,
  advanceDay,
  awardHonours,
  canAfford,
  canRecruit,
  createCompany,
  createRecruitingOffice,
  createRosterMember,
  createTheatre,
  dismissMember,
  hasMember,
  isCompany,
  isRosterFull,
  memberOf,
  parseCompany,
  recruitBlockers,
  recruitFee,
  recruitSoldier,
  removeMember,
  rosterSize,
  spendCrowns,
  travelTo,
  withCrowns,
  withHonours,
  withName,
  withTheatre,
  type Company,
  type CompanyInit,
  type RecruitingOffice,
  type RecruitingOfficeInit,
  type RecruitRequest,
  type RosterMemberInit,
} from "../../src/engine/company";
import { coord } from "../../src/engine/grid";
import { IdError, asCompanyId, asPostId, asRegionId, asUnitId } from "../../src/engine/ids";
import { createPostAssignment } from "../../src/engine/progression/posts";
import { deriveStats } from "../../src/engine/stats";
import { createUnit, type Unit } from "../../src/engine/unit";

/* --------------------------------------------------------------------------
 * T068 — Company model
 *
 * Pins the task's "done when": the **Company** holds its **roster**, its
 * **Crowns**, its **Regimental Honours** and the current **theatre state**.
 * The tests also pin the guarantees later Phase 6 systems lean on: creation
 * fails fast on malformed data, every update is pure (inputs untouched, a new
 * company returned) and the whole record round-trips through `parseCompany` at
 * the save boundary.
 * ------------------------------------------------------------------------ */

function makeSoldier(id: string): Unit {
  return createUnit({
    id: asUnitId(id),
    name: `Soldier ${id}`,
    power: "france",
    postId: asPostId("fusilier"),
    level: 1,
    at: coord(0, 0),
    stats: deriveStats({ level: 1, growth: POSTS.fusilier.growth }),
  });
}

function makeMember(id: string, overrides: Partial<RosterMemberInit> = {}): RosterMemberInit {
  return {
    unit: makeSoldier(id),
    assignment: createPostAssignment({ primaryPostId: asPostId("fusilier"), power: "france" }),
    ...overrides,
  };
}

function makeMembers(count: number): RosterMemberInit[] {
  return Array.from({ length: count }, (_, index) => makeMember(`unit-${index + 1}`));
}

function makeCompany(overrides: Partial<CompanyInit> = {}): Company {
  return createCompany({ id: asCompanyId("company-1"), name: "The Greycoats", ...overrides });
}

/* --------------------------------------------------------------------------
 * Creation & defaults
 * ------------------------------------------------------------------------ */

describe("createCompany — the campaign record", () => {
  it("starts a fresh company with no Crowns, no Honours and an empty roster", () => {
    const company = makeCompany();
    expect(company.id).toBe("company-1");
    expect(company.name).toBe("The Greycoats");
    expect(company.crowns).toBe(CROWNS_MIN);
    expect(company.honours).toBe(HONOURS_MIN);
    expect(company.roster).toEqual([]);
  });

  it("opens on campaign day 1 with no region, per mapping §10", () => {
    const company = makeCompany();
    expect(company.theatre.day).toBe(CAMPAIGN_DAY_MIN);
    expect(company.theatre.regionId).toBeNull();
    expect(company.theatre.knownRegionIds).toEqual([]);
  });

  it("keeps the Crowns, Honours and roster it is given", () => {
    const member = makeMember("unit-1", { recruitedOnDay: 3 });
    const company = makeCompany({ crowns: 1200, honours: 2, roster: [member] });
    expect(company.crowns).toBe(1200);
    expect(company.honours).toBe(2);
    expect(rosterSize(company)).toBe(1);
    expect(memberOf(company, asUnitId("unit-1"))?.recruitedOnDay).toBe(3);
  });

  it("defaults a member's recruitment day to the company's current day", () => {
    const company = makeCompany({
      theatre: { day: 7 },
      roster: [makeMember("unit-1")],
    });
    expect(company.roster[0]?.recruitedOnDay).toBe(7);
  });

  it("rejects a malformed id, name or economy", () => {
    expect(() => createCompany({ id: asCompanyId(""), name: "The Greycoats" })).toThrow(IdError);
    expect(() => createCompany({ id: asCompanyId("company-1"), name: "   " })).toThrow(RangeError);
    expect(() => makeCompany({ crowns: -1 })).toThrow(RangeError);
    expect(() => makeCompany({ crowns: 1.5 })).toThrow(RangeError);
    expect(() => makeCompany({ honours: -1 })).toThrow(RangeError);
    expect(() => makeCompany({ name: "A".repeat(COMPANY_NAME_MAX + 1) })).toThrow(RangeError);
  });

  it("rejects a rogue campaign day", () => {
    expect(() => makeCompany({ theatre: { day: 0 } })).toThrow(RangeError);
    expect(() => makeCompany({ theatre: { day: 1.5 } })).toThrow(RangeError);
  });

  it("rejects duplicate unit ids in the roster", () => {
    expect(() => makeCompany({ roster: [makeMember("unit-1"), makeMember("unit-1")] })).toThrow(
      RangeError,
    );
  });

  it("rejects a roster over ROSTER_MAX", () => {
    expect(() => makeCompany({ roster: makeMembers(ROSTER_MAX) })).not.toThrow();
    expect(() => makeCompany({ roster: makeMembers(ROSTER_MAX + 1) })).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Theatre state
 * ------------------------------------------------------------------------ */

describe("TheatreState — where and when the company is", () => {
  it("folds the current region into the known regions", () => {
    const theatre = createTheatre({ regionId: asRegionId("sainte-colombe") });
    expect(theatre.regionId).toBe("sainte-colombe");
    expect(theatre.knownRegionIds).toEqual(["sainte-colombe"]);
  });

  it("deduplicates known regions while preserving first-seen order", () => {
    const theatre = createTheatre({
      knownRegionIds: [asRegionId("b"), asRegionId("a"), asRegionId("b"), asRegionId("a")],
    });
    expect(theatre.knownRegionIds).toEqual(["b", "a"]);
  });

  it("rejects a malformed region and an invalid day", () => {
    expect(() => createTheatre({ regionId: "" as never })).toThrow(IdError);
    expect(() => createTheatre({ knownRegionIds: ["" as never] })).toThrow(IdError);
    expect(() => createTheatre({ day: 0 })).toThrow(RangeError);
  });

  it("advances the campaign clock by whole days", () => {
    const company = advanceDay(makeCompany(), 3);
    expect(company.theatre.day).toBe(4);
    expect(advanceDay(makeCompany()).theatre.day).toBe(2);
    expect(() => advanceDay(makeCompany(), 0)).toThrow(RangeError);
    expect(() => advanceDay(makeCompany(), 1.5)).toThrow(RangeError);
  });

  it("charts a new region on travel and tracks the current one", () => {
    const company = travelTo(makeCompany(), asRegionId("bridge"));
    expect(company.theatre.regionId).toBe("bridge");
    expect(company.theatre.knownRegionIds).toEqual(["bridge"]);

    const moved = travelTo(company, asRegionId("farmhouse"));
    expect(moved.theatre.knownRegionIds).toEqual(["bridge", "farmhouse"]);

    const back = travelTo(moved, asRegionId("bridge"));
    expect(back.theatre.regionId).toBe("bridge");
    expect(back.theatre.knownRegionIds).toEqual(["bridge", "farmhouse"]);
  });

  it("allows travelling to no region without charting anything", () => {
    const company = travelTo(makeCompany(), null);
    expect(company.theatre.regionId).toBeNull();
    expect(company.theatre.knownRegionIds).toEqual([]);
  });

  it("replaces the whole theatre state through withTheatre", () => {
    const company = withTheatre(makeCompany(), {
      day: 12,
      regionId: asRegionId("redoubt"),
    });
    expect(company.theatre.day).toBe(12);
    expect(company.theatre.knownRegionIds).toEqual(["redoubt"]);
  });
});

/* --------------------------------------------------------------------------
 * Economy — Crowns & Regimental Honours
 * ------------------------------------------------------------------------ */

describe("Crowns — the war chest", () => {
  it("adds, sets and spends Crowns", () => {
    const paid = addCrowns(makeCompany({ crowns: 100 }), 250);
    expect(paid.crowns).toBe(350);

    expect(withCrowns(paid, 10).crowns).toBe(10);

    const spent = spendCrowns(paid, 300);
    expect(spent.crowns).toBe(50);
    expect(paid.crowns).toBe(350); // pure: the input is untouched
  });

  it("reports affordability", () => {
    const company = makeCompany({ crowns: 100 });
    expect(canAfford(company, 100)).toBe(true);
    expect(canAfford(company, 101)).toBe(false);
    expect(() => canAfford(company, -1)).toThrow(RangeError);
  });

  it("refuses to overspend or accept malformed amounts", () => {
    const company = makeCompany({ crowns: 100 });
    expect(() => spendCrowns(company, 101)).toThrow(RangeError);
    expect(() => spendCrowns(company, -1)).toThrow(RangeError);
    expect(() => addCrowns(company, 0.5)).toThrow(RangeError);
    expect(() => withCrowns(company, -5)).toThrow(RangeError);
  });
});

describe("Regimental Honours — the company's distinctions", () => {
  it("sets and awards Honours", () => {
    expect(withHonours(makeCompany(), 4).honours).toBe(4);
    expect(awardHonours(makeCompany({ honours: 2 }), 3).honours).toBe(5);
  });

  it("rejects malformed Honours", () => {
    expect(() => withHonours(makeCompany(), -1)).toThrow(RangeError);
    expect(() => awardHonours(makeCompany(), 1.5)).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Roster
 * ------------------------------------------------------------------------ */

describe("Roster — the soldiers under the company's colours", () => {
  it("returns the member for a unit id", () => {
    const company = makeCompany({ roster: [makeMember("unit-1"), makeMember("unit-2")] });
    expect(memberOf(company, asUnitId("unit-2"))?.unit.id).toBe("unit-2");
    expect(memberOf(company, asUnitId("unit-9"))).toBeUndefined();
    expect(hasMember(company, asUnitId("unit-1"))).toBe(true);
    expect(hasMember(company, asUnitId("unit-9"))).toBe(false);
    expect(rosterSize(company)).toBe(2);
  });

  it("adds a member, normalising it through the authored factories", () => {
    const company = addMember(makeCompany({ theatre: { day: 5 } }), makeMember("unit-1"));
    expect(rosterSize(company)).toBe(1);
    expect(company.roster[0]?.recruitedOnDay).toBe(5);
    expect(company.roster[0]?.assignment.primaryPostId).toBe("fusilier");
  });

  it("builds a member directly and defaults its recruitment day", () => {
    const member = createRosterMember(makeMember("unit-1"), 6);
    expect(member.unit.id).toBe("unit-1");
    expect(member.recruitedOnDay).toBe(6);
    expect(() => createRosterMember(makeMember("unit-2"), 0)).toThrow(RangeError);
  });

  it("refuses a duplicate unit and a full roster", () => {
    const one = makeCompany({ roster: [makeMember("unit-1")] });
    expect(() => addMember(one, makeMember("unit-1"))).toThrow(RangeError);

    const full = makeCompany({ roster: makeMembers(ROSTER_MAX) });
    expect(isRosterFull(full)).toBe(true);
    expect(() => addMember(full, makeMember("extra"))).toThrow(RangeError);
  });

  it("removes a member, and is a no-op for an absent one", () => {
    const company = makeCompany({ roster: [makeMember("unit-1"), makeMember("unit-2")] });
    const removed = removeMember(company, asUnitId("unit-1"));
    expect(rosterSize(removed)).toBe(1);
    expect(hasMember(removed, asUnitId("unit-1"))).toBe(false);

    // No change → the same value is returned (structural sharing).
    expect(removeMember(company, asUnitId("unit-9"))).toBe(company);
  });

  it("rejects a malformed unit id", () => {
    expect(() => removeMember(makeCompany(), "" as never)).toThrow(IdError);
  });
});

/* --------------------------------------------------------------------------
 * Immutability & the save boundary
 * ------------------------------------------------------------------------ */

describe("Purity — updates never mutate the input", () => {
  it("returns a new company and leaves the original intact", () => {
    const original = makeCompany({ crowns: 50, roster: [makeMember("unit-1")] });
    const snapshot = JSON.parse(JSON.stringify(original)) as Company;

    addCrowns(original, 10);
    awardHonours(original, 1);
    advanceDay(original);
    travelTo(original, asRegionId("bridge"));
    addMember(original, makeMember("unit-2"));
    removeMember(original, asUnitId("unit-1"));
    withName(original, "Renamed");

    expect(JSON.parse(JSON.stringify(original))).toEqual(snapshot);
  });

  it("does not share a mutated roster array between values", () => {
    const original = makeCompany({ roster: [makeMember("unit-1")] });
    const grown = addMember(original, makeMember("unit-2"));
    expect(original.roster).toHaveLength(1);
    expect(grown.roster).toHaveLength(2);
    expect(original.roster).not.toBe(grown.roster);
  });
});

describe("parseCompany — the save boundary (T101)", () => {
  it("round-trips a company and preserves its content", () => {
    const original = makeCompany({
      crowns: 900,
      honours: 3,
      roster: [makeMember("unit-1", { recruitedOnDay: 2 })],
      theatre: { day: 9, regionId: asRegionId("sainte-colombe") },
    });
    const parsed = parseCompany(JSON.parse(JSON.stringify(original)) as unknown);
    expect(parsed).toEqual(original);
    expect(isCompany(original)).toBe(true);
  });

  it("rejects a value that is not a company", () => {
    expect(() => parseCompany(null)).toThrow(CompanyError);
    expect(() => parseCompany([])).toThrow(CompanyError);
    expect(() => parseCompany({ id: "", name: "x" })).toThrow(CompanyError);
    expect(isCompany({ id: "company-1" })).toBe(false);
  });
});

/* --------------------------------------------------------------------------
 * T069 — Recruit & dismiss
 *
 * Pins the task's "done when": a company recruits a soldier **by power** at a
 * **recruiting office** in its current region, pays the office's fee, and can
 * **dismiss** a soldier without emptying the roster. The roster cap and the
 * recruit fee are the policy; the tests pin both the blockers a recruit screen
 * shows and the pure, deterministic recruit/dismiss transitions.
 * ------------------------------------------------------------------------ */

function makeOffice(overrides: Partial<RecruitingOfficeInit> = {}): RecruitingOffice {
  return createRecruitingOffice({
    power: "france",
    regionId: asRegionId("sainte-colombe"),
    ...overrides,
  });
}

function makeRequest(overrides: Partial<RecruitRequest> = {}): RecruitRequest {
  return {
    unitId: asUnitId("unit-9"),
    name: "Cpl. Voss",
    postId: asPostId("fusilier"),
    ...overrides,
  };
}

describe("Recruiting office — signing soldiers by power (T069)", () => {
  it("builds an office with a default fee and validates its inputs", () => {
    const office = makeOffice();
    expect(office.power).toBe("france");
    expect(office.regionId).toBe("sainte-colombe");
    expect(office.fee).toBe(RECRUIT_BASE_FEE);

    expect(
      createRecruitingOffice({ power: "britain", regionId: asRegionId("x"), fee: 0 }).fee,
    ).toBe(0);
    expect(() =>
      createRecruitingOffice({ power: "spain" as never, regionId: asRegionId("x") }),
    ).toThrow(RangeError);
    expect(() => createRecruitingOffice({ power: "france", regionId: "" as never })).toThrow(
      IdError,
    );
    expect(() =>
      createRecruitingOffice({ power: "france", regionId: asRegionId("x"), fee: -1 }),
    ).toThrow(RangeError);
  });

  it("scales the recruit fee with level", () => {
    const office = makeOffice({ fee: 200 });
    expect(RECRUIT_LEVEL_MIN).toBe(1);
    expect(recruitFee(office)).toBe(200);
    expect(recruitFee(office, 1)).toBe(200);
    expect(recruitFee(office, 4)).toBe(200 + 3 * RECRUIT_FEE_PER_LEVEL);
    expect(() => recruitFee(office, 0)).toThrow(RangeError);
    expect(() => recruitFee(office, 1.5)).toThrow(RangeError);
  });

  it("lists every reason a recruit cannot be signed", () => {
    const office = makeOffice();
    const request = makeRequest();
    const present = travelTo(makeCompany({ crowns: 1000 }), office.regionId);
    expect(recruitBlockers(present, office, request)).toEqual([]);
    expect(canRecruit(present, office, request)).toBe(true);

    // Not at the office's region.
    const away = makeCompany({ crowns: 1000 });
    expect(recruitBlockers(away, office, request)).toContain("wrong-region");

    // Roster at capacity.
    const full = makeCompany({
      crowns: 1000,
      roster: makeMembers(ROSTER_MAX),
      theatre: { regionId: office.regionId },
    });
    expect(recruitBlockers(full, office, request)).toContain("roster-full");

    // Unit id already in the company.
    const duplicate = makeCompany({
      crowns: 1000,
      roster: [makeMember("unit-9")],
      theatre: { regionId: office.regionId },
    });
    expect(recruitBlockers(duplicate, office, request)).toContain("duplicate-unit");

    // War chest too small.
    const poor = makeCompany({ crowns: 10, theatre: { regionId: office.regionId } });
    expect(recruitBlockers(poor, office, request)).toContain("insufficient-crowns");

    // A post barred to the office's power, and an unknown post.
    expect(
      recruitBlockers(present, office, makeRequest({ postId: asPostId("rifleman") })),
    ).toContain("post-not-available");
    expect(recruitBlockers(present, office, makeRequest({ postId: asPostId("nope") }))).toContain(
      "post-not-available",
    );
  });

  it("signs a soldier of the office's power and pays the fee", () => {
    const office = makeOffice({ power: "britain", fee: 200 });
    const company = travelTo(makeCompany({ crowns: 1000, theatre: { day: 5 } }), office.regionId);
    const recruited = recruitSoldier(
      company,
      office,
      makeRequest({ name: "Rfm. Hale", postId: asPostId("rifleman") }),
    );

    const member = memberOf(recruited, asUnitId("unit-9"));
    expect(rosterSize(recruited)).toBe(1);
    expect(member?.unit.power).toBe("britain");
    expect(member?.unit.postId).toBe("rifleman");
    expect(member?.unit.level).toBe(RECRUIT_LEVEL_MIN);
    expect(member?.assignment.primaryPostId).toBe("rifleman");
    expect(member?.recruitedOnDay).toBe(5);
    expect(recruited.crowns).toBe(1000 - 200);

    // Pure: the source company and its war chest are untouched.
    expect(company.crowns).toBe(1000);
    expect(rosterSize(company)).toBe(0);
  });

  it("charges for the level and allows a common post for any power", () => {
    const office = makeOffice({ power: "prussia", fee: 100 });
    const company = travelTo(makeCompany({ crowns: 1000 }), office.regionId);
    const recruited = recruitSoldier(
      company,
      office,
      makeRequest({ name: "Dr. Meyer", postId: asPostId("surgeon"), level: 3 }),
    );

    expect(memberOf(recruited, asUnitId("unit-9"))?.unit.power).toBe("prussia");
    expect(recruited.crowns).toBe(1000 - (100 + 2 * RECRUIT_FEE_PER_LEVEL));
  });

  it("refuses to recruit when a blocker applies", () => {
    const office = makeOffice();
    const away = makeCompany({ crowns: 1000 });
    expect(() => recruitSoldier(away, office, makeRequest())).toThrow(/wrong-region/);

    const poor = makeCompany({ theatre: { regionId: office.regionId } });
    expect(() => recruitSoldier(poor, office, makeRequest())).toThrow(/insufficient-crowns/);
  });
});

describe("Dismissal — releasing a soldier (T069)", () => {
  it("removes a soldier and leaves the rest of the company intact", () => {
    const company = makeCompany({ roster: [makeMember("unit-1"), makeMember("unit-2")] });
    const dismissed = dismissMember(company, asUnitId("unit-1"));

    expect(hasMember(dismissed, asUnitId("unit-1"))).toBe(false);
    expect(hasMember(dismissed, asUnitId("unit-2"))).toBe(true);
    expect(rosterSize(company)).toBe(2); // pure: the original is untouched
  });

  it("refuses to dismiss an absent soldier, the last one, or a bad id", () => {
    const company = makeCompany({ roster: [makeMember("unit-1")] });
    expect(ROSTER_MIN).toBe(1);
    expect(() => dismissMember(company, asUnitId("unit-9"))).toThrow(RangeError);
    expect(() => dismissMember(company, asUnitId("unit-1"))).toThrow(RangeError);
    expect(() => dismissMember(makeCompany(), asUnitId("unit-1"))).toThrow(RangeError);
    expect(() => dismissMember(company, "" as never)).toThrow(IdError);
  });
});
