import { expect, test } from "@playwright/test";

/**
 * T071 — Officers' Mess (mission board).
 *
 * The mess is presentation over the authored contracts (T070) and the company
 * (T068): it must show each contract's **fee**, evaluate its **requirements**
 * (item / post / unit / honour) against the roster, preview the **reward**, and
 * only let the player take a contract whose gates are open. It is reached from
 * the app shell's "Officers' Mess" tab (`nav-mess`) and seeded with a
 * deterministic demo company (The Greycoats) so these assertions are stable.
 */

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("nav-mess").click();
  await expect(page.getByTestId("mess-screen")).toBeVisible();
});

test("shows the company's war chest, honours and roster", async ({ page }) => {
  await expect(page.getByTestId("mess-company-name")).toHaveText("The Greycoats");
  await expect(page.getByTestId("mess-company-crowns")).toHaveText("900");
  await expect(page.getByTestId("mess-company-honours")).toHaveText("3");
  await expect(page.getByTestId("mess-company-roster")).toHaveText("5 soldiers");
});

test("posts each contract with its kind, fee and reward preview", async ({ page }) => {
  const card = page.getByTestId("contract-break-the-bridge");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("contract-break-the-bridge-kind")).toHaveText("Battle");
  await expect(page.getByTestId("contract-break-the-bridge-fee")).toHaveText("250 Crowns");

  // The reward preview names every payout the contract offers, including kit.
  await expect(page.getByTestId("contract-break-the-bridge-reward")).toBeVisible();
  await expect(page.getByTestId("contract-break-the-bridge-reward-crowns")).toHaveText(
    "1200 Crowns",
  );
  await expect(page.getByTestId("contract-break-the-bridge-reward-drill")).toHaveText("60 Drill");
  await expect(page.getByTestId("contract-break-the-bridge-reward-experience")).toHaveText(
    "45 Experience",
  );
  await expect(page.getByTestId("contract-break-the-bridge-reward-honours")).toHaveText(
    "2 Honours",
  );
  await expect(page.getByTestId("contract-break-the-bridge-reward-item-baker-rifle")).toHaveText(
    "Baker Rifle (kit)",
  );
});

test("marks a unit requirement met when the roster is large enough", async ({ page }) => {
  // Four soldiers required, five on the roster.
  const requirement = page.getByTestId("contract-break-the-bridge-req-0");
  await expect(requirement).toHaveAttribute("data-met", "true");
  await expect(requirement).toContainText("Soldiers");
  await expect(requirement).toContainText("5 / 4");
  await expect(page.getByTestId("contract-break-the-bridge-req-0-status")).toHaveText("Met");
  await expect(page.getByTestId("contract-break-the-bridge-accept")).toBeEnabled();
});

test("marks an item requirement unmet and disables the contract", async ({ page }) => {
  // Storm the Farmhouse needs Sapper's Tools; the company carries none.
  const requirement = page.getByTestId("contract-storm-the-farmhouse-req-0");
  await expect(requirement).toHaveAttribute("data-met", "false");
  await expect(requirement).toContainText("Sapper's Tools");
  await expect(requirement).toContainText("0 / 1");
  await expect(page.getByTestId("contract-storm-the-farmhouse-req-0-status")).toHaveText("Unmet");
  await expect(page.getByTestId("contract-storm-the-farmhouse-accept")).toBeDisabled();
});

test("marks a post requirement against the primary posts on the roster", async ({ page }) => {
  // Hold the Redoubt needs an Artilleryman; the roster has none.
  const requirement = page.getByTestId("contract-hold-the-redoubt-req-0");
  await expect(requirement).toHaveAttribute("data-met", "false");
  await expect(requirement).toContainText("Artilleryman");
  await expect(requirement).toContainText("0 / 1");

  // A Skirmish unit gate of three soldiers is satisfied by the five-man roster.
  const skirmish = page.getByTestId("contract-crossed-sabres-req-0");
  await expect(skirmish).toHaveAttribute("data-met", "true");
  await expect(skirmish).toContainText("5 / 3");
});

test("pays the fee and marks a contract posted when taken", async ({ page }) => {
  const accept = page.getByTestId("contract-crossed-sabres-accept");
  await expect(accept).toBeEnabled();
  await accept.click();

  // The 120-Crown fee leaves the war chest at 780, and the contract is closed.
  await expect(page.getByTestId("mess-company-crowns")).toHaveText("780");
  await expect(accept).toBeDisabled();
  await expect(accept).toHaveText("Posted");
});

test("filters the board by contract kind", async ({ page }) => {
  await expect(page.getByTestId("contract-break-the-bridge")).toBeVisible();

  await page.getByTestId("mess-filter-detachment").click();
  await expect(page.getByTestId("contract-forage-the-valley")).toBeVisible();
  await expect(page.getByTestId("contract-escort-the-pay-chest")).toBeVisible();
  await expect(page.getByTestId("contract-reconnoitre-the-ridge")).toBeVisible();
  await expect(page.getByTestId("contract-break-the-bridge")).toHaveCount(0);

  await page.getByTestId("mess-filter-all").click();
  await expect(page.getByTestId("contract-break-the-bridge")).toBeVisible();
});
