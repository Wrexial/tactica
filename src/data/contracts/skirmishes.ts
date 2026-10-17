/**
 * **Skirmishes** — rival free companies (T070, T093; mapping §10).
 *
 * A skirmish is the retheme of FFTA's **Encounter mission**: another free
 * company met on the road, with its own purse and its own reasons. Skirmishes
 * are never chapter-gated — the road is open from the start of the campaign —
 * though some carry a `regionId` so the Mess can post them in the right place.
 *
 * A skirmish is the smallest contract the board offers, so its fee and reward
 * are modest and its requirements are usually a single soldier of the right
 * trade. All numbers are **our own balance data**, inspired by the FFTA
 * mission/fee tables but tuned for detachment-scale play (`agents.md` §3, §10).
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.**
 * - **Validated at load.** Every entry is parsed with {@link parseContracts}.
 * - **No placeholders.** Every skirmish carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import { parseContracts } from "./shared";

/**
 * Every skirmish contract, keyed by its stable id and validated at module load.
 * The original T070 slice comes first, then the T093 expansion.
 */
export const SKIRMISH_CONTRACTS = parseContracts({
  /* ----- The original T070 slice ---------------------------------------- */

  "crossed-sabres": {
    name: "Crossed Sabres",
    description:
      "A rival company holds the crossroads and will not yield it; clear them before dusk.",
    flavour: "No war is so bitter as the one between two men who both need the same purse.",
    kind: "skirmish",
    fee: 120,
    requires: [{ kind: "unit", count: 3 }],
    reward: { crowns: 550, ap: 30, experience: 25, honours: 1, itemIds: ["cavalry-sabre"] },
    regionId: "crossroads",
  },
  "the-rival-foragers": {
    name: "The Rival Foragers",
    description:
      "Another company is stripping the same valley; see them off before the stores are gone.",
    flavour: "They call it living off the land. The land calls it something else.",
    kind: "skirmish",
    fee: 80,
    requires: [{ kind: "post", id: "forager" }],
    reward: { crowns: 350, ap: 25, experience: 20, itemIds: ["water-canteen"] },
  },
  "pistols-at-dawn": {
    name: "Pistols at Dawn",
    description:
      "A matter of honour between two companies is settled in the old way: a brace of pistols and a witness.",
    flavour: "The code is absurd, and every officer in the theatre will swear by it.",
    kind: "skirmish",
    fee: 150,
    requires: [
      { kind: "post", id: "sabreur" },
      { kind: "unit", count: 2 },
    ],
    reward: { crowns: 600, ap: 35, experience: 30, honours: 1, itemIds: ["horse-pistol"] },
  },

  /* ----- The T093 expansion --------------------------------------------- */

  "the-roadside-ambush": {
    name: "The Roadside Ambush",
    description:
      "A rival company is lying up in the Blackwood to rob the next convoy; spring their ambush first.",
    flavour: "They picked the ground. That is the only advantage they get.",
    kind: "skirmish",
    fee: 90,
    requires: [{ kind: "post", id: "chasseur" }],
    reward: { crowns: 400, ap: 25, experience: 20, itemIds: ["rifled-carbine"] },
    regionId: "blackwood",
  },
  "the-deserters-camp": {
    name: "The Deserters' Camp",
    description:
      "Deserters from three armies have banded together in the hills; break the camp before it grows.",
    flavour: "A deserter alone is a fugitive. Fifty of them are a problem for the whole theatre.",
    kind: "skirmish",
    fee: 110,
    requires: [{ kind: "unit", count: 3 }],
    reward: { crowns: 500, ap: 30, experience: 25, itemIds: ["land-pattern-musket"] },
    regionId: "the-highlands",
  },
  "sabres-at-the-ford": {
    name: "Sabres at the Ford",
    description:
      "Two troops of horse want the same crossing; the matter will be settled at the water's edge.",
    flavour: "Cavalry against cavalry is over in minutes and remembered for years.",
    kind: "skirmish",
    fee: 130,
    requires: [
      { kind: "post", id: "hussar" },
      { kind: "unit", count: 3 },
    ],
    reward: { crowns: 560, ap: 30, experience: 25, honours: 1, itemIds: ["light-sabre"] },
    regionId: "sainte-colombe",
  },
  "the-foragers-quarrel": {
    name: "The Foragers' Quarrel",
    description:
      "Two foraging parties meet in the same field with the same orders; settle who leaves with the hay.",
    flavour: "It began over a wagon of grain and ended as a matter of regimental pride.",
    kind: "skirmish",
    fee: 70,
    requires: [
      { kind: "post", id: "forager" },
      { kind: "post", id: "chasseur" },
    ],
    reward: { crowns: 320, ap: 20, experience: 18, itemIds: ["haversack"] },
  },
});
