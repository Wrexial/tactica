import { expect, test } from "@playwright/test";

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
  await page.goto("/");
  await expect(page.getByTestId("battle-canvas")).toBeVisible();

  // Select the acting soldier, then aim the musket.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
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
});
