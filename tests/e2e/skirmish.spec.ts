import { expect, test } from "@playwright/test";

import { openBattlefield } from "./helpers";

/**
 * Quick Battle — the preset two-team scene.
 *
 * One self-contained action with ready-made rosters: the company's starting
 * specialists against a scratch force on the farmhouse board, under an
 * annihilation objective. This spec proves the whole scene is reachable, the
 * company takes the opening turn, the AI plays the enemy, and the objective
 * resolves to a result that can be restarted.
 */
test("opens the preset Quick Battle and fights it to a result", async ({ page }) => {
  await openBattlefield(page);

  await page.getByTestId("nav-quick-battle").click();
  await expect(page.getByTestId("skirmish-battle")).toBeVisible();
  await expect(page.getByTestId("skirmish-name")).toHaveText("The Farmhouse");
  await expect(page.getByTestId("skirmish-objective")).toContainText("Defeat every hostile");

  // The company takes the opening turn (Pte. Okafor, Speed 40).
  await expect(page.getByTestId("hud-actor")).toHaveText("Pte. Okafor");
  await expect(page.getByTestId("hud-phase")).toHaveText("select");

  // Commit the company: the deterministic Field AI fights both sides out.
  await page.getByTestId("skirmish-resolve").click();
  await expect(page.getByTestId("skirmish-result")).toBeVisible();
  await expect(page.getByTestId("skirmish-result-outcome")).toContainText(
    /holds the field|quits the field|draw/i,
  );

  // Fight again resets to a fresh board on the opening turn.
  await page.getByTestId("skirmish-result-restart").click();
  await expect(page.getByTestId("skirmish-battle")).toBeVisible();
  await expect(page.getByTestId("hud-actor")).toHaveText("Pte. Okafor");
});

test("reads the raised farmhouse terrace from the low approach", async ({ page }) => {
  await openBattlefield(page);
  await page.getByTestId("nav-quick-battle").click();
  await expect(page.getByTestId("skirmish-battle")).toBeVisible();

  // The cursor begins on Pte. Okafor's low approach tile (0, 4). Stepping east
  // climbs the graded terrace: level approach → orchard bank (+1) → the raised
  // farmhouse core (+2).
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("hud-cursor")).toHaveText("1, 4");
  await expect(page.getByTestId("hud-elevation")).toHaveText("level");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("hud-cursor")).toHaveText("2, 4");
  await expect(page.getByTestId("hud-elevation")).toHaveText("+1");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("hud-cursor")).toHaveText("3, 4");
  await expect(page.getByTestId("hud-elevation")).toHaveText("+2");
});

test("lets the player move and strike an enemy", async ({ page }) => {
  await openBattlefield(page);
  await page.getByTestId("nav-quick-battle").click();
  await expect(page.getByTestId("skirmish-battle")).toBeVisible();

  // Select, plan and commit a march. T142 — the march commits on its own and
  // leaves the same soldier in command to act or choose End Turn.
  await page.keyboard.press("Enter"); // select
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await page.keyboard.press("ArrowDown"); // cursor to a free tile south
  await page.keyboard.press("Enter"); // plan the march
  await expect(page.getByTestId("hud-phase")).toHaveText("move");
  await page.keyboard.press("Enter"); // commit the march
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await expect(page.getByTestId("hud-actor")).toHaveText("Pte. Okafor");
  await expect(page.getByTestId("end-turn")).toBeVisible();
  await expect(page.getByTestId("animation-log")).toContainText("marches");
});
