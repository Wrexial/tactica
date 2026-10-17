/**
 * Prussia — the disciplined shock action sets (mapping §3).
 *
 * Prussia is the drill-and-shock school: heavy line fire, armoured cavalry and
 * the assault column. Each post authors a complete action set; the
 * equipment-bound id `couched-charge` lives on the Lancer (`agents.md` §3, §9).
 */

import { parseAbilities } from "./shared";

export const PRUSSIA_ABILITIES = parseAbilities({
  /* ----- Line Grenadier (Warrior) -------------------------------------- */

  "heavy-volley": {
    name: "Heavy Volley",
    description: "A massed, close-range volley from the heaviest shoulder arms in the line.",
    flavour:
      "Prussian drill makes one musket sound like a hundred; the enemy cannot tell the difference.",
    abilityClass: "action",
    skillsetId: "line-grenadier-kit",
    postId: "line-grenadier",
    mpCost: 7,
    chargeTime: 25,
    power: 80,
    range: 4,
    aoeShape: "line",
    aoeSize: 1,
    element: "lightning",
    ap: 120,
  },

  "ground-the-arms": {
    name: "Ground the Arms",
    description: "Fix bayonets and close; heavy melee damage that ignores a defender's shield.",
    flavour: "The order is short and the work is not: at them with the bayonet.",
    abilityClass: "action",
    skillsetId: "line-grenadier-kit",
    postId: "line-grenadier",
    mpCost: 4,
    chargeTime: 10,
    power: 95,
    range: 1,
    ap: 110,
  },

  "hold-the-line": {
    name: "Hold the Line",
    description: "Brace the file against a charge; the bearer becomes Formed and Steadied.",
    flavour: "Discipline is standing still while everyone else decides to run.",
    abilityClass: "action",
    skillsetId: "line-grenadier-kit",
    postId: "line-grenadier",
    mpCost: 5,
    chargeTime: 15,
    power: 0,
    range: 0,
    target: "self",
    inflicts: ["protect", "regen"],
    ap: 110,
  },

  /* ----- Cuirassier (Defender) ----------------------------------------- */

  "armoured-charge": {
    name: "Armoured Charge",
    description:
      "Put the weight of horse and breastplate behind the charge; heavy damage and knock-back.",
    flavour: "Heavy enough to stop a sabre, heavy enough to break a square.",
    abilityClass: "action",
    skillsetId: "cuirassier-kit",
    postId: "cuirassier",
    mpCost: 8,
    chargeTime: 30,
    power: 100,
    range: 2,
    ap: 150,
  },

  "ride-them-down": {
    name: "Ride Them Down",
    description: "Trample a broken file, leaving survivors Pinned and their formation ruined.",
    flavour: "The cuirassier's business begins where the enemy's courage ends.",
    abilityClass: "action",
    skillsetId: "cuirassier-kit",
    postId: "cuirassier",
    mpCost: 9,
    chargeTime: 25,
    power: 85,
    range: 1,
    aoeShape: "cross",
    aoeSize: 1,
    inflicts: ["immobilize"],
    ap: 160,
  },

  "iron-wall": {
    name: "Iron Wall",
    description:
      "Present the breastplates as a moving wall, reducing incoming damage for the turn.",
    flavour: "Shot rattles off the cuirass like hail off a roof — until it finds the joints.",
    abilityClass: "action",
    skillsetId: "cuirassier-kit",
    postId: "cuirassier",
    mpCost: 6,
    chargeTime: 15,
    power: 0,
    range: 0,
    target: "self",
    inflicts: ["protect", "expertGuard"],
    ap: 140,
  },

  /* ----- Assault Pioneer (White Monk) ---------------------------------- */

  "pioneer-charge": {
    name: "Pioneer Charge",
    description: "A workman's assault with axe and bayonet, opening a way through obstacles.",
    flavour: "Sappers open what a battery cannot crack.",
    abilityClass: "action",
    skillsetId: "assault-pioneer-kit",
    postId: "assault-pioneer",
    mpCost: 6,
    chargeTime: 15,
    power: 85,
    range: 1,
    ap: 110,
  },

  "clear-the-works": {
    name: "Clear the Works",
    description: "Break apart earthworks and barricades, removing defensive cover from a tile.",
    flavour: "A parapet is only a pile of earth; a determined man with a spade can move it.",
    abilityClass: "action",
    skillsetId: "assault-pioneer-kit",
    postId: "assault-pioneer",
    mpCost: 7,
    chargeTime: 20,
    power: 60,
    range: 2,
    target: "tile",
    aoeShape: "cross",
    aoeSize: 1,
    element: "earth",
    inflicts: ["defense"],
    ap: 140,
  },

  "self-dressing": {
    name: "Self-Dressing",
    description:
      "Bind one's own wound in the lull of the assault, restoring hit points over the next turns.",
    flavour: "A pioneer is far from the surgeons; he learns to mend himself.",
    abilityClass: "action",
    skillsetId: "assault-pioneer-kit",
    postId: "assault-pioneer",
    mpCost: 6,
    chargeTime: 10,
    power: 0,
    range: 0,
    target: "self",
    inflicts: ["regen"],
    ap: 120,
  },

  /* ----- Chaplain (Bishop) --------------------------------------------- */

  "field-blessing": {
    name: "Field Blessing",
    description: "A short service that steadies the nearest allies and raises their faith.",
    flavour: "A prayer said in the mud reaches the same heaven as one said in a cathedral.",
    abilityClass: "action",
    skillsetId: "chaplain-kit",
    postId: "chaplain",
    mpCost: 8,
    chargeTime: 20,
    power: 0,
    range: 3,
    target: "ally",
    aoeShape: "cross",
    aoeSize: 1,
    element: "holy",
    inflicts: ["mresUp", "regen"],
    ap: 130,
  },

  "last-rites": {
    name: "Last Rites",
    description: "Commend the fallen and bring one fallen comrade back to the line.",
    flavour: "The chaplain is the last man to leave the field and the first to give it meaning.",
    abilityClass: "action",
    skillsetId: "chaplain-kit",
    postId: "chaplain",
    mpCost: 12,
    chargeTime: 35,
    power: 60,
    range: 2,
    target: "ally",
    element: "holy",
    ap: 180,
  },

  "steel-the-heart": {
    name: "Steel the Heart",
    description: "A rousing word that cures panic and grants a lasting Rally.",
    flavour: "Courage is a stock that rises when someone stands up and speaks.",
    abilityClass: "action",
    skillsetId: "chaplain-kit",
    postId: "chaplain",
    mpCost: 7,
    chargeTime: 15,
    power: 0,
    range: 3,
    target: "ally",
    element: "holy",
    cleanses: ["confuse", "charm", "berserk"],
    inflicts: ["boost"],
    ap: 150,
  },

  /* ----- Lancer (Dragoon) ---------------------------------------------- */

  "couched-charge": {
    name: "Couched Charge",
    description:
      "Couch the lance, drive the spurs home, and let the whole weight arrive at the point.",
    flavour: "Couched in a charge, a lance turns a rider into a single thunderbolt.",
    abilityClass: "action",
    skillsetId: "lancer-kit",
    postId: "lancer",
    mpCost: 7,
    chargeTime: 25,
    power: 110,
    range: 2,
    ap: 140,
  },

  "lance-point": {
    name: "Lance Point",
    description: "A thrust at reach that keeps the enemy outside its own blade range.",
    flavour: "The lance gives a man a yard of advantage, and a yard is most of a duel.",
    abilityClass: "action",
    skillsetId: "lancer-kit",
    postId: "lancer",
    mpCost: 5,
    chargeTime: 10,
    power: 80,
    range: 2,
    ap: 110,
  },

  "trot-to-gallop": {
    name: "Trot to Gallop",
    description:
      "Build the pace over two strides; the next charge arrives sooner and lands harder.",
    flavour: "A charge is not a sprint; it is a promise kept at increasing speed.",
    abilityClass: "action",
    skillsetId: "lancer-kit",
    postId: "lancer",
    mpCost: 6,
    chargeTime: 15,
    power: 0,
    range: 0,
    target: "self",
    inflicts: ["haste", "watkUp"],
    ap: 150,
  },

  /* ----- Shock Grenadier (Gladiator) ----------------------------------- */

  "shattering-blow": {
    name: "Shattering Blow",
    description:
      "A single overwhelming strike that breaks a target's guard and lowers its defence.",
    flavour: "The shock grenadier does not fence; he ends the conversation.",
    abilityClass: "action",
    skillsetId: "shock-grenadier-kit",
    postId: "shock-grenadier",
    mpCost: 9,
    chargeTime: 30,
    power: 130,
    range: 1,
    inflicts: ["defense"],
    ap: 170,
  },

  "all-out-attack": {
    name: "All Out Attack",
    description: "Abandon defence for one turn of maximum offensive pressure.",
    flavour: "Some men fight as if the battle is a personal insult.",
    abilityClass: "action",
    skillsetId: "shock-grenadier-kit",
    postId: "shock-grenadier",
    mpCost: 8,
    chargeTime: 20,
    power: 105,
    range: 1,
    inflicts: ["watkUp", "defense"],
    ap: 160,
  },

  "break-the-square": {
    name: "Break the Square",
    description: "A concentrated assault on a formed position that Punishes a packed defender.",
    flavour: "Infantry in square are safe from horse — until the grenadiers arrive on foot.",
    abilityClass: "action",
    skillsetId: "shock-grenadier-kit",
    postId: "shock-grenadier",
    mpCost: 10,
    chargeTime: 35,
    power: 115,
    range: 1,
    inflicts: ["immobilize"],
    ap: 190,
  },

  /* ----- Line Officer (Templar) ---------------------------------------- */

  "commanding-voice": {
    name: "Commanding Voice",
    description: "Bellow an order that hastens and heartens every ally within earshot.",
    flavour: "A voice that carries is worth more than a pair of colours.",
    abilityClass: "action",
    skillsetId: "line-officer-kit",
    postId: "line-officer",
    mpCost: 9,
    chargeTime: 20,
    power: 0,
    range: 4,
    target: "ally",
    aoeShape: "square",
    aoeSize: 2,
    inflicts: ["haste", "boost"],
    ap: 160,
  },

  "re-form": {
    name: "Re-Form",
    description:
      "Rebuild a broken formation, cleansing panic and restoring order to nearby allies.",
    flavour:
      "The line breaks in a heartbeat and is rebuilt in the next, if the officers are alive.",
    abilityClass: "action",
    skillsetId: "line-officer-kit",
    postId: "line-officer",
    mpCost: 8,
    chargeTime: 20,
    power: 0,
    range: 4,
    target: "ally",
    aoeShape: "cross",
    aoeSize: 1,
    cleanses: ["shaken", "slow", "addle"],
    inflicts: ["protect"],
    ap: 170,
  },

  "dressing-down": {
    name: "Dressing Down",
    description: "A public rebuke that strips an enemy officer's influence and lowers its attack.",
    flavour: "Some defeats are delivered in front of the whole regiment.",
    abilityClass: "action",
    skillsetId: "line-officer-kit",
    postId: "line-officer",
    mpCost: 7,
    chargeTime: 20,
    power: 0,
    range: 5,
    target: "enemy",
    inflicts: ["watkDown", "mpowDown"],
    ap: 170,
  },
});
