import { expect, test, type Page } from "@playwright/test";

import { openBattlefield } from "./helpers";

/**
 * T030 / T087 — input controller, path preview, keyboard & gamepad navigation.
 *
 * The Pixi canvas cannot be asserted pixel-by-pixel, so the HUD mirrors the
 * battle controller (`data-testid="hud-*"`). These specs walk the FFTA turn by
 * keyboard, pointer and **gamepad** and check the controller state the overlay
 * renders from: select → move range → plan march (path preview) → confirm. They
 * also cover the camp menus and the responsive shell.
 */

/* --------------------------------------------------------------------------
 * Gamepad harness (T087)
 *
 * Playwright has no gamepad hardware, so `navigator.getGamepads` is stubbed to
 * return one synthetic pad. The app polls it on `requestAnimationFrame`, so a
 * press/release pair is a real rising edge the edge detector can see.
 * ------------------------------------------------------------------------ */

const GAMEPAD_INIT = `
window.__gamepad = {
  id: "Tactica Test Pad",
  index: 0,
  connected: true,
  mapping: "standard",
  timestamp: 0,
  axes: [0, 0, 0, 0],
  buttons: Array.from({ length: 16 }, () => ({ pressed: false, touched: false, value: 0 })),
};
Object.defineProperty(navigator, "getGamepads", {
  configurable: true,
  value: () => [window.__gamepad],
});
`;

interface MockPadWindow {
  __gamepad: { buttons: { pressed: boolean; value: number }[] };
}

async function setGamepadButton(page: Page, index: number, pressed: boolean): Promise<void> {
  await page.evaluate(
    ({ index: buttonIndex, pressed: isPressed }) => {
      const pad = (window as unknown as MockPadWindow).__gamepad;
      pad.buttons[buttonIndex].pressed = isPressed;
      pad.buttons[buttonIndex].value = isPressed ? 1 : 0;
    },
    { index, pressed },
  );
}

/** Press and release a gamepad button, waiting a couple of poll frames. */
async function tapGamepad(page: Page, index: number): Promise<void> {
  await setGamepadButton(page, index, true);
  await page.waitForTimeout(80);
  await setGamepadButton(page, index, false);
  await page.waitForTimeout(80);
}

/* --------------------------------------------------------------------------
 * Battle navigation
 * ------------------------------------------------------------------------ */

test("keyboard selects a soldier, reveals the move range and previews the march", async ({
  page,
}) => {
  await openBattlefield(page);

  await expect(page.getByTestId("hud-actor")).toHaveText("Sgt. Aubry");
  await expect(page.getByTestId("hud-cursor")).toHaveText("3, 4");
  await expect(page.getByTestId("hud-phase")).toHaveText("select");

  // Confirm the acting soldier's tile: selection shows the blue move range.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await expect(page.getByTestId("hud-selected")).toHaveText("Sgt. Aubry");
  await expect(page.getByTestId("hud-move-range")).not.toHaveText("0 tiles");

  // Step to an adjacent reachable tile and confirm it to plan the march.
  await page.keyboard.press("ArrowRight");
  await expect(page.getByTestId("hud-cursor")).toHaveText("4, 4");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("move");
  await expect(page.getByTestId("hud-path")).toHaveText("2 tiles");
});

test("anchors the focused soldier's card beside it with its vitals", async ({ page }) => {
  await openBattlefield(page);

  // At rest the field stays clear: the card is an on-demand readout, not a
  // permanent panel parked over the middle of the map.
  const card = page.getByTestId("unit-card");
  await expect(card).toHaveCount(0);

  // Selecting the acting soldier brings the anchored card up beside it with
  // the vitals strip, and `anchorFor` has picked a side and kept it on screen.
  await page.keyboard.press("Enter");
  await expect(card).toBeVisible();
  await expect(card).toHaveAttribute("data-role", "selected");
  await expect(card).toContainText("Sgt. Aubry");
  await expect(card.getByTestId("hud-chips")).toBeVisible();
  await expect(card).toHaveAttribute("data-side", /left|right/);

  const box = await card.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
});

test("pointer selects the tile under the cursor", async ({ page }) => {
  await openBattlefield(page);

  const canvas = page.getByTestId("battle-canvas");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  if (box === null) return;

  const before = await page.getByTestId("hud-cursor").textContent();
  // The camera frames the map centred on the canvas; the centre point is
  // always an in-bounds tile, so clicking it must move the cursor.
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId("hud-cursor")).not.toHaveText(before ?? "");
});

test("keyboard opens the Orders menu and fires an action without a mouse", async ({ page }) => {
  await openBattlefield(page);

  // Select the acting soldier, then confirm its own tile again to open Orders.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await page.keyboard.press("Enter");

  const focusedTestId = await page.evaluate(() =>
    document.activeElement?.getAttribute("data-testid"),
  );
  expect(focusedTestId).toMatch(/^action-/);

  // Enter activates the focused order button, moving to targeting.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("target");
});

/** Parse the HUD cursor readout (`"3, 4"`) into numbers. */
async function cursorX(page: Page): Promise<number> {
  const text = (await page.getByTestId("hud-cursor").textContent()) ?? "";
  const [x] = text.split(",").map((part) => Number(part.trim()));
  return x;
}

test("gamepad confirms a soldier and opens Orders", async ({ page }) => {
  await page.addInitScript(GAMEPAD_INIT);
  await openBattlefield(page);
  await expect(page.getByTestId("hud-cursor")).toHaveText("3, 4");

  // A confirms the actor under the initial cursor; a second A focuses Orders.
  await tapGamepad(page, 0);
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await tapGamepad(page, 0);
  const focusedTestId = await page.evaluate(() =>
    document.activeElement?.getAttribute("data-testid"),
  );
  expect(focusedTestId).toMatch(/^action-/);

  // A activates the focused order and the battle enters targeting.
  await tapGamepad(page, 0);
  await expect(page.getByTestId("hud-phase")).toHaveText("target");
});

test("gamepad D-pad walks the battlefield cursor", async ({ page }) => {
  await page.addInitScript(GAMEPAD_INIT);
  await openBattlefield(page);
  await expect(page.getByTestId("hud-cursor")).toHaveText("3, 4");

  // Holding a direction may auto-repeat, so assert the axis of travel rather
  // than an exact count of tiles.
  const start = await cursorX(page);
  await tapGamepad(page, 15); // D-pad right
  const right = await cursorX(page);
  expect(right).toBeGreaterThan(start);

  await tapGamepad(page, 14); // D-pad left
  const left = await cursorX(page);
  expect(left).toBeLessThan(right);
});

/* --------------------------------------------------------------------------
 * Menu navigation
 * ------------------------------------------------------------------------ */

test("keyboard navigates the camp menus and returns to the field", async ({ page }) => {
  await openBattlefield(page);
  await page.getByTestId("nav-menu").click();
  await expect(page.getByTestId("menus")).toBeVisible();

  // Focus the Orders sidebar entry; ArrowDown steps to the next camp screen.
  await page.getByTestId("menu-nav-main").focus();
  await page.keyboard.press("ArrowDown");
  const focusedTestId = await page.evaluate(() =>
    document.activeElement?.getAttribute("data-testid"),
  );
  expect(focusedTestId).toBeTruthy();
  expect(focusedTestId).not.toBe("menu-nav-main");

  // Enter activates the focused screen button.
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("company-screen")).toBeVisible();

  // Escape leaves the camp for the battlefield and hands the grid control back.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("menus")).toHaveCount(0);
  await expect(page.getByTestId("battle-canvas")).toBeVisible();
});

test("M toggles the camp menu without a mouse", async ({ page }) => {
  await openBattlefield(page);
  await page.keyboard.press("m");
  await expect(page.getByTestId("menus")).toBeVisible();
  await page.keyboard.press("m");
  await expect(page.getByTestId("menus")).toHaveCount(0);
});

test("gamepad Start opens the camp and B returns to the field", async ({ page }) => {
  await page.addInitScript(GAMEPAD_INIT);
  await openBattlefield(page);

  await tapGamepad(page, 9); // Start
  await expect(page.getByTestId("menus")).toBeVisible();

  await tapGamepad(page, 1); // B / cancel
  await expect(page.getByTestId("menus")).toHaveCount(0);
  await expect(page.getByTestId("battle-canvas")).toBeVisible();
});

/* --------------------------------------------------------------------------
 * Responsive shell (T087)
 * ------------------------------------------------------------------------ */

test("reflows on a phone-sized viewport without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("battle-canvas")).toBeVisible();
  await expect(page.getByTestId("nav-map")).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});
