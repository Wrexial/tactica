import { expect, test } from "@playwright/test";

import { openBattlefield } from "./helpers";

/**
 * T083 — Orders Tempo tray.
 *
 * The Pixi canvas cannot be asserted visually, so the tray mirrors the
 * deterministic `previewTurns` forecast (T019) in the DOM. These specs check
 * that the upcoming order is rendered, that the acting soldier heads it, and
 * that it advances when a turn is committed.
 */

test("visualises the upcoming turn order", async ({ page }) => {
  await openBattlefield(page);

  await expect(page.getByTestId("tempo-tray")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Orders Tempo" })).toBeVisible();

  const entries = page.getByTestId("tempo-order").locator("li");
  await expect(entries).toHaveCount(8);

  // The soldier whose turn it is (per the HUD) heads the tray and is flagged.
  await expect(page.getByTestId("hud-actor")).toHaveText("Sgt. Aubry");
  await expect(page.getByTestId("tempo-entry-0")).toContainText("Sgt. Aubry");
  await expect(page.getByTestId("tempo-entry-0")).toHaveAttribute("data-current", "true");
  await expect(page.getByTestId("tempo-entry-0-now")).toHaveText("On turn");

  // Speed orders the rest: Cpl. Lefèvre (Speed 34) follows Sgt. Aubry (42).
  await expect(page.getByTestId("tempo-entry-1")).toContainText("Cpl. Lefèvre");
  await expect(page.getByTestId("tempo-entry-1")).toHaveAttribute("data-current", "false");
});

test("advances the tray after a turn is closed", async ({ page }) => {
  await openBattlefield(page);
  await expect(page.getByTestId("tempo-entry-0")).toContainText("Sgt. Aubry");

  // Select the acting soldier, plan a one-tile march and commit it (T142: the
  // march stays its own command and leaves the same soldier in turn).
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await expect(page.getByTestId("tempo-entry-0")).toContainText("Sgt. Aubry");

  // End Turn is the explicit `wait`; only then does the tray advance.
  await page.getByTestId("end-turn").click();
  await expect(page.getByTestId("hud-phase")).toHaveText("select");

  // The next soldier now heads the tray.
  await expect(page.getByTestId("hud-actor")).toHaveText("Cpl. Lefèvre");
  await expect(page.getByTestId("tempo-entry-0")).toContainText("Cpl. Lefèvre");
  await expect(page.getByTestId("tempo-entry-0")).toHaveAttribute("data-current", "true");
});
