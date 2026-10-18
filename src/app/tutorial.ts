/**
 * Tutorial orchestration (T110) — the **edge** that binds the authored
 * curriculum (`src/data/tutorial.ts`) to the live engine.
 *
 * The data layer declares what the tutorial teaches and keeps a plain
 * {@link TutorialFacts} snapshot pure. This module is the only place the
 * tutorial touches the engine, and it does so in the two ways the retheme
 * allows (`agents.md` §7):
 *
 * - **Observing the battle.** {@link observeTutorialFacts} folds a
 *   {@link BattleController} update into the facts: it reads the committed
 *   command log (a `move` / `act`) and the emitted events (`turnEnded`) and
 *   accumulates them. It never mutates the controller or the engine state.
 * - **Drilling a recruit.** {@link createTutorialRecruit} builds the authored
 *   training soldier, and {@link collectTutorialDrill} credits the exercise's
 *   **Drill** to the abilities its kit binds, through the real
 *   `engine/progression/drill.ts` (`awardDrill`). The lesson therefore
 *   demonstrates the genuine FFTA AP-by-equipment loop, not a mock-up.
 *
 * Contract (`agents.md` §2, §7, §9): pure and deterministic — no DOM, no
 * `Math.random`, no clock. Every function returns a new value and reads its
 * inputs without writing to them.
 */

import { TUTORIAL_TRAINING, type TutorialFacts } from "../data/tutorial";
import { coord } from "../engine/grid";
import { asEquipmentId, asPostId, asUnitId } from "../engine/ids";
import { awardDrill, type DrillAwardResult } from "../engine/progression/drill";
import { createUnit, type Unit } from "../engine/unit";
import type { BattleController } from "./battleController";

/**
 * Fold one controller update into the tutorial facts.
 *
 * Reads the controller's **last dispatched** record, which is exactly the
 * committed intent (`BattleController.lastCommands`) and the resolved
 * {@link BattleEvent}s (`lastEvents`). A cursor move or a selection carries
 * neither, so it leaves the facts unchanged; a committed march, order or turn
 * advances them monotonically (once true, always true).
 *
 * The tempo lesson is completed by the officer reading the tray
 * (`tempoRead`), but `tempoAdvanced` records that a turn actually ended first,
 * so the coach can hold the acknowledgement until the order has moved on.
 */
export function observeTutorialFacts(
  previous: TutorialFacts,
  controller: BattleController,
): TutorialFacts {
  const moved =
    previous.moved || controller.lastCommands.some((command) => command.kind === "move");
  const acted = previous.acted || controller.lastCommands.some((command) => command.kind === "act");
  const tempoAdvanced =
    previous.tempoAdvanced || controller.lastEvents.some((event) => event.kind === "turnEnded");

  if (
    moved === previous.moved &&
    acted === previous.acted &&
    tempoAdvanced === previous.tempoAdvanced
  ) {
    // No observed change: return the same value so React can skip a render.
    return previous;
  }
  return { ...previous, moved, acted, tempoAdvanced };
}

/**
 * Build the authored training recruit with the kit that binds the drilled
 * ability. Placed at `{ x: 0, y: 0 }` because the recruit never deploys — the
 * Drill lesson only needs a real {@link Unit} for `awardDrill` to read.
 */
export function createTutorialRecruit(): Unit {
  return createUnit({
    id: asUnitId(TUTORIAL_TRAINING.id),
    name: TUTORIAL_TRAINING.name,
    power: TUTORIAL_TRAINING.power,
    postId: asPostId(TUTORIAL_TRAINING.postId),
    level: TUTORIAL_TRAINING.level,
    at: coord(0, 0),
    stats: { ...TUTORIAL_TRAINING.stats },
    equipment: { weapon: asEquipmentId(TUTORIAL_TRAINING.weaponId) },
  });
}

/**
 * Credit the tutorial's Drill award to the recruit's equipped kit. Returns the
 * engine's {@link DrillAwardResult}, so the UI can show the ordinary
 * `drillGained` events and the progress toward mastery the rest of the game
 * uses (`src/engine/progression/drill.ts`, T048).
 */
export function collectTutorialDrill(recruit: Unit, amount: number): DrillAwardResult {
  return awardDrill(recruit, amount, 0);
}
