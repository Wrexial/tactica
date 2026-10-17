/**
 * Britain — the light-troops action sets (mapping §3).
 *
 * Britain is the rifle-and-skirmish school: long reach, high accuracy, fast
 * movement. Each post authors a complete action set alongside the FFTA job's
 * kit; the equipment-bound id `aim-vitals` lives on the Rifleman and
 * `range-the-ground` on the Sharpshooter (`agents.md` §3, §9).
 */

import { parseAbilities } from "./shared";

export const BRITAIN_ABILITIES = parseAbilities({
  /* ----- Rifleman (Archer) --------------------------------------------- */

  "aim-vitals": {
    name: "Aim Vitals",
    description: "Pick a point between belt and cross-strap; the shot inflicts a Bleeding wound.",
    flavour: "A Baker rifle in still hands can pick a man from the enemy line.",
    abilityClass: "action",
    skillsetId: "rifleman-kit",
    postId: "rifleman",
    mpCost: 6,
    chargeTime: 20,
    power: 85,
    range: 6,
    hitRate: 95,
    inflicts: ["poison"],
    ap: 150,
  },

  "green-jacket-fire": {
    name: "Green Jacket Fire",
    description: "Fire from cover and step back into it; low cost, reliable skirmish damage.",
    flavour: "In green, a rifleman is a bush that shoots back.",
    abilityClass: "action",
    skillsetId: "rifleman-kit",
    postId: "rifleman",
    mpCost: 4,
    chargeTime: 0,
    power: 60,
    range: 5,
    ap: 90,
  },

  "pick-the-officer": {
    name: "Pick the Officer",
    description: "Single out a leader; the hit drives down an enemy's command and morale.",
    flavour: "An army without its officers is only a crowd with muskets.",
    abilityClass: "action",
    skillsetId: "rifleman-kit",
    postId: "rifleman",
    mpCost: 8,
    chargeTime: 25,
    power: 75,
    range: 6,
    inflicts: ["mpowDown"],
    ap: 160,
  },

  /* ----- Sharpshooter (Sniper) ----------------------------------------- */

  "range-the-ground": {
    name: "Range the Ground",
    description:
      "Pace out the distance and note the wind; the next long shot cannot miss its mark.",
    flavour: "See the ground before you cross it, and half the battle is already won.",
    abilityClass: "action",
    skillsetId: "sharpshooter-kit",
    postId: "sharpshooter",
    mpCost: 5,
    chargeTime: 15,
    power: 0,
    range: 0,
    target: "self",
    inflicts: ["advice"],
    ap: 70,
  },

  "long-shot": {
    name: "Long Shot",
    description: "A deliberate shot at the very edge of range, ignoring the target's cover.",
    flavour: "The further the shot, the quieter the report and the greater the astonishment.",
    abilityClass: "action",
    skillsetId: "sharpshooter-kit",
    postId: "sharpshooter",
    mpCost: 9,
    chargeTime: 35,
    power: 100,
    range: 8,
    hitRate: 90,
    ap: 170,
  },

  "still-the-breath": {
    name: "Still the Breath",
    description:
      "Settle the whole body before firing; raises accuracy and critical chance for a turn.",
    flavour: "Between two heartbeats there is all the time in the world.",
    abilityClass: "action",
    skillsetId: "sharpshooter-kit",
    postId: "sharpshooter",
    mpCost: 6,
    chargeTime: 15,
    power: 0,
    range: 0,
    target: "self",
    inflicts: ["boost"],
    ap: 120,
  },

  /* ----- Sabreur (Fencer) ---------------------------------------------- */

  "fencing-lunge": {
    name: "Fencing Lunge",
    description:
      "A straight, fast thrust that reaches further than a cut and answers before the guard closes.",
    flavour: "Fence with the point, not the edge; the point arrives first.",
    abilityClass: "action",
    skillsetId: "sabreur-kit",
    postId: "sabreur",
    mpCost: 4,
    chargeTime: 0,
    power: 65,
    range: 2,
    ap: 80,
  },

  "quick-parry": {
    name: "Quick Parry",
    description:
      "Beat the enemy's blade aside and open it for the riposte; the next blow lands true.",
    flavour: "A parry is a question; the riposte is the answer no one wants to hear.",
    abilityClass: "action",
    skillsetId: "sabreur-kit",
    postId: "sabreur",
    mpCost: 4,
    chargeTime: 10,
    power: 45,
    range: 1,
    inflicts: ["defense"],
    ap: 90,
  },

  "cut-and-thrust": {
    name: "Cut and Thrust",
    description:
      "Alternate edge and point in one flowing attack, striking twice for a single cost.",
    flavour: "The blade that only cuts is only half a weapon.",
    abilityClass: "action",
    skillsetId: "sabreur-kit",
    postId: "sabreur",
    mpCost: 7,
    chargeTime: 20,
    power: 80,
    range: 1,
    ap: 130,
  },

  /* ----- Adjutant (Red Mage) ------------------------------------------- */

  "aide-order": {
    name: "Aide Order",
    description: "Carry the colonel's word down the line; an ally acts sooner this tempo.",
    flavour: "An order delivered in time is worth a battery sent late.",
    abilityClass: "action",
    skillsetId: "adjutant-kit",
    postId: "adjutant",
    mpCost: 7,
    chargeTime: 15,
    power: 0,
    range: 4,
    target: "ally",
    inflicts: ["haste"],
    ap: 130,
  },

  "mixed-volley": {
    name: "Mixed Volley",
    description: "Blend blade and ball in one attack; usable at blade or musket range.",
    flavour:
      "The adjutant is expected to do whatever the moment requires, and to look calm doing it.",
    abilityClass: "action",
    skillsetId: "adjutant-kit",
    postId: "adjutant",
    mpCost: 6,
    chargeTime: 15,
    power: 75,
    range: 3,
    ap: 120,
  },

  "steady-the-ranks": {
    name: "Steady the Ranks",
    description: "Re-form a shaken file, cleansing panic from an ally and restoring Élan.",
    flavour: "A calm voice at the right moment is worth a squadron of cavalry.",
    abilityClass: "action",
    skillsetId: "adjutant-kit",
    postId: "adjutant",
    mpCost: 8,
    chargeTime: 20,
    power: 0,
    range: 4,
    target: "ally",
    cleanses: ["shaken", "confuse"],
    inflicts: ["regen"],
    ap: 150,
  },

  /* ----- Rocketeer (Elementalist) -------------------------------------- */

  "rocket-ladder": {
    name: "Rocket Ladder",
    description: "Fire a ranging rocket to walk subsequent shots onto a target area.",
    flavour: "The rockets are as frightening as they are inaccurate, which is quite enough.",
    abilityClass: "action",
    skillsetId: "rocketeer-kit",
    postId: "rocketeer",
    mpCost: 8,
    chargeTime: 30,
    power: 70,
    range: 7,
    target: "tile",
    aoeShape: "cross",
    aoeSize: 1,
    element: "fire",
    ap: 140,
  },

  "congreve-salvo": {
    name: "Congreve Salvo",
    description: "Launch a salvo of rockets that burst along a line, catching a whole file.",
    flavour: "When the rockets go up, even veteran cavalry find somewhere else to be.",
    abilityClass: "action",
    skillsetId: "rocketeer-kit",
    postId: "rocketeer",
    mpCost: 12,
    chargeTime: 35,
    power: 85,
    range: 6,
    aoeShape: "line",
    aoeSize: 2,
    element: "fire",
    inflicts: ["blind"],
    ap: 170,
  },

  "smoke-screen": {
    name: "Smoke Screen",
    description:
      "Lay a bank of powder smoke; enemies inside are Dazed and allies become Concealed.",
    flavour: "Two volleys and no one can see the colours through the fog of war.",
    abilityClass: "action",
    skillsetId: "rocketeer-kit",
    postId: "rocketeer",
    mpCost: 9,
    chargeTime: 25,
    power: 0,
    range: 5,
    target: "tile",
    aoeShape: "square",
    aoeSize: 2,
    element: "wind",
    inflicts: ["blind"],
    ap: 160,
  },

  /* ----- Long Rifle (Assassin) ----------------------------------------- */

  "concealed-approach": {
    name: "Concealed Approach",
    description: "Break contact and slip into cover, becoming Concealed and hard to target.",
    flavour: "The long rifle does not fight fair; it fights to be somewhere else.",
    abilityClass: "action",
    skillsetId: "long-rifle-kit",
    postId: "long-rifle",
    mpCost: 6,
    chargeTime: 10,
    power: 0,
    range: 0,
    target: "self",
    inflicts: ["conceal"],
    ap: 120,
  },

  "silent-ball": {
    name: "Silent Ball",
    description: "A single muffled shot at close quarters that a sentry never hears.",
    flavour: "The shot you never hear is the one that finds you.",
    abilityClass: "action",
    skillsetId: "long-rifle-kit",
    postId: "long-rifle",
    mpCost: 9,
    chargeTime: 30,
    power: 115,
    range: 1,
    hitRate: 100,
    ap: 180,
  },

  assassinate: {
    name: "Assassinate",
    description:
      "A deliberate attempt to take a leader off the field in one blow; may strike Mortally Wounded.",
    flavour:
      "Armies are held together by a handful of men; remove the right one and the rest unravels.",
    abilityClass: "action",
    skillsetId: "long-rifle-kit",
    postId: "long-rifle",
    mpCost: 12,
    chargeTime: 40,
    power: 120,
    range: 4,
    inflicts: ["doom"],
    ap: 200,
  },

  /* ----- Commodore (Summoner) ------------------------------------------ */

  broadside: {
    name: "Broadside",
    description:
      "Call down a full ship's broadside onto the field, striking every enemy in a wide arc.",
    flavour: "A broadside is not aimed; it is simply a wall of iron arriving at once.",
    abilityClass: "action",
    skillsetId: "commodore-kit",
    postId: "commodore",
    mpCost: 14,
    chargeTime: 45,
    power: 95,
    range: 7,
    aoeShape: "field",
    aoeSize: 2,
    element: "water",
    ap: 190,
  },

  "signal-to-engage": {
    name: "Signal to Engage",
    description: "Run up the signal flags; every ally's next action comes sooner and hits harder.",
    flavour: "Flags, mirrors and rockets speak where the voice cannot reach.",
    abilityClass: "action",
    skillsetId: "commodore-kit",
    postId: "commodore",
    mpCost: 10,
    chargeTime: 25,
    power: 0,
    range: 5,
    target: "ally",
    aoeShape: "square",
    aoeSize: 2,
    inflicts: ["haste", "boost"],
    ap: 180,
  },

  "cutting-out": {
    name: "Cutting Out",
    description: "A boarding-party raid that seizes a position and hauls its garrison away.",
    flavour: "Cutting out a ship is the most dangerous work a sailor can volunteer for.",
    abilityClass: "action",
    skillsetId: "commodore-kit",
    postId: "commodore",
    mpCost: 11,
    chargeTime: 35,
    power: 100,
    range: 2,
    inflicts: ["disable"],
    ap: 190,
  },
});
