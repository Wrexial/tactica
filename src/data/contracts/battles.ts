/**
 * **Battles** — story and campaign set pieces (T070, T093; mapping §10).
 *
 * A battle is the retheme of FFTA's **Regular mission**: a named, hand-built
 * engagement that anchors the story spine (T077). A battle may carry a
 * `chapter`, in which case it is posted only once the company has reached that
 * beat; the spine's `contractIds` must name it (see `../story.ts`). A battle
 * with no `chapter` is a side set piece the Mess posts from the start.
 *
 * Every battle is tied to a campaign-map `regionId` (`../maps/locations.ts`)
 * and pays a fee in Crowns, so the Mess can show where the work is and what it
 * costs. All numbers are **our own balance data**, inspired by the FFTA
 * mission/fee tables but tuned for detachment-scale play (`agents.md` §3, §10).
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.**
 * - **Validated at load.** Every entry is parsed with {@link parseContracts}.
 * - **No placeholders.** Every battle carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import { parseContracts } from "./shared";

/**
 * Every battle contract, keyed by its stable id and validated at module load.
 * The story-gated set-pieces come first, then the ungated side battles.
 */
export const BATTLE_CONTRACTS = parseContracts({
  /* ----- Story set pieces (spine-gated, T077) --------------------------- */

  "break-the-bridge": {
    name: "Break the Bridge",
    description:
      "March on Sainte-Colombe and drop the stone bridge before the enemy column crosses; four soldiers and a day's powder.",
    flavour: "Whoever holds the bridge holds the road, and today the road is worth a battalion.",
    kind: "battle",
    fee: 250,
    requires: [{ kind: "unit", count: 4 }],
    reward: { crowns: 1200, ap: 60, experience: 45, honours: 2, itemIds: ["baker-rifle"] },
    regionId: "sainte-colombe",
    chapter: 1,
  },
  "storm-the-farmhouse": {
    name: "Storm the Farmhouse",
    description:
      "Sappers blow the gate and a Grenadier party clears the farmhouse held by the enemy rearguard.",
    flavour: "The farm looks quiet from the road. Farms held by desperate men always do.",
    kind: "battle",
    fee: 300,
    requires: [
      { kind: "item", id: "sappers-tools" },
      { kind: "post", id: "grenadier" },
      { kind: "unit", count: 5 },
    ],
    reward: { crowns: 1500, ap: 70, experience: 55, honours: 2, itemIds: ["congreve-rocket"] },
    regionId: "blackwood",
    chapter: 3,
  },
  "hold-the-redoubt": {
    name: "Hold the Redoubt",
    description:
      "Man the earthwork with a gun crew and hold it through the afternoon's counter-attack.",
    flavour: "A redoubt is nothing but a promise. The battery is what keeps it.",
    kind: "battle",
    fee: 220,
    requires: [
      { kind: "post", id: "artilleryman" },
      { kind: "unit", count: 4 },
    ],
    reward: { crowns: 1000, ap: 55, experience: 40, honours: 2, itemIds: ["six-pounder"] },
    regionId: "sainte-colombe",
    chapter: 4,
  },

  /* ----- Ungated side battles ------------------------------------------- */

  "take-the-mill": {
    name: "Take the Mill",
    description:
      "The mill ford is held by a stubborn rearguard; an Engineer party must carry the crossing.",
    flavour: "Burn the mill and the crossing means nothing; hold it, and the road is yours.",
    kind: "battle",
    fee: 200,
    requires: [
      { kind: "post", id: "engineer" },
      { kind: "unit", count: 4 },
    ],
    reward: { crowns: 950, ap: 50, experience: 40, honours: 1, itemIds: ["mining-tools"] },
    regionId: "sainte-colombe",
  },
  "clear-the-orchard": {
    name: "Clear the Orchard",
    description:
      "Skirmishers have turned the old orchard into a nest of loopholes; clear it lane by lane.",
    flavour: "An orchard is a gentleman's field and a skirmisher's dream.",
    kind: "battle",
    fee: 160,
    requires: [{ kind: "unit", count: 3 }],
    reward: { crowns: 700, ap: 40, experience: 30, itemIds: ["hunting-bow"] },
    regionId: "crossroads",
  },
  "silence-the-battery": {
    name: "Silence the Battery",
    description:
      "Enemy guns on the ridge are ranging the column; carry the crest and spike the pieces.",
    flavour: "From the crest you can count their campfires. They can count yours.",
    kind: "battle",
    fee: 260,
    requires: [
      { kind: "post", id: "artilleryman" },
      { kind: "post", id: "scout" },
      { kind: "unit", count: 4 },
    ],
    reward: { crowns: 1150, ap: 60, experience: 45, honours: 2, itemIds: ["spyglass"] },
    regionId: "the-ridge",
  },
  "carry-the-pass": {
    name: "Carry the Pass",
    description:
      "A narrow highland pass is blocked by regulars; scouts must find the track that turns their flank.",
    flavour: "The highlands do not belong to any army; that is precisely the problem.",
    kind: "battle",
    fee: 320,
    requires: [
      { kind: "post", id: "scout" },
      { kind: "unit", count: 5 },
    ],
    reward: { crowns: 1400, ap: 70, experience: 55, honours: 2, itemIds: ["tower-shield"] },
    regionId: "the-highlands",
  },
});
