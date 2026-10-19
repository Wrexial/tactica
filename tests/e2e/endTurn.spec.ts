import { expect, test } from "@playwright/test";

import { openBattlefield } from "./helpers";

/**
 * T140 — the explicit End Turn control.
 *
 * The command band is the only player-facing way to pass a turn without moving
 * or acting. These specs prove it appears while the selected soldier owns the
 * turn, dispatches a single `wait` (which advances the Orders Tempo) and stays
 * out of the aiming/confirm phases where a turn is no longer an open decision.
 */

test("End Turn passes the acting soldier's turn without a move or an action", async ({ page }) => {
  await openBattlefield(page);

  // The opening actor is selected and holds the turn.
  await expect(page.getByTestId("hud-actor")).toHaveText("Sgt. Aubry");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await expect(page.getByTestId("end-turn")).toBeVisible();

  await page.getByTestId("end-turn").click();

  // `wait` closes the turn and `advanceToDecision` hands it to the next actor.
  await expect(page.getByTestId("hud-actor")).toHaveText("Cpl. Lefèvre");
  await expect(page.getByTestId("hud-phase")).toHaveText("select");
  await expect(page.getByTestId("end-turn")).toHaveCount(0);

  // A wait emits no march or action cue, so the battle log stays empty.
  const log = page.getByTestId("animation-log");
  await expect(log.locator("li")).toHaveCount(0);
  await expect(log).not.toContainText("marches");
});

test("End Turn after a march adds no second move or act", async ({ page }) => {
  await openBattlefield(page);

  // Select, preview a march and commit it: the soldier stays in command (T138).
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("move");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await expect(page.getByTestId("animation-log")).toContainText("marches");

  // Let the march animation finish; field orders stay locked until it does.
  await page.waitForTimeout(500);

  // The keyboard path passes the turn with T, exactly like the button.
  await expect(page.getByTestId("end-turn")).toBeVisible();
  await page.keyboard.press("t");

  await expect(page.getByTestId("hud-actor")).toHaveText("Cpl. Lefèvre");
  await expect(page.getByTestId("hud-phase")).toHaveText("select");

  // The wait replaced the march's cue with nothing: no second move, no action.
  const log = page.getByTestId("animation-log");
  await expect(log.locator("li")).toHaveCount(0);
  await expect(log.locator('[data-kind="move"]')).toHaveCount(0);
  await expect(log.locator('[data-kind="artillery"]')).toHaveCount(0);
});

test("End Turn is unavailable while an order is aimed", async ({ page }) => {
  await openBattlefield(page);

  await page.keyboard.press("Enter");
  await expect(page.getByTestId("end-turn")).toBeVisible();

  await page.getByTestId("action-musket-fire").click();
  await expect(page.getByTestId("hud-phase")).toHaveText("target");
  await expect(page.getByTestId("end-turn")).toHaveCount(0);

  // Backing out of the aim restores the open-turn control.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await expect(page.getByTestId("end-turn")).toBeVisible();
});
