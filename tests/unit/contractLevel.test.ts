/**
 * Contract readiness hints (T169) — the recommended level shown on a Mess card.
 *
 * The helper reads the authored `recommendedLevel` from the contract's resolved
 * board and compares it with the roster's average level. These tests pin both
 * halves without rendering the screen.
 */

import { describe, expect, it } from "vitest";

import { CONTRACTS } from "../../src/data/contracts";
import { createCompany, type Company } from "../../src/engine/company";
import { coord } from "../../src/engine/grid";
import { asCompanyId, asPostId, asUnitId } from "../../src/engine/ids";
import { createPostAssignment } from "../../src/engine/progression/posts";
import { createUnit } from "../../src/engine/unit";
import { companyLevelOf, isUnderLevel, recommendedLevelOf } from "../../src/ui/contractLevel";

/** A company whose soldiers are at `levels`, in order. */
function companyAt(levels: readonly number[]): Company {
  const roster = levels.map((level, index) => ({
    unit: createUnit({
      id: asUnitId(`unit-${index}`),
      name: `Soldier ${index}`,
      power: "france",
      postId: asPostId("fusilier"),
      level,
      at: coord(0, 0),
      stats: { hp: 40, mp: 12, atk: 20, def: 18, mag: 6, res: 8, spd: 28, move: 4, jump: 2 },
    }),
    assignment: createPostAssignment({ primaryPostId: asPostId("fusilier"), power: "france" }),
  }));
  return createCompany({ id: asCompanyId("hint-company"), name: "The Hinted", roster });
}

describe("recommendedLevelOf (T169)", () => {
  it("reads the resolved board's recommended level", () => {
    expect(recommendedLevelOf(CONTRACTS["break-the-bridge"])).toBe(1);
    expect(recommendedLevelOf(CONTRACTS["clear-the-orchard"])).toBe(3);
    expect(recommendedLevelOf(CONTRACTS["hold-the-churchyard"])).toBe(6);
    expect(recommendedLevelOf(CONTRACTS["take-the-headquarters"])).toBe(7);
  });

  it("has no level for a contract that fields no battle", () => {
    // Detachments are dispatch missions: they never open a board.
    expect(recommendedLevelOf(CONTRACTS["forage-the-valley"])).toBeNull();
    expect(recommendedLevelOf(CONTRACTS["drill-the-recruits"])).toBeNull();
  });
});

describe("companyLevelOf (T169)", () => {
  it("is the floored average of the roster", () => {
    expect(companyLevelOf(companyAt([2, 4]))).toBe(3);
    expect(companyLevelOf(companyAt([5, 5, 6]))).toBe(5);
  });

  it("reads an empty roster as level 0", () => {
    expect(companyLevelOf(companyAt([]))).toBe(0);
  });
});

describe("isUnderLevel (T169)", () => {
  const churchyard = CONTRACTS["hold-the-churchyard"]; // recommends level 6

  it("flags a company below the recommendation", () => {
    expect(isUnderLevel(companyAt([3, 3]), churchyard)).toBe(true);
    expect(isUnderLevel(companyAt([5, 5]), churchyard)).toBe(true);
  });

  it("does not flag a company at or above it", () => {
    expect(isUnderLevel(companyAt([6, 6]), churchyard)).toBe(false);
    expect(isUnderLevel(companyAt([7, 8]), churchyard)).toBe(false);
  });

  it("never flags a contract with no recommended level", () => {
    expect(isUnderLevel(companyAt([1]), CONTRACTS["gather-the-harvest"])).toBe(false);
  });
});
