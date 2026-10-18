import { expect, test } from "@playwright/test";

/**
 * T113 — lobby & matchmaking.
 *
 * Drives the whole net play path through the real app: match a free company
 * against the closest-rated rival in the lobby, confirm readiness, run the 1v1
 * skirmish over T112's lockstep sessions, and read the after-action report.
 * The two peers must agree on the final state hash, which is the observable
 * proof that no battle state crossed the wire (only the shared seed and the
 * ordered command log did).
 */

test("matches two free companies and runs an agreed 1v1 skirmish", async ({ page }) => {
  await page.goto("/");

  // Open the lobby from the camp navigation.
  await page.getByTestId("nav-lobby").click();
  await expect(page.getByTestId("lobby-screen")).toBeVisible();
  await expect(page.getByTestId("lobby-home-name")).toHaveText("The Greycoats");
  await expect(page.getByTestId("lobby-idle")).toBeVisible();

  // Find an opponent. The Greycoats rate 24; the Black Eagles rate 18, the
  // closest in the pool, so matchmaking must choose them deterministically.
  await page.getByTestId("lobby-find").click();
  await expect(page.getByTestId("lobby-matched")).toBeVisible();
  await expect(page.getByTestId("lobby-away-name")).toHaveText("The Black Eagles");

  // The skirmish cannot start until the player's company is ready.
  await expect(page.getByTestId("lobby-start")).toBeDisabled();
  await page.getByTestId("lobby-ready").click();
  await expect(page.getByTestId("lobby-ready")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("lobby-start")).toBeEnabled();

  // Start the match and read the after-action report.
  await page.getByTestId("lobby-start").click();
  await expect(page.getByTestId("lobby-result")).toBeVisible();
  await expect(page.getByTestId("lobby-agreed")).toHaveText("Hashes agree");

  // Both peers computed the same final fingerprint.
  const homeHash = await page.getByTestId("lobby-hash-home").textContent();
  const awayHash = await page.getByTestId("lobby-hash-away").textContent();
  expect(homeHash).not.toBeNull();
  expect(homeHash).toBe(awayHash);

  // The engine resolves real damage through `step` (T117), so the headless
  // skirmish now reaches a decisive objective; the point is that both peers
  // agree on the outcome and the frame log is not empty.
  await expect(page.getByTestId("lobby-outcome")).toContainText(/victory|defeat|draw|ceasefire/i);
  await expect(page.getByTestId("lobby-frames")).not.toHaveText("0");

  // A fresh opponent resets the handshake.
  await page.getByTestId("lobby-rematch").click();
  await expect(page.getByTestId("lobby-idle")).toBeVisible();
});
