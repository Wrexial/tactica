/**
 * Tutorial coach (T110) — the drill-square overlay that walks a new officer
 * through the five foundational lessons (`src/data/tutorial.ts`).
 *
 * This is the presentation half of the tutorial. It owns only **local,
 * ephemeral progress** (the {@link TutorialFacts} snapshot and the Drill result)
 * and renders the authored curriculum; every rule it shows — the lesson order,
 * the sample Articles, the Drill award and the ability a weapon teaches — comes
 * from `src/data/`. The one engine interaction is delegated to
 * `src/app/tutorial.ts`, which observes the battle controller and awards Drill
 * through the real `engine/progression/drill.ts`.
 *
 * The overlay watches the live {@link BattleController}: committed marches and
 * orders, and the `turnEnded` event, advance the curriculum. The Articles and
 * Orders Tempo lessons ask the officer to acknowledge what they have read; the
 * Drill lesson collects a genuine Drill award.
 *
 * Contract (`agents.md` §2, §7, §9): presentation only, at the edge. It never
 * mutates engine or controller state, reads no clock and uses no randomness. A
 * screen-reader announcement carries the active lesson so the tutorial is
 * playable without sight of the overlay (T109).
 */

import { useEffect, useMemo, useState } from "react";

import {
  EMPTY_TUTORIAL_FACTS,
  TUTORIAL_ARTICLES,
  TUTORIAL_MISSION,
  TUTORIAL_TRAINING,
  isTutorialComplete,
  lessonComplete,
  nextLesson,
  type TutorialFacts,
} from "../data/tutorial";
import { getAbility, isAbilityKey } from "../data/abilities";
import { getEquipment, isEquipmentKey } from "../data/equipment";
import type { DrillAwardResult } from "../engine/progression/drill";
import { collectTutorialDrill, createTutorialRecruit, observeTutorialFacts } from "../app/tutorial";
import { useTranslation } from "../i18n";
import { announce } from "./a11y";
import { upcomingTurnOrder } from "./tempoOrder";
import type { BattleController } from "../app/battleController";

/** Props for {@link Tutorial}. */
export interface TutorialProps {
  /** The live battle controller the exercise observes. */
  readonly controller: BattleController;
  /** Leave the exercise and close the overlay. */
  readonly onClose: () => void;
}

/**
 * The tutorial coach overlay. Mount it over the battlefield and hand it the
 * battlefield {@link BattleController}; it advances as the officer plays.
 */
export function Tutorial({ controller, onClose }: TutorialProps) {
  const { t } = useTranslation();
  const [facts, setFacts] = useState<TutorialFacts>(EMPTY_TUTORIAL_FACTS);
  const [drill, setDrill] = useState<DrillAwardResult | null>(null);

  // A single training recruit, built once from the authored spec.
  const recruit = useMemo(() => createTutorialRecruit(), []);

  // Fold every controller update into the progress facts. A cursor move emits
  // no commands or events, so `observeTutorialFacts` returns the same value and
  // React skips the render.
  useEffect(() => {
    setFacts((previous) => observeTutorialFacts(previous, controller));
  }, [controller]);

  const current = nextLesson(TUTORIAL_MISSION, facts);
  const complete = isTutorialComplete(TUTORIAL_MISSION, facts);

  // Announce the active lesson for screen-reader players whenever it changes.
  useEffect(() => {
    const lesson = nextLesson(TUTORIAL_MISSION, facts);
    if (lesson !== undefined) announce(`${lesson.name}. ${lesson.coach}`);
  }, [facts]);

  const projected = upcomingTurnOrder(controller.battle, 4);

  const abilityName = isAbilityKey(TUTORIAL_TRAINING.abilityId)
    ? getAbility(TUTORIAL_TRAINING.abilityId).name
    : TUTORIAL_TRAINING.abilityId;
  const weaponName = isEquipmentKey(TUTORIAL_TRAINING.weaponId)
    ? getEquipment(TUTORIAL_TRAINING.weaponId).name
    : TUTORIAL_TRAINING.weaponId;
  const requiredDrill = isEquipmentKey(TUTORIAL_TRAINING.weaponId)
    ? (getEquipment(TUTORIAL_TRAINING.weaponId).teaches.find(
        (teach) => teach.abilityId === TUTORIAL_TRAINING.abilityId,
      )?.ap ?? 100)
    : 100;

  /** Confirm the officer has read the projected Orders Tempo order. */
  const readTempo = (): void => {
    if (!facts.tempoAdvanced) return;
    setFacts((previous) => ({ ...previous, tempoRead: true }));
  };

  /** Confirm the officer has acknowledged the day's Articles of War. */
  const readArticles = (): void => {
    setFacts((previous) => ({ ...previous, articlesRead: true }));
  };

  /** Collect the exercise's Drill through the engine's real award path. */
  const collectDrill = (): void => {
    if (facts.drillCollected) return;
    setDrill(collectTutorialDrill(recruit, TUTORIAL_MISSION.drillAward));
    setFacts((previous) => ({ ...previous, drillCollected: true }));
  };

  const learned = drill?.unit.abilities.find(
    (entry) => entry.abilityId === TUTORIAL_TRAINING.abilityId,
  );
  const drillProgress = drill === null ? 0 : (learned?.drill ?? 0);
  const drillMastered = learned?.mastered ?? false;

  const lessonIndex = current === undefined ? 0 : TUTORIAL_MISSION.lessons.indexOf(current);

  return (
    <section className="tutorial" data-testid="tutorial-panel" aria-label={t("tutorial.label")}>
      <header className="tutorial__header">
        <div className="tutorial__identity">
          <p className="kicker">{t("tutorial.kicker")}</p>
          <h2 data-testid="tutorial-title">{TUTORIAL_MISSION.name}</h2>
          <p className="muted">{TUTORIAL_MISSION.description}</p>
        </div>
        <button type="button" className="button" data-testid="tutorial-close" onClick={onClose}>
          {t("tutorial.leave")}
        </button>
      </header>

      <ol className="tutorial-progress" data-testid="tutorial-progress">
        {TUTORIAL_MISSION.lessons.map((lesson, index) => {
          const done = lessonComplete(lesson.objective, facts);
          const active = current?.id === lesson.id;
          return (
            <li
              key={lesson.id}
              className={
                done
                  ? "tutorial-progress__item tutorial-progress__item--done"
                  : active
                    ? "tutorial-progress__item tutorial-progress__item--active"
                    : "tutorial-progress__item"
              }
              data-testid={`tutorial-objective-${lesson.objective}`}
              data-complete={done}
              data-current={active}
            >
              <span className="tutorial-progress__index">{done ? "✓" : index + 1}</span>
              <span className="tutorial-progress__name">{lesson.name}</span>
            </li>
          );
        })}
      </ol>

      {complete ? (
        <article className="tutorial__complete" data-testid="tutorial-complete">
          <h3>{t("tutorial.complete")}</h3>
          <p>{t("tutorial.completeNote")}</p>
          {drill !== null && (
            <div className="tutorial__drill">
              <p className="tutorial__drill-progress" data-testid="tutorial-drill-progress">
                {t("tutorial.drillFraction", { drill: drillProgress, required: requiredDrill })}
              </p>
              <p className="tutorial__drill-result" data-testid="tutorial-drill-result">
                {t("tutorial.drillResult", { trained: drill.trained, mastered: drill.mastered })}
                {drillMastered ? t("tutorial.drillHeld") : ""}
              </p>
            </div>
          )}
          <button type="button" className="button" data-testid="tutorial-finish" onClick={onClose}>
            {t("tutorial.returnToField")}
          </button>
        </article>
      ) : current !== undefined ? (
        <article
          className="tutorial__lesson"
          data-testid="tutorial-current-lesson"
          data-objective={current.objective}
        >
          <p className="tutorial__eyebrow">
            {t("tutorial.lessonOf", {
              index: lessonIndex + 1,
              total: TUTORIAL_MISSION.lessons.length,
            })}
          </p>
          <h3>{current.name}</h3>
          <p className="tutorial__coach" data-testid="tutorial-coach">
            {current.coach}
          </p>
          <p className="muted">{current.description}</p>
          <p className="tutorial__hint">
            <kbd>{current.hint}</kbd>
          </p>

          {current.objective === "tempo" && (
            <section className="tutorial__tempo" aria-label={t("tutorial.projectedLabel")}>
              <h4>{t("tutorial.orderOfBattle")}</h4>
              <ol className="tutorial__tempo-list" data-testid="tutorial-tempo-order">
                {projected.map((entry) => (
                  <li key={`${entry.unitId}-${entry.rank}`}>
                    <span>{entry.rank}</span>
                    <span>{entry.unit.name}</span>
                  </li>
                ))}
              </ol>
              <button
                type="button"
                className="button"
                data-testid="tutorial-tempo-ack"
                disabled={!facts.tempoAdvanced}
                onClick={readTempo}
              >
                {t("tutorial.confirmTempo")}
              </button>
            </section>
          )}

          {current.objective === "articles" && (
            <section className="tutorial__articles" aria-label={t("tutorial.articlesLabel")}>
              <h4>{t("tutorial.standingOrders")}</h4>
              <ul data-testid="tutorial-articles">
                {TUTORIAL_ARTICLES.map((article) => (
                  <li
                    key={article.id}
                    data-testid={`tutorial-article-${article.id}`}
                    data-kind={article.kind}
                  >
                    <span className="tutorial__article-kind" data-kind={article.kind}>
                      {article.kind === "forbid" ? t("tutorial.forbidden") : t("tutorial.commended")}
                    </span>
                    <strong>{article.name}</strong>
                    <span>{article.description}</span>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="button"
                data-testid="tutorial-articles-ack"
                onClick={readArticles}
              >
                {t("tutorial.acknowledgeArticles")}
              </button>
            </section>
          )}

          {current.objective === "drill" && (
            <section className="tutorial__drill" aria-label={t("tutorial.drillByKitLabel")}>
              <h4>{t("tutorial.drillByKit")}</h4>
              <p data-testid="tutorial-drill-summary">
                {t("tutorial.binds", { weapon: weaponName, ability: abilityName })}
              </p>
              <p className="tutorial__drill-progress" data-testid="tutorial-drill-progress">
                {t("tutorial.drillFraction", { drill: drillProgress, required: requiredDrill })}
              </p>
              <button
                type="button"
                className="button"
                data-testid="tutorial-drill-collect"
                disabled={facts.drillCollected}
                onClick={collectDrill}
              >
                {t("tutorial.collectDrill", { amount: TUTORIAL_MISSION.drillAward })}
              </button>
              {facts.drillCollected && drill !== null && (
                <p className="tutorial__drill-result" data-testid="tutorial-drill-result">
                  {t("tutorial.drillResult", { trained: drill.trained, mastered: drill.mastered })}
                  {drillMastered ? t("tutorial.drillHeld") : ""}
                </p>
              )}
            </section>
          )}
        </article>
      ) : null}
    </section>
  );
}
