import { expect, test } from "@playwright/test";

import { openBattlefield } from "./helpers";

/**
 * T146 — the opening Field is a real action, not an endless sandbox.
 *
 * It carries an annihilation objective, the shared AI driver plays the hostile
 * pickets, and the deterministic Resolve control (the same auto-battle path as
 * Quick Battle) brings the action to a terminal result that can be restarted.
 */
test("plays the opening Field action to a result and restarts it", async ({ page }) => {
  await openBattlefield(page);

  await expect(page.getByTestId("demo-battle")).toBeVisible();
  await expect(page.getByTestId("demo-name")).toHaveText("The River Ford");
  await expect(page.getByTestId("demo-objective")).toContainText("Defeat every hostile");
  await expect(page.getByTestId("hud-actor")).toHaveText("Sgt. Aubry");

  // Commit both sides to the deterministic AI: the objective resolves.
  await page.getByTestId("demo-resolve").click();
  await expect(page.getByTestId("demo-result")).toBeVisible();
  await expect(page.getByTestId("demo-result-outcome")).toContainText(
    /holds the field|quits the field|draw/i,
  );

  // Fight again resets the opening board to Sgt. Aubry's turn.
  await page.getByTestId("demo-result-restart").click();
  await expect(page.getByTestId("demo-battle")).toBeVisible();
  await expect(page.getByTestId("hud-actor")).toHaveText("Sgt. Aubry");
  await expect(page.getByTestId("hud-phase")).toHaveText("select");
});
