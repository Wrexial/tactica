import { expect, test } from "@playwright/test";

/**
 * T052 — post-change screen.
 *
 * The screen is presentation over the pure progression helpers (T051): it must
 * **gate post changes by unlock requirements** and **show Drill progress**. The
 * barracks is reached from the app shell's "Barracks" tab (`nav-posts`); the
 * screen is seeded with a deterministic demo soldier (Sgt. Aubry, France
 * fusilier) so these assertions are stable across reloads.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-posts").click();
  await expect(page.getByTestId("post-screen")).toBeVisible();
});

test("opens on the soldier's current primary and attached posts", async ({ page }) => {
  await expect(page.getByTestId("post-current-primary")).toHaveText("Fusilier");
  await expect(page.getByTestId("post-current-attached")).toHaveText("Marksman");
});

test("unlocks posts whose mastery requirement is met", async ({ page }) => {
  // Two fusilier abilities are mastered, so Grenadier (needs 2) is unlocked.
  await expect(page.getByTestId("post-grenadier-status")).toHaveText("Unlocked");
  await expect(page.getByTestId("post-grenadier-set-primary")).toBeEnabled();

  // Fusilier is the current primary, so its own control is a no-op.
  await expect(page.getByTestId("post-fusilier-status")).toHaveText("Current");
  await expect(page.getByTestId("post-fusilier-set-primary")).toBeDisabled();
});

test("locks posts whose mastery requirement is unmet and shows progress", async ({ page }) => {
  // Colour Guard needs three fusilier abilities; only two are mastered.
  await expect(page.getByTestId("post-colour-guard-status")).toHaveText("Locked");
  await expect(page.getByTestId("post-colour-guard-requirement")).toHaveText(
    "Requires 3 from Fusilier (2/3)",
  );
  await expect(page.getByTestId("post-colour-guard-set-primary")).toBeDisabled();
});

test("shows Drill progress toward ability mastery", async ({ page }) => {
  // A mastered ability reads full and mastered.
  await expect(page.getByTestId("drill-volley-fire-progress")).toHaveText("100 / 100");
  await expect(page.getByTestId("drill-volley-fire-status")).toHaveText("Mastered");

  // An in-progress ability shows its accumulated Drill against the cost.
  await expect(page.getByTestId("drill-aim-vitals-progress")).toHaveText("40 / 150");
  await expect(page.getByTestId("drill-aim-vitals-status")).toHaveText("In training");
});

test("changes the primary post when the requirement is met", async ({ page }) => {
  await page.getByTestId("post-grenadier-set-primary").click();

  await expect(page.getByTestId("post-current-primary")).toHaveText("Grenadier");
  // Changing the primary resets the attached command to the new post's kit.
  await expect(page.getByTestId("post-current-attached")).toHaveText("—");
  await expect(page.getByTestId("post-grenadier-status")).toHaveText("Current");

  // The locked post stays locked — drill, not the primary choice, is the gate.
  await expect(page.getByTestId("post-colour-guard-set-primary")).toBeDisabled();
});
