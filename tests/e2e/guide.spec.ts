import { expect, test } from "@playwright/test";

import { openBattlefield } from "./helpers";

/**
 * T171 — the in-game Field Manual.
 *
 * The player guide exists as `docs/HOW_TO_PLAY.md`, but the build needs a
 * version that is one tap away while playing. This spec proves the manual is
 * reachable from the navigation bar, renders every section (field, controls,
 * turn, fighting, company, campaign and the not-yet-wired note), and returns to
 * the battlefield from its close button.
 */
test("opens the Field Manual, shows every section and returns to the field", async ({ page }) => {
  await openBattlefield(page);

  await page.getByTestId("nav-guide").click();
  await expect(page.getByTestId("guide-screen")).toBeVisible();

  for (const id of ["field", "controls", "turn", "fighting", "company", "campaign", "pending"]) {
    await expect(page.getByTestId(`guide-section-${id}`)).toBeVisible();
  }

  // The manual names the controls and the turn loop in player language.
  await expect(page.getByTestId("guide-section-controls")).toContainText("T / gamepad Y");
  await expect(page.getByTestId("guide-section-turn")).toContainText("End Turn");
  await expect(page.getByTestId("guide-section-pending")).toContainText("not");

  await page.getByTestId("guide-close").click();
  await expect(page.getByTestId("battle-canvas")).toBeVisible();
});

test("backs out of the Field Manual with Escape", async ({ page }) => {
  await openBattlefield(page);
  await page.getByTestId("nav-guide").click();
  await expect(page.getByTestId("guide-screen")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("battle-canvas")).toBeVisible();
});
