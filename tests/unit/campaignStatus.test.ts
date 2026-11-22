/**
 * Campaign status helpers (T162) — the chapter the UI should gate on and
 * whether the story is finished.
 *
 * `campaignChapter` is deliberately *derived*: a fresh save stores chapter 0,
 * but the opening `start` trigger makes chapter 1 reachable immediately, so the
 * Officers' Mess must not read the stored number. `isCampaignConcluded` reads
 * the same facts and reports the finale.
 */

import { describe, expect, it } from "vitest";

import { campaignChapter, isCampaignConcluded } from "../../src/app/campaign";
import { createDemoCampaign } from "../../src/app/campaignController";
import { MAX_STORY_CHAPTER } from "../../src/data/story";
import { createCampaignProgress } from "../../src/persist/campaign";

/** The contracts needed to reach the last chapter, in story order. */
const SPINE = [
  "break-the-bridge",
  "crossed-sabres",
  "storm-the-farmhouse",
  "break-the-guerrilla-camp",
  "clear-the-sunken-lane",
  "hold-the-churchyard",
] as const;

describe("campaignChapter (T162)", () => {
  it("opens a fresh campaign at chapter 1, not the stored 0", () => {
    const demo = createDemoCampaign();
    expect(demo.progress.chapter).toBe(0);
    expect(campaignChapter(demo)).toBe(1);
  });

  it("reports a chapter advanced by the calendar or the ledger", () => {
    const demo = createDemoCampaign();
    const reached = {
      ...demo,
      progress: createCampaignProgress({
        chapter: 4,
        completedContractIds: ["break-the-bridge", "crossed-sabres", "storm-the-farmhouse"],
      }),
    };
    expect(campaignChapter(reached)).toBe(4);
  });

  it("is pure: the same save always yields the same chapter", () => {
    const demo = createDemoCampaign();
    expect(campaignChapter(demo)).toBe(campaignChapter(demo));
  });
});

describe("isCampaignConcluded (T162)", () => {
  it("is false for the demo campaign", () => {
    expect(isCampaignConcluded(createDemoCampaign())).toBe(false);
  });

  it("is false at chapter 9 until its contract is completed", () => {
    const demo = createDemoCampaign();
    const atFinale = {
      ...demo,
      calendar: { ...demo.calendar, day: 60 },
      company: { ...demo.company, theatre: { ...demo.company.theatre, day: 60 } },
      progress: createCampaignProgress({
        chapter: MAX_STORY_CHAPTER,
        completedContractIds: [...SPINE],
      }),
    };
    expect(campaignChapter(atFinale)).toBe(MAX_STORY_CHAPTER);
    expect(isCampaignConcluded(atFinale)).toBe(false);
  });

  it("is true once the finale is fought", () => {
    const demo = createDemoCampaign();
    const finished = {
      ...demo,
      calendar: { ...demo.calendar, day: 60 },
      company: { ...demo.company, theatre: { ...demo.company.theatre, day: 60 } },
      progress: createCampaignProgress({
        chapter: MAX_STORY_CHAPTER,
        completedContractIds: [...SPINE, "take-the-headquarters"],
      }),
    };
    expect(isCampaignConcluded(finished)).toBe(true);
  });
});
