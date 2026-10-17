/**
 * Forbidding standing orders (T054, T093; mapping §9).
 *
 * A **forbidding Article** names an act the Provost Marshal has outlawed for the
 * day. Breaking it earns a **Reprimand** (Yellow) or, for the grave handful
 * authored at `severity: "court-martial"`, a **Court-Martial** (Red) on the
 * first offence (`src/engine/rules/articles.ts`, T056–T058).
 *
 * ## What an Article can forbid
 *
 * Each entry pairs a {@link ArticleTarget} with the concrete `keys` that name an
 * authored id of that class:
 *
 * | `target`    | `keys` name...                       |
 * | ----------- | ------------------------------------ |
 * | `action`    | an ability id (`canister-shot`)       |
 * | `element`   | an element key (`fire`)               |
 * | `weapon`    | a weapon family (`musket`, `rifle`)   |
 * | `post`      | a post id (`forager`, `surgeon`)      |
 * | `condition` | a condition id (`poison`, `regen`)    |
 * | `move`      | the `move` key — any movement at all  |
 * | `item`      | an equipment id used as an item       |
 *
 * The first four ids are the ids the rest of `src/data/` already uses, so a typo
 * is caught by the T054 test and by the content sweep (T094) rather than
 * silently disarming an order.
 *
 * ## Authored numbers
 *
 * `weight` biases the seeded daily draw (`T055`); grave Articles are
 * deliberately rarer (`0.5`). `severity` opens a Court-Martial on the first
 * breach. Every value here is **our own balance data**, inspired by the FFTA
 * law list (`docs/wiki/pages/Law_system_(Tactics_Advance).md`) but re-authored
 * for detachment-scale play (`agents.md` §3, §10).
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.** Content lives here; the engine imports
 *   *this*, never the reverse.
 * - **Validated at load.** Every entry is parsed with {@link parseArticles}.
 * - **No placeholders.** Every Article carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import { parseArticles } from "./shared";

/**
 * Every forbidding standing order, keyed by its stable id and validated at
 * module load. Ordered the way the pool is authored: the original T054 slice
 * first (so daily draws and menus keep a stable order), then the T093 expansion
 * grouped by target class.
 */
export const FORBID_ARTICLES = parseArticles({
  /* ----- The original T054 slice ---------------------------------------- */

  "no-canister-shot": {
    name: "No Case Shot",
    description:
      "Case and canister are forbidden today; firing case shot is a breach of the standing order.",
    flavour: "At close quarters the tin case is indiscriminate, and the colours always hear of it.",
    kind: "forbid",
    target: "action",
    keys: ["canister-shot"],
    weight: 0.75,
  },
  "no-couched-charge": {
    name: "No Couched Charge",
    description:
      "Lances are to be carried, not couched; charging home with the lance breaks the order.",
    flavour: "A couched lance is a fine thing on an open field and a scandal in a village street.",
    kind: "forbid",
    target: "action",
    keys: ["couched-charge"],
  },
  "no-fire": {
    name: "No Incendiary",
    description:
      "Burning shells and combustibles are forbidden; an Incendiary-typed action is a breach.",
    flavour: "The order is to take the town, not to leave it in ashes.",
    kind: "forbid",
    target: "element",
    keys: ["fire"],
  },
  "no-dark": {
    name: "No Terror",
    description:
      "Atrocity and deliberate terror are forbidden; a Terror-typed action invites a court-martial.",
    flavour: "We do not win by what the enemy fears we might become.",
    kind: "forbid",
    target: "element",
    keys: ["dark"],
    severity: "court-martial",
    weight: 0.5,
  },
  "no-rifle": {
    name: "No Rifle Fire",
    description: "The rifle is stood down today; an attack made with a rifle is a breach.",
    flavour: "The rifles load too slowly for the line that must hold the road today.",
    kind: "forbid",
    target: "weapon",
    keys: ["rifle"],
  },
  "no-sabre": {
    name: "No Sabre",
    description: "Cold steel is forbidden; an attack made with a sabre breaks the standing order.",
    flavour: "Today the matter is to be settled at range, not at the point.",
    kind: "forbid",
    target: "weapon",
    keys: ["sabre"],
  },
  "no-gun": {
    name: "No Artillery",
    description: "The guns stay limbered; an attack with an artillery piece breaks the order.",
    flavour: "The battery is needed at the crossroads, not in this affair.",
    kind: "forbid",
    target: "weapon",
    keys: ["gun"],
    weight: 0.75,
  },
  "no-forager": {
    name: "No Foraging",
    description: "Foraging is suspended; an action taken by a Forager breaks the standing order.",
    flavour: "Hungry horses and angry farmers lose more campaigns than any battery.",
    kind: "forbid",
    target: "post",
    keys: ["forager"],
  },
  "no-poison": {
    name: "No Poisoned Shot",
    description:
      "Poisoned or ragged shot is an outrage; an action that inflicts Bleeding is a court-martial offence.",
    flavour: "A ball is a soldier's death; a festering wound is a butcher's.",
    kind: "forbid",
    target: "condition",
    keys: ["poison"],
    severity: "court-martial",
    weight: 0.5,
  },
  "no-blind": {
    name: "No Blinding",
    description: "Deliberately blinding the enemy is forbidden; inflicting Dazed is a breach.",
    flavour: "A blinded man is no longer an enemy, only a burden.",
    kind: "forbid",
    target: "condition",
    keys: ["blind"],
  },

  /* ----- Expanded action orders ----------------------------------------- */

  "no-grenade": {
    name: "No Grenades",
    description: "Grenades are to be kept slung; lobbing a grenade breaks the standing order.",
    flavour: "The colonel will not have the company blown to pieces by its own pioneers.",
    kind: "forbid",
    target: "action",
    keys: ["grenade-lob"],
  },
  "no-bayonet": {
    name: "No Bayonet",
    description: "The bayonet stays fixed but unblooded; a bayonet charge is a breach today.",
    flavour: "They are to be pushed back, not butchered at the fence line.",
    kind: "forbid",
    target: "action",
    keys: ["bayonet-charge"],
  },
  "no-bombardment": {
    name: "No Bombardment",
    description:
      "The heavy guns are silent; calling a bombardment down on the position breaks the order.",
    flavour: "The town is to be occupied, and you cannot occupy a ruin.",
    kind: "forbid",
    target: "action",
    keys: ["bombard-the-crossroads"],
    weight: 0.75,
  },
  "no-pillage": {
    name: "No Pillage",
    description:
      "Looting the field is a court-martial offence; any action that pillages invites a Red Card.",
    flavour: "An army that robs the people it came to save has already lost the country.",
    kind: "forbid",
    target: "action",
    keys: ["pillage"],
    severity: "court-martial",
    weight: 0.5,
  },
  "no-assassination": {
    name: "No Assassination",
    description:
      "Striking at an officer out of the line is forbidden; an assassination is an immediate court-martial.",
    flavour: "We fight the regiment, not the man wearing its coat.",
    kind: "forbid",
    target: "action",
    keys: ["assassinate"],
    severity: "court-martial",
    weight: 0.5,
  },
  "no-foreign-drill": {
    name: "No Foreign Drill",
    description:
      "Copying enemy methods is forbidden; an action that mimics foreign drill breaks the order.",
    flavour: "Their way of fighting is not ours to borrow on a parade ground.",
    kind: "forbid",
    target: "action",
    keys: ["foreign-drill"],
  },

  /* ----- Expanded element orders ---------------------------------------- */

  "no-shock": {
    name: "No Concussion",
    description: "Concussive blast is forbidden; a Shock-typed action breaks the standing order.",
    flavour: "The surgeons have enough broken heads without the gunners adding to them.",
    kind: "forbid",
    target: "element",
    keys: ["lightning"],
    weight: 0.75,
  },
  "no-smoke": {
    name: "No Smoke",
    description: "Smoke screens are forbidden; a Smoke-typed action breaks the standing order.",
    flavour: "Blinding the field blinds our own centre as surely as the enemy's.",
    kind: "forbid",
    target: "element",
    keys: ["wind"],
  },
  "no-deluge": {
    name: "No Deluge",
    description: "Flooding the ground is forbidden; a Deluge-typed action breaks the order.",
    flavour: "A drowned road is a road we shall have to march down tomorrow.",
    kind: "forbid",
    target: "element",
    keys: ["water"],
  },
  "no-siege": {
    name: "No Siege Work",
    description: "Mining and siege charges are forbidden; a Siege-typed action breaks the order.",
    flavour: "The walls are to be held, not brought down about our own ears.",
    kind: "forbid",
    target: "element",
    keys: ["earth"],
  },

  /* ----- Expanded weapon orders ----------------------------------------- */

  "no-cold-steel": {
    name: "No Broadswords",
    description: "The broadsword is stood down; an attack made with a blade breaks the order.",
    flavour: "Heavy blades are for the breach, and today there is no breach.",
    kind: "forbid",
    target: "weapon",
    keys: ["blade"],
  },
  "no-lance": {
    name: "No Lance",
    description: "The lance is forbidden in the streets; an attack made with a lance is a breach.",
    flavour: "A lance in a lane takes friend and foe impartially.",
    kind: "forbid",
    target: "weapon",
    keys: ["lance"],
  },
  "no-bow": {
    name: "No Bow",
    description: "The bow is out of favour today; an attack made with a bow breaks the order.",
    flavour: "The partisans will grumble, but the order stands.",
    kind: "forbid",
    target: "weapon",
    keys: ["bow"],
  },

  /* ----- Expanded post orders ------------------------------------------- */

  "no-cavalry": {
    name: "No Horse",
    description: "The horse is to stay held; an action taken by a Hussar breaks the standing order.",
    flavour: "Cavalry in a firefight is a liability, not a reserve.",
    kind: "forbid",
    target: "post",
    keys: ["hussar"],
  },
  "no-sapper": {
    name: "No Sapping",
    description: "Sapping is suspended; an action taken by a Sapper breaks the standing order.",
    flavour: "We are not here to dig them out, only to hold what we have.",
    kind: "forbid",
    target: "post",
    keys: ["sapper"],
  },

  /* ----- Expanded condition orders -------------------------------------- */

  "no-cripple": {
    name: "No Crippling",
    description: "Deliberately crippling the enemy is forbidden; inflicting Pinned is a breach.",
    flavour: "A man who cannot walk is a charge on the enemy and on us alike.",
    kind: "forbid",
    target: "condition",
    keys: ["immobilize"],
  },
  "no-madness": {
    name: "No Confusion",
    description: "Drugging or confounding the enemy is forbidden; inflicting Bewildered is a breach.",
    flavour: "We want their wits about them when they see our colours come on.",
    kind: "forbid",
    target: "condition",
    keys: ["confuse"],
  },

  /* ----- Movement and item orders --------------------------------------- */

  "no-withdrawal": {
    name: "No Retreat",
    description: "The line holds where it stands; any movement that gives ground breaks the order.",
    flavour: "The ground behind us is the ground we cannot afford to lose.",
    kind: "forbid",
    target: "move",
    keys: ["move"],
  },
  "no-strong-drink": {
    name: "No Strong Drink",
    description: "The grog ration is stopped; using a flask of spirits breaks the standing order.",
    flavour: "A company that drinks before the volley fires wild and pays for it.",
    kind: "forbid",
    target: "item",
    keys: ["brandy-flask"],
  },
});
