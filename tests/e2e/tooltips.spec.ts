import { expect, test } from "@playwright/test";

import { openBattlefield } from "./helpers";

/**
 * Tooltips & info (UX).
 *
 * The Field is dense with terms and numbers a new player cannot read. These
 * specs prove the three surfaces explain themselves on hover **and** on
 * keyboard focus: the HUD term markers, the Orders menu's ability descriptions,
 * and the Orders Tempo tray's soldier stat lines.
 */
test("explains the HUD terms on hover and on focus", async ({ page }) => {
  await openBattlefield(page);

  await page.getByTestId("hud-help-move-range").hover();
  await expect(page.getByTestId("hud-help-move-range-bubble")).toBeVisible();
  await expect(page.getByTestId("hud-help-move-range-bubble")).toContainText(/reach this turn/i);

  // Keyboard focus reveals the bubble too, and the trigger points at it.
  await page.getByTestId("hud-help-danger-zone").focus();
  await expect(page.getByTestId("hud-help-danger-zone-bubble")).toBeVisible();
  await expect(page.getByTestId("hud-help-danger-zone")).toHaveAttribute(
    "aria-describedby",
    /.+/,
  );
});

test("explains an Orders action with its rules text and numbers", async ({ page }) => {
  await openBattlefield(page);

  await page.keyboard.press("Enter"); // select the acting soldier
  await expect(page.getByTestId("action-menu")).toBeVisible();

  const bubble = page.getByTestId("order-info-musket-fire");
  await page.getByTestId("action-musket-fire").hover();
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText("Range");
  await expect(bubble).toContainText("Target");
  await expect(bubble).toContainText("Cost");
});

test("shows an authored ability's description in Quick Battle", async ({ page }) => {
  await openBattlefield(page);
  await page.getByTestId("nav-quick-battle").click();
  await expect(page.getByTestId("skirmish-battle")).toBeVisible();

  await page.keyboard.press("Enter"); // select Pte. Okafor
  await expect(page.getByTestId("action-menu")).toBeVisible();

  const bubble = page.getByTestId("order-info-aimed-shot");
  await page.getByTestId("action-aimed-shot").hover();
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText(/place a single ball precisely/i);
});

test("shows a soldier's stat line from the Orders Tempo tray", async ({ page }) => {
  await openBattlefield(page);

  const bubble = page.getByTestId("tempo-info-0");
  await page.getByTestId("tempo-entry-0").hover();
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText("HP");
  await expect(bubble).toContainText("Élan");
});

test("explains a depot item's stats before you buy it", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-depot").click();
  await expect(page.getByTestId("depot-screen")).toBeVisible();

  await page.locator(".depot-item-name").first().hover();
  const bubble = page.locator('[data-testid^="depot-info-"]').first();
  await expect(bubble).toBeVisible();
  await expect(bubble).toContainText("Slot");
  await expect(bubble).toContainText(/Weapon|Off-hand|Uniform|Head|Accessory/);
});
