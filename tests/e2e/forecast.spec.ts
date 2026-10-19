import { expect, test } from "@playwright/test";

import { openBattlefield } from "./helpers";

/**
 * T086 — battle forecast.
 *
 * The overlay cannot be read pixel-by-pixel, so the HUD carries the confirm
 * prompt's projection: the named target, the to-hit odds, the expected damage
 * and the reactions the blow may provoke. This spec aims the demo's musket at a
 * picket and checks the panel reports those numbers before the order is
 * committed.
 */

test("shows hit chance, expected damage and reaction risk before confirming", async ({ page }) => {
  await openBattlefield(page);

  // Select the acting soldier, then aim the musket.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("command");

  // T135 — the Orders menu is a compact band docked at the foot of the field
  // (FFT Blue's `ActionMenu`), below the midline rather than in the side panel.
  const band = page.getByTestId("action-menu");
  await expect(band).toBeVisible();
  const bandBox = await band.boundingBox();
  const viewport = page.viewportSize();
  expect(bandBox).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (bandBox !== null && viewport !== null) {
    expect(bandBox.y + bandBox.height).toBeGreaterThan(viewport.height * 0.55);
  }

  await page.getByTestId("action-musket-fire").click();
  await expect(page.getByTestId("hud-phase")).toHaveText("target");

  // The cursor opens on Sgt. Aubry; a hostile target gives a real forecast.
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("hud-cursor")).toHaveText("8, 4");
  await expect(page.getByTestId("battle-forecast")).toBeVisible();
  await expect(page.getByTestId("forecast-target-0-damage")).not.toHaveText("—");
  await expect(page.getByTestId("forecast-target-0-hit")).toContainText("%");
  // The picket carries no confirmed R-Ability, so its Dodge is flagged as a
  // possible answer rather than a certain one.
  await expect(page.getByTestId("forecast-reaction-0")).toHaveAttribute("data-kind", "dodge");

  // T135 — the forecast is anchored to the aimed-at soldier (T133): the card
  // picks a side and is clamped fully on screen, not parked in the side panel.
  const card = page.getByTestId("battle-forecast");
  await expect(card).toHaveAttribute("data-side", /left|right/);
  const cardBox = await card.boundingBox();
  expect(cardBox).not.toBeNull();
  if (cardBox !== null && viewport !== null) {
    expect(cardBox.x).toBeGreaterThanOrEqual(0);
    expect(cardBox.y).toBeGreaterThanOrEqual(0);
    expect(cardBox.x + cardBox.width).toBeLessThanOrEqual(viewport.width);
    expect(cardBox.y + cardBox.height).toBeLessThanOrEqual(viewport.height);
  }
});
