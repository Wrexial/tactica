import { expect, test } from "@playwright/test";

import { openBattlefield } from "./helpers";

/**
 * T085 — targeting UX.
 *
 * The Pixi overlay cannot be asserted pixel-by-pixel, so the HUD mirrors the
 * same derived targeting numbers the overlay draws from: the reach of an aimed
 * action, its area footprint, the hostile danger zone and the elevation delta
 * under the cursor. These specs walk the aiming flow and check those readouts.
 */

test("shows an action's reach, area footprint and the hostile danger zone", async ({ page }) => {
  await openBattlefield(page);

  // Select the acting soldier: the danger zone and orders menu appear.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await expect(page.getByTestId("action-menu")).toBeVisible();
  await expect(page.getByTestId("hud-danger-zone")).not.toHaveText("0 tiles");

  // Aim the area order: reach is highlighted and the footprint is previewed.
  await page.getByTestId("action-dress-ranks").click();
  await expect(page.getByTestId("hud-phase")).toHaveText("target");
  await expect(page.getByTestId("hud-target-range")).not.toHaveText("0 tiles");
  await expect(page.getByTestId("hud-target-area")).toHaveText("5 tiles");

  // Move the aim one tile east; the footprint follows the cursor.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("hud-cursor")).toHaveText("4, 4");
  await expect(page.getByTestId("hud-target-area")).toHaveText("5 tiles");
});

test("previews the elevation of the tile under the cursor", async ({ page }) => {
  await openBattlefield(page);

  // The cursor starts on Sgt. Aubry's flat tile.
  await expect(page.getByTestId("hud-cursor")).toHaveText("3, 4");
  await expect(page.getByTestId("hud-elevation")).toHaveText("level");

  // Climb to the hill at (8, 6): five east then two south.
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("hud-cursor")).toHaveText("8, 6");
  await expect(page.getByTestId("hud-elevation")).toHaveText("+1");

  // Step onto the two-layer summit at (9, 7).
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowDown");
  await expect(page.getByTestId("hud-cursor")).toHaveText("9, 7");
  await expect(page.getByTestId("hud-elevation")).toHaveText("+2");
});
