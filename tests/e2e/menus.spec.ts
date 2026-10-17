import { expect, test } from "@playwright/test";

/**
 * T084 — camp menu suite.
 *
 * The suite is a presentation router over the authored data and the pure
 * engine helpers: a main hub plus the company roll, the post, equipment and
 * ability screens, and the pre-existing depot, mess and campaign-map screens.
 * It is reached from the app shell's "Camp Orders" tab (`nav-menu`) and seeded
 * with a deterministic demo company (The Greycoats) and five soldiers, so these
 * assertions are stable across reloads.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-menu").click();
  await expect(page.getByTestId("menus")).toBeVisible();
});

test("opens on the main hub with the company's war chest", async ({ page }) => {
  await expect(page.getByTestId("menu-main")).toBeVisible();
  await expect(page.getByTestId("menu-summary-crowns")).toHaveText("1400 Crowns");
  await expect(page.getByTestId("menu-summary-honours")).toHaveText("3");
  await expect(page.getByTestId("menu-summary-roster")).toHaveText("5 soldiers");
  await expect(page.getByTestId("menu-summary-day")).toHaveText("12");
});

test("the company roll lists every soldier and opens a service record", async ({ page }) => {
  await page.getByTestId("menu-nav-company").click();
  await expect(page.getByTestId("company-screen")).toBeVisible();

  await expect(page.getByTestId("company-roster").locator("li")).toHaveCount(5);
  await expect(page.getByTestId("company-selected-name")).toHaveText("Sgt. Aubry");
  await expect(page.getByTestId("company-kit-weapon")).toContainText("Charleville Musket");

  await page.getByTestId("company-soldier-unit-voss").click();
  await expect(page.getByTestId("company-selected-name")).toHaveText("Lt. Voss");
  await expect(page.getByTestId("company-kit-weapon")).toContainText("Light Carbine");
});

test("the barracks screen gates posts by mastery and shows Drill", async ({ page }) => {
  await page.getByTestId("menu-nav-post").click();
  await expect(page.getByTestId("post-screen")).toBeVisible();

  await expect(page.getByTestId("post-grenadier-status")).toHaveText("Unlocked");
  await expect(page.getByTestId("post-colour-guard-status")).toHaveText("Locked");
  await expect(page.getByTestId("drill-volley-fire-status")).toHaveText("Mastered");
  await expect(page.getByTestId("drill-aim-vitals-progress")).toHaveText("40 / 150");
});

test("the equipment screen swaps kit and changes the fielded stats", async ({ page }) => {
  await page.getByTestId("menu-nav-equipment").click();
  await expect(page.getByTestId("equipment-screen")).toBeVisible();

  await expect(page.getByTestId("equipment-item-weapon")).toHaveText("Charleville Musket");
  const steel = page.getByTestId("equipment-stat-atk");
  const before = await steel.textContent();

  await page.getByTestId("equipment-equip-weapon-grenadier-broadsword").click();

  await expect(page.getByTestId("equipment-item-weapon")).toHaveText("Grenadier Broadsword");
  await expect(steel).not.toHaveText(before ?? "");
});

test("the ability ledger shows Drill progress and kit instruction", async ({ page }) => {
  await page.getByTestId("menu-nav-abilities").click();
  await expect(page.getByTestId("abilities-screen")).toBeVisible();

  await expect(page.getByTestId("ability-volley-fire-status")).toHaveText("Mastered");
  await expect(page.getByTestId("ability-aim-vitals-progress")).toHaveText("40 / 150 Drill");
  await expect(page.getByTestId("ability-aim-vitals-status")).toHaveText("In training");

  // The Charleville Musket teaches Volley Fire; the ledger names the source kit.
  await expect(page.getByTestId("ability-kit-charleville-musket")).toContainText(
    "Charleville Musket",
  );
  await expect(page.getByTestId("ability-kit-charleville-musket")).toContainText("Volley Fire");
});

test("reaches the depot, mess and campaign map from the sidebar", async ({ page }) => {
  await page.getByTestId("menu-nav-depot").click();
  await expect(page.getByTestId("depot-screen")).toBeVisible();

  await page.getByTestId("menu-nav-mess").click();
  await expect(page.getByTestId("mess-screen")).toBeVisible();

  await page.getByTestId("menu-nav-campaign-map").click();
  await expect(page.getByTestId("campaign-map-screen")).toBeVisible();
});

test("returns to the battlefield from the suite", async ({ page }) => {
  await page.getByTestId("menu-nav-field").click();
  await expect(page.getByTestId("menus")).toHaveCount(0);
  await expect(page.getByTestId("battle-canvas")).toBeVisible();
});
