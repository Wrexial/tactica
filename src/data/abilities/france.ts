/**
 * France — the combined-arms action sets (mapping §3).
 *
 * Every post authored in `../posts/france.ts` gets a complete action set: at
 * least one signature action plus the supporting drills its FFTA job carried.
 * The ids stay FFTA-shaped where equipment already binds to them
 * (`volley-fire`, `bayonet-charge`, `dismounting-shot`, `case-shot`); the
 * display fields carry the Napoleonic fiction (`agents.md` §3, §9;
 * `src/data/README.md`).
 *
 * Numbers are **our balance data** — inspired by the scraped FFTA job action
 * lists (`docs/wiki/pages/Final_Fantasy_Tactics_Advance_jobs.md`) but rounded
 * for detachment scale. No balance constant lives in engine code.
 */

import { parseAbilities } from "./shared";

export const FRANCE_ABILITIES = parseAbilities({
  /* ----- Fusilier (Soldier) -------------------------------------------- */

  "volley-fire": {
    name: "Volley Fire",
    description:
      "Three ranks fire by word of command at a target line; solid, unspectacular, reliable damage.",
    flavour: "The Queen of Battles does not shout; she speaks once, and the field is cleared.",
    abilityClass: "action",
    skillsetId: "fusilier-kit",
    postId: "fusilier",
    mpCost: 6,
    chargeTime: 20,
    power: 60,
    range: 3,
    aoeShape: "line",
    aoeSize: 1,
    element: "lightning",
    ap: 100,
  },

  "bayonet-charge": {
    name: "Bayonet Charge",
    description: "Close to arm's length and drive the bayonet home; heavy melee damage.",
    flavour: "The fusilier is the army's anvil, and the bayonet is how an anvil bites.",
    abilityClass: "action",
    skillsetId: "fusilier-kit",
    postId: "fusilier",
    mpCost: 0,
    chargeTime: 0,
    power: 90,
    range: 1,
    ap: 90,
  },

  "close-order-drill": {
    name: "Close Order",
    description:
      "Dress the ranks shoulder to shoulder; the soldier becomes Formed and harder to break.",
    flavour: "Elbow to elbow, the line is a wall of men that no horseman rides through.",
    abilityClass: "action",
    skillsetId: "fusilier-kit",
    postId: "fusilier",
    mpCost: 4,
    chargeTime: 10,
    power: 0,
    range: 0,
    target: "self",
    inflicts: ["protect"],
    ap: 80,
  },

  /* ----- Grenadier (Fighter) ------------------------------------------- */

  "crushing-blow": {
    name: "Crushing Blow",
    description:
      "A two-handed swing that breaks guard and bone alike; very heavy single-target damage.",
    flavour: "Grenadiers are chosen for the worst work of the day, and this is how they do it.",
    abilityClass: "action",
    skillsetId: "grenadier-kit",
    postId: "grenadier",
    mpCost: 8,
    chargeTime: 30,
    power: 120,
    range: 1,
    ap: 120,
  },

  "grenade-lob": {
    name: "Grenade Lob",
    description: "Throw a fused grenade into a packed file, catching everyone in the blast.",
    flavour: "The grenade is a small, rude argument that ends most discussions at close range.",
    abilityClass: "action",
    skillsetId: "grenadier-kit",
    postId: "grenadier",
    mpCost: 10,
    chargeTime: 25,
    power: 70,
    range: 3,
    aoeShape: "cross",
    aoeSize: 1,
    element: "fire",
    ap: 140,
  },

  "storm-the-breach": {
    name: "Storm the Breach",
    description: "Spend Élan to shrug off defensive cover and force a way into the position.",
    flavour: "The forlorn hope goes first, and the grenadiers are close behind them.",
    abilityClass: "action",
    skillsetId: "grenadier-kit",
    postId: "grenadier",
    mpCost: 6,
    chargeTime: 15,
    power: 100,
    range: 1,
    inflicts: ["defense"],
    ap: 150,
  },

  /* ----- Marksman (Archer) --------------------------------------------- */

  "aimed-shot": {
    name: "Aimed Shot",
    description:
      "Take a breath and place a single ball precisely; above-average accuracy and damage.",
    flavour: "Patience, breath and one clean shot — the marksman wastes neither powder nor lead.",
    abilityClass: "action",
    skillsetId: "marksman-kit",
    postId: "marksman",
    mpCost: 4,
    chargeTime: 15,
    power: 85,
    range: 5,
    hitRate: 95,
    ap: 90,
  },

  "leading-shot": {
    name: "Leading Shot",
    description: "Fire ahead of a moving target, ignoring the cover of broken ground.",
    flavour: "Aim where the man will be, not where he is; the ground is not the problem.",
    abilityClass: "action",
    skillsetId: "marksman-kit",
    postId: "marksman",
    mpCost: 6,
    chargeTime: 20,
    power: 75,
    range: 6,
    ap: 110,
  },

  "mark-the-range": {
    name: "Mark the Range",
    description: "Call the distance to a target; allies firing at it gain accuracy this turn.",
    flavour: "One man walks the ball, and every musket behind him finds the mark.",
    abilityClass: "action",
    skillsetId: "marksman-kit",
    postId: "marksman",
    mpCost: 5,
    chargeTime: 10,
    power: 0,
    range: 7,
    target: "ally",
    ap: 100,
  },

  /* ----- Colour Guard (Paladin) ---------------------------------------- */

  "steady-the-line": {
    name: "Steady the Line",
    description:
      "A word and a raised hand restore order; nearby allies become Formed and Steadied.",
    flavour:
      "While the colours stand, the line stands — and the colour guard does not let them fall.",
    abilityClass: "action",
    skillsetId: "colour-guard-kit",
    postId: "colour-guard",
    mpCost: 8,
    chargeTime: 20,
    power: 0,
    range: 3,
    target: "ally",
    aoeShape: "cross",
    aoeSize: 1,
    inflicts: ["protect", "regen"],
    ap: 130,
  },

  "form-square": {
    name: "Form Square",
    description:
      "Order the company into square; the bearer becomes Entrenched against cavalry and shot.",
    flavour: "Four faces of bayonets, and the horsemen break upon them like surf on rock.",
    abilityClass: "action",
    skillsetId: "colour-guard-kit",
    postId: "colour-guard",
    mpCost: 6,
    chargeTime: 15,
    power: 0,
    range: 0,
    target: "self",
    inflicts: ["protect", "defense"],
    ap: 120,
  },

  "rally-round": {
    name: "Rally Round",
    description:
      "Plant the standard and call the broken back to the ranks, curing panic and restoring nerve.",
    flavour: "Eyes on the standard: as long as it flies, a man remembers which way to run.",
    abilityClass: "action",
    skillsetId: "colour-guard-kit",
    postId: "colour-guard",
    mpCost: 10,
    chargeTime: 25,
    power: 0,
    range: 4,
    target: "ally",
    aoeShape: "square",
    aoeSize: 1,
    cleanses: ["confuse", "berserk", "charm"],
    inflicts: ["boost"],
    ap: 160,
  },

  /* ----- Hussar (Ninja) ------------------------------------------------ */

  "dismounting-shot": {
    name: "Dismounting Shot",
    description:
      "A close pistol ball at the saddle; knocks a rider down and leaves the horse running.",
    flavour: "One shot, close range, and the saddle is suddenly very empty.",
    abilityClass: "action",
    skillsetId: "hussar-kit",
    postId: "hussar",
    mpCost: 5,
    chargeTime: 10,
    power: 70,
    range: 2,
    inflicts: ["immobilize"],
    ap: 80,
  },

  "sabre-cut": {
    name: "Sabre Cut",
    description: "A fast, light slash that lets the hussar strike twice in one pass.",
    flavour: "A hussar is never where the shot was aimed, and always where it was not expected.",
    abilityClass: "action",
    skillsetId: "hussar-kit",
    postId: "hussar",
    mpCost: 4,
    chargeTime: 0,
    power: 55,
    range: 1,
    ap: 70,
  },

  "ride-down": {
    name: "Ride Down",
    description: "Spur through a broken file, scattering the survivors and slowing their regroup.",
    flavour: "Cavalry against shaken infantry is not a fight; it is a harvest.",
    abilityClass: "action",
    skillsetId: "hussar-kit",
    postId: "hussar",
    mpCost: 8,
    chargeTime: 20,
    power: 80,
    range: 2,
    aoeShape: "line",
    aoeSize: 1,
    inflicts: ["slow"],
    ap: 130,
  },

  /* ----- Chasseur (Hunter) --------------------------------------------- */

  "hunt-the-trail": {
    name: "Hunt the Trail",
    description:
      "Track a wounded foe across broken ground; reveals it and improves the next shot against it.",
    flavour: "Chasseurs fight in the green, and they never lose the trail they set out on.",
    abilityClass: "action",
    skillsetId: "chasseur-kit",
    postId: "chasseur",
    mpCost: 5,
    chargeTime: 15,
    power: 0,
    range: 6,
    target: "enemy",
    ap: 100,
  },

  "cold-ball": {
    name: "Cold Ball",
    description: "A deliberate long shot from a rested rifle, striking at extreme range.",
    flavour: "The chasseur fires once, from far enough that the smoke is only a rumour.",
    abilityClass: "action",
    skillsetId: "chasseur-kit",
    postId: "chasseur",
    mpCost: 8,
    chargeTime: 30,
    power: 110,
    range: 7,
    ap: 150,
  },

  "take-prisoner": {
    name: "Take Prisoner",
    description: "Wing a foe rather than kill it, leaving it Lamed and fit to be captured.",
    flavour: "A prisoner answers questions; a corpse is only a mouthful of questions unanswered.",
    abilityClass: "action",
    skillsetId: "chasseur-kit",
    postId: "chasseur",
    mpCost: 6,
    chargeTime: 15,
    power: 50,
    range: 6,
    inflicts: ["immobilize", "disable"],
    ap: 140,
  },

  /* ----- Intelligence Officer (Blue Mage) ------------------------------ */

  "read-the-enemy": {
    name: "Read the Enemy",
    description: "Study a foe mid-battle to learn its methods and expose its order of battle.",
    flavour:
      "A captured order is worth a battery — an intelligence officer knows how to read it aloud.",
    abilityClass: "action",
    skillsetId: "intelligence-officer-kit",
    postId: "intelligence-officer",
    mpCost: 6,
    chargeTime: 20,
    power: 0,
    range: 6,
    target: "enemy",
    ap: 110,
  },

  "copy-their-drill": {
    name: "Copy Their Drill",
    description: "Turn an enemy's own method back on its author; unbinds a condition from an ally.",
    flavour: "The best teachers are the ones trying to kill you.",
    abilityClass: "action",
    skillsetId: "intelligence-officer-kit",
    postId: "intelligence-officer",
    mpCost: 8,
    chargeTime: 25,
    power: 70,
    range: 4,
    target: "any",
    ap: 150,
  },

  "cipher-orders": {
    name: "Cipher Orders",
    description: "Scramble the enemy's signals; a foe becomes Bewildered and loses its next order.",
    flavour: "Write the order in a hand the enemy's own staff will mistake for their own.",
    abilityClass: "action",
    skillsetId: "intelligence-officer-kit",
    postId: "intelligence-officer",
    mpCost: 7,
    chargeTime: 20,
    power: 0,
    range: 5,
    target: "enemy",
    inflicts: ["addle", "confuse"],
    ap: 140,
  },

  /* ----- Bombardier (Illusionist) -------------------------------------- */

  "case-shot": {
    name: "Case Shot",
    description:
      "A shell packed with case that bursts over a target class, hitting every foe in the area.",
    flavour:
      "The bombardier does not aim at a man; he aims at a place and lets the place do the work.",
    abilityClass: "action",
    skillsetId: "bombardier-kit",
    postId: "bombardier",
    mpCost: 12,
    chargeTime: 35,
    power: 90,
    range: 6,
    aoeShape: "square",
    aoeSize: 2,
    element: "fire",
    ap: 170,
  },

  "bombard-the-crossroads": {
    name: "Bombard the Crossroads",
    description:
      "Walk shells across a likely approach, delaying any unit caught in the beaten zone.",
    flavour: "A crossroads is where every plan must pass; make it a place men avoid.",
    abilityClass: "action",
    skillsetId: "bombardier-kit",
    postId: "bombardier",
    mpCost: 10,
    chargeTime: 30,
    power: 70,
    range: 7,
    target: "tile",
    aoeShape: "cross",
    aoeSize: 2,
    element: "earth",
    inflicts: ["slow"],
    ap: 150,
  },

  "carcass-fire": {
    name: "Carcass Fire",
    description: "Fire an incendiary carcass that leaves a burning field and Bleeding wounds.",
    flavour: "Nothing clears a village street faster than a house already on fire.",
    abilityClass: "action",
    skillsetId: "bombardier-kit",
    postId: "bombardier",
    mpCost: 14,
    chargeTime: 40,
    power: 100,
    range: 6,
    aoeShape: "cross",
    aoeSize: 1,
    element: "fire",
    inflicts: ["poison"],
    ap: 180,
  },
});
