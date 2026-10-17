/**
 * **Pacifications** — clear a region and hold it (T070, T093; mapping §10).
 *
 * A pacification is the retheme of FFTA's **Area mission**: the company clears a
 * campaign-map region of raiders and deserters, and the region's depots open to
 * it in return. Every pacification is tied to a `regionId` — that is the whole
 * point of the contract — and most are ungated, though the highland sweep is a
 * chapter-gated set piece on the story spine (T077).
 *
 * All numbers are **our own balance data**, inspired by the FFTA mission/fee
 * tables but tuned for detachment-scale play (`agents.md` §3, §10).
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.**
 * - **Validated at load.** Every entry is parsed with {@link parseContracts}.
 * - **No placeholders.** Every pacification carries an authored Napoleonic
 *   `name`, `description` and `flavour` (mapping §14, D6/D8).
 */

import { parseContracts } from "./shared";

/**
 * Every pacification contract, keyed by its stable id and validated at module
 * load. The original T070 slice comes first, then the T093 expansion.
 */
export const PACIFICATION_CONTRACTS = parseContracts({
  /* ----- The original T070 slice ---------------------------------------- */

  "pacify-the-coast-road": {
    name: "Pacify the Coast Road",
    description:
      "Clear the coast road of raiders and deserters so the convoys can move again.",
    flavour: "The road is the region. Hold the road and the rest follows.",
    kind: "pacification",
    fee: 300,
    requires: [{ kind: "unit", count: 5 }],
    reward: { crowns: 1600, ap: 80, experience: 55, honours: 3, itemIds: ["congreve-rocket"] },
    regionId: "the-coast-road",
  },
  "clear-the-forest-bands": {
    name: "Clear the Forest Bands",
    description:
      "A Partisan leads the company against the irregular bands sheltering in the Blackwood.",
    flavour: "You cannot shell a forest into submission; someone has to walk it.",
    kind: "pacification",
    fee: 250,
    requires: [
      { kind: "post", id: "partisan" },
      { kind: "unit", count: 4 },
    ],
    reward: { crowns: 1300, ap: 75, experience: 50, honours: 2, itemIds: ["forester-bow"] },
    regionId: "blackwood",
  },
  "break-the-guerrilla-camp": {
    name: "Break the Guerrilla Camp",
    description:
      "Storm the guerrilla camp in the highlands with powder, rifles and a company willing to climb.",
    flavour: "The highlands do not belong to any army; that is precisely the problem.",
    kind: "pacification",
    fee: 400,
    requires: [
      { kind: "item", id: "powder-flask", count: 3 },
      { kind: "post", id: "chasseur" },
      { kind: "unit", count: 6 },
      { kind: "honour", count: 3 },
    ],
    reward: { crowns: 1800, ap: 100, experience: 70, honours: 3, itemIds: ["baker-rifle"] },
    regionId: "the-highlands",
    chapter: 5,
  },

  /* ----- The T093 expansion --------------------------------------------- */

  "pacify-the-highlands": {
    name: "Pacify the Highlands",
    description:
      "The highland bands have grown bold; a Partisan party must clear the passes and hold them.",
    flavour: "There is no law above the snowline, and someone must carry it up there.",
    kind: "pacification",
    fee: 350,
    requires: [
      { kind: "post", id: "partisan" },
      { kind: "unit", count: 5 },
    ],
    reward: { crowns: 1500, ap: 85, experience: 60, honours: 3, itemIds: ["jaeger-rifle"] },
    regionId: "the-highlands",
  },
  "clear-the-green-valley": {
    name: "Clear the Green Valley",
    description:
      "Deserters are living off the valley farms; clear them out before the harvest is lost.",
    flavour: "A rich valley draws wolves of every uniform.",
    kind: "pacification",
    fee: 220,
    requires: [{ kind: "unit", count: 4 }],
    reward: { crowns: 1100, ap: 65, experience: 45, honours: 2, itemIds: ["forage-cap"] },
    regionId: "the-green-valley",
  },
  "sweep-the-ridge": {
    name: "Sweep the Ridge",
    description:
      "Enemy pickets have been watching the ridge for weeks; a Marksman and Scout party must clear it.",
    flavour: "Whoever owns the ridge owns the valley beneath it.",
    kind: "pacification",
    fee: 280,
    requires: [
      { kind: "post", id: "scout" },
      { kind: "post", id: "marksman" },
      { kind: "unit", count: 4 },
    ],
    reward: { crowns: 1250, ap: 70, experience: 50, honours: 2, itemIds: ["rifled-piece"] },
    regionId: "the-ridge",
  },
  "open-the-crossroads": {
    name: "Open the Crossroads",
    description:
      "The junction is closed by enemy outposts; clear them and the three roads are ours again.",
    flavour: "Three roads meet here, and every one of them is a way to lose the war.",
    kind: "pacification",
    fee: 240,
    requires: [
      { kind: "unit", count: 4 },
      { kind: "honour", count: 2 },
    ],
    reward: { crowns: 1200, ap: 70, experience: 50, honours: 2, itemIds: ["signal-staff"] },
    regionId: "crossroads",
  },
});
