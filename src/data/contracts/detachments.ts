/**
 * **Detachments** — soldiers sent away for N days (T070, T093; mapping §10).
 *
 * A detachment is the retheme of FFTA's **Dispatch mission**: a party leaves the
 * roster for a fixed number of campaign days and returns with Crowns, Drill and
 * Experience (see `src/engine/detach.ts`, T072). Every detachment therefore
 * carries a positive `duration`, which the schema does not require of the other
 * kinds and the T070 test forbids on them.
 *
 * A detachment is usually ungated — the work exists whenever the company can
 * spare the soldiers — but it may name a `regionId` so the Mess can show where
 * the party is bound. All numbers are **our own balance data**, inspired by the
 * FFTA mission/fee tables but tuned for detachment-scale play (`agents.md` §3,
 * §10).
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.**
 * - **Validated at load.** Every entry is parsed with {@link parseContracts}.
 * - **No placeholders.** Every detachment carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import { parseContracts } from "./shared";

/**
 * Every detachment contract, keyed by its stable id and validated at module
 * load. The original T070 slice comes first, then the T093 expansion.
 */
export const DETACHMENT_CONTRACTS = parseContracts({
  /* ----- The original T070 slice ---------------------------------------- */

  "forage-the-valley": {
    name: "Forage the Valley",
    description:
      "Send a foraging party down the valley for four days to bring in hay, cattle and grain.",
    flavour: "An army marches on its stomach, and a company on whatever it can carry.",
    kind: "detachment",
    fee: 60,
    duration: 4,
    requires: [
      { kind: "post", id: "forager" },
      { kind: "unit", count: 2 },
    ],
    reward: { crowns: 300, ap: 40, experience: 25, itemIds: ["water-canteen"] },
  },
  "escort-the-pay-chest": {
    name: "Escort the Pay Chest",
    description:
      "Ride with the pay chest to the forward depot; six days on the road and a good deal of watching the hedgerows.",
    flavour: "Gold does not march, but it never travels alone.",
    kind: "detachment",
    fee: 120,
    duration: 6,
    requires: [
      { kind: "post", id: "chasseur" },
      { kind: "unit", count: 3 },
    ],
    reward: { crowns: 700, ap: 50, experience: 35, honours: 1, itemIds: ["spyglass"] },
  },
  "reconnoitre-the-ridge": {
    name: "Reconnoitre the Ridge",
    description:
      "A Scout party maps the ridge and its approaches for three days and returns with a sketch.",
    flavour: "A ridge seen from the wrong side has lost more battles than any bad general.",
    kind: "detachment",
    fee: 50,
    duration: 3,
    requires: [{ kind: "post", id: "scout" }],
    reward: { crowns: 250, ap: 45, experience: 30, honours: 1, itemIds: ["spyglass"] },
  },

  /* ----- The T093 expansion --------------------------------------------- */

  "gather-the-harvest": {
    name: "Gather the Harvest",
    description:
      "The valley harvest is ripe and the enemy will burn it; bring it in over five days.",
    flavour: "The valley has fed this war for three years and is beginning to notice.",
    kind: "detachment",
    fee: 70,
    duration: 5,
    requires: [
      { kind: "post", id: "forager" },
      { kind: "unit", count: 2 },
    ],
    reward: { crowns: 360, ap: 45, experience: 28, itemIds: ["haversack"] },
    regionId: "the-green-valley",
  },
  "mend-the-coast-road": {
    name: "Mend the Coast Road",
    description:
      "The coast turnpike is cut by weeks of rain; a working party repairs it over four days.",
    flavour: "The road is the region. Hold the road and the rest follows.",
    kind: "detachment",
    fee: 90,
    duration: 4,
    requires: [
      { kind: "post", id: "engineer" },
      { kind: "post", id: "sapper" },
    ],
    reward: { crowns: 420, ap: 50, experience: 30, itemIds: ["mining-tools"] },
    regionId: "the-coast-road",
  },
  "drill-the-recruits": {
    name: "Drill the Recruits",
    description:
      "Three days of square-bashing under an Adjutant turns the newest drafts into a file of soldiers.",
    flavour: "Recruits are cheap; trained recruits are priceless and hard to keep.",
    kind: "detachment",
    fee: 40,
    duration: 3,
    requires: [
      { kind: "post", id: "adjutant" },
      { kind: "unit", count: 3 },
    ],
    reward: { crowns: 220, ap: 60, experience: 20, itemIds: ["cartridge-box"] },
  },
  "survey-the-highlands": {
    name: "Survey the Highlands",
    description:
      "A Scout and a Signaller spend six days mapping the highland tracks and their watering places.",
    flavour: "A map of the highlands is worth more than a battery up there.",
    kind: "detachment",
    fee: 100,
    duration: 6,
    requires: [
      { kind: "post", id: "scout" },
      { kind: "post", id: "signaller" },
    ],
    reward: { crowns: 480, ap: 55, experience: 35, honours: 1, itemIds: ["surveyors-staff"] },
    regionId: "the-highlands",
  },
});
