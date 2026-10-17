/**
 * Commended acts (T054, T093; mapping §5, §9).
 *
 * A **commending Article** names an act the Provost Marshal recommends for the
 * day. Performing it grants **Honour** (FFTA JP, mapping §5) rather than a card,
 * and the daily draw makes only a few such acts available at once so the reward
 * rotates with the campaign date (`src/engine/rules/honour.ts`, T060).
 *
 * A commending Article uses exactly the same matching rules as a forbidding one
 * — a {@link ArticleTarget} plus the `keys` that name an authored id of that
 * class — so a single action can break one order and earn another. The
 * `honour` field is the JP granted; it is always greater than zero (the T054
 * test pins that).
 *
 * ## Authored numbers
 *
 * `honour` and `weight` are **our own balance data**, inspired by FFTA's
 * Judge-recommended acts (`docs/wiki/pages/Judge_Points.md`,
 * `docs/wiki/pages/Law_system_(Tactics_Advance).md`) but re-authored for
 * detachment-scale play (`agents.md` §3, §10). `weight` biases the seeded daily
 * draw; the signature line orders carry the heavier weights.
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.**
 * - **Validated at load.** Every entry is parsed with {@link parseArticles}.
 * - **No placeholders.** Every Article carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import { parseArticles } from "./shared";

/**
 * Every commended act, keyed by its stable id and validated at module load.
 * Ordered the way the pool is authored: the original T054 slice first, then the
 * T093 expansion grouped by target class.
 */
export const COMMEND_ARTICLES = parseArticles({
  /* ----- The original T054 slice ---------------------------------------- */

  "commend-volley-fire": {
    name: "Commended: Volley Fire",
    description: "Massed fire is the order of the day; the Volley Fire action earns Honour.",
    flavour: "Three ranks, one crash: the old way, and still the best.",
    kind: "commend",
    target: "action",
    keys: ["volley-fire"],
    honour: 2,
    weight: 2,
  },
  "commend-parry": {
    name: "Commended: Parry",
    description: "Discipline in the press is rewarded; a successful Parry earns Honour.",
    flavour: "A cool head and a raised guard save more men than a charge.",
    kind: "commend",
    target: "action",
    keys: ["parry"],
    honour: 1,
  },
  "commend-colours": {
    name: "Commended: Colours",
    description: "Actions that rally the line are rewarded; a Colours-typed action earns Honour.",
    flavour: "While the standard flies, the line holds.",
    kind: "commend",
    target: "element",
    keys: ["holy"],
    honour: 3,
    weight: 0.75,
  },
  "commend-musket": {
    name: "Commended: Musket",
    description: "The musket line is favoured today; an attack made with a musket earns Honour.",
    flavour: "The smoothbore is the army's true voice.",
    kind: "commend",
    target: "weapon",
    keys: ["musket"],
    honour: 1,
    weight: 2,
  },
  "commend-surgeon": {
    name: "Commended: Surgery",
    description: "Mercy is the order; an action taken by a Surgeon earns Honour.",
    flavour: "Every man saved is a man who will fight again.",
    kind: "commend",
    target: "post",
    keys: ["surgeon"],
    honour: 2,
  },
  "commend-steadied": {
    name: "Commended: Steady",
    description:
      "Keeping the line on its feet is rewarded; an action that grants Steadied earns Honour.",
    flavour: "A steady file is worth a fresh regiment.",
    kind: "commend",
    target: "condition",
    keys: ["regen"],
    honour: 1,
  },

  /* ----- Expanded action commendations ---------------------------------- */

  "commend-reform": {
    name: "Commended: Re-form",
    description: "Closing up under fire is rewarded; the Re-form action earns Honour.",
    flavour: "A line that closes its gaps is telling the enemy it is not finished.",
    kind: "commend",
    target: "action",
    keys: ["re-form"],
    honour: 2,
  },
  "commend-rally": {
    name: "Commended: Rally",
    description: "Calling the shaken back to the colours is rewarded; Rally Round earns Honour.",
    flavour: "One voice the men trust is worth a squadron of dragoons.",
    kind: "commend",
    target: "action",
    keys: ["rally-round"],
    honour: 2,
  },
  "commend-steady-line": {
    name: "Commended: Steady the Line",
    description: "Steadying the rank is rewarded; the Steady the Line action earns Honour.",
    flavour: "The order is not to be brave, only to stand.",
    kind: "commend",
    target: "action",
    keys: ["steady-the-line"],
    honour: 1,
  },
  "commend-hold-line": {
    name: "Commended: Hold the Line",
    description: "Refusing to yield is rewarded; the Hold the Line action earns Honour.",
    flavour: "Holding is a decision made once and kept for hours.",
    kind: "commend",
    target: "action",
    keys: ["hold-the-line"],
    honour: 1,
  },

  /* ----- Expanded weapon commendations ---------------------------------- */

  "commend-carbine": {
    name: "Commended: Carbine",
    description: "The carbine is favoured in the press; an attack with a carbine earns Honour.",
    flavour: "Short, handy and honest: the light horseman's true weapon.",
    kind: "commend",
    target: "weapon",
    keys: ["carbine"],
    honour: 1,
  },

  /* ----- Expanded post commendations ------------------------------------ */

  "commend-artillery": {
    name: "Commended: Gunnery",
    description: "Good practice with the guns is rewarded; an action taken by an Artilleryman earns Honour.",
    flavour: "A battery that finds its range quickly wins the half-hour that decides the day.",
    kind: "commend",
    target: "post",
    keys: ["artilleryman"],
    honour: 2,
  },
  "commend-chasseur": {
    name: "Commended: Chasseurs",
    description: "The skirmish line is favoured; an action taken by a Chasseur earns Honour.",
    flavour: "The chasseurs are the eyes and the sting of the column.",
    kind: "commend",
    target: "post",
    keys: ["chasseur"],
    honour: 2,
  },
  "commend-marksman": {
    name: "Commended: Marksmanship",
    description: "Careful shooting is rewarded; an action taken by a Marksman earns Honour.",
    flavour: "One aimed shot is worth a file's worth of powder.",
    kind: "commend",
    target: "post",
    keys: ["marksman"],
    honour: 2,
  },
  "commend-engineer": {
    name: "Commended: Engineering",
    description: "Field works are rewarded; an action taken by an Engineer earns Honour.",
    flavour: "Entrenchments are the cheapest soldiers in any army.",
    kind: "commend",
    target: "post",
    keys: ["engineer"],
    honour: 2,
  },

  /* ----- Expanded condition commendations ------------------------------- */

  "commend-formed": {
    name: "Commended: Formed",
    description: "Closing ranks is rewarded; an action that grants Formed earns Honour.",
    flavour: "A formed body of men is a wall no skirmish line can walk through.",
    kind: "commend",
    target: "condition",
    keys: ["protect"],
    honour: 1,
  },
  "commend-braced": {
    name: "Commended: Braced",
    description: "Steeling the men against fire is rewarded; an action that grants Braced earns Honour.",
    flavour: "Shellfire breaks the body; discipline keeps the mind from following.",
    kind: "commend",
    target: "condition",
    keys: ["shell"],
    honour: 1,
  },
  "commend-double-quick": {
    name: "Commended: Double-Quick",
    description: "Speed on the field is rewarded; an action that grants Double-Quick earns Honour.",
    flavour: "The side that gets there first may fight from the better ground.",
    kind: "commend",
    target: "condition",
    keys: ["haste"],
    honour: 1,
  },

  /* ----- Item commendation ---------------------------------------------- */

  "commend-field-kit": {
    name: "Commended: Field Kit",
    description: "Keeping the company equipped is rewarded; using a field kit earns Honour.",
    flavour: "An army marches on its stomach and fights out of its knapsack.",
    kind: "commend",
    target: "item",
    keys: ["field-kit"],
    honour: 1,
  },
});
