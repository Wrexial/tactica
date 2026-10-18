import { expect, test } from "@playwright/test";

/**
 * T102 — autosave, slots & export/import.
 *
 * The camp keep is presentation over the persistence layer (T100/T101): a
 * rolling **autosave**, three named **slots** that can be filed, restored and
 * struck, and a canonical **JSON export/import** round-trip. It is reached from
 * the app shell's "Saves" tab (`nav-saves`) and seeded with a deterministic
 * demo campaign (The Greycoats, day 12) so these assertions are stable across
 * reloads.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-saves").click();
  await expect(page.getByTestId("saves-screen")).toBeVisible();
});

test("opens on the working campaign with an automatic autosave", async ({ page }) => {
  await expect(page.getByTestId("saves-current-company")).toHaveText("The Greycoats");
  await expect(page.getByTestId("saves-current-day")).toHaveText("12");
  await expect(page.getByTestId("saves-current-roster")).toHaveText("2 soldiers");
  await expect(page.getByTestId("saves-current-seed")).toHaveText("campaign-1815");
  await expect(page.getByTestId("saves-current-version")).toHaveText("v1");

  // The rolling autosave is written without the player asking.
  await expect(page.getByTestId("saves-autosave")).toHaveAttribute("data-filled", "true");
  await expect(page.getByTestId("saves-autosave-state")).toContainText("The Greycoats");
});

test("files multiple slots, restores one, and strikes one", async ({ page }) => {
  // Advance to day 13 and file it in slot-1.
  await page.getByTestId("saves-advance-day").click();
  await expect(page.getByTestId("saves-current-day")).toHaveText("13");
  await page.getByTestId("saves-save-slot-1").click();
  await expect(page.getByTestId("saves-slot-slot-1")).toHaveAttribute("data-filled", "true");
  await expect(page.getByTestId("saves-slot-slot-1-label")).toContainText("Day 13");

  // March on to day 15 and file a second slot.
  await page.getByTestId("saves-advance-day").click();
  await page.getByTestId("saves-advance-day").click();
  await expect(page.getByTestId("saves-current-day")).toHaveText("15");
  await page.getByTestId("saves-save-slot-2").click();
  await expect(page.getByTestId("saves-slot-slot-2")).toHaveAttribute("data-filled", "true");
  await expect(page.getByTestId("saves-slot-slot-2-label")).toContainText("Day 15");

  // Restore slot-1: the campaign clock rolls back to day 13.
  await page.getByTestId("saves-load-slot-1").click();
  await expect(page.getByTestId("saves-current-day")).toHaveText("13");

  // Strike slot-2: it empties.
  await page.getByTestId("saves-delete-slot-2").click();
  await expect(page.getByTestId("saves-slot-slot-2")).toHaveAttribute("data-filled", "false");
});

test("uses a custom slot label when one is given", async ({ page }) => {
  await page.getByTestId("saves-label").fill("Before the crossing");
  await page.getByTestId("saves-save-slot-3").click();
  await expect(page.getByTestId("saves-slot-slot-3-label")).toHaveText("Before the crossing");
});

test("exports canonical JSON and offers it as a download", async ({ page }) => {
  await page.getByTestId("saves-export").click();

  const exported = await page.getByTestId("saves-export-json").inputValue();
  expect(exported).toContain('"seed":"campaign-1815"');
  expect(exported).toContain('"name":"The Greycoats"');
  await expect(page.getByTestId("saves-download")).toHaveAttribute(
    "download",
    "lines-of-glory-campaign.json",
  );
});

test("imports exported JSON and rolls the campaign back to that record", async ({ page }) => {
  // Export day 13.
  await page.getByTestId("saves-advance-day").click();
  await expect(page.getByTestId("saves-current-day")).toHaveText("13");
  await page.getByTestId("saves-export").click();
  const exported = await page.getByTestId("saves-export-json").inputValue();

  // March on to day 14 ...
  await page.getByTestId("saves-advance-day").click();
  await expect(page.getByTestId("saves-current-day")).toHaveText("14");

  // ... then paste the earlier record back in: day 13 is restored.
  await page.getByTestId("saves-import-json").fill(exported);
  await page.getByTestId("saves-import").click();
  await expect(page.getByTestId("saves-current-day")).toHaveText("13");
  await expect(page.getByTestId("saves-ledger-0")).toContainText("Imported");
});

test("rejects malformed import JSON without losing the campaign", async ({ page }) => {
  await page.getByTestId("saves-import-json").fill("{ not a campaign");
  await page.getByTestId("saves-import").click();

  await expect(page.getByTestId("saves-ledger-0")).toHaveAttribute("data-kind", "error");
  await expect(page.getByTestId("saves-ledger-0")).toContainText("Import rejected");
  await expect(page.getByTestId("saves-current-company")).toHaveText("The Greycoats");
});
