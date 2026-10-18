import { expect, test } from "@playwright/test";

import { openBattlefield } from "./helpers";

/**
 * T109 — accessibility.
 *
 * The UI layer (`src/ui/a11y.ts`) adds a keyboard skip link, screen-reader
 * labels and a live region, reduces motion on request and applies a
 * colour-blind-safe palette. These specs exercise the DOM-facing half; the pure
 * half (contrast, roving focus, labels) is unit-tested in
 * `tests/unit/a11y.test.ts`.
 */

test("offers a keyboard skip link into the battlefield", async ({ page }) => {
  await page.goto("/");

  const skip = page.getByTestId("skip-link");
  // Hidden above the viewport until it takes focus.
  const before = await skip.boundingBox();
  expect(before === null || before.y < 0).toBe(true);

  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await expect.poll(async () => (await skip.boundingBox())?.y ?? -999).toBeGreaterThanOrEqual(0);

  await page.keyboard.press("Enter");
  await expect
    .poll(() => page.evaluate(() => document.activeElement?.id ?? ""))
    .toBe("main-content");
});

test("labels the battlefield and keeps a polite live region", async ({ page }) => {
  await page.goto("/");

  const canvas = page.getByTestId("battle-canvas");
  await expect(canvas).toHaveAttribute("role", "img");
  await expect(canvas).toHaveAttribute("aria-label", "Battlefield");

  const live = page.locator("#a11y-live-region");
  await expect(live).toHaveAttribute("aria-live", "polite");
  await expect(live).toHaveAttribute("aria-atomic", "true");
  await expect(live).toHaveAttribute("role", "status");
});

test("announces the active screen as the view changes", async ({ page }) => {
  await page.goto("/");
  const live = page.locator("#a11y-live-region");
  await expect(live).toHaveText("Battlefield");

  await page.getByTestId("nav-settings").click();
  await expect(live).toHaveText("Settings");

  await page.getByTestId("nav-mess").click();
  await expect(live).toHaveText("Officers' mess");
});

test("drives the camp menu by keyboard and returns to the field", async ({ page }) => {
  await openBattlefield(page);

  await page.keyboard.press("m");
  await expect(page.getByTestId("nav-menu")).toHaveAttribute("aria-pressed", "true");

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("nav-battle")).toHaveAttribute("aria-pressed", "true");
});

test("honours prefers-reduced-motion", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");

  const html = page.locator("html");
  await expect(html).toHaveAttribute("data-reduced-motion", "reduced");
  await expect(html).toHaveAttribute("data-motion", "reduced");

  // The stylesheet collapses transitions to effectively zero.
  const duration = await page
    .getByTestId("skip-link")
    .evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration));
  expect(duration).toBeLessThan(0.01);
});

test("defaults to full motion when no preference is set", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-reduced-motion", "full");
});

test("applies a colour-blind-safe palette to the root", async ({ page }) => {
  await page.goto("/");

  const readPalette = (): Promise<{ mode: string; company: string; enemy: string }> =>
    page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        mode: document.documentElement.dataset.colourBlind ?? "",
        company: style.getPropertyValue("--a11y-company").trim(),
        enemy: style.getPropertyValue("--a11y-enemy").trim(),
      };
    });

  const issue = await readPalette();
  expect(issue.company).toMatch(/^#[0-9a-fA-F]{6}$/);
  expect(issue.company).not.toBe(issue.enemy);

  await page.getByTestId("nav-settings").click();
  await page.getByTestId("settings-colour-blind").selectOption("deuteranopia");

  await expect(page.locator("html")).toHaveAttribute("data-colour-blind", "deuteranopia");
  const deuter = await readPalette();
  expect(deuter.mode).toBe("deuteranopia");
  // The field is re-authored, and friend/foe stay distinct.
  expect(deuter.company).not.toBe(issue.company);
  expect(deuter.company).not.toBe(deuter.enemy);
});
