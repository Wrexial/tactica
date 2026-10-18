import { expect, test, type Page } from "@playwright/test";

/**
 * T103 — settings.
 *
 * The camp preferences screen (volume, text speed, damage numbers,
 * colour-blind mode and keybinds) is reached from the app shell's "Settings"
 * tab (`nav-settings`). It opens on the issue defaults and files every change
 * through the same `SaveStore` as the campaign, so a reload restores it.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("settings-screen")).toBeVisible();
});

/**
 * Drive a range input the way a pointer would. The native prototype setter is
 * used deliberately: assigning `input.value` directly updates React's value
 * tracker, so the synthetic `input` event is deduped and `onChange` never
 * fires.
 */
async function setRange(page: Page, testId: string, value: number): Promise<void> {
  await page.getByTestId(testId).evaluate((element, next) => {
    const input = element as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, String(next));
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, value);
}

test("opens on the issue defaults", async ({ page }) => {
  await expect(page.getByTestId("settings-summary-volume")).toHaveText("70%");
  await expect(page.getByTestId("settings-summary-text-speed")).toHaveText("normal");
  await expect(page.getByTestId("settings-summary-damage-numbers")).toHaveText("Shown");
  await expect(page.getByTestId("settings-summary-colour-blind")).toHaveText("Issue palette");
  await expect(page.getByTestId("settings-summary-version")).toHaveText("v1");
  await expect(page.getByTestId("settings-volume-value")).toHaveText("70%");
  await expect(page.getByTestId("settings-text-speed")).toHaveValue("normal");
  await expect(page.getByTestId("settings-damage-numbers")).toBeChecked();
  await expect(page.getByTestId("settings-colour-blind")).toHaveValue("off");
});

test("sets the master volume and can mute or fill it", async ({ page }) => {
  await setRange(page, "settings-volume", 30);
  await expect(page.getByTestId("settings-volume-value")).toHaveText("30%");
  await expect(page.getByTestId("settings-summary-volume")).toHaveText("30%");

  await page.getByTestId("settings-mute").click();
  await expect(page.getByTestId("settings-volume-value")).toHaveText("0%");

  await page.getByTestId("settings-volume-full").click();
  await expect(page.getByTestId("settings-volume-value")).toHaveText("100%");
});

test("changes the text speed and its note", async ({ page }) => {
  await page.getByTestId("settings-text-speed").selectOption("fast");
  await expect(page.getByTestId("settings-text-speed")).toHaveValue("fast");
  await expect(page.getByTestId("settings-summary-text-speed")).toHaveText("fast");
  await expect(page.getByTestId("settings-text-speed-note")).toContainText("clipped");
});

test("toggles damage numbers", async ({ page }) => {
  await page.getByTestId("settings-damage-numbers").uncheck();
  await expect(page.getByTestId("settings-damage-numbers")).not.toBeChecked();
  await expect(page.getByTestId("settings-summary-damage-numbers")).toHaveText("Hidden");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.damageNumbers))
    .toBe("off");

  await page.getByTestId("settings-damage-numbers").check();
  await expect(page.getByTestId("settings-summary-damage-numbers")).toHaveText("Shown");
});

test("switches colour-blind palettes and previews the swatches", async ({ page }) => {
  await expect(page.getByTestId("settings-palette")).toHaveAttribute("data-mode", "off");

  await page.getByTestId("settings-colour-blind").selectOption("deuteranopia");
  await expect(page.getByTestId("settings-palette")).toHaveAttribute("data-mode", "deuteranopia");
  await expect(page.getByTestId("settings-summary-colour-blind")).toHaveText("Grass (green-weak)");
  await expect(page.getByTestId("settings-colour-blind-note")).toContainText("blue-safe");
  await expect(page.getByTestId("settings-palette-swatch")).toHaveCount(4);
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.colourBlind))
    .toBe("deuteranopia");
});

test("rebinds a key, returns to defaults, and resets all settings", async ({ page }) => {
  // Rebind confirm to G.
  await page.getByTestId("settings-rebind-confirm").click();
  await expect(page.getByTestId("settings-rebind-confirm")).toHaveAttribute(
    "data-capturing",
    "true",
  );
  await page.keyboard.press("g");
  await expect(page.getByTestId("settings-keybind-confirm-key")).toHaveText("G");

  // Reset just the keybinds.
  await page.getByTestId("settings-reset-keybinds").click();
  await expect(page.getByTestId("settings-keybind-confirm-key")).toHaveText("Enter");

  // Change several preferences, then restore every default at once.
  await setRange(page, "settings-volume", 15);
  await page.getByTestId("settings-damage-numbers").uncheck();
  await page.getByTestId("settings-text-speed").selectOption("instant");
  await page.getByTestId("settings-reset").click();

  await expect(page.getByTestId("settings-summary-volume")).toHaveText("70%");
  await expect(page.getByTestId("settings-summary-text-speed")).toHaveText("normal");
  await expect(page.getByTestId("settings-summary-damage-numbers")).toHaveText("Shown");
  await expect(page.getByTestId("settings-status")).toContainText("issue defaults");
});

test("persists preferences across a reload", async ({ page }) => {
  await setRange(page, "settings-volume", 25);
  await page.getByTestId("settings-text-speed").selectOption("slow");
  await page.getByTestId("settings-damage-numbers").uncheck();
  await page.getByTestId("settings-colour-blind").selectOption("protanopia");

  // Give the async SaveStore write a moment to settle before reloading.
  await expect(page.getByTestId("settings-volume-value")).toHaveText("25%");
  await page.waitForTimeout(400);
  await page.reload();

  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("settings-summary-volume")).toHaveText("25%");
  await expect(page.getByTestId("settings-summary-text-speed")).toHaveText("slow");
  await expect(page.getByTestId("settings-summary-damage-numbers")).toHaveText("Hidden");
  await expect(page.getByTestId("settings-summary-colour-blind")).toHaveText("Martian (red-weak)");
});

test("tolerates a corrupt persisted settings record", async ({ page }) => {
  // Write a malformed payload to the reserved slot, then reopen the screen.
  await page.evaluate(async () => {
    const request = indexedDB.open("lines-of-glory", 1);
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => {
        const database = request.result;
        const transaction = database.transaction("saves", "readwrite");
        transaction.objectStore("saves").put({
          slot: "settings",
          version: 1,
          savedAt: Date.now(),
          label: "Settings",
          data: { volume: "loud", textSpeed: 7, damageNumbers: "yes", keybinds: { confirm: 3 } },
        });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      };
      request.onerror = () => reject(request.error);
    });
  });

  await page.reload();
  await page.getByTestId("nav-settings").click();
  await expect(page.getByTestId("settings-summary-volume")).toHaveText("70%");
  await expect(page.getByTestId("settings-summary-text-speed")).toHaveText("normal");
  await expect(page.getByTestId("settings-summary-damage-numbers")).toHaveText("Shown");
  await expect(page.getByTestId("settings-keybind-confirm-key")).toHaveText("Enter");
});
