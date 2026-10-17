/**
 * Story spine (T077, mapping §10, D13) — the chapter progression that turns the
 * open **contract sandbox** into a campaign.
 *
 * `docs/NAPOLEONIC_MAPPING.md` D13 makes the campaign an "open contract sandbox
 * **with a story spine**". The sandbox is the Officers' Mess (T071), the
 * Campaign Map (T073), depots (T075) and the calendar (T076); the spine is this
 * module. It answers one question for every other campaign system: **which
 * chapter is the company in, and what has that chapter unlocked?**
 *
 * In FFTA the world opens up as the story advances: the pub posts new missions,
 * and each race-guardian **Totema** answers the call only after it has been met
 * in the story. The retheme keeps that shape exactly (mapping §4, §10):
 *
 * | FFTA story beat              | Tactica (mapping §4, §10)                     |
 * | ---------------------------- | --------------------------------------------- |
 * | main-story mission unlocked  | a **story contract** gated by a chapter       |
 * | Totema met and then callable | a **Guard Sortie** unlocked by a chapter      |
 * | story progress flag          | a chapter number (`1..`{@link MAX_STORY_CHAPTER}) |
 *
 * ## The model
 *
 * A **chapter** is a named story beat with three parts:
 *
 * 1. a {@link StoryTrigger} that must be satisfied to *enter* it — either the
 *    campaign's start, the completion of a named contract, or the arrival of a
 *    campaign day;
 * 2. the **story contracts** it opens (ids from `./contracts.ts`), which the
 *    Mess then posts; and
 * 3. the **Guard Sorties** it unlocks (ids from `./guards.ts`), which the
 *    action executor may then summon for ten Honour.
 *
 * ```
 *   StoryFacts                       STORY_CHAPTERS
 *   ├─ completedContractIds[]  ─┐   ┌─ number, trigger, contractIds, guardSortieIds
 *   └─ day                     ─┴──►│
 *                                    ▼
 *   advanceChapter(current, facts) ── the next reachable chapter
 *                                    │
 *          ┌─────────────────────────┴─────────────────────────┐
 *          ▼                                                   ▼
 *   unlockedStoryContractIds(chapter)              unlockedGuardSortieIds(chapter)
 *   isStoryContractUnlocked(...)                   isGuardSortieUnlocked(...)
 * ```
 *
 * ## Why the spine lives in `src/data/`
 *
 * The chapter table is **content**, not engine logic: the trigger that opens
 * each beat, the contract it posts and the formation it unlocks are authored
 * design decisions, and D13 requires the `src/data/` layer to "express
 * contracts, regions and a story spine". The engine reads the chapter *numbers*
 * already baked into `ContractDef.chapter` (T070) and `GuardSortieDef.chapter`
 * (T062); this module is the single authored source that keeps those two tables
 * honest. {@link assertStorySpine} cross-checks them at module load, so a
 * mistyped chapter fails loudly instead of silently opening the wrong beat.
 *
 * ## Contract (`agents.md` §2, §3, §9; `src/data/README.md`)
 *
 * - **Static data, no engine import.** The spine declares chapters; the engine
 *   imports *this*, never the reverse. Ids stay plain strings; the engine brands
 *   them at its boundary (T012).
 * - **Validated at load.** Every chapter is parsed with
 *   {@link StoryChapterDefSchema}, then {@link assertStorySpine} proves the
 *   chapter numbers are contiguous, the triggers are reachable (no beat that
 *   requires itself) and the contract/Guard Sortie references resolve.
 * - **No placeholders.** Every chapter carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 *
 * Reference: mapping §4 (Guard Sorties unlocked "by beating it in the story"),
 * §10 ("Regular missions → Battles … Story/campaign set pieces") and D13.
 * Original fiction inspired by the Napoleonic Wars, not a port of FFTA's story.
 */

import { z } from "zod";

import { CONTRACTS, isContractKey } from "./contracts";
import { GUARD_SORTIES, isGuardSortieKey } from "./guards";
import { DisplayFields, IdSchema } from "./schema";

/* --------------------------------------------------------------------------
 * Schema
 * ------------------------------------------------------------------------ */

/** The ways a chapter can be entered (mapping §10). */
export const STORY_TRIGGER_KINDS = ["start", "complete-contract", "reach-day"] as const;
export type StoryTriggerKind = (typeof STORY_TRIGGER_KINDS)[number];

/**
 * A chapter **trigger** — the condition that opens a beat.
 *
 * | `kind`              | enters the chapter when...                         |
 * | ------------------- | -------------------------------------------------- |
 * | `start`             | always (the opening chapter)                        |
 * | `complete-contract` | the named contract is in `StoryFacts.completedContractIds` |
 * | `reach-day`         | `StoryFacts.day` is at least the named campaign day |
 *
 * Triggers are **monotonic**: a completed contract stays completed and the
 * campaign day only moves forward, so once a chapter is reachable it stays
 * reachable and {@link advanceChapter} can never move backwards.
 */
export const StoryTriggerSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("start"),
  }),
  z.object({
    kind: z.literal("complete-contract"),
    contractId: IdSchema.describe("Contract whose completion advances the story (T070)"),
  }),
  z.object({
    kind: z.literal("reach-day"),
    day: z.number().int().positive().describe("Campaign day on which the chapter opens (T076)"),
  }),
]);
export type StoryTrigger = z.infer<typeof StoryTriggerSchema>;

/**
 * One chapter of the story spine. `number` is the stable chapter handle the
 * engine gates against (the same number authored on contracts and Guard
 * Sorties); `id` is the stable authoring handle; the display fields carry the
 * fiction.
 */
export const StoryChapterDefSchema = z.object({
  id: IdSchema,
  ...DisplayFields,
  /** Chapter number: 1 = the opening beat, increasing by one per chapter. */
  number: z.number().int().positive(),
  /** Condition that opens this chapter (see {@link StoryTrigger}). */
  trigger: StoryTriggerSchema,
  /** Story contracts opened at this chapter (ids from `./contracts.ts`). */
  contractIds: z.array(IdSchema).default([]),
  /** Guard Sorties unlocked at this chapter (ids from `./guards.ts`). */
  guardSortieIds: z.array(IdSchema).default([]),
});
export type StoryChapterDef = z.infer<typeof StoryChapterDefSchema>;

/* --------------------------------------------------------------------------
 * The table
 * ------------------------------------------------------------------------ */

/**
 * The canonical chapter ids in story order. Typed as a tuple so the compiler
 * rejects a missing key in {@link STORY_CHAPTER_DATA} and the UI can iterate a
 * stable order.
 */
export const STORY_CHAPTER_KEYS = [
  "the-free-company",
  "the-old-guard",
  "the-heavy-brigade",
  "the-deaths-head",
  "the-grand-battery",
  "the-kaisers-bombardiers",
] as const;
export type StoryChapterKey = (typeof STORY_CHAPTER_KEYS)[number];

/** The schema's *input* type: defaulted fields may be omitted when authoring. */
type StoryChapterInput = z.input<typeof StoryChapterDefSchema>;

/** A single chapter as authored, before {@link StoryChapterDefSchema} stamps its id. */
export type StoryChapterData = Omit<StoryChapterInput, "id">;

/**
 * Unparsed chapter data, keyed by the stable id. `satisfies` enforces that
 * every {@link StoryChapterKey} is authored; only fields that differ from the
 * schema defaults need to appear.
 */
const STORY_CHAPTER_DATA = {
  "the-free-company": {
    name: "A Company of Fortune",
    description:
      "The free company takes its first contract and learns to stand together on the road to Sainte-Colombe.",
    flavour: "No colours, no country, and no pay but what the next contract brings.",
    number: 1,
    trigger: { kind: "start" },
    contractIds: ["break-the-bridge"],
  },
  "the-old-guard": {
    name: "The Old Guard Answers",
    description:
      "Word of the bridge reaches the Old Guard, and for the first time the company may call on a national formation.",
    flavour: "The Old Guard does not come to be admired. It comes to end the matter.",
    number: 2,
    trigger: { kind: "complete-contract", contractId: "break-the-bridge" },
    guardSortieIds: ["old-guard"],
  },
  "the-heavy-brigade": {
    name: "The Heavy Brigade",
    description:
      "A running fight with a rival company draws the heavy dragoons into the field, and the company may call them down.",
    flavour: "At a walk, then a trot, then a weight no line of infantry can hold.",
    number: 3,
    trigger: { kind: "complete-contract", contractId: "crossed-sabres" },
    contractIds: ["storm-the-farmhouse"],
    guardSortieIds: ["heavy-brigade"],
  },
  "the-deaths-head": {
    name: "The Death's Head",
    description:
      "With the farmhouse taken, the black hussars ride at the company's call, breaking through whatever holds the line.",
    flavour: "They wear the skull and crossed bones, and they have earned the right to.",
    number: 4,
    trigger: { kind: "complete-contract", contractId: "storm-the-farmhouse" },
    contractIds: ["hold-the-redoubt"],
    guardSortieIds: ["deaths-head-hussars"],
  },
  "the-grand-battery": {
    name: "The Grand Battery",
    description:
      "By the thirtieth day the massed artillery park is in position, and its guns answer the company's signal.",
    flavour: "Two hundred guns speak together, and for a moment the earth itself answers.",
    number: 5,
    trigger: { kind: "reach-day", day: 30 },
    contractIds: ["break-the-guerrilla-camp"],
    guardSortieIds: ["grand-battery"],
  },
  "the-kaisers-bombardiers": {
    name: "The Kaiser's Bombardiers",
    description:
      "The guerrilla camp is broken, and the bombardiers walk their shell across the enemy front at the company's word.",
    flavour:
      "The bombardment is not meant to kill a man; it is meant to erase the ground he stands on.",
    number: 6,
    trigger: { kind: "complete-contract", contractId: "break-the-guerrilla-camp" },
    guardSortieIds: ["kaisers-bombardiers"],
  },
} satisfies Record<StoryChapterKey, StoryChapterData>;

/**
 * Every chapter, keyed by the stable id and validated at module load. Read this
 * instead of branching on chapter ids anywhere in the campaign.
 */
export const STORY_CHAPTERS: Record<StoryChapterKey, StoryChapterDef> = Object.fromEntries(
  Object.entries(STORY_CHAPTER_DATA).map(([id, def]) => [
    id,
    StoryChapterDefSchema.parse({ id, ...def }),
  ]),
) as Record<StoryChapterKey, StoryChapterDef>;

/**
 * The chapters in story order (the order of {@link STORY_CHAPTER_KEYS}, which
 * the integrity check pins to `1..N`). Handy for menus and tests.
 */
export const STORY_CHAPTER_LIST: readonly StoryChapterDef[] = STORY_CHAPTER_KEYS.map(
  (id) => STORY_CHAPTERS[id],
);

/** The first chapter number; a fresh campaign begins here (mapping D13). */
export const STORY_CHAPTER_MIN = 1;

/** The last chapter number authored. */
export const MAX_STORY_CHAPTER = STORY_CHAPTER_LIST.length;

/* --------------------------------------------------------------------------
 * Integrity — the spine keeps contracts and Guard Sorties honest (T077)
 * ------------------------------------------------------------------------ */

/**
 * Prove the authored spine is coherent, throwing on the first problem. Called
 * once at module load and exported so tests can pin the invariants directly.
 *
 * The invariants:
 *
 * - **Contiguous numbers.** Chapters are numbered `1..N` with no gaps and no
 *   duplicates, so `chapter + 1` always means "the next beat".
 * - **Resolvable references.** Every `contractIds` entry names a real
 *   {@link import("./contracts").CONTRACTS} contract and every `guardSortieIds`
 *   entry names a real {@link import("./guards").GUARD_SORTIES} formation.
 * - **Agreement with content.** A story contract's own `ContractDef.chapter`
 *   (T070) matches the chapter that opens it; each unlocked Guard Sortie's
 *   `GuardSortieDef.chapter` (T062) matches the chapter that unlocks it. This is
 *   what stops the two gating tables from drifting.
 * - **Reachable triggers.** A `complete-contract` trigger must name a contract
 *   that already exists and is available strictly *before* the chapter it opens
 *   (an earlier chapter, or ungated) — otherwise a beat could require itself or
 *   a contract it only opens, and the campaign would deadlock.
 *
 * @throws RangeError when any invariant is broken.
 */
export function assertStorySpine(chapters: readonly StoryChapterDef[] = STORY_CHAPTER_LIST): void {
  const seenNumbers = new Set<number>();
  const seenIds = new Set<string>();

  for (let index = 0; index < chapters.length; index++) {
    const chapter = chapters[index] as StoryChapterDef;

    if (seenIds.has(chapter.id)) {
      throw new RangeError(`story chapters duplicate id ${chapter.id}`);
    }
    seenIds.add(chapter.id);

    if (chapter.number !== index + 1 || seenNumbers.has(chapter.number)) {
      throw new RangeError(
        `story chapter ${chapter.id} must be numbered ${index + 1}, received ${chapter.number}`,
      );
    }
    seenNumbers.add(chapter.number);

    for (const contractId of chapter.contractIds) {
      const contract = isContractKey(contractId) ? CONTRACTS[contractId] : undefined;
      if (contract === undefined) {
        throw new RangeError(`story chapter ${chapter.id} opens unknown contract ${contractId}`);
      }
      if (contract.chapter !== undefined && contract.chapter !== chapter.number) {
        throw new RangeError(
          `story chapter ${chapter.id} opens ${contractId}, but its ContractDef.chapter is ${contract.chapter}`,
        );
      }
    }

    for (const guardSortieId of chapter.guardSortieIds) {
      const guard = isGuardSortieKey(guardSortieId) ? GUARD_SORTIES[guardSortieId] : undefined;
      if (guard === undefined) {
        throw new RangeError(
          `story chapter ${chapter.id} unlocks unknown Guard Sortie ${guardSortieId}`,
        );
      }
      if (guard.chapter !== chapter.number) {
        throw new RangeError(
          `story chapter ${chapter.id} unlocks ${guardSortieId}, but its GuardSortieDef.chapter is ${guard.chapter}`,
        );
      }
    }

    if (chapter.trigger.kind === "complete-contract") {
      const contractId = chapter.trigger.contractId;
      const contract = isContractKey(contractId) ? CONTRACTS[contractId] : undefined;
      if (contract === undefined) {
        throw new RangeError(
          `story chapter ${chapter.id} is triggered by unknown contract ${contractId}`,
        );
      }
      if (contract.chapter !== undefined && contract.chapter >= chapter.number) {
        throw new RangeError(
          `story chapter ${chapter.id} is gated behind a chapter-${contract.chapter} contract it could never reach`,
        );
      }
    }
  }

  if (chapters.length === 0) {
    throw new RangeError("the story spine must author at least one chapter");
  }
}

// Fail fast: a broken spine is a load-time error, never a mid-campaign surprise.
assertStorySpine();

/* --------------------------------------------------------------------------
 * Lookups
 * ------------------------------------------------------------------------ */

/** Runtime guard: `true` when `value` is a canonical chapter key. */
export function isStoryChapterKey(value: unknown): value is StoryChapterKey {
  return typeof value === "string" && (STORY_CHAPTER_KEYS as readonly string[]).includes(value);
}

/** Runtime guard: `true` when `number` is an authored chapter number. */
export function isStoryChapterNumber(number: unknown): number is number {
  return (
    typeof number === "number" &&
    Number.isInteger(number) &&
    number >= STORY_CHAPTER_MIN &&
    number <= MAX_STORY_CHAPTER
  );
}

/** Look up a chapter by its canonical key. Throws on an unknown key. */
export function getStoryChapter(id: StoryChapterKey): StoryChapterDef {
  const chapter = STORY_CHAPTERS[id];
  if (chapter === undefined) {
    throw new RangeError(`unknown story chapter: ${String(id)}`);
  }
  return chapter;
}

/**
 * The chapter with `number`, or `undefined` outside `1..`{@link MAX_STORY_CHAPTER}.
 * Use {@link isStoryChapterNumber} when a boolean is enough.
 */
export function storyChapterByNumber(number: number): StoryChapterDef | undefined {
  if (!isStoryChapterNumber(number)) return undefined;
  return STORY_CHAPTER_LIST[number - 1];
}

/**
 * Assert that `chapter` is a readable story position (`0..`{@link MAX_STORY_CHAPTER}).
 * Chapter `0` is "not started yet": it unlocks nothing but can be advanced from.
 */
function assertReadableChapter(chapter: number): void {
  if (!Number.isInteger(chapter) || chapter < 0 || chapter > MAX_STORY_CHAPTER) {
    throw new RangeError(
      `story chapter must be an integer in [0, ${MAX_STORY_CHAPTER}], received ${String(chapter)}`,
    );
  }
}

/** The chapter number that opens `contractId`, or `undefined` for a non-story contract. */
export function chapterForContract(contractId: string): number | undefined {
  return STORY_CHAPTER_LIST.find((chapter) => chapter.contractIds.includes(contractId))?.number;
}

/** The chapter number that unlocks `guardSortieId`, or `undefined` if unauthored. */
export function chapterForGuardSortie(guardSortieId: string): number | undefined {
  return STORY_CHAPTER_LIST.find((chapter) => chapter.guardSortieIds.includes(guardSortieId))
    ?.number;
}

/** Every story contract id opened anywhere in the spine, in chapter order. */
export function allStoryContractIds(): readonly string[] {
  return STORY_CHAPTER_LIST.flatMap((chapter) => chapter.contractIds);
}

/** Every Guard Sortie id unlocked anywhere in the spine, in chapter order. */
export function allGuardSortieIds(): readonly string[] {
  return STORY_CHAPTER_LIST.flatMap((chapter) => chapter.guardSortieIds);
}

/* --------------------------------------------------------------------------
 * Gating — what a chapter opens (T077)
 * ------------------------------------------------------------------------ */

/** What a chapter has unlocked: its story contracts and Guard Sorties. */
export interface StoryGate {
  /** The chapter position the gate was computed for. */
  readonly chapter: number;
  /** Story contracts opened at or before the chapter, in canonical order. */
  readonly contractIds: readonly string[];
  /** Guard Sorties unlocked at or before the chapter, in canonical order. */
  readonly guardSortieIds: readonly string[];
}

/**
 * The **story contracts** opened at or before `chapter`, in chapter order. A
 * contract authored in `./contracts.ts` but never named by the spine is not a
 * story contract and is always assumed posted.
 *
 * ```ts
 * unlockedStoryContractIds(1); // ["break-the-bridge"]
 * unlockedStoryContractIds(3); // ["break-the-bridge", "storm-the-farmhouse"]
 * ```
 *
 * @throws RangeError when `chapter` is not an integer in `[0, MAX_STORY_CHAPTER]`.
 */
export function unlockedStoryContractIds(chapter: number): readonly string[] {
  assertReadableChapter(chapter);
  const ids: string[] = [];
  for (const def of STORY_CHAPTER_LIST) {
    if (def.number <= chapter) ids.push(...def.contractIds);
  }
  return ids;
}

/**
 * The **Guard Sorties** unlocked at or before `chapter`, in chapter order.
 * Mirrors `guardSortiesForChapter` (`./guards.ts`) and the engine's
 * `unlockedGuardSorties` (T062); {@link assertStorySpine} keeps them in step.
 *
 * ```ts
 * unlockedGuardSortieIds(1); // []
 * unlockedGuardSortieIds(2); // ["old-guard"]
 * unlockedGuardSortieIds(6); // all five
 * ```
 *
 * @throws RangeError when `chapter` is not an integer in `[0, MAX_STORY_CHAPTER]`.
 */
export function unlockedGuardSortieIds(chapter: number): readonly string[] {
  assertReadableChapter(chapter);
  const ids: string[] = [];
  for (const def of STORY_CHAPTER_LIST) {
    if (def.number <= chapter) ids.push(...def.guardSortieIds);
  }
  return ids;
}

/** `true` when `contractId` is a story contract opened at or before `chapter`. */
export function isStoryContractUnlocked(chapter: number, contractId: string): boolean {
  return unlockedStoryContractIds(chapter).includes(contractId);
}

/** `true` when `guardSortieId` has been unlocked at or before `chapter`. */
export function isGuardSortieUnlocked(chapter: number, guardSortieId: string): boolean {
  return unlockedGuardSortieIds(chapter).includes(guardSortieId);
}

/** A single object describing everything `chapter` opens, for menus and saves. */
export function storyGateAt(chapter: number): StoryGate {
  return {
    chapter,
    contractIds: unlockedStoryContractIds(chapter),
    guardSortieIds: unlockedGuardSortieIds(chapter),
  };
}

/* --------------------------------------------------------------------------
 * Advancing the spine (T077) — facts in, next chapter out
 * ------------------------------------------------------------------------ */

/**
 * The campaign facts a chapter trigger is evaluated against. Both fields are
 * monotonic, which is what makes {@link advanceChapter} stable: a completed
 * contract is never un-completed and a campaign day never moves backwards.
 */
export interface StoryFacts {
  /** Contracts the company has completed, in any order. */
  readonly completedContractIds?: readonly string[];
  /** The current campaign day (T076); defaults to the opening day. */
  readonly day?: number;
}

/** `true` when `trigger` is satisfied by `facts`. Pure; `facts` is never mutated. */
export function triggerMet(trigger: StoryTrigger, facts: StoryFacts = {}): boolean {
  switch (trigger.kind) {
    case "start":
      return true;
    case "complete-contract":
      return (facts.completedContractIds ?? []).includes(trigger.contractId);
    case "reach-day":
      return (facts.day ?? STORY_CHAPTER_MIN) >= trigger.day;
  }
}

/**
 * `true` when the chapter numbered `chapter` can be entered.
 *
 * @throws RangeError when `chapter` is outside `1..`{@link MAX_STORY_CHAPTER}.
 */
export function chapterTriggerMet(chapter: number, facts: StoryFacts = {}): boolean {
  const def = storyChapterByNumber(chapter);
  if (def === undefined) {
    throw new RangeError(
      `story chapter must be an integer in [${STORY_CHAPTER_MIN}, ${MAX_STORY_CHAPTER}], received ${String(chapter)}`,
    );
  }
  return triggerMet(def.trigger, facts);
}

/**
 * The furthest chapter reachable from `current` given `facts`, advancing one
 * beat at a time. The story is **sequential**: a later chapter cannot be held
 * while an earlier trigger is unmet, so the loop stops at the first beat whose
 * trigger fails even if a later one would pass.
 *
 * ```ts
 * // Completed the bridge and the skirmish; not yet day 30.
 * advanceChapter(1, { completedContractIds: ["break-the-bridge", "crossed-sabres"] }); // 3
 * advanceChapter(3, { completedContractIds: ["storm-the-farmhouse"], day: 30 });      // 5
 * ```
 *
 * @throws RangeError when `current` is outside `0..`{@link MAX_STORY_CHAPTER}.
 */
export function advanceChapter(current: number, facts: StoryFacts = {}): number {
  assertReadableChapter(current);
  let chapter = current;
  while (chapter < MAX_STORY_CHAPTER && chapterTriggerMet(chapter + 1, facts)) {
    chapter += 1;
  }
  return chapter;
}
