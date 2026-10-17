/**
 * Common posts — the shared action sets (mapping §3).
 *
 * The four common posts (Surgeon, Artilleryman, Forager, Staff Officer) are
 * open to every power. Each authors the core kit the FFTA job carried, plus the
 * power-specific signature action the mapping notes; the equipment-bound ids
 * `canister-shot` and `well-timed-order` live here (`agents.md` §3, §9).
 */

import { parseAbilities } from "./shared";

export const COMMON_ABILITIES = parseAbilities({
  /* ----- Surgeon (White Mage) ------------------------------------------ */

  "surgical-dressing": {
    name: "Surgical Dressing",
    description: "Clean, stitch and bandage a wounded comrade; restores hit points.",
    flavour: "Under the lantern's edge, the surgeon is worth more than a squadron.",
    abilityClass: "action",
    skillsetId: "surgeon-kit",
    postId: "surgeon",
    mpCost: 6,
    chargeTime: 15,
    power: 60,
    range: 3,
    target: "ally",
    ap: 100,
  },

  "restore-the-wounded": {
    name: "Restore the Wounded",
    description: "A full treatment that heals a cluster of allies and Steadies them.",
    flavour: "A dressing station behind the line saves more men than any counter-charge.",
    abilityClass: "action",
    skillsetId: "surgeon-kit",
    postId: "surgeon",
    mpCost: 10,
    chargeTime: 25,
    power: 80,
    range: 3,
    target: "ally",
    aoeShape: "cross",
    aoeSize: 1,
    inflicts: ["regen"],
    ap: 150,
  },

  "revive-casualty": {
    name: "Revive Casualty",
    description: "Bring a fallen soldier back to the line, bandaged and breathing.",
    flavour: "The surgeon is the only officer who undoes the enemy's work.",
    abilityClass: "action",
    skillsetId: "surgeon-kit",
    postId: "surgeon",
    mpCost: 14,
    chargeTime: 40,
    power: 70,
    range: 2,
    target: "ally",
    ap: 200,
  },

  "cleanse-ailment": {
    name: "Cleanse Ailment",
    description: "Purge a fever, a poison or a blinding smoke from an ally.",
    flavour: "Antidote, knife and clean water: most ailments never survive the surgeon's tent.",
    abilityClass: "action",
    skillsetId: "surgeon-kit",
    postId: "surgeon",
    mpCost: 8,
    chargeTime: 20,
    power: 0,
    range: 3,
    target: "ally",
    cleanses: ["poison", "blind", "silence"],
    ap: 140,
  },

  /* ----- Artilleryman (Black Mage) ------------------------------------- */

  "canister-shot": {
    name: "Canister Shot",
    description:
      "Load the piece with canister at close range; a cone of balls that leaves foes Dazed.",
    flavour: "At close range the canister turns the piece into a mouthful of nails.",
    abilityClass: "action",
    skillsetId: "artilleryman-kit",
    postId: "artilleryman",
    mpCost: 10,
    chargeTime: 30,
    power: 90,
    range: 4,
    aoeShape: "line",
    aoeSize: 1,
    element: "lightning",
    inflicts: ["blind"],
    ap: 200,
  },

  "solid-shot": {
    name: "Solid Shot",
    description: "A single iron round at long range; punches through ranks without bursting.",
    flavour: "One nine-pounder ball can take a file apart and keep going.",
    abilityClass: "action",
    skillsetId: "artilleryman-kit",
    postId: "artilleryman",
    mpCost: 8,
    chargeTime: 30,
    power: 85,
    range: 7,
    element: "earth",
    ap: 150,
  },

  "shell-fire": {
    name: "Shell Fire",
    description: "A fused shell that bursts over a target area, striking everyone beneath it.",
    flavour: "The shell is patient; it waits until it is exactly where it was sent.",
    abilityClass: "action",
    skillsetId: "artilleryman-kit",
    postId: "artilleryman",
    mpCost: 11,
    chargeTime: 35,
    power: 80,
    range: 6,
    target: "tile",
    aoeShape: "cross",
    aoeSize: 1,
    element: "fire",
    ap: 180,
  },

  /* ----- Forager (Thief) ----------------------------------------------- */

  "forage-supplies": {
    name: "Forage Supplies",
    description: "Scrounge powder, rations and coin from the battlefield and the enemy's stores.",
    flavour: "Armies march on their stomachs, and foragers know exactly whose stomach.",
    abilityClass: "action",
    skillsetId: "forager-kit",
    postId: "forager",
    mpCost: 5,
    chargeTime: 15,
    power: 0,
    range: 2,
    target: "enemy",
    ap: 110,
  },

  pillage: {
    name: "Pillage",
    description: "Strip a fallen or pinned foe of its kit, stealing a piece of equipment.",
    flavour: "The forager does not wait for the quartermaster; he improvises.",
    abilityClass: "action",
    skillsetId: "forager-kit",
    postId: "forager",
    mpCost: 7,
    chargeTime: 20,
    power: 60,
    range: 2,
    target: "enemy",
    inflicts: ["disable"],
    ap: 140,
  },

  "slip-away": {
    name: "Slip Away",
    description: "Break off the fight and vanish into the baggage train, becoming Concealed.",
    flavour: "A good forager knows every gap in the line, including the one he came through.",
    abilityClass: "action",
    skillsetId: "forager-kit",
    postId: "forager",
    mpCost: 5,
    chargeTime: 10,
    power: 0,
    range: 0,
    target: "self",
    inflicts: ["conceal", "haste"],
    ap: 100,
  },

  /* ----- Staff Officer (Time Mage) ------------------------------------- */

  "well-timed-order": {
    name: "Well-Timed Order",
    description: "Send a dispatch at exactly the right minute; an ally acts again sooner.",
    flavour: "An officer who knows the minute can order the charge a moment before the enemy.",
    abilityClass: "action",
    skillsetId: "staff-officer-kit",
    postId: "staff-officer",
    mpCost: 8,
    chargeTime: 20,
    power: 0,
    range: 4,
    target: "ally",
    inflicts: ["haste"],
    ap: 100,
  },

  "quick-march": {
    name: "Quick March",
    description:
      "Order the double-quick; nearby allies become Double-Quick and close the distance.",
    flavour: "The quick step is drilled until the whole line moves like one man.",
    abilityClass: "action",
    skillsetId: "staff-officer-kit",
    postId: "staff-officer",
    mpCost: 9,
    chargeTime: 20,
    power: 0,
    range: 4,
    target: "ally",
    aoeShape: "cross",
    aoeSize: 1,
    inflicts: ["haste", "boost"],
    ap: 150,
  },

  "delay-the-enemy": {
    name: "Delay the Enemy",
    description: "Falsify an order or burn a bridge; a foe is Bogged and its next action delayed.",
    flavour: "A few minutes bought at the right place is a battle won elsewhere.",
    abilityClass: "action",
    skillsetId: "staff-officer-kit",
    postId: "staff-officer",
    mpCost: 8,
    chargeTime: 25,
    power: 0,
    range: 5,
    target: "enemy",
    inflicts: ["slow", "stop"],
    ap: 170,
  },
});
