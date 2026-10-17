/**
 * Austria — the defensive and technical action sets (mapping §3).
 *
 * Austria is the defensive, multi-national school: support calls, gadgets and
 * steady carbine fire. Each post authors a complete action set; the
 * equipment-bound ids `snap-shot` and `call-hounds` live here (`agents.md`
 * §3, §9).
 */

import { parseAbilities } from "./shared";

export const AUSTRIA_ABILITIES = parseAbilities({
  /* ----- Scout (Animist) ----------------------------------------------- */

  "call-hounds": {
    name: "Call Hounds",
    description: "Sound the horn and loose the hounds; they harry a foe and leave it Bewildered.",
    flavour: "The horn carries further than any order shouted into the smoke.",
    abilityClass: "action",
    skillsetId: "scout-kit",
    postId: "scout",
    mpCost: 6,
    chargeTime: 20,
    power: 70,
    range: 5,
    inflicts: ["confuse"],
    ap: 90,
  },

  "scout-ahead": {
    name: "Scout Ahead",
    description: "Push forward and read the ground; reveals a wide area and Conceals the scout.",
    flavour: "A good scout is back before the enemy knows he was ever there.",
    abilityClass: "action",
    skillsetId: "scout-kit",
    postId: "scout",
    mpCost: 5,
    chargeTime: 15,
    power: 0,
    range: 0,
    target: "self",
    inflicts: ["conceal", "advice"],
    ap: 90,
  },

  "horn-call": {
    name: "Horn Call",
    description: "A prearranged call that hastens allies and calls in supporting fire.",
    flavour: "Every hunting horn has its own language, and the enemy never learns it.",
    abilityClass: "action",
    skillsetId: "scout-kit",
    postId: "scout",
    mpCost: 7,
    chargeTime: 20,
    power: 0,
    range: 4,
    target: "ally",
    aoeShape: "cross",
    aoeSize: 1,
    inflicts: ["haste"],
    ap: 120,
  },

  /* ----- Gunner / Fusilier (Gunner) ------------------------------------ */

  "snap-shot": {
    name: "Snap Shot",
    description: "A quick carbine shot from the hip, answered before the enemy can present.",
    flavour: "Light cavalry carry it slung; it answers fast in a running fight.",
    abilityClass: "action",
    skillsetId: "gunner-kit",
    postId: "gunner",
    mpCost: 3,
    chargeTime: 0,
    power: 55,
    range: 4,
    ap: 90,
  },

  "carbine-drill": {
    name: "Carbine Drill",
    description: "The steady, practiced carbine sequence: load, present, fire, recover.",
    flavour: "Reliability is a kind of courage; the gunner never has to think about the piece.",
    abilityClass: "action",
    skillsetId: "gunner-kit",
    postId: "gunner",
    mpCost: 5,
    chargeTime: 15,
    power: 70,
    range: 5,
    element: "lightning",
    ap: 100,
  },

  "cover-fire": {
    name: "Cover Fire",
    description: "Keep an enemy's head down; the target is Suppressed and less likely to hit back.",
    flavour: "You do not have to hit a man to make him useless for a minute.",
    abilityClass: "action",
    skillsetId: "gunner-kit",
    postId: "gunner",
    mpCost: 5,
    chargeTime: 10,
    power: 35,
    range: 5,
    inflicts: ["blind"],
    ap: 110,
  },

  /* ----- Mog Knight / Lancer (Mog Knight) ------------------------------ */

  "lance-charge": {
    name: "Lance Charge",
    description:
      "A mounted-style charge with the lance, arriving at the point and driving the foe back.",
    flavour: "Even a small rider with a long lance is a problem no infantryman ignores.",
    abilityClass: "action",
    skillsetId: "mog-knight-kit",
    postId: "mog-knight",
    mpCost: 7,
    chargeTime: 25,
    power: 105,
    range: 2,
    ap: 140,
  },

  "guard-the-flank": {
    name: "Guard the Flank",
    description: "Wheel the troop to screen an ally, becoming Formed and Drawing fire.",
    flavour: "A flank is where battles are lost; a lance line is how they are kept.",
    abilityClass: "action",
    skillsetId: "mog-knight-kit",
    postId: "mog-knight",
    mpCost: 6,
    chargeTime: 15,
    power: 0,
    range: 2,
    target: "ally",
    inflicts: ["cover", "protect"],
    ap: 140,
  },

  disengage: {
    name: "Disengage",
    description:
      "Break contact in good order, slipping out of reach without an enemy's parting blow.",
    flavour: "There is no shame in a withdrawal that leaves the troop intact.",
    abilityClass: "action",
    skillsetId: "mog-knight-kit",
    postId: "mog-knight",
    mpCost: 5,
    chargeTime: 10,
    power: 0,
    range: 0,
    target: "self",
    inflicts: ["haste"],
    ap: 130,
  },

  /* ----- Juggler / Grenadier (Juggler) --------------------------------- */

  "grenade-toss": {
    name: "Grenade Toss",
    description: "Lob a grenade with a juggler's accuracy into an exact tile, catching the blast.",
    flavour: "A grenade in the right hand is a small, personal battery.",
    abilityClass: "action",
    skillsetId: "juggler-kit",
    postId: "juggler",
    mpCost: 7,
    chargeTime: 20,
    power: 80,
    range: 4,
    target: "tile",
    aoeShape: "cross",
    aoeSize: 1,
    element: "fire",
    ap: 140,
  },

  "knife-throw": {
    name: "Knife Throw",
    description: "Throw a balanced knife at short range; fast, cheap and Bleeding.",
    flavour: "The juggler's knives are never quite where the eye expects them.",
    abilityClass: "action",
    skillsetId: "juggler-kit",
    postId: "juggler",
    mpCost: 3,
    chargeTime: 0,
    power: 50,
    range: 3,
    inflicts: ["poison"],
    ap: 110,
  },

  "juggling-gambit": {
    name: "Juggling Gambit",
    description:
      "A showman's flurry of blades and bombs that leaves the target Dazed and off-balance.",
    flavour:
      "Half the trick is the noise, and the other half is the audience looking the wrong way.",
    abilityClass: "action",
    skillsetId: "juggler-kit",
    postId: "juggler",
    mpCost: 9,
    chargeTime: 25,
    power: 75,
    range: 2,
    aoeShape: "cross",
    aoeSize: 1,
    inflicts: ["blind", "slow"],
    ap: 170,
  },

  /* ----- Engineer (Gadgeteer) ------------------------------------------ */

  "field-contraption": {
    name: "Field Contraption",
    description: "Deploy a hastily built device that confuses, blocks or harasses a nearby foe.",
    flavour:
      "The engineer's answer to any problem is a box, some wire and a great deal of swearing.",
    abilityClass: "action",
    skillsetId: "engineer-kit",
    postId: "engineer",
    mpCost: 8,
    chargeTime: 25,
    power: 60,
    range: 3,
    target: "tile",
    aoeShape: "cross",
    aoeSize: 1,
    inflicts: ["addle", "immobilize"],
    ap: 160,
  },

  "repair-works": {
    name: "Repair Works",
    description: "Patch up a position or a piece of kit, restoring an ally's Entrenchment.",
    flavour: "An engineer can make almost anything work, at least until the battle is over.",
    abilityClass: "action",
    skillsetId: "engineer-kit",
    postId: "engineer",
    mpCost: 7,
    chargeTime: 20,
    power: 0,
    range: 3,
    target: "ally",
    inflicts: ["protect", "defense"],
    ap: 150,
  },

  "hail-of-fire": {
    name: "Hail of Fire",
    description: "Unleash a gadget's full payload of shot and flame across a wide area.",
    flavour: "The engineer's greatest trick is saved for the day it is most needed.",
    abilityClass: "action",
    skillsetId: "engineer-kit",
    postId: "engineer",
    mpCost: 12,
    chargeTime: 40,
    power: 90,
    range: 4,
    aoeShape: "square",
    aoeSize: 2,
    element: "fire",
    ap: 190,
  },
});
