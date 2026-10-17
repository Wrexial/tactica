import { expect, test } from "@playwright/test";

test("renders the battlefield canvas and HUD shell", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Lines of Glory" })).toBeVisible();
  await expect(page.getByTestId("battle-canvas")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Field Orders" })).toBeVisible();
});
