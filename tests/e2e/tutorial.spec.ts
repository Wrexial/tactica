import { expect, test } from "@playwright/test";

import { openBattlefield } from "./helpers";

/**
 * T110 — tutorial mission (the Drill Square).
 *
 * The authored curriculum lives in `src/data/tutorial.ts` and is unit-tested in
 * `tests/unit/tutorial.test.ts`. This spec drives the whole exercise through the
 * real battlefield: it marches and fires Sgt. Aubry, confirms the Orders Tempo
 * order, acknowledges the Articles of War and collects real Drill from the
 * training kit.
 */

test("teaches move, act, tempo, Articles and Drill in one exercise", async ({ page }) => {
  await openBattlefield(page);

  // Open the drill square from the nav; it overlays the field as an active
  // tutorial without changing the battle underneath.
  await page.getByTestId("nav-tutorial").click();
  await expect(page.getByTestId("nav-tutorial")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("tutorial-panel")).toBeVisible();
  await expect(page.getByTestId("tutorial-title")).toHaveText("The Exercise at Grey Meadow");

  // All five objectives are on the curriculum, in order, and the first
  // incomplete lesson is the march.
  for (const objective of ["move", "act", "tempo", "articles", "drill"]) {
    await expect(page.getByTestId(`tutorial-objective-${objective}`)).toBeVisible();
  }
  await expect(page.getByTestId("tutorial-current-lesson")).toHaveAttribute(
    "data-objective",
    "move",
  );

  // --- Lesson 1 & 2: march, then fire before the turn closes. ---------------
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("command");

  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("hud-cursor")).toHaveText("4, 4");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("move");

  // Choose the musket while the march is still open, aim it at the picket and
  // confirm the whole turn. This commits `[move, act]` in one order.
  await page.getByTestId("action-musket-fire").click();
  await expect(page.getByTestId("hud-phase")).toHaveText("target");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("hud-cursor")).toHaveText("8, 4");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("confirm");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("select");

  // The march and the fire are recorded, and the turn advanced, so the tempo
  // lesson is now active and its acknowledgement is available.
  await expect(page.getByTestId("tutorial-objective-move")).toHaveAttribute(
    "data-complete",
    "true",
  );
  await expect(page.getByTestId("tutorial-objective-act")).toHaveAttribute("data-complete", "true");

  // --- Lesson 3: read the order of battle. ---------------------------------
  await expect(page.getByTestId("tutorial-current-lesson")).toHaveAttribute(
    "data-objective",
    "tempo",
  );
  await expect(page.getByTestId("tutorial-tempo-order").locator("li")).not.toHaveCount(0);
  const tempoAck = page.getByTestId("tutorial-tempo-ack");
  await expect(tempoAck).toBeEnabled();
  await tempoAck.click();
  await expect(page.getByTestId("tutorial-objective-tempo")).toHaveAttribute(
    "data-complete",
    "true",
  );

  // --- Lesson 4: the Articles of War. --------------------------------------
  await expect(page.getByTestId("tutorial-current-lesson")).toHaveAttribute(
    "data-objective",
    "articles",
  );
  await expect(page.getByTestId("tutorial-article-tutorial-no-incendiary")).toHaveAttribute(
    "data-kind",
    "forbid",
  );
  await expect(page.getByTestId("tutorial-article-tutorial-commend-musket-fire")).toHaveAttribute(
    "data-kind",
    "commend",
  );
  await page.getByTestId("tutorial-articles-ack").click();

  // --- Lesson 5: Drill by kit. --------------------------------------------
  await expect(page.getByTestId("tutorial-current-lesson")).toHaveAttribute(
    "data-objective",
    "drill",
  );
  await expect(page.getByTestId("tutorial-drill-summary")).toContainText("Volley Fire");
  await expect(page.getByTestId("tutorial-drill-progress")).toHaveText("0 / 100 Drill");
  await page.getByTestId("tutorial-drill-collect").click();
  await expect(page.getByTestId("tutorial-drill-progress")).toHaveText("40 / 100 Drill");
  await expect(page.getByTestId("tutorial-drill-result")).toContainText("1 ability trained");

  // --- Complete. -----------------------------------------------------------
  await expect(page.getByTestId("tutorial-complete")).toBeVisible();
  for (const objective of ["move", "act", "tempo", "articles", "drill"]) {
    await expect(page.getByTestId(`tutorial-objective-${objective}`)).toHaveAttribute(
      "data-complete",
      "true",
    );
  }

  // Leaving the exercise returns the battlefield to its normal state.
  await page.getByTestId("tutorial-finish").click();
  await expect(page.getByTestId("tutorial-panel")).toHaveCount(0);
  await expect(page.getByTestId("nav-tutorial")).toHaveAttribute("aria-pressed", "false");
});
