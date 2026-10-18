import { expect, type Page } from "@playwright/test";

/**
 * Navigate to the app and wait until the battlefield input controller is bound.
 *
 * The key/pointer listeners are attached only after Pixi's async `app.init()`
 * resolves (`src/ui/App.tsx`), but the DOM HUD renders before then. A test that
 * dispatches input straight after `page.goto("/")` can therefore race the init
 * and have its first keypresses dropped. Always await this before driving the
 * battlefield; the canvas carries `data-input-ready` once listeners are live.
 */
export async function openBattlefield(page: Page): Promise<void> {
  await page.goto("/");
  await expect(page.getByTestId("battle-canvas")).toHaveAttribute("data-input-ready", "true");
}
