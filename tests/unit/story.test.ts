import { describe, expect, it } from "vitest";

import {
  CONTRACTS,
  CONTRACT_LIST,
  contractsForChapter,
  isContractKey,
} from "../../src/data/contracts";
import {
  GUARD_SORTIES,
  GUARD_SORTIE_KEYS,
  GUARD_SORTIE_LIST,
  guardSortiesForChapter,
  isGuardSortieKey,
} from "../../src/data/guards";
import { StoryChapterDefSchema, type StoryChapterDef } from "../../src/data/story";
import {
  MAX_STORY_CHAPTER,
  STORY_CHAPTERS,
  STORY_CHAPTER_KEYS,
  STORY_CHAPTER_LIST,
  STORY_CHAPTER_MIN,
  STORY_TRIGGER_KINDS,
  advanceChapter,
  allGuardSortieIds,
  allStoryContractIds,
  assertStorySpine,
  chapterForContract,
  chapterForGuardSortie,
  chapterTriggerMet,
  getStoryChapter,
  isGuardSortieUnlocked,
  isStoryChapterKey,
  isStoryChapterNumber,
  isStoryContractUnlocked,
  storyChapterByNumber,
  storyGateAt,
  triggerMet,
  unlockedGuardSortieIds,
  unlockedStoryContractIds,
  type StoryFacts,
} from "../../src/data/story";
import {
  guardSortieUnlockPredicate,
  unlockedGuardSorties,
} from "../../src/engine/actions/guardSortie";

/* --------------------------------------------------------------------------
 * T077 — Story spine
 *
 * Pins the task's "done when": **chapter triggers gate story contracts and
 * unlock Guard Sorties.** The spine is the campaign's chapter progression
 * (mapping §10, D13): a chapter is entered when its trigger fires, and entering
 * it opens story contracts (`./contracts.ts`) and unlocks national Guard
 * Sorties (`./guards.ts`). The tests also pin the cross-table agreement — the
 * `chapter` numbers on contracts and Guard Sorties must match the spine — so
 * the three content tables cannot drift.
 * ------------------------------------------------------------------------ */

/** Markers that mean "content not authored yet" (mirrors the T009 sweep). */
const PLACEHOLDER = /\b(TBD|TBC|TODO|FIXME|XXX)\b|placeholder|lorem\s+ipsum|\?{3,}/i;

/** Every authored chapter must carry authored, non-placeholder display prose. */
function expectCleanDisplay(chapter: {
  id: string;
  name: string;
  description: string;
  flavour: string;
}) {
  for (const field of ["name", "description", "flavour"] as const) {
    const text = chapter[field];
    expect(text.trim(), `${chapter.id}.${field} must be non-empty`).not.toBe("");
    expect(PLACEHOLDER.test(text), `${chapter.id}.${field} contains a placeholder`).toBe(false);
  }
}

/** A shallow clone of the real spine so a test can corrupt one field in isolation. */
function brokenSpine(edit: (chapter: StoryChapterDef, index: number) => StoryChapterDef) {
  return STORY_CHAPTER_LIST.map((chapter, index) => edit(chapter, index));
}

/* --------------------------------------------------------------------------
 * Registry integrity
 * ------------------------------------------------------------------------ */

describe("story spine — registry integrity (T077)", () => {
  it("authors a parsed chapter for every canonical key", () => {
    expect(STORY_CHAPTER_LIST).toHaveLength(STORY_CHAPTER_KEYS.length);
    expect(new Set(STORY_CHAPTER_KEYS).size).toBe(STORY_CHAPTER_KEYS.length);
    expect(MAX_STORY_CHAPTER).toBe(STORY_CHAPTER_KEYS.length);

    for (const key of STORY_CHAPTER_KEYS) {
      const chapter = STORY_CHAPTERS[key];
      expect(chapter, key).toBeDefined();
      expect(chapter.id).toBe(key);
      // Parsed at module load, so a bad field would have thrown already.
      expect(StoryChapterDefSchema.safeParse(chapter).success).toBe(true);
      expectCleanDisplay(chapter);
    }
  });

  it("numbers the chapters contiguously from STORY_CHAPTER_MIN", () => {
    expect(STORY_CHAPTER_MIN).toBe(1);
    expect(STORY_CHAPTER_LIST.map((chapter) => chapter.number)).toEqual(
      Array.from({ length: MAX_STORY_CHAPTER }, (_value, index) => index + 1),
    );
    expect(assertStorySpine).not.toThrow();
  });

  it("only uses authored trigger kinds", () => {
    for (const chapter of STORY_CHAPTER_LIST) {
      expect(STORY_TRIGGER_KINDS).toContain(chapter.trigger.kind);
    }
  });

  it("guards chapter lookups", () => {
    expect(isStoryChapterKey("the-old-guard")).toBe(true);
    expect(isStoryChapterKey("the-french")).toBe(false);
    expect(isStoryChapterNumber(1)).toBe(true);
    expect(isStoryChapterNumber(0)).toBe(false);
    expect(isStoryChapterNumber(MAX_STORY_CHAPTER + 1)).toBe(false);
    expect(isStoryChapterNumber(1.5)).toBe(false);
    expect(getStoryChapter("the-old-guard").number).toBe(2);
    expect(() => getStoryChapter("missing" as never)).toThrow(RangeError);
    expect(storyChapterByNumber(3)?.id).toBe("the-heavy-brigade");
    expect(storyChapterByNumber(99)).toBeUndefined();
  });
});

/* --------------------------------------------------------------------------
 * Cross-table agreement — the spine keeps contracts and guards honest
 * ------------------------------------------------------------------------ */

describe("story spine — agreement with contracts and Guard Sorties (T077)", () => {
  it("resolves every story contract and matches its ContractDef.chapter", () => {
    for (const chapter of STORY_CHAPTER_LIST) {
      for (const contractId of chapter.contractIds) {
        expect(isContractKey(contractId), `${chapter.id}: unknown contract ${contractId}`).toBe(
          true,
        );
        expect(CONTRACTS[contractId as keyof typeof CONTRACTS].chapter, contractId).toBe(
          chapter.number,
        );
      }
    }
  });

  it("resolves every unlocked Guard Sortie and matches its GuardSortieDef.chapter", () => {
    for (const chapter of STORY_CHAPTER_LIST) {
      for (const guardSortieId of chapter.guardSortieIds) {
        expect(
          isGuardSortieKey(guardSortieId),
          `${chapter.id}: unknown Guard Sortie ${guardSortieId}`,
        ).toBe(true);
        expect(
          GUARD_SORTIES[guardSortieId as keyof typeof GUARD_SORTIES].chapter,
          guardSortieId,
        ).toBe(chapter.number);
      }
    }
  });

  it("unlocks each of the five Guard Sorties exactly once, in canonical order", () => {
    const unlocked = allGuardSortieIds();
    expect(unlocked).toEqual([...GUARD_SORTIE_KEYS]);
    expect(new Set(unlocked).size).toBe(unlocked.length);

    // Every authored formation is reachable through the spine.
    for (const guard of GUARD_SORTIE_LIST) {
      expect(chapterForGuardSortie(guard.id), guard.id).toBe(guard.chapter);
    }
  });

  it("opens each gated story contract exactly once", () => {
    const opened = allStoryContractIds();
    expect(new Set(opened).size).toBe(opened.length);

    // Every chapter-gated contract in the content table is a story contract.
    for (const contract of CONTRACT_LIST) {
      if (contract.chapter === undefined) continue;
      expect(chapterForContract(contract.id), contract.id).toBe(contract.chapter);
    }
  });
});

/* --------------------------------------------------------------------------
 * Contract gating
 * ------------------------------------------------------------------------ */

describe("story spine — gates story contracts (T077)", () => {
  it("opens nothing before the campaign starts", () => {
    expect(unlockedStoryContractIds(0)).toEqual([]);
    expect(isStoryContractUnlocked(0, "break-the-bridge")).toBe(false);
  });

  it("opens the opening battle at chapter 1", () => {
    expect(unlockedStoryContractIds(1)).toEqual(["break-the-bridge"]);
    expect(isStoryContractUnlocked(1, "break-the-bridge")).toBe(true);
  });

  it("opens later battles only once their chapter is reached", () => {
    expect(isStoryContractUnlocked(2, "storm-the-farmhouse")).toBe(false);
    expect(unlockedStoryContractIds(3)).toEqual(["break-the-bridge", "storm-the-farmhouse"]);
    expect(isStoryContractUnlocked(3, "storm-the-farmhouse")).toBe(true);
    expect(isStoryContractUnlocked(3, "hold-the-redoubt")).toBe(false);
    expect(isStoryContractUnlocked(4, "hold-the-redoubt")).toBe(true);
    expect(isStoryContractUnlocked(5, "break-the-guerrilla-camp")).toBe(true);
  });

  it("never opens a non-story contract through the spine", () => {
    for (const contractId of allStoryContractIds()) {
      expect(typeof contractId).toBe("string");
    }
    expect(allStoryContractIds()).not.toContain("crossed-sabres");
  });

  it("agrees with contractsForChapter for every story contract", () => {
    for (const chapter of STORY_CHAPTER_LIST) {
      const posted = contractsForChapter(chapter.number).map((contract) => contract.id);
      for (const contractId of chapter.contractIds) {
        expect(posted, `${contractId} at chapter ${chapter.number}`).toContain(contractId);
      }
    }
  });

  it("reports the gate for a chapter in one value", () => {
    const gate = storyGateAt(3);
    expect(gate.chapter).toBe(3);
    expect(gate.contractIds).toEqual(["break-the-bridge", "storm-the-farmhouse"]);
    expect(gate.guardSortieIds).toEqual(["old-guard", "heavy-brigade"]);
  });

  it("rejects chapters outside the authored range", () => {
    expect(() => unlockedStoryContractIds(-1)).toThrow(RangeError);
    expect(() => unlockedStoryContractIds(MAX_STORY_CHAPTER + 1)).toThrow(RangeError);
    expect(() => unlockedStoryContractIds(1.5)).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Guard Sortie unlocking
 * ------------------------------------------------------------------------ */

describe("story spine — unlocks Guard Sorties (T077)", () => {
  it("unlocks nothing at chapter 1", () => {
    expect(unlockedGuardSortieIds(1)).toEqual([]);
    expect(isGuardSortieUnlocked(1, "old-guard")).toBe(false);
  });

  it("unlocks one formation per chapter from chapter 2", () => {
    expect(unlockedGuardSortieIds(2)).toEqual(["old-guard"]);
    expect(unlockedGuardSortieIds(3)).toEqual(["old-guard", "heavy-brigade"]);
    expect(unlockedGuardSortieIds(MAX_STORY_CHAPTER)).toHaveLength(GUARD_SORTIE_KEYS.length);
    expect(isGuardSortieUnlocked(6, "kaisers-bombardiers")).toBe(true);
  });

  it("agrees with guardSortiesForChapter", () => {
    for (const chapter of STORY_CHAPTER_LIST) {
      const fromData = guardSortiesForChapter(chapter.number).map((guard) => guard.id);
      const fromSpine = unlockedGuardSortieIds(chapter.number);
      for (const guardSortieId of fromSpine) {
        expect(fromData, `${guardSortieId} at chapter ${chapter.number}`).toContain(guardSortieId);
      }
    }
  });

  it("drives the engine's Guard Sortie unlock predicate", () => {
    for (const chapter of STORY_CHAPTER_LIST) {
      const predicate = guardSortieUnlockPredicate(chapter.number);
      expect(unlockedGuardSorties(chapter.number)).toEqual(unlockedGuardSortieIds(chapter.number));
      for (const guard of GUARD_SORTIE_LIST) {
        expect(predicate(guard.id as never), `${guard.id} at chapter ${chapter.number}`).toBe(
          isGuardSortieUnlocked(chapter.number, guard.id),
        );
      }
    }
  });

  it("reports the chapter that unlocks each formation", () => {
    expect(chapterForGuardSortie("old-guard")).toBe(2);
    expect(chapterForGuardSortie("grand-battery")).toBe(5);
    expect(chapterForGuardSortie("kaisers-bombardiers")).toBe(6);
    expect(chapterForGuardSortie("no-such-guard")).toBeUndefined();
  });
});

/* --------------------------------------------------------------------------
 * Triggers and advancing the spine
 * ------------------------------------------------------------------------ */

describe("story spine — chapter triggers (T077)", () => {
  it("always satisfies a start trigger", () => {
    expect(triggerMet({ kind: "start" })).toBe(true);
    expect(triggerMet({ kind: "start" }, {})).toBe(true);
  });

  it("satisfies a complete-contract trigger only once the contract is done", () => {
    const trigger = { kind: "complete-contract", contractId: "break-the-bridge" } as const;
    expect(triggerMet(trigger, { completedContractIds: [] })).toBe(false);
    expect(triggerMet(trigger, { completedContractIds: ["crossed-sabres"] })).toBe(false);
    expect(
      triggerMet(trigger, { completedContractIds: ["crossed-sabres", "break-the-bridge"] }),
    ).toBe(true);
  });

  it("satisfies a reach-day trigger when the campaign day arrives", () => {
    const trigger = { kind: "reach-day", day: 30 } as const;
    expect(triggerMet(trigger, { day: 29 })).toBe(false);
    expect(triggerMet(trigger, { day: 30 })).toBe(true);
    expect(triggerMet(trigger, { day: 45 })).toBe(true);
    // No day supplied means the campaign's opening day.
    expect(triggerMet({ kind: "reach-day", day: 1 }, {})).toBe(true);
  });

  it("evaluates a chapter's own trigger", () => {
    expect(chapterTriggerMet(1, {})).toBe(true);
    expect(chapterTriggerMet(2, { completedContractIds: ["break-the-bridge"] })).toBe(true);
    expect(chapterTriggerMet(2, { completedContractIds: [] })).toBe(false);
    expect(chapterTriggerMet(5, { day: 30 })).toBe(true);
    expect(() => chapterTriggerMet(0)).toThrow(RangeError);
    expect(() => chapterTriggerMet(MAX_STORY_CHAPTER + 1)).toThrow(RangeError);
  });

  it("advances one beat at a time and stops at the first unmet trigger", () => {
    // Bridge done → chapter 2, but the skirmish trigger for chapter 3 is missing.
    expect(advanceChapter(1, { completedContractIds: ["break-the-bridge"] })).toBe(2);
    // Add the skirmish and the farmhouse battle.
    expect(
      advanceChapter(1, {
        completedContractIds: ["break-the-bridge", "crossed-sabres", "storm-the-farmhouse"],
      }),
    ).toBe(4);
  });

  it("never skips an earlier beat to reach a later one", () => {
    // Day 30 would open chapter 5, but chapter 2's trigger is unmet.
    const facts: StoryFacts = {
      completedContractIds: ["crossed-sabres", "storm-the-farmhouse", "hold-the-redoubt"],
      day: 30,
    };
    expect(advanceChapter(1, facts)).toBe(1);
  });

  it("advances through the whole spine once every trigger is met", () => {
    const facts: StoryFacts = {
      completedContractIds: [
        "break-the-bridge",
        "crossed-sabres",
        "storm-the-farmhouse",
        "break-the-guerrilla-camp",
      ],
      day: 30,
    };
    expect(advanceChapter(STORY_CHAPTER_MIN, facts)).toBe(MAX_STORY_CHAPTER);
    expect(advanceChapter(0, facts)).toBe(MAX_STORY_CHAPTER);
  });

  it("is a pure function of its facts", () => {
    const facts: StoryFacts = { completedContractIds: ["break-the-bridge"] };
    const before = JSON.stringify(facts);
    advanceChapter(1, facts);
    chapterTriggerMet(2, facts);
    triggerMet({ kind: "start" }, facts);
    expect(JSON.stringify(facts)).toBe(before);
  });

  it("rejects an out-of-range starting chapter", () => {
    expect(() => advanceChapter(-1)).toThrow(RangeError);
    expect(() => advanceChapter(MAX_STORY_CHAPTER + 1)).toThrow(RangeError);
    expect(() => advanceChapter(2.5)).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Integrity enforcement
 * ------------------------------------------------------------------------ */

describe("story spine — assertStorySpine (T077)", () => {
  it("rejects a duplicated chapter number", () => {
    const broken = brokenSpine((chapter, index) =>
      index === 1 ? { ...chapter, number: 1 } : chapter,
    );
    expect(() => assertStorySpine(broken)).toThrow(RangeError);
  });

  it("rejects a duplicated chapter id", () => {
    const broken = brokenSpine((chapter, index) =>
      index === 1 ? { ...chapter, id: STORY_CHAPTER_LIST[0].id } : chapter,
    );
    expect(() => assertStorySpine(broken)).toThrow(RangeError);
  });

  it("rejects an unknown story contract", () => {
    const broken = brokenSpine((chapter, index) =>
      index === 0 ? { ...chapter, contractIds: ["no-such-contract"] } : chapter,
    );
    expect(() => assertStorySpine(broken)).toThrow(/unknown contract/);
  });

  it("rejects a contract whose own chapter disagrees with the spine", () => {
    const broken = brokenSpine((chapter, index) =>
      index === 2 ? { ...chapter, contractIds: ["hold-the-redoubt"] } : chapter,
    );
    expect(() => assertStorySpine(broken)).toThrow(RangeError);
  });

  it("rejects an unknown Guard Sortie", () => {
    const broken = brokenSpine((chapter, index) =>
      index === 1 ? { ...chapter, guardSortieIds: ["no-such-guard"] } : chapter,
    );
    expect(() => assertStorySpine(broken)).toThrow(/unknown Guard Sortie/);
  });

  it("rejects a Guard Sortie whose own chapter disagrees with the spine", () => {
    const broken = brokenSpine((chapter, index) =>
      index === 1 ? { ...chapter, guardSortieIds: ["heavy-brigade"] } : chapter,
    );
    expect(() => assertStorySpine(broken)).toThrow(RangeError);
  });

  it("rejects a trigger that names an unknown contract", () => {
    const broken = brokenSpine((chapter, index) =>
      index === 1
        ? { ...chapter, trigger: { kind: "complete-contract", contractId: "no-such-contract" } }
        : chapter,
    );
    expect(() => assertStorySpine(broken)).toThrow(/unknown contract/);
  });

  it("rejects a chapter gated behind a contract it could never reach", () => {
    // Chapter 3 cannot require a chapter-3 contract: it only opens it.
    const broken = brokenSpine((chapter, index) =>
      index === 2
        ? { ...chapter, trigger: { kind: "complete-contract", contractId: "storm-the-farmhouse" } }
        : chapter,
    );
    expect(() => assertStorySpine(broken)).toThrow(/could never reach/);
  });

  it("rejects an empty spine", () => {
    expect(() => assertStorySpine([])).toThrow(RangeError);
  });
});

/* --------------------------------------------------------------------------
 * Schema enforcement
 * ------------------------------------------------------------------------ */

describe("story spine — schema enforcement (T077)", () => {
  const display = {
    name: "A Chapter",
    description: "A chapter of the campaign.",
    flavour: "The drums beat.",
  };

  it("rejects a missing trigger and a non-positive chapter number", () => {
    expect(StoryChapterDefSchema.safeParse({ id: "x", number: 1, ...display }).success).toBe(false);
    expect(
      StoryChapterDefSchema.safeParse({
        id: "x",
        number: 0,
        trigger: { kind: "start" },
        ...display,
      }).success,
    ).toBe(false);
  });

  it("rejects a negative reach-day", () => {
    expect(
      StoryChapterDefSchema.safeParse({
        id: "x",
        number: 1,
        trigger: { kind: "reach-day", day: 0 },
        ...display,
      }).success,
    ).toBe(false);
  });

  it("defaults the open lists to empty", () => {
    const parsed = StoryChapterDefSchema.parse({
      id: "x",
      number: 1,
      trigger: { kind: "start" },
      ...display,
    });
    expect(parsed.contractIds).toEqual([]);
    expect(parsed.guardSortieIds).toEqual([]);
  });
});
