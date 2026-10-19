import { expect, test } from "@playwright/test";

import { openBattlefield } from "./helpers";

/**
 * T082 — event-driven animations.
 *
 * The Pixi canvas cannot be asserted pixel-by-pixel, so the HUD mirrors the
 * animation cues built **only** from the engine events the last order emitted
 * (`render/animations.ts`). These specs walk the confirm ladder to commit a
 * march and check that the battle log gains a movement cue derived from the
 * engine's `moved` event. The volley / artillery / popup classifiers are pinned
 * exhaustively in `tests/unit/animations.test.ts`.
 */

test("opening events produce no battle animations", async ({ page }) => {
  await openBattlefield(page);
  await expect(page.getByRole("heading", { name: "Battle log" })).toBeVisible();
  await expect(page.getByTestId("animation-log").locator("li")).toHaveCount(0);
});

test("keeps the battle log behind a toggle", async ({ page }) => {
  await openBattlefield(page);

  // T137 — the log is collapsed by default; its heading is the toggle.
  const log = page.getByTestId("battle-log");
  await expect(log).toBeVisible();
  await expect(log).not.toHaveAttribute("open", /.*/);

  await page.getByRole("heading", { name: "Battle log" }).click();
  await expect(log).toHaveAttribute("open", /.*/);
  await expect(page.getByTestId("animation-log")).toBeVisible();
});

test("a committed march animates from the engine's moved event", async ({ page }) => {
  await openBattlefield(page);

  // Select the acting soldier, then plan and confirm a one-tile march.
  await expect(page.getByTestId("hud-actor")).toHaveText("Sgt. Aubry");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("hud-phase")).toHaveText("move");
  await page.keyboard.press("Enter");
  // T142 — a march commits on its own and leaves the actor in command, ready
  // to give an order or choose End Turn.
  await expect(page.getByTestId("hud-phase")).toHaveText("command");
  await expect(page.getByTestId("hud-actor")).toHaveText("Sgt. Aubry");

  // The engine emitted `moved`; the log must show exactly one movement cue with
  // a label that could only come from that event.
  const moves = page.getByTestId("animation-log").locator('[data-kind="move"]');
  await expect(moves).toHaveCount(1);
  await expect(moves.first()).toContainText("Sgt. Aubry");
  await expect(moves.first()).toContainText("marches");
});
