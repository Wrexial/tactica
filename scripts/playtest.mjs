#!/usr/bin/env node
/**
 * playtest.mjs — a watchable "play the game" driver.
 *
 * This is the manual-play harness behind the playability passes: it drives a
 * real Chromium against the dev server the way a player would (clicking the
 * `data-testid` hooks, pressing keys) and prints what it sees. Because the
 * battlefield is a Pixi/WebGL canvas, the DOM cannot assert pixels — so the
 * script reads the *HUD* (`hud-*`, `campaign-*`, the Orders menu and battle
 * log), which mirrors the engine state, and drops a screenshot at every step.
 *
 * Usage:
 *   npm run dev                      # terminal 1 (http://localhost:5173/)
 *   node scripts/playtest.mjs --headed
 *
 * Flags / env:
 *   --headed            open a visible window (slow, watchable) [default headless]
 *   --url <url>         base URL (default http://localhost:5173/)
 *   --out <dir>         screenshot dir (default test-results/playtest)
 *
 * Notes:
 *   - Waits for `[data-testid=battle-canvas][data-input-ready=true]` before any
 *     input, so it never races Pixi's async init (the old e2e flake).
 *   - Deterministic: same campaign seed, board and AI every run.
 */

import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

/* ----------------------------- args ----------------------------- */

const args = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? fallback : (args[i + 1] ?? true);
};
const headed = args.includes("--headed");
const URL = flag("url", process.env.PLAYTEST_URL ?? "http://localhost:5173/");
const OUT = flag("out", "test-results/playtest");
mkdirSync(OUT, { recursive: true });

/* ----------------------------- harness ----------------------------- */

const browser = await chromium.launch({
  headless: !headed,
  slowMo: headed ? 350 : 0, // visible pacing so a human can follow along
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(e.message));

let shotIndex = 0;
async function shot(name) {
  const file = `${OUT}/${String(++shotIndex).padStart(2, "0")}-${name}.png`;
  await page.screenshot({ path: file });
  console.log(`   📸 ${file}`);
}
const read = async (id) => {
  const loc = page.getByTestId(id);
  return (await loc.count()) ? ((await loc.first().textContent()) ?? "").trim() : null;
};
const key = async (k, ms = 200) => {
  await page.keyboard.press(k);
  await page.waitForTimeout(ms);
};
const logText = () =>
  page.getByTestId("animation-log").locator("li").allInnerTexts();
async function step(name, fn) {
  console.log(`\n▸ ${name}`);
  await fn();
}

/* ----------------------------- the session ----------------------------- */

await step("boot the game", async () => {
  await page.goto(URL);
  await page
    .getByTestId("battle-canvas")
    .and(page.locator('[data-input-ready="true"]'))
    .waitFor();
  await page.waitForTimeout(400);
  console.log(`   actor: ${await read("hud-actor")} | phase: ${await read("hud-phase")}`);
  await shot("boot");
});

await step("combat: march and fire as one turn", async () => {
  await key("Enter"); // select Sgt. Aubry
  await key("ArrowRight"); // cursor one tile east
  await key("Enter"); // plan the march -> phase "move"
  console.log(`   planned march: ${await read("hud-path")} (phase ${await read("hud-phase")})`);

  await page.getByTestId("action-musket-fire").click(); // keep the march, start aiming
  await page.waitForTimeout(160);
  for (let i = 0; i < 5 && (await read("forecast-target-0-damage")) === null; i++) {
    await key("ArrowRight", 60);
  }
  console.log(
    `   forecast: ${await read("forecast-target-0-damage")} @ ${await read("forecast-target-0-hit")} ` +
      `(reach ${await read("hud-target-range")})`,
  );
  await shot("aiming");

  await key("Enter"); // choose the target
  await key("Enter", 1500); // confirm the order -> [move, act]
  console.log(`   next actor: ${await read("hud-actor")}`);
  console.log(`   battle log: ${JSON.stringify(await logText())}`);
  await shot("after-order");
});

await step("double-move check: nudge the cursor and watch for a replay", async () => {
  await page.waitForTimeout(1200); // let the march tween finish
  await shot("rest");
  const rest = await logText();

  await key("ArrowDown", 260); // pure UI change (previously replayed the march)
  await shot("cursor-moved");
  const after = await logText();

  console.log(`   before: ${JSON.stringify(rest)}`);
  console.log(`   after:  ${JSON.stringify(after)}`);
  console.log(
    rest.join("|") === after.join("|")
      ? "   ✓ no new events — the finished march was not replayed"
      : "   ✗ UNEXPECTED: a new event appeared",
  );
});

await step("Officers' Mess: take a contract", async () => {
  await page.getByTestId("nav-mess").click();
  await page.getByTestId("mess-screen").waitFor();
  console.log(`   war chest: ${await read("mess-company-crowns")} Crowns`);
  await shot("mess-board");

  const accept = page.getByTestId("contract-crossed-sabres-accept");
  console.log(`   "Crossed Sabres" takeable: ${await accept.isEnabled()}`);
  await accept.click();
  await page.waitForTimeout(350);
  console.log(`   war chest after fee: ${await read("mess-company-crowns")} Crowns`);
  await shot("mess-accepted");
});

await step("Field: the contract's battle deploys", async () => {
  await page.getByTestId("nav-battle").click();
  await page.getByTestId("campaign-battle").waitFor();
  await page.waitForTimeout(400);
  console.log(`   contract:  ${await read("campaign-contract")}`);
  console.log(`   objective: ${await read("campaign-objective")}`);
  console.log(`   actor:     ${await read("hud-actor")} | phase: ${await read("hud-phase")}`);
  await shot("deployed");
});

await step("select a soldier and read the Orders", async () => {
  await key("Enter", 250);
  const orders = await page.getByTestId("action-menu").locator("li").allInnerTexts();
  console.log(`   move range: ${await read("hud-move-range")}`);
  console.log(`   orders: ${orders.map((o) => o.replace(/\n/g, " ")).join(", ")}`);
  await shot("selected");
});

await step("hold the line until the objective resolves", async () => {
  const hold = page.getByTestId("campaign-hold");
  for (let i = 0; i < 16; i++) {
    if (await page.getByTestId("campaign-result").isVisible()) break;
    if ((await hold.isVisible()) && (await hold.isEnabled())) await hold.click();
    await page.waitForTimeout(220);
  }
  await page.getByTestId("campaign-result").waitFor();
  console.log(`   outcome: ${await read("campaign-result-outcome")}`);
  console.log(`   day:     ${await read("campaign-result-day")}`);
  console.log(`   crowns:  ${await read("campaign-result-crowns")}`);
  console.log(`   honours: ${await read("campaign-result-honours")}`);
  await shot("result");
});

await step("dismiss the report", async () => {
  await page.getByTestId("campaign-result-dismiss").click();
  await page.getByTestId("mess-screen").waitFor();
  console.log(`   back at the Mess, war chest ${await read("mess-company-crowns")} Crowns`);
  await shot("back-at-mess");
});

console.log(`\nconsole errors: ${errors.length ? errors.join(" | ") : "none"}`);
await browser.close();
