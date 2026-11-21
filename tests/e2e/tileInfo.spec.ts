import { expect, test } from "@playwright/test";

import { openBattlefield } from "./helpers";

/**
 * T145 — tile inspection.
 *
 * The cursor's ground has to be readable before a march: terrain name and
 * rules, absolute height, the climb relative to the soldier in focus, entry
 * cost and the passable / sight / water flags. The card is anchored to the
 * cursor; `hud-tile` carries the same facts for assistive tech and tests.
 */
test("inspects the occupied opening tile and a raised hill under the cursor", async ({ page }) => {
  await openBattlefield(page);

  // The field opens with the cursor on Sgt. Aubry's flat, open tile.
  await expect(page.getByTestId("hud-cursor")).toHaveText("3, 4");
  const card = page.getByTestId("tile-card");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-terrain", "field");
  await expect(card).toHaveAttribute("data-height", "0");
  await expect(card).toHaveAttribute("data-occupied", "true");
  await expect(page.getByTestId("tile-name")).toHaveText("Open Field");
  await expect(page.getByTestId("tile-occupant")).toContainText("Sgt. Aubry");
  await expect(page.getByTestId("tile-passable")).toHaveText("Passable");
  await expect(page.getByTestId("tile-sight")).toHaveText("Clear sight");
  await expect(page.getByTestId("tile-water")).toHaveText("Dry ground");
  await expect(page.getByTestId("hud-tile")).toContainText("Open Field");

  // Climb to the hill at (8, 6): five east then two south (as in T085).
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowDown");

  await expect(page.getByTestId("hud-cursor")).toHaveText("8, 6");
  await expect(card).toHaveAttribute("data-terrain", "hill");
  await expect(card).toHaveAttribute("data-height", "1");
  await expect(card).toHaveAttribute("data-occupied", "false");
  await expect(card).toHaveAttribute("data-elevation-delta", "1");
  await expect(page.getByTestId("tile-name")).toHaveText("Rising Ground");
  await expect(page.getByTestId("tile-height")).toHaveText("1");
  await expect(page.getByTestId("tile-delta")).toHaveText("+1");
  await expect(page.getByTestId("tile-move-cost")).toHaveText("2");
  await expect(page.getByTestId("tile-passable")).toHaveText("Passable");
  await expect(page.getByTestId("tile-sight")).toHaveText("Clear sight");
  await expect(page.getByTestId("tile-water")).toHaveText("Dry ground");
  await expect(page.getByTestId("hud-tile")).toContainText("Rising Ground");
  await expect(page.getByTestId("hud-tile")).toContainText("+1");
});

test("reports rough, sight-blocking ground while browsing the Orders band", async ({ page }) => {
  await openBattlefield(page);

  // Select the acting soldier, then inspect the copse at (2, 2).
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");

  await expect(page.getByTestId("hud-cursor")).toHaveText("2, 2");
  await expect(page.getByTestId("tile-card")).toHaveAttribute("data-terrain", "wood");
  await expect(page.getByTestId("tile-name")).toHaveText("Wood");
  await expect(page.getByTestId("tile-sight")).toHaveText("Sight blocked");
  await expect(page.getByTestId("tile-move-cost")).toHaveText("2");
  await expect(page.getByTestId("hud-tile")).toContainText("Sight blocked");
});

test("steps aside for the forecast while aiming an order", async ({ page }) => {
  await openBattlefield(page);

  await page.keyboard.press("Enter");
  await expect(page.getByTestId("action-menu")).toBeVisible();

  // Aiming puts the forecast on the target tile; the tile card yields so it
  // never covers the odds the player is about to confirm.
  await page.getByTestId("action-musket-fire").click();
  await expect(page.getByTestId("hud-phase")).toHaveText("target");
  await expect(page.getByTestId("tile-card")).toHaveCount(0);
  await expect(page.getByTestId("hud-tile")).toContainText("Open Field");
});
