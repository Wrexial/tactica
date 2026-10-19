import { expect, test } from "@playwright/test";

test("renders the battlefield canvas and HUD shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Lines of Glory" })).toBeVisible();
  await expect(page.getByTestId("battle-canvas")).toBeVisible();
  // T137 — the persistent `aside.hud` column is retired in favour of the
  // anchored card, the bottom band, the world plate and the tempo rail. The
  // Orders Tempo rail and the collapsed battle log are the remaining chrome.
  await expect(page.locator("aside.hud")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Orders Tempo" })).toBeVisible();
  await expect(page.getByTestId("battle-log")).toBeVisible();
});
