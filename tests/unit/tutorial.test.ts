import { describe, expect, it } from "vitest";

import {
  EMPTY_TUTORIAL_FACTS,
  TUTORIAL_ARTICLES,
  TUTORIAL_LESSONS,
  TUTORIAL_MISSION,
  TUTORIAL_OBJECTIVES,
  TUTORIAL_TRAINING,
  TutorialMissionSchema,
  completedObjectives,
  isTutorialComplete,
  lessonComplete,
  nextLesson,
  type TutorialFacts,
} from "../../src/data/tutorial";
import { ArticleDefSchema } from "../../src/data/schema";
import {
  collectTutorialDrill,
  createTutorialRecruit,
  observeTutorialFacts,
} from "../../src/app/tutorial";
import { act, confirmOrder, createBattleController, planMove, selectUnit } from "../../src/app/battleController";
import { createDemoBattle } from "../../src/app/demoScenario";
import { unitTarget } from "../../src/engine/commands";
import { coord } from "../../src/engine/grid";
import { asAbilityId, asUnitId } from "../../src/engine/ids";

/* --------------------------------------------------------------------------
 * T110 — Tutorial mission
 *
 * These tests pin the authored curriculum (data integrity + progress rules) and
 * the two engine-backed steps: observing a committed turn and awarding real
 * Drill through the kit. The field play-through itself is the Playwright spec
 * (`tests/e2e/tutorial.spec.ts`).
 * ------------------------------------------------------------------------ */

/** Every fact true, i.e. a fully completed exercise. */
const COMPLETED_FACTS: TutorialFacts = {
  moved: true,
  acted: true,
  tempoAdvanced: true,
  tempoRead: true,
  articlesRead: true,
  drillCollected: true,
};

describe("tutorial curriculum (T110)", () => {
  it("validates the authored mission against the schema", () => {
    expect(() => TutorialMissionSchema.parse(TUTORIAL_MISSION)).not.toThrow();
  });

  it("teaches all five objectives, in order and once each", () => {
    expect(TUTORIAL_LESSONS.map((lesson) => lesson.objective)).toEqual([...TUTORIAL_OBJECTIVES]);
    expect(new Set(TUTORIAL_LESSONS.map((lesson) => lesson.id)).size).toBe(TUTORIAL_LESSONS.length);
  });

  it("carries authored Napoleonic copy, never a placeholder", () => {
    for (const lesson of TUTORIAL_LESSONS) {
      expect(lesson.name.length).toBeGreaterThan(0);
      expect(lesson.description.length).toBeGreaterThan(0);
      expect(lesson.flavour.length).toBeGreaterThan(0);
      expect(lesson.coach.length).toBeGreaterThan(0);
      expect(lesson.hint.length).toBeGreaterThan(0);
      expect(JSON.stringify(lesson)).not.toMatch(/TBD|TODO|placeholder/i);
    }
  });

  it("shows both sides of the Articles of War", () => {
    const kinds = TUTORIAL_ARTICLES.map((article) => article.kind);
    expect(kinds).toContain("forbid");
    expect(kinds).toContain("commend");
    for (const article of TUTORIAL_ARTICLES) {
      expect(() => ArticleDefSchema.parse(article)).not.toThrow();
    }
  });

  it("walks the lessons forward as the facts arrive", () => {
    expect(nextLesson(TUTORIAL_MISSION, EMPTY_TUTORIAL_FACTS)?.objective).toBe("move");

    const afterMove: TutorialFacts = { ...EMPTY_TUTORIAL_FACTS, moved: true };
    expect(completedObjectives(TUTORIAL_MISSION, afterMove)).toEqual(["move"]);
    expect(nextLesson(TUTORIAL_MISSION, afterMove)?.objective).toBe("act");

    expect(nextLesson(TUTORIAL_MISSION, COMPLETED_FACTS)).toBeUndefined();
    expect(isTutorialComplete(TUTORIAL_MISSION, COMPLETED_FACTS)).toBe(true);
    expect(isTutorialComplete(TUTORIAL_MISSION, EMPTY_TUTORIAL_FACTS)).toBe(false);
  });

  it("requires the tempo acknowledgement only after the order moves on", () => {
    const reader: TutorialFacts = { ...EMPTY_TUTORIAL_FACTS, tempoAdvanced: true };
    expect(lessonComplete("tempo", reader)).toBe(false);
    expect(lessonComplete("tempo", { ...reader, tempoRead: true })).toBe(true);
  });
});

describe("tutorial observation (T110)", () => {
  it("records a committed move and the turn it closes", () => {
    let controller = createBattleController(createDemoBattle());
    controller = selectUnit(controller, asUnitId("unit-aubry"));
    controller = planMove(controller, coord(4, 4));

    // The march commits on its own (T138), so the observation sees `["move"]`
    // before the action is aimed from the committed tile (T139).
    controller = confirmOrder(controller);
    let facts = observeTutorialFacts(EMPTY_TUTORIAL_FACTS, controller);
    expect(facts.moved).toBe(true);
    expect(facts.acted).toBe(false);

    controller = act(controller, asAbilityId("musket-fire"), unitTarget(asUnitId("unit-hedge")));
    facts = observeTutorialFacts(facts, controller);
    expect(facts.acted).toBe(true);
    // The act closed the Orders Tempo turn, so the order advanced.
    expect(facts.tempoAdvanced).toBe(true);
  });

  it("is monotonic — once a fact is true it stays true", () => {
    const seeded: TutorialFacts = { ...EMPTY_TUTORIAL_FACTS, moved: true };
    const controller = createBattleController(createDemoBattle());
    const facts = observeTutorialFacts(seeded, controller);
    expect(facts.moved).toBe(true);
    expect(facts.acted).toBe(false);
  });
});

describe("tutorial Drill (T110)", () => {
  it("awards real Drill to the ability the training kit binds", () => {
    const recruit = createTutorialRecruit();
    const result = collectTutorialDrill(recruit, TUTORIAL_MISSION.drillAward);

    expect(result.trained).toBe(1);
    const learned = result.unit.abilities.find(
      (entry) => entry.abilityId === TUTORIAL_TRAINING.abilityId,
    );
    expect(learned?.drill).toBe(TUTORIAL_MISSION.drillAward);
    expect(learned?.mastered).toBe(false);
    expect(result.events.map((event) => event.kind)).toContain("drillGained");
    // The award credited the authored kit, not an incidental ability.
    expect(result.events[0]).toMatchObject({
      kind: "drillGained",
      abilityId: TUTORIAL_TRAINING.abilityId,
    });
  });
});
