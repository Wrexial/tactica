import { expect, test } from "@playwright/test";

/**
 * T121 — the campaign loop, end to end.
 *
 * The field report named the missing glue: taking a contract at the Officers'
 * Mess did nothing on the Field, and a finished battle never reached the
 * campaign. This spec walks the whole loop against the deterministic demo
 * campaign:
 *
 * 1. **Officers' Mess** — take a postable combat contract (its fee is paid).
 * 2. **Field** — the contract's battle is deployed (`buildBattleFromContract`),
 *    the enemy's opening turns are already resolved (`battleRunner`).
 * 3. **Orders** — the player commits Orders Tempo orders.
 * 4. **After-action report** — the T120 reducer applies the outcome, the day
 *    advances and the Crowns change.
 *
 * The contract chosen is **Crossed Sabres**, a short `survive 6 turns`
 * skirmish, so the action resolves deterministically and quickly. The demo
 * campaign is seeded and authored (`createDemoCampaign`), so every run is
 * byte-identical.
 */

test("takes a contract from the Mess, fights it on the Field and applies the result", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByTestId("nav-mess").click();
  await expect(page.getByTestId("mess-screen")).toBeVisible();

  // 1. Take the short, ungated skirmish: survives six Orders Tempo turns.
  const accept = page.getByTestId("contract-crossed-sabres-accept");
  await expect(accept).toBeEnabled();
  await accept.click();

  // The working campaign pays the 120-Crown fee and marks the post.
  await expect(page.getByTestId("mess-company-crowns")).toHaveText("780");
  await expect(accept).toBeDisabled();
  await expect(accept).toHaveText("Posted");

  // 2. The contract's battle is deployed on the Field.
  await page.getByTestId("nav-battle").click();
  await expect(page.getByTestId("campaign-battle")).toBeVisible();
  await expect(page.getByTestId("campaign-contract")).toHaveText("Crossed Sabres");
  await expect(page.getByTestId("campaign-objective")).toContainText("Hold out for 6 turns");

  // 3. Commit Orders Tempo orders until the objective resolves. The campaign
  // controller runs every hostile turn in between (T119); the survive board
  // needs only a few holds. Auto-battle the remainder if the loop stalls.
  const hold = page.getByTestId("campaign-hold");
  const resolve = page.getByTestId("campaign-resolve");
  const result = page.getByTestId("campaign-result");

  for (let attempt = 0; attempt < 16; attempt++) {
    if (await result.isVisible()) break;
    if ((await hold.isVisible()) && (await hold.isEnabled())) {
      await hold.click();
    } else if (await resolve.isVisible()) {
      await resolve.click();
    }
    await page.waitForTimeout(100);
  }

  // 4. The after-action report names the outcome and the campaign change.
  await expect(result).toBeVisible();
  await expect(page.getByTestId("campaign-result-contract")).toHaveText("Crossed Sabres");
  await expect(page.getByTestId("campaign-result-outcome")).toHaveText(
    "The company holds the field",
  );
  await expect(page.getByTestId("campaign-result-day")).toHaveText("Day 12 → 13");
  await expect(page.getByTestId("campaign-result-crowns")).toHaveText("780 → 1,330 Crowns");
  await expect(page.getByTestId("campaign-result-honours")).toHaveText("3 → 4 Honours");

  // Dismissing the report returns to the Mess with the reward banked.
  await page.getByTestId("campaign-result-dismiss").click();
  await expect(page.getByTestId("mess-screen")).toBeVisible();
  await expect(page.getByTestId("mess-company-crowns")).toHaveText("1330");
});
