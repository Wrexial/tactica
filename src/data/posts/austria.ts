/**
 * Austria — the defensive and technical school (Moogle in FFTA), mapping §3.
 *
 * Austria's identity is the steady line, skirmishers and technical support:
 * reliable firearms, hounds and field signals. FFTA's Moogle jobs (Gunner,
 * Mog Knight, Juggler) reuse the Napoleonic role names *Fusilier*, *Lancer*
 * and *Grenadier* — which also appear under other powers as **different FFTA
 * jobs**. Their **ids therefore stay the FFTA job keys** (`gunner`,
 * `mog-knight`, `juggler`) so the roster is unique and stable, while the
 * player-facing `name` follows the mapping verbatim (`src/data/README.md`:
 * "never put period names into ids").
 */

import { FULL_KIT, SHOULDER_KIT, parsePosts } from "./shared";

export const AUSTRIA_POSTS = parsePosts({
  /** FFTA Animist. */
  scout: {
    name: "Scout",
    description:
      "Light support who calls up hounds and skirmishers; status-craft, horns and field signals.",
    flavour: "The horn sounds, and the woods answer with friends.",
    power: "austria",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["instrument", "bow"],
    growth: { hp: 7.2, mp: 2.6, atk: 7.6, def: 8.8, mag: 7.2, res: 8.8, spd: 1.2 },
    skillsetIds: ["scout-kit"],
  },

  /** FFTA Gunner. */
  gunner: {
    name: "Fusilier",
    description:
      "A carbine-armed line soldier of the Austrian school; reliable ranged fire and a stubborn defensive brace.",
    flavour: "The Austrian fusilier holds the white-coated line and makes every cartridge count.",
    power: "austria",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["carbine", "musket"],
    growth: { hp: 7.4, mp: 1.8, atk: 8.2, def: 9.0, mag: 6.8, res: 8.4, spd: 1.2 },
    skillsetIds: ["gunner-kit"],
  },

  /** FFTA Mog Knight. */
  "mog-knight": {
    name: "Lancer",
    description:
      "A mounted-style lancer of the Austrian school; reach and a heavy charge from behind a shield wall.",
    flavour: "The lancer's pennon is a warning; the pennon's owner is the reason to heed it.",
    power: "austria",
    equipSlots: FULL_KIT,
    weaponTypes: ["lance", "blade"],
    growth: { hp: 7.8, mp: 2.0, atk: 8.6, def: 9.2, mag: 6.6, res: 8.4, spd: 1.0 },
    skillsetIds: ["mog-knight-kit"],
    requires: [{ postId: "gunner", abilities: 2 }],
  },

  /** FFTA Juggler. */
  juggler: {
    name: "Grenadier",
    description:
      "Thrown charges and knives, with gambits that misfire as often as they astonish.",
    flavour: "A grenadier's pouch is a promise; which way it lands is left to the day.",
    power: "austria",
    equipSlots: FULL_KIT,
    weaponTypes: ["tool", "sabre"],
    growth: { hp: 6.8, mp: 2.2, atk: 8.0, def: 8.2, mag: 7.4, res: 8.2, spd: 1.6 },
    skillsetIds: ["juggler-kit"],
    requires: [{ postId: "scout", abilities: 2 }],
  },

  /** FFTA Gadgeteer. */
  engineer: {
    name: "Engineer",
    description:
      "Technical support with gadgets, charges and improvised devices; utility effects with an element of chance.",
    flavour: "If it can be built, an engineer can also take it apart — usually with a bang.",
    power: "austria",
    equipSlots: FULL_KIT,
    weaponTypes: ["tool", "gun"],
    growth: { hp: 7.2, mp: 2.4, atk: 8.2, def: 9.6, mag: 8.3, res: 10.2, spd: 0.9 },
    skillsetIds: ["engineer-kit"],
    requires: [{ postId: "forager", abilities: 2 }],
  },
});
