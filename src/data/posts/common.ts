/**
 * Common posts — the four roles shared by every power (mapping §3).
 *
 * FFTA's White Mage, Black Mage, Thief and Time Mage appear on more than one
 * race's job list; the mapping collapses them into **common posts** that any
 * school may take. In the engine that is the `common: true` flag: the post's
 * `power` still names its home depot for flavour and depot discounts, but
 * {@link postsForPower} offers it to everyone.
 *
 * The mapping notes each power gains a small variant (weapon model, one
 * signature action); those variants are authored later alongside the ability
 * sets (`src/data/abilities/`, T089) and do not change this roster.
 */

import { FULL_KIT, SHOULDER_KIT, parsePosts } from "./shared";

export const COMMON_POSTS = parsePosts({
  /** FFTA White Mage (Hume / Nu mou / Viera). */
  surgeon: {
    name: "Surgeon",
    description:
      "Medical specialist who heals wounds, steadies nerve and cleanses conditions. A common post open to every power.",
    flavour: "Under the lantern's edge, the surgeon is worth more than a squadron.",
    power: "france",
    equipSlots: FULL_KIT,
    weaponTypes: ["staff", "tool"],
    growth: { hp: 6.1, mp: 4.8, atk: 6.2, def: 7.3, mag: 8.4, res: 8.2, spd: 1.2 },
    skillsetIds: ["surgeon-kit"],
    common: true,
  },

  /** FFTA Black Mage (Hume / Nu mou / Austria). */
  artilleryman: {
    name: "Artilleryman",
    description:
      "Gun crew who deliver elemental fire, concussion and case shot at range. A common post open to every power.",
    flavour: "The gunners speak last, and the field goes quiet to listen.",
    power: "france",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["gun"],
    growth: { hp: 5.6, mp: 4.4, atk: 6.4, def: 6.8, mag: 8.8, res: 9.6, spd: 1.1 },
    skillsetIds: ["artilleryman-kit"],
    common: true,
  },

  /** FFTA Thief (Hume / Austria). */
  forager: {
    name: "Forager",
    description:
      "Light-fingered scrounger who steals kit, disarms a foe and slips away. A common post open to every power.",
    flavour: "Armies march on their stomachs, and foragers know exactly whose stomach.",
    power: "austria",
    equipSlots: FULL_KIT,
    weaponTypes: ["sabre", "carbine"],
    growth: { hp: 6.6, mp: 1.1, atk: 7.6, def: 7.6, mag: 7.6, res: 6.8, spd: 1.8 },
    skillsetIds: ["forager-kit"],
    common: true,
  },

  /** FFTA Time Mage (Russia / Austria). */
  "staff-officer": {
    name: "Staff Officer",
    description:
      "Signals and dispatch specialist who bends the tempo of battle; hastens allies and delays enemies. A common post open to every power.",
    flavour: "An order sent in time is worth a battery sent late.",
    power: "russia",
    equipSlots: SHOULDER_KIT,
    weaponTypes: ["staff"],
    growth: { hp: 5.2, mp: 3.6, atk: 5.6, def: 6.8, mag: 10.2, res: 9.6, spd: 1.2 },
    skillsetIds: ["staff-officer-kit"],
    common: true,
  },
});
