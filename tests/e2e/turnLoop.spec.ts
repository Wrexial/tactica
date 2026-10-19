import { expect, test } from "@playwright/test";

import { openBattlefield } from "./helpers";

/**
 * T142 — the canonical core combat loop, locked through the real canvas.
 *
 * The contract lives in `docs/COMBAT_LOOP.md`: select → preview/commit a march
 * (optional) → action menu from the committed tile → target/confirm one `act`
 * (optional) → or End Turn with one `wait`. A march must never close the turn,
 * an action must resolve from the tile the soldier actually occupies, and a
 * single confirm must never dispatch more than one command.
 *
 * The Pixi canvas cannot be read pixel-by-pixel, so the spec observes the
 * controller through the HUD, the command band, the forecast and the battle log
 * (`animation-log`), all of which are projections of the last dispatch's
 * commands and engine events.
 */

test("commits a march, then resolves the act from the new tile as one command", async ({
  page,
}) => {
  // Keep the two dispatches close together: reduced motion removes the
  // animation gate between the committed march and the order that follows.
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openBattlefield(page);

  const log = page.getByTestId("animation-log");
  await expect(page.getByTestId("hud-actor")).toHaveText("Sgt. Aubry");
  await expect(page.getByTestId("hud-cursor")).toHaveText("3, 4");

  // Select the acting soldier; its command band and move range appear.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await expect(page.getByTestId("action-menu")).toBeVisible();
  await expect(page.getByTestId("hud-move-range")).not.toHaveText("0 tiles");

  // Plan a march to (4, 2), north of the start tile. The centre picket at
  // (8, 2) is out of musket range from (3, 4), so the later shot proves the
  // action resolves from the *moved* tile rather than the origin.
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(page.getByTestId("hud-cursor")).toHaveText("4, 2");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("move");
  await expect(page.getByTestId("hud-path")).toHaveText("4 tiles");

  // Confirm the march. Exactly one `move` is dispatched: the actor stays in
  // command with the action menu, the move slot is spent, and the tempo has
  // not advanced (a `[move, wait]` or `[move, act]` bundle would have).
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await expect(page.getByTestId("hud-actor")).toHaveText("Sgt. Aubry");
  await expect(page.getByTestId("action-menu")).toBeVisible();
  await expect(page.getByTestId("hud-move-range")).toHaveText("0 tiles");
  await expect(page.getByTestId("end-turn")).toBeVisible();
  await expect(log.locator("li")).toHaveCount(1);
  await expect(log.locator('[data-kind="move"]')).toHaveCount(1);
  await expect(log).toContainText("Sgt. Aubry marches");

  // Choose the musket from the committed tile and aim at the centre picket.
  // The forecast is only available because the soldier now stands at (4, 2).
  await page.getByTestId("action-musket-fire").click();
  await expect(page.getByTestId("hud-phase")).toHaveText("target");
  for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("hud-cursor")).toHaveText("8, 2");
  await expect(page.getByTestId("battle-forecast")).toBeVisible();
  await expect(page.getByTestId("forecast-target-0-hit")).toContainText("%");
  await expect(page.getByTestId("forecast-target-0-damage")).not.toHaveText("—");

  // Confirm the order: one `act` closes the turn and hands it to the next
  // actor. The log is rebuilt from the act's events, so a folded march would
  // leave a movement cue behind; the absence of one pins one command per
  // confirm.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("confirm");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("select");
  await expect(page.getByTestId("hud-actor")).toHaveText("Cpl. Lefèvre");
  await expect(page.getByTestId("action-menu")).toHaveCount(0);
  await expect(log.locator('[data-kind="move"]')).toHaveCount(0);
  await expect(log).not.toContainText("marches");
});

test("End Turn closes an open turn with a single wait after the march", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openBattlefield(page);

  // March one tile east and confirm it; the soldier remains in command.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("hud-cursor")).toHaveText("4, 4");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("move");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await expect(page.getByTestId("hud-actor")).toHaveText("Sgt. Aubry");

  // End Turn is the explicit `wait`; it advances Orders Tempo without adding a
  // second move or an action. The wait emits no animation cue, so the log that
  // held the march is emptied rather than appended to.
  const log = page.getByTestId("animation-log");
  await expect(log.locator('[data-kind="move"]')).toHaveCount(1);
  await expect(page.getByTestId("end-turn")).toBeVisible();
  await page.getByTestId("end-turn").click();

  await expect(page.getByTestId("hud-actor")).toHaveText("Cpl. Lefèvre");
  await expect(page.getByTestId("hud-phase")).toHaveText("select");
  await expect(page.getByTestId("end-turn")).toHaveCount(0);
  await expect(page.getByTestId("action-menu")).toHaveCount(0);
  await expect(log.locator("li")).toHaveCount(0);
  await expect(log).not.toContainText("marches");
  await expect(log.locator('[data-kind="artillery"]')).toHaveCount(0);
});
