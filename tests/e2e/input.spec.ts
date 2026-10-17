import { expect, test } from "@playwright/test";

/**
 * T030 — input controller + path preview.
 *
 * The Pixi canvas cannot be asserted pixel-by-pixel, so the HUD mirrors the
 * battle controller (`data-testid="hud-*"`). These specs walk the FFTA turn by
 * keyboard and pointer and check the controller state the overlay renders from:
 * select → move range → plan march (path preview) → confirm.
 */

test("keyboard selects a soldier, reveals the move range and previews the march", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("battle-canvas")).toBeVisible();
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

test("pointer selects the tile under the cursor", async ({ page }) => {
  await page.goto("/");

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
