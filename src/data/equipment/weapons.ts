/**
 * Weapons and off-hand arms — the full weapon table (T090, T035, mapping §3).
 *
 * One **family per FFTA weapon class** drives the variant Steel formula in
 * `src/data/weapons.ts` (T035); this module authors several pieces per family so
 * every post's `weaponTypes` has real choice at every price band. The
 * off-hand table adds the shields and pistols that fill the `offhand` slot.
 *
 * ## Drill by kit
 *
 * Each `teaches` entry names an ability id authored in `src/data/abilities/`
 * and the **Drill** (AP) cost to master it from that item (T048). A weapon
 * teaches the drills its post could use, so the Fusilier's musket teaches
 * `volley-fire`, the Baker rifle teaches `aim-vitals`, and so on. Ids stay
 * FFTA-shaped; the display fields carry the Napoleonic fiction.
 *
 * ## Elements & on-hit conditions
 *
 * Mapping §7/§14/D9 keeps every "element" a mundane cause: artillery is
 * *Incendiary* (`fire`) or *Shock* (`lightning`), a sapper's mine is *Siege*
 * (`earth`), a signal staff is *Colours* (`holy`). Innate elements live on
 * weapons only; on-hit conditions use the FFTA-shaped condition ids from
 * `src/data/conditions.ts` (a rifled ball → `poison`/**Bleeding**, close
 * shellfire → `blind`/**Dazed**).
 *
 * ## Authored numbers
 *
 * Every cost, stat modifier and Drill cost below is **re-authored balance
 * data**, inspired by the scraped FFTA weapon tables
 * (`docs/wiki/pages/Final_Fantasy_Tactics_Advance_weapons.md`) but tuned for
 * detachment-scale play (`agents.md` §3, §10). No balance constant lives in
 * engine code.
 */

import { parseEquipment } from "./shared";

/**
 * Every weapon and off-hand item, keyed by its stable id and validated at
 * module load. Grouped by FFTA weapon family, ascending within each family.
 */
export const WEAPONS = parseEquipment({
  /* ----- Sabres (Saber) ------------------------------------------------ */

  "cavalry-sabre": {
    name: "Cavalry Sabre",
    description: "A light curved blade; +8 Steel, +2 Speed. Teaches Riposte (80 Drill).",
    flavour: "The trooper's sidearm: quick to the draw and quicker to the throat.",
    slot: "weapon",
    weaponType: "sabre",
    cost: 300,
    power: "france",
    stats: { atk: 8, spd: 2 },
    teaches: [{ abilityId: "riposte", ap: 80 }],
  },
  "light-sabre": {
    name: "Light Sabre",
    description:
      "A nimble blade for the skirmish line; +7 Steel, +3 Speed. Teaches Quick Parry (70 Drill).",
    flavour: "Light troops carry it because a fast cut beats a heavy one that never lands.",
    slot: "weapon",
    weaponType: "sabre",
    cost: 260,
    power: "britain",
    stats: { atk: 7, spd: 3 },
    teaches: [{ abilityId: "quick-parry", ap: 70 }],
  },
  "dragoon-sabre": {
    name: "Dragoon Sabre",
    description:
      "A soldier's blade, mounted or afoot; +10 Steel, +2 Speed. Teaches Sabre Cut (90 Drill).",
    flavour: "Dragoons fight from the saddle or on it, and their sabre does not care which.",
    slot: "weapon",
    weaponType: "sabre",
    cost: 420,
    power: "france",
    stats: { atk: 10, spd: 2 },
    teaches: [{ abilityId: "sabre-cut", ap: 90 }],
  },
  "officers-sabre": {
    name: "Officer's Sabre",
    description:
      "Gilt and well-balanced; +11 Steel, +1 Speed, +2 Powder. Teaches Fencing Lunge (110 Drill).",
    flavour: "An officer's blade is worn for the salutes and drawn for the charge.",
    slot: "weapon",
    weaponType: "sabre",
    cost: 560,
    power: "france",
    stats: { atk: 11, spd: 1, mag: 2 },
    teaches: [{ abilityId: "fencing-lunge", ap: 110 }],
  },
  "mameluke-scimitar": {
    name: "Mameluke Scimitar",
    description: "A curved eastern blade; +12 Steel, +3 Speed. Teaches Cut and Thrust (120 Drill).",
    flavour: "Taken from the East and carried back west, it cuts a wider, crueller arc.",
    slot: "weapon",
    weaponType: "sabre",
    cost: 720,
    power: "france",
    stats: { atk: 12, spd: 3 },
    teaches: [{ abilityId: "cut-and-thrust", ap: 120 }],
  },

  /* ----- Broadswords (Blade) ------------------------------------------- */

  "grenadier-broadsword": {
    name: "Grenadier Broadsword",
    description: "A heavy straight blade; +14 Steel, −2 Speed. Teaches Crushing Blow (120 Drill).",
    flavour: "The grenadiers favour the weight; one blow settles most arguments.",
    slot: "weapon",
    weaponType: "blade",
    cost: 520,
    power: "prussia",
    stats: { atk: 14, spd: -2 },
    teaches: [{ abilityId: "crushing-blow", ap: 120 }],
  },
  "line-broadsword": {
    name: "Line Broadsword",
    description: "A straight issue blade; +12 Steel. Teaches Break the Square (100 Drill).",
    flavour: "The line fights in a wall, and this is the wall's tooth.",
    slot: "weapon",
    weaponType: "blade",
    cost: 460,
    power: "prussia",
    stats: { atk: 12 },
    teaches: [{ abilityId: "break-the-square", ap: 100 }],
  },
  claymore: {
    name: "Claymore",
    description:
      "A basket-hilted broadsword; +15 Steel, +1 Speed. Teaches Shattering Blow (130 Drill).",
    flavour: "A highland charge comes on with the pipes, and ends with this.",
    slot: "weapon",
    weaponType: "blade",
    cost: 820,
    power: "britain",
    stats: { atk: 15, spd: 1 },
    teaches: [{ abilityId: "shattering-blow", ap: 130 }],
  },
  "executioners-blade": {
    name: "Executioner's Blade",
    description:
      "A grim two-handed cleaver; +17 Steel, −3 Speed. Teaches All-Out Attack (150 Drill).",
    flavour: "It was made for one job, and it does that job very well.",
    slot: "weapon",
    weaponType: "blade",
    cost: 980,
    power: "prussia",
    stats: { atk: 17, spd: -3 },
    teaches: [{ abilityId: "all-out-attack", ap: 150 }],
  },
  "naval-cutlass": {
    name: "Naval Cutlass",
    description: "A short, heavy boarding blade; +9 Steel, +2 Speed. Teaches Disengage (80 Drill).",
    flavour: "On a crowded deck, a long blade is a liability and a short one is a rescue.",
    slot: "weapon",
    weaponType: "blade",
    cost: 300,
    power: "britain",
    stats: { atk: 9, spd: 2 },
    teaches: [{ abilityId: "disengage", ap: 80 }],
  },

  /* ----- Lances -------------------------------------------------------- */

  "uhlan-lance": {
    name: "Uhlan Lance",
    description: "A long reach weapon; +12 Steel, +1 Speed. Teaches Couched Charge (140 Drill).",
    flavour: "Couched in a charge, a lance turns a rider into a single thunderbolt.",
    slot: "weapon",
    weaponType: "lance",
    cost: 640,
    power: "prussia",
    stats: { atk: 12, spd: 1 },
    teaches: [{ abilityId: "couched-charge", ap: 140 }],
  },
  "dragoon-lance": {
    name: "Dragoon Lance",
    description: "A serviceable all-round lance; +10 Steel. Teaches Lance Charge (110 Drill).",
    flavour: "The dragoon's lance is long enough to reach and short enough to carry all day.",
    slot: "weapon",
    weaponType: "lance",
    cost: 380,
    power: "france",
    stats: { atk: 10 },
    teaches: [{ abilityId: "lance-charge", ap: 110 }],
  },
  "heavy-lance": {
    name: "Heavy Lance",
    description:
      "A thick-shafted shock weapon; +15 Steel, −2 Speed. Teaches Armoured Charge (160 Drill).",
    flavour: "Breaking a square is not a fencing match; the lance goes through, or it breaks.",
    slot: "weapon",
    weaponType: "lance",
    cost: 760,
    power: "prussia",
    stats: { atk: 15, spd: -2 },
    teaches: [{ abilityId: "armoured-charge", ap: 160 }],
  },
  pike: {
    name: "Infantry Pike",
    description: "A long infantry spear; +8 Steel, −1 Speed. Teaches Lance Point (90 Drill).",
    flavour: "Old-fashioned, perhaps, but a hedge of pikes still stops a horse.",
    slot: "weapon",
    weaponType: "lance",
    cost: 160,
    power: "russia",
    stats: { atk: 8, spd: -1 },
    teaches: [{ abilityId: "lance-point", ap: 90 }],
  },

  /* ----- Muskets (Musket) --------------------------------------------- */

  "charleville-musket": {
    name: "Charleville Musket",
    description: "A smoothbore shoulder arm; +10 Steel. Teaches Volley Fire (100 Drill).",
    flavour: "Three ranks, one crashing volley — the Queen of Battles speaks.",
    slot: "weapon",
    weaponType: "musket",
    cost: 400,
    power: "france",
    stats: { atk: 10 },
    teaches: [{ abilityId: "volley-fire", ap: 100 }],
  },
  "land-pattern-musket": {
    name: "Land Pattern Musket",
    description: "The steady brown-bess pattern; +11 Steel. Teaches Bayonet Charge (90 Drill).",
    flavour: "Ugly, heavy and utterly reliable — much like the men who carry it.",
    slot: "weapon",
    weaponType: "musket",
    cost: 440,
    power: "britain",
    stats: { atk: 11 },
    teaches: [{ abilityId: "bayonet-charge", ap: 90 }],
  },
  "pattern-musket": {
    name: "Pattern Musket",
    description: "A fine-finished musket; +10 Steel, +1 Speed. Teaches Heavy Volley (110 Drill).",
    flavour: "Present, fire, reload — done well a thousand times, it never grows old.",
    slot: "weapon",
    weaponType: "musket",
    cost: 520,
    power: "britain",
    stats: { atk: 10, spd: 1 },
    teaches: [{ abilityId: "heavy-volley", ap: 110 }],
  },
  "potsdam-musket": {
    name: "Potsdam Musket",
    description:
      "Drilled-issue Prussian arm; +12 Steel, −1 Speed. Teaches Close Order (100 Drill).",
    flavour: "The Prussian musket is fired by the numbers, and the numbers never miss a beat.",
    slot: "weapon",
    weaponType: "musket",
    cost: 480,
    power: "prussia",
    stats: { atk: 12, spd: -1 },
    teaches: [{ abilityId: "close-order-drill", ap: 100 }],
  },
  "austrian-musket": {
    name: "Austrian Musket",
    description: "A reliable line arm; +9 Steel. Teaches Mixed Volley (90 Drill).",
    flavour: "White coats, steady files, and a musket that answers every time.",
    slot: "weapon",
    weaponType: "musket",
    cost: 360,
    power: "austria",
    stats: { atk: 9 },
    teaches: [{ abilityId: "mixed-volley", ap: 90 }],
  },

  /* ----- Carbines ------------------------------------------------------ */

  "light-carbine": {
    name: "Light Carbine",
    description: "A short firearm; +8 Steel, +3 Speed. Teaches Snap Shot (90 Drill).",
    flavour: "Light cavalry carry it slung; it answers fast in a running fight.",
    slot: "weapon",
    weaponType: "carbine",
    cost: 460,
    power: "austria",
    stats: { atk: 8, spd: 3 },
    teaches: [{ abilityId: "snap-shot", ap: 90 }],
  },
  "cavalry-carbine": {
    name: "Cavalry Carbine",
    description:
      "A short-barrelled horseman's piece; +9 Steel, +2 Speed. Teaches Dismounting Shot (80 Drill).",
    flavour: "One shot from the saddle, then the sabre has the argument.",
    slot: "weapon",
    weaponType: "carbine",
    cost: 420,
    power: "france",
    stats: { atk: 9, spd: 2 },
    teaches: [{ abilityId: "dismounting-shot", ap: 80 }],
  },
  "rifled-carbine": {
    name: "Rifled Carbine",
    description: "A short grooved barrel; +11 Steel, +2 Speed. Teaches Carbine Drill (100 Drill).",
    flavour: "Short, accurate and quick to shoulder — a skirmisher's best bargain.",
    slot: "weapon",
    weaponType: "carbine",
    cost: 700,
    power: "britain",
    stats: { atk: 11, spd: 2 },
    teaches: [{ abilityId: "carbine-drill", ap: 100 }],
  },

  /* ----- Rifles -------------------------------------------------------- */

  "baker-rifle": {
    name: "Baker Rifle",
    description:
      "A grooved barrel; +13 Steel, +2 Speed. Hits inflict Bleeding. Teaches Aim Vitals (150 Drill).",
    flavour: "A Baker rifle in still hands can pick a man from the enemy line.",
    slot: "weapon",
    weaponType: "rifle",
    cost: 900,
    power: "britain",
    stats: { atk: 13, spd: 2 },
    teaches: [{ abilityId: "aim-vitals", ap: 150 }],
    inflicts: ["poison"],
  },
  "rifled-piece": {
    name: "Rifled Piece",
    description: "A fine long arm; +15 Steel, +1 Speed. Teaches Long Shot (170 Drill).",
    flavour: "It takes a full minute to load, and rather less than that to end a battle.",
    slot: "weapon",
    weaponType: "rifle",
    cost: 1100,
    power: "britain",
    stats: { atk: 15, spd: 1 },
    teaches: [{ abilityId: "long-shot", ap: 170 }],
  },
  "jaeger-rifle": {
    name: "Jäger Rifle",
    description:
      "A huntsman's rifle in service green; +12 Steel, +2 Speed. Teaches Aimed Shot (130 Drill).",
    flavour: "The Jäger was a hunter before he was a soldier, and it shows.",
    slot: "weapon",
    weaponType: "rifle",
    cost: 820,
    power: "prussia",
    stats: { atk: 12, spd: 2 },
    teaches: [{ abilityId: "aimed-shot", ap: 130 }],
  },
  "hunters-rifle": {
    name: "Hunter's Rifle",
    description:
      "A French rifle for the chasseurs; +12 Steel, +2 Speed. Teaches Cold Ball (140 Drill).",
    flavour: "Fired once, from far enough away that the smoke is only a rumour.",
    slot: "weapon",
    weaponType: "rifle",
    cost: 860,
    power: "france",
    stats: { atk: 12, spd: 2 },
    teaches: [{ abilityId: "cold-ball", ap: 140 }],
  },

  /* ----- Bows (irregular / forester) ----------------------------------- */

  "forester-bow": {
    name: "Forester's Bow",
    description: "A drawn bow; +6 Steel, +2 Speed. Teaches Quiet Loosing (60 Drill).",
    flavour: "Irregulars and foresters still trust the bow when powder runs wet.",
    slot: "weapon",
    weaponType: "bow",
    cost: 120,
    stats: { atk: 6, spd: 2 },
    teaches: [{ abilityId: "quiet-loosing", ap: 60 }],
  },
  longbow: {
    name: "Longbow",
    description: "A yew warbow; +9 Steel, +1 Speed. Teaches Hunt the Trail (80 Drill).",
    flavour: "A hundred years out of date, and still silent where a musket would roar.",
    slot: "weapon",
    weaponType: "bow",
    cost: 180,
    power: "britain",
    stats: { atk: 9, spd: 1 },
    teaches: [{ abilityId: "hunt-the-trail", ap: 80 }],
  },
  "hunting-bow": {
    name: "Hunting Bow",
    description: "A light composite bow; +7 Steel, +3 Speed. Teaches Silent Ball (70 Drill).",
    flavour: "The scout's bow takes game, sentries, and no one's attention.",
    slot: "weapon",
    weaponType: "bow",
    cost: 150,
    power: "austria",
    stats: { atk: 7, spd: 3 },
    teaches: [{ abilityId: "silent-ball", ap: 70 }],
  },

  /* ----- Guns (ordnance) ----------------------------------------------- */

  "six-pounder": {
    name: "Six-Pounder Gun",
    description:
      "A served field piece; +18 Steel, −3 Speed. Attacks are Shock and inflict Dazed. Teaches Canister Shot (200 Drill).",
    flavour: "At close range the canister turns the piece into a mouthful of nails.",
    slot: "weapon",
    weaponType: "gun",
    cost: 1200,
    power: "russia",
    element: "lightning",
    stats: { atk: 18, spd: -3 },
    teaches: [{ abilityId: "canister-shot", ap: 200 }],
    inflicts: ["blind"],
  },
  "nine-pounder": {
    name: "Nine-Pounder Gun",
    description:
      "The workhorse field gun; +20 Steel, −4 Speed. Attacks are Shock. Teaches Solid Shot (180 Drill).",
    flavour: "A nine-pounder does not need to be lucky; it only needs to be pointed.",
    slot: "weapon",
    weaponType: "gun",
    cost: 1400,
    power: "france",
    element: "lightning",
    stats: { atk: 20, spd: -4 },
    teaches: [{ abilityId: "solid-shot", ap: 180 }],
  },
  howitzer: {
    name: "Howitzer",
    description:
      "A high-angle piece; +17 Steel, −2 Speed. Attacks are Incendiary. Teaches Shell Fire (190 Drill).",
    flavour: "The howitzer drops its argument behind a wall instead of against it.",
    slot: "weapon",
    weaponType: "gun",
    cost: 1100,
    power: "britain",
    element: "fire",
    stats: { atk: 17, spd: -2 },
    teaches: [{ abilityId: "shell-fire", ap: 190 }],
  },
  mortar: {
    name: "Mortar",
    description:
      "A siege weapon; +19 Steel, −4 Speed. Attacks are Siege. Teaches Battery Fire (210 Drill).",
    flavour: "Fieldworks are only safe from a mortar until someone carries one into range.",
    slot: "weapon",
    weaponType: "gun",
    cost: 1250,
    power: "russia",
    element: "earth",
    stats: { atk: 19, spd: -4 },
    teaches: [{ abilityId: "battery-fire", ap: 210 }],
  },
  "congreve-rocket": {
    name: "Congreve Rocket",
    description:
      "A rocket trough; +15 Steel, −1 Speed. Attacks are Incendiary. Teaches Case Shot (170 Drill).",
    flavour: "The rockets are as frightening as they are inaccurate, which is quite enough.",
    slot: "weapon",
    weaponType: "gun",
    cost: 980,
    power: "britain",
    element: "fire",
    stats: { atk: 15, spd: -1 },
    teaches: [{ abilityId: "case-shot", ap: 170 }],
  },
  "twelve-pounder": {
    name: "Twelve-Pounder Gun",
    description:
      "A heavy battery piece; +21 Steel, −4 Speed. Attacks are Shock. Teaches Grand Barrage (220 Drill).",
    flavour: "When the grand battery speaks, the whole line listens.",
    slot: "weapon",
    weaponType: "gun",
    cost: 1500,
    power: "france",
    element: "lightning",
    stats: { atk: 21, spd: -4 },
    teaches: [{ abilityId: "grand-barrage", ap: 220 }],
  },

  /* ----- Staves & signal kit ------------------------------------------- */

  "signal-staff": {
    name: "Signal Staff",
    description: "Flags, mirrors and rockets; +8 Powder, +4 Faith. Attacks are Colours.",
    flavour: "Flags, mirrors and rockets speak where the voice cannot reach.",
    slot: "weapon",
    weaponType: "staff",
    cost: 300,
    power: "russia",
    element: "holy",
    stats: { mag: 8, res: 4 },
    teaches: [{ abilityId: "signal-flare", ap: 110 }],
  },
  "map-case": {
    name: "Map Case",
    description:
      "Orders, charts and dividers; +6 Powder, +4 Faith. Teaches Well-Timed Order (100 Drill).",
    flavour: "A staff officer's whole war fits inside a leather tube.",
    slot: "weapon",
    weaponType: "staff",
    cost: 280,
    power: "britain",
    stats: { mag: 6, res: 4 },
    teaches: [{ abilityId: "well-timed-order", ap: 100 }],
  },
  "dispatch-case": {
    name: "Dispatch Case",
    description:
      "Sealed orders and a writing roll; +7 Powder, +3 Faith. Teaches Aide Order (90 Drill).",
    flavour: "The rider who carries the order can change a battle without firing a shot.",
    slot: "weapon",
    weaponType: "staff",
    cost: 320,
    power: "france",
    stats: { mag: 7, res: 3 },
    teaches: [{ abilityId: "aide-order", ap: 90 }],
  },
  "surveyors-staff": {
    name: "Surveyor's Staff",
    description:
      "A ranging rod and plane table; +5 Powder, +3 Faith, +2 Speed. Teaches Ranging Signal (100 Drill).",
    flavour: "Measure the ground twice, and the guns need only fire once.",
    slot: "weapon",
    weaponType: "staff",
    cost: 260,
    power: "austria",
    stats: { mag: 5, res: 3, spd: 2 },
    teaches: [{ abilityId: "ranging-signal", ap: 100 }],
  },

  /* ----- Instruments --------------------------------------------------- */

  "hunting-horn": {
    name: "Hunting Horn",
    description: "A call that directs troops and hounds; +6 Powder, +2 Steel.",
    flavour: "The horn carries further than any order shouted into the smoke.",
    slot: "weapon",
    weaponType: "instrument",
    cost: 260,
    power: "austria",
    stats: { mag: 6, atk: 2 },
    teaches: [{ abilityId: "call-hounds", ap: 90 }],
  },
  bugle: {
    name: "Bugle",
    description: "A brass field call; +5 Powder, +2 Speed. Teaches Horn Call (70 Drill).",
    flavour: "Every call has a meaning, and every soldier learns them before his letters.",
    slot: "weapon",
    weaponType: "instrument",
    cost: 160,
    power: "france",
    stats: { mag: 5, spd: 2 },
    teaches: [{ abilityId: "horn-call", ap: 70 }],
  },
  "regimental-drum": {
    name: "Regimental Drum",
    description:
      "A snare that sets the step; +5 Powder, +3 Faith. Teaches Commanding Voice (80 Drill).",
    flavour: "The drum beats the time, and the whole column moves as one man.",
    slot: "weapon",
    weaponType: "instrument",
    cost: 180,
    power: "prussia",
    stats: { mag: 5, res: 3 },
    teaches: [{ abilityId: "commanding-voice", ap: 80 }],
  },
  fife: {
    name: "Fife",
    description: "A shrill marching pipe; +4 Powder, +3 Speed. Teaches Quick March (60 Drill).",
    flavour: "Thin and piercing, the fife carries over the tramp of a thousand boots.",
    slot: "weapon",
    weaponType: "instrument",
    cost: 120,
    power: "britain",
    stats: { mag: 4, spd: 3 },
    teaches: [{ abilityId: "quick-march", ap: 60 }],
  },

  /* ----- Tools --------------------------------------------------------- */

  "sappers-tools": {
    name: "Sapper's Tools",
    description: "Picks, charges and wire; +9 Steel, +3 Speed. Attacks are Siege.",
    flavour: "A sapper's kit opens walls that a battery could not crack.",
    slot: "weapon",
    weaponType: "tool",
    cost: 540,
    power: "russia",
    element: "earth",
    stats: { atk: 9, spd: 3 },
    teaches: [{ abilityId: "charge-the-sap", ap: 130 }],
  },
  "pioneer-axe": {
    name: "Pioneer Axe",
    description:
      "A pioneer's axe and bill; +10 Steel, +1 Speed. Teaches Pioneer Charge (110 Drill).",
    flavour: "The pioneer clears the road, and woe to anything standing on it.",
    slot: "weapon",
    weaponType: "tool",
    cost: 360,
    power: "prussia",
    stats: { atk: 10, spd: 1 },
    teaches: [{ abilityId: "pioneer-charge", ap: 110 }],
  },
  "mining-tools": {
    name: "Mining Tools",
    description:
      "Spades, tamping irons and powder; +8 Steel, +2 Speed. Attacks are Siege. Teaches Undermine (120 Drill).",
    flavour: "A mine is a slow argument that ends with the ground opening.",
    slot: "weapon",
    weaponType: "tool",
    cost: 480,
    power: "russia",
    element: "earth",
    stats: { atk: 8, spd: 2 },
    teaches: [{ abilityId: "undermine", ap: 120 }],
  },
  "field-kit": {
    name: "Field Kit",
    description:
      "Tools and spares for any repair; +6 Steel, +3 Speed. Teaches Repair Works (90 Drill).",
    flavour: "A bridge repaired by dusk is worth a battalion by dawn.",
    slot: "weapon",
    weaponType: "tool",
    cost: 300,
    power: "britain",
    stats: { atk: 6, spd: 3 },
    teaches: [{ abilityId: "repair-works", ap: 90 }],
  },
  "gadget-case": {
    name: "Gadget Case",
    description:
      "Springs, screws and a hopeful inventor; +6 Powder, +2 Speed. Teaches Field Contraption (100 Drill).",
    flavour: "Half of what the engineer carries does nothing, and the other half works twice.",
    slot: "weapon",
    weaponType: "tool",
    cost: 420,
    power: "austria",
    stats: { mag: 6, spd: 2 },
    teaches: [{ abilityId: "field-contraption", ap: 100 }],
  },

  /* ----- Off-hand: shields --------------------------------------------- */

  "pavise-shield": {
    name: "Pavise Shield",
    description: "An off-hand shield; +8 Guard, +6 HP. Teaches Parry (70 Drill).",
    flavour: "In the press of a breach, the boss of a shield is as good as a sword.",
    slot: "offhand",
    weaponType: "shield",
    cost: 220,
    stats: { def: 8, hp: 6 },
    teaches: [{ abilityId: "parry", ap: 70 }],
  },
  "round-shield": {
    name: "Round Shield",
    description: "A light, round buckler; +6 Guard, +4 HP. Teaches Quick Parry (60 Drill).",
    flavour: "Small enough to carry over a long march, strong enough to matter.",
    slot: "offhand",
    weaponType: "shield",
    cost: 160,
    power: "britain",
    stats: { def: 6, hp: 4 },
    teaches: [{ abilityId: "quick-parry", ap: 60 }],
  },
  "tower-shield": {
    name: "Tower Shield",
    description:
      "A tall body shield; +12 Guard, +8 HP, −1 Speed. Teaches Guard the Flank (90 Drill).",
    flavour: "Set it down, stand behind it, and let the enemy exhaust himself against the wood.",
    slot: "offhand",
    weaponType: "shield",
    cost: 380,
    power: "prussia",
    stats: { def: 12, hp: 8, spd: -1 },
    teaches: [{ abilityId: "guard-the-flank", ap: 90 }],
  },
  buckler: {
    name: "Buckler",
    description: "A small fist shield; +4 Guard, +2 Speed. Teaches Iron Wall (80 Drill).",
    flavour: "It covers the heart and nothing else, which is usually the important part.",
    slot: "offhand",
    weaponType: "shield",
    cost: 120,
    power: "austria",
    stats: { def: 4, spd: 2 },
    teaches: [{ abilityId: "iron-wall", ap: 80 }],
  },

  /* ----- Off-hand: pistols --------------------------------------------- */

  "horse-pistol": {
    name: "Horse Pistol",
    description:
      "A heavy off-hand pistol; +6 Steel, +1 Speed. Teaches Dismounting Shot (80 Drill).",
    flavour: "One shot, close range, and the saddle is suddenly very empty.",
    slot: "offhand",
    weaponType: "gun",
    cost: 380,
    power: "france",
    stats: { atk: 6, spd: 1 },
    teaches: [{ abilityId: "dismounting-shot", ap: 80 }],
  },
  "duelling-pistol": {
    name: "Duelling Pistol",
    description: "A balanced off-hand piece; +7 Steel, +2 Speed. Teaches Snap Shot (80 Drill).",
    flavour: "Made for twenty paces and a formal apology, useful at any range at all.",
    slot: "offhand",
    weaponType: "gun",
    cost: 420,
    power: "britain",
    stats: { atk: 7, spd: 2 },
    teaches: [{ abilityId: "snap-shot", ap: 80 }],
  },
  "belt-pistol": {
    name: "Belt Pistol",
    description: "A sturdy service pistol; +5 Steel, +1 Speed. Teaches Close Order (60 Drill).",
    flavour: "The last argument at arm's length, and a heavy one.",
    slot: "offhand",
    weaponType: "gun",
    cost: 240,
    power: "russia",
    stats: { atk: 5, spd: 1 },
    teaches: [{ abilityId: "close-order-drill", ap: 60 }],
  },
});
