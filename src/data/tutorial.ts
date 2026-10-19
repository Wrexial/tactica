/**
 * Tutorial mission (T110) — the **drill square** the company visits before its
 * first contract.
 *
 * FFTA opens on a scripted snowball fight that teaches the player to **move**,
 * **act** and read the turn order before the real battles begin
 * (`docs/wiki/pages/Mr._Leslaie.md`). Tactica keeps that idea and widens it to
 * cover the systems the retheme adds, so a new officer meets all five of the
 * game's foundational verbs in one short, deterministic exercise:
 *
 * | Lesson            | Objective   | Teaches                                            |
 * | ----------------- | ----------- | -------------------------------------------------- |
 * | The March         | `move`      | Select a soldier and march along a legal path       |
 * | The Fire          | `act`       | Choose an Order and aim it before the turn closes   |
 * | Orders Tempo      | `tempo`     | Speed-driven turn order and why a turn advances     |
 * | Articles of War   | `articles`  | Daily standing orders, commendations and breaches   |
 * | Drill by Kit      | `drill`     | Drill earned from kit and permanent ability mastery |
 *
 * ## Data, not code
 *
 * The curriculum is **authored content** (`agents.md` §2): the ordered lessons,
 * the two sample Articles of War and the training recruit's kit all live here,
 * validated at module load. The engine and the UI read this; nothing about the
 * tutorial is hard-coded in the battle loop. The file has **no engine import**
 * (`src/data/README.md`) — the app layer (`src/app/tutorial.ts`) turns the
 * authored training spec into a real `Unit` and awards real Drill.
 *
 * ## Determinism (`agents.md` §2)
 *
 * The exercise is seeded (`seed`) and set on a fixed campaign `day`, so the
 * turn order, the Articles on display and every Drill event replay byte-for-byte.
 * The progress helpers below are pure functions of a plain {@link TutorialFacts}
 * snapshot, which makes the curriculum trivially unit-testable.
 *
 * Reference: `docs/wiki/pages/Mr._Leslaie.md` (the opening tutorial battle) and
 * `docs/NAPOLEONIC_MAPPING.md` §9 (Articles of War), §10 (Drill by kit), §12
 * (Orders Tempo).
 */

import { z } from "zod";

import {
  ArticleDefSchema,
  DisplayFields,
  IdSchema,
  PowerKeySchema,
  StatBlockSchema,
  type ArticleDef,
} from "./schema";

/* --------------------------------------------------------------------------
 * Objectives and lessons
 * ------------------------------------------------------------------------ */

/**
 * The five skills the tutorial exists to teach, in the order they are exercised.
 * The id doubles as the lesson's objective, so a lesson's completion rule is
 * keyed by what it teaches rather than by its authored id.
 */
export const TUTORIAL_OBJECTIVES = ["move", "act", "tempo", "articles", "drill"] as const;
export const TutorialObjectiveSchema = z.enum(TUTORIAL_OBJECTIVES);
export type TutorialObjective = z.infer<typeof TutorialObjectiveSchema>;

/** One step of the curriculum: what the officer reads and what they must do. */
export const TutorialLessonSchema = z.object({
  id: IdSchema,
  ...DisplayFields,
  /** The skill this lesson teaches and the signal that completes it. */
  objective: TutorialObjectiveSchema,
  /** The active coach bubble's instruction — a direct order to the player. */
  coach: z.string().min(1),
  /** A control reminder shown beneath the order (`Arrows move the cursor`). */
  hint: z.string().min(1),
});
export type TutorialLesson = z.infer<typeof TutorialLessonSchema>;

/**
 * The five lessons, in play order. Each is re-authored Napoleonic fiction
 * (mapping §14, D6/D8), not FFTA prose.
 */
export const TUTORIAL_LESSONS: readonly TutorialLesson[] = [
  {
    id: "lesson-march",
    name: "The March",
    description:
      "Select a soldier and march along a legal path. A march never spends the turn — the order that follows it does.",
    flavour: "Ground is taken one measured pace at a time, and the drill makes it steady.",
    objective: "move",
    coach: "Select Sgt. Aubry, trace a line to a blue tile, and confirm the march.",
    hint: "Arrows move the cursor · Enter selects and confirms.",
  },
  {
    id: "lesson-fire",
    name: "The Fire",
    description:
      "An Order resolves from the tile your soldier has marched to, then ends the turn. Commit the march first, then choose and aim the order.",
    flavour: "The line does not fire by inspiration; it fires by order.",
    objective: "act",
    coach: "Commit the march, then choose an Order and aim it at a hostile picket.",
    hint: "Open Orders with O, or click an order in the HUD.",
  },
  {
    id: "lesson-tempo",
    name: "Orders Tempo",
    description:
      "Every soldier charges tempo in proportion to Speed. Resolving an order spends the turn, and the next soldier rises to the head of the tray.",
    flavour: "The fastest do not wait their turn; they make it.",
    objective: "tempo",
    coach: "Study the Orders Tempo tray, then confirm the order of battle.",
    hint: "The tray at the bottom of the field names who acts next.",
  },
  {
    id: "lesson-articles",
    name: "Articles of War",
    description:
      "The day's standing orders forbid some acts and commend others. A first breach draws a Reprimand; a second, or an illegal kill, draws a Court-Martial.",
    flavour: "An army marches on its orders, and a court-martial waits for those who forget them.",
    objective: "articles",
    coach: "Read the day's Articles of War, then acknowledge the standing orders.",
    hint: "Commended acts earn Honour; forbidden ones draw cards.",
  },
  {
    id: "lesson-drill",
    name: "Drill by Kit",
    description:
      "Fighting awards Drill to the abilities bound to your kit. Enough Drill masters an ability permanently, even after the teaching item is removed.",
    flavour: "The musket teaches the volley long before the recruit understands why.",
    objective: "drill",
    coach: "Collect the exercise's Drill and watch an ability draw closer to mastery.",
    hint: "Drill is credited to every equipped ability you are still learning.",
  },
];

/* --------------------------------------------------------------------------
 * The mission
 * ------------------------------------------------------------------------ */

export const TutorialMissionSchema = z.object({
  id: IdSchema,
  ...DisplayFields,
  /** Fixed seed for the exercise; keeps the turn order replayable. */
  seed: z.number().int(),
  /** Campaign day whose Articles the lesson reads (mapping §9/§10). */
  day: z.number().int().positive(),
  /** Drill the training recruit earns in the Drill lesson (mapping §5). */
  drillAward: z.number().int().positive(),
  /** The ordered curriculum. */
  lessons: z.array(TutorialLessonSchema).min(1),
});
export type TutorialMission = z.infer<typeof TutorialMissionSchema>;

/** The one authored tutorial, validated at module load. */
export const TUTORIAL_MISSION: TutorialMission = TutorialMissionSchema.parse({
  id: "tutorial-drill-square",
  name: "The Exercise at Grey Meadow",
  description:
    "A training exercise that walks a new officer through the march, the fire, Orders Tempo, the Articles of War and Drill by kit.",
  flavour: "Before the company meets the enemy, it meets the drill square.",
  seed: 1810,
  day: 1,
  drillAward: 40,
  lessons: TUTORIAL_LESSONS,
});

/* --------------------------------------------------------------------------
 * The day's Articles of War
 * ------------------------------------------------------------------------ */

/**
 * The two standing orders in force during the exercise — one forbidding, one
 * commending — so the lesson can show both sides of the Articles of War
 * (`ArticleDefSchema`, mapping §9). They are tutorial-scale examples: an
 * Incendiary ban (element) and a commended musket volley (action).
 */
export const TUTORIAL_ARTICLES: readonly ArticleDef[] = [
  ArticleDefSchema.parse({
    id: "tutorial-no-incendiary",
    name: "No Incendiary",
    description:
      "Incendiary actions are forbidden in the exercise; a first breach draws a Reprimand.",
    flavour: "The range is dry this summer, and the colonel will not burn it to prove a point.",
    kind: "forbid",
    target: "element",
    keys: ["fire"],
    severity: "reprimand",
    honour: 0,
    weight: 1,
  }),
  ArticleDefSchema.parse({
    id: "tutorial-commend-musket-fire",
    name: "Commended: Musket Fire",
    description: "A disciplined musket volley is commended and earns Honour.",
    flavour: "Fire by rank, and the smoke itself becomes a wall the enemy must cross.",
    kind: "commend",
    target: "action",
    keys: ["musket-fire"],
    severity: "reprimand",
    honour: 1,
    weight: 1,
  }),
];

/* --------------------------------------------------------------------------
 * The training recruit (Drill lesson)
 * ------------------------------------------------------------------------ */

/**
 * A recruit and the kit the Drill lesson drills with. The weapon id is an
 * authored equipment key (`charleville-musket`) that teaches an ability, so the
 * app layer can award **real** Drill through `engine/progression/drill.ts`.
 */
export const TutorialTrainingSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  power: PowerKeySchema,
  postId: IdSchema,
  level: z.number().int().positive(),
  stats: StatBlockSchema,
  /** Equipped weapon that binds the drilled ability (mapping §10). */
  weaponId: IdSchema,
  /** The ability the weapon teaches, for the lesson copy. */
  abilityId: IdSchema,
});
export type TutorialTraining = z.infer<typeof TutorialTrainingSchema>;

/** The recruit the Drill lesson equips and drills, validated at load. */
export const TUTORIAL_TRAINING: TutorialTraining = TutorialTrainingSchema.parse({
  id: "unit-tutorial-recruit",
  name: "Recruit Petit",
  power: "france",
  postId: "fusilier",
  level: 1,
  stats: {
    hp: 58,
    mp: 24,
    atk: 11,
    def: 8,
    mag: 4,
    res: 6,
    spd: 28,
    move: 4,
    jump: 2,
  },
  weaponId: "charleville-musket",
  abilityId: "volley-fire",
});

/* --------------------------------------------------------------------------
 * Pure progress helpers
 * ------------------------------------------------------------------------ */

/**
 * What the officer has actually done in the field exercise. A plain snapshot so
 * the curriculum can be evaluated without holding engine or UI state.
 *
 * - `moved` — a `move` command was committed;
 * - `acted` — an `act` command was committed;
 * - `tempoAdvanced` — a turn ended, so the Orders Tempo order moved on;
 * - `tempoRead` — the officer studied the projected turn order;
 * - `articlesRead` — the officer acknowledged the day's standing orders;
 * - `drillCollected` — the officer collected the exercise's Drill.
 */
export interface TutorialFacts {
  readonly moved: boolean;
  readonly acted: boolean;
  readonly tempoAdvanced: boolean;
  readonly tempoRead: boolean;
  readonly articlesRead: boolean;
  readonly drillCollected: boolean;
}

/** A fresh officer who has done nothing yet. */
export const EMPTY_TUTORIAL_FACTS: TutorialFacts = {
  moved: false,
  acted: false,
  tempoAdvanced: false,
  tempoRead: false,
  articlesRead: false,
  drillCollected: false,
};

/** Whether a single lesson's objective has been satisfied. */
export function lessonComplete(objective: TutorialObjective, facts: TutorialFacts): boolean {
  switch (objective) {
    case "move":
      return facts.moved;
    case "act":
      return facts.acted;
    case "tempo":
      return facts.tempoRead;
    case "articles":
      return facts.articlesRead;
    case "drill":
      return facts.drillCollected;
  }
}

/** The objectives already satisfied, in curriculum order. */
export function completedObjectives(
  mission: TutorialMission,
  facts: TutorialFacts,
): readonly TutorialObjective[] {
  return mission.lessons
    .filter((lesson) => lessonComplete(lesson.objective, facts))
    .map((lesson) => lesson.objective);
}

/** The next lesson to teach, or `undefined` once the whole curriculum is done. */
export function nextLesson(
  mission: TutorialMission,
  facts: TutorialFacts,
): TutorialLesson | undefined {
  return mission.lessons.find((lesson) => !lessonComplete(lesson.objective, facts));
}

/** `true` when every lesson in `mission` has been satisfied. */
export function isTutorialComplete(mission: TutorialMission, facts: TutorialFacts): boolean {
  return nextLesson(mission, facts) === undefined;
}
