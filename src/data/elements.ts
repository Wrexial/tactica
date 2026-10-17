/**
 * The eight reflavoured elements (T038, mapping §7 / decision D5).
 *
 * FFTA keeps eight elements — Fire, Ice, Lightning, Earth, Water, Wind, Holy and
 * Dark. The retheme keeps all eight (mapping §14, "8 reflavoured elements") and
 * re-authors each as a **mundane cause** rather than a literal spell
 * (mapping §7, §14 D9: "no literal magic ... keep the mechanical effect, change
 * the cause"):
 *
 * | FFTA      | Tactica     | In-world cause                                   |
 * | --------- | ----------- | ------------------------------------------------ |
 * | Fire      | Incendiary  | Shells, fire ships, burning combustibles         |
 * | Ice       | Cold        | Winter, frost, attrition                         |
 * | Lightning | Shock       | Concussion, close artillery, blast               |
 * | Earth     | Siege       | Mines, earthworks, falling masonry               |
 * | Water     | Deluge      | Rivers, naval gunnery, soaked powder             |
 * | Wind      | Smoke       | Obscuration, dispersal, choking smoke            |
 * | Holy      | Colours     | Regimental colours, inspiration, blessing         |
 * | Dark      | Terror      | Atrocity, dread, collapse of nerve               |
 *
 * The **element id stays the FFTA key** (`fire`, `holy`, ...) so engine formulas
 * and the reference mirror map 1:1; the `name` carries the Napoleonic reading
 * (`src/data/README.md`, mapping §1). Affinities (weak / resist / immune /
 * absorb) live on the combatant, not here — see
 * `src/engine/rules/elements.ts` (T038) for the damage modification those
 * affinities apply.
 *
 * ## Opposition cycle
 *
 * Each element names a single `opposedTo` partner. The cycle is the familiar
 * tactical-series pairing, rethemed: Incendiary ↔ Cold, Shock ↔ Deluge,
 * Siege ↔ Smoke and Colours ↔ Terror. Content may read it with
 * {@link opposedElement} / {@link isOpposedTo} to author natural weaknesses
 * without repeating the whole affinity map on every enemy.
 *
 * Design contracts (`agents.md` §2, §3, §9; `src/data/README.md`):
 * - **Static data, no engine import.** Content lives here; the engine imports
 *   *this*, never the reverse.
 * - **Validated at load.** Every entry is parsed with {@link ElementDefSchema},
 *   so a malformed element fails loudly rather than skewing a battle.
 * - **No placeholders.** Every element carries an authored Napoleonic `name`,
 *   `description` and `flavour` (mapping §14, D6/D8).
 */

import { ELEMENT_KEYS, ElementDefSchema, type ElementDef, type ElementKey } from "./schema";

/* --------------------------------------------------------------------------
 * The table
 * ------------------------------------------------------------------------ */

/**
 * Unparsed element data. Typed against every {@link ElementKey} so the compiler
 * rejects a missing or extra element; parsed into {@link ELEMENTS} below.
 */
const ELEMENT_DATA = {
  fire: {
    name: "Incendiary",
    description:
      "Burning shells, fire ships and combustibles that cling to a target and punish packed ranks.",
    flavour: "A howitzer shell turns a farmhouse into a furnace in a matter of minutes.",
    opposedTo: "ice",
  },
  ice: {
    name: "Cold",
    description:
      "Bitter frost and the slow attrition of winter; saps strength and numbs the blood.",
    flavour: "The Russian winter has broken more armies than any battery ever massed.",
    opposedTo: "fire",
  },
  lightning: {
    name: "Shock",
    description: "Concussive blast and the numbing punch of close artillery.",
    flavour: "The ground jumps, and a man's wits leave him before the smoke does.",
    opposedTo: "water",
  },
  earth: {
    name: "Siege",
    description: "Mines, earthworks and falling masonry; the crushing weight of the ground itself.",
    flavour: "A sap charged beneath a bastion lifts the whole wall in a single breath.",
    opposedTo: "wind",
  },
  water: {
    name: "Deluge",
    description: "Flood, soaked powder and the drag of rivers in spate.",
    flavour: "Wet cartridge and rising water halt an army faster than any cavalry charge.",
    opposedTo: "lightning",
  },
  wind: {
    name: "Smoke",
    description: "Billowing powder smoke and driving wind that blind, scatter and choke.",
    flavour: "Two volleys and no one can see the colours through the fog of war.",
    opposedTo: "earth",
  },
  holy: {
    name: "Colours",
    description:
      "The regimental colours and the morale they inspire; steadies allies and sears the faithless.",
    flavour: "Eyes on the standard: while it flies, the line holds.",
    opposedTo: "dark",
  },
  dark: {
    name: "Terror",
    description: "Atrocity, dread and the collapse of nerve in the face of the unthinkable.",
    flavour: "Some positions are carried by what the enemy believes you will do next.",
    opposedTo: "holy",
  },
} satisfies Record<ElementKey, Omit<ElementDef, "id">>;

/**
 * Every element, keyed by the stable FFTA id and validated at module load.
 * Read this instead of branching on element ids anywhere in the engine.
 */
export const ELEMENTS: Record<ElementKey, ElementDef> = Object.fromEntries(
  Object.entries(ELEMENT_DATA).map(([id, def]) => [id, ElementDefSchema.parse({ id, ...def })]),
) as Record<ElementKey, ElementDef>;

/**
 * The elements in their canonical FFTA display order (`ELEMENT_KEYS`). Handy for
 * menus, bestiary entries and tests that need a stable iteration order.
 */
export const ELEMENT_LIST: readonly ElementDef[] = ELEMENT_KEYS.map((id) => ELEMENTS[id]);

/* --------------------------------------------------------------------------
 * Lookups
 * ------------------------------------------------------------------------ */

/** Look up an element's authored definition. Throws on an unknown id. */
export function getElement(id: ElementKey): ElementDef {
  const element = ELEMENTS[id];
  if (element === undefined) {
    throw new RangeError(`unknown element: ${String(id)}`);
  }
  return element;
}

/**
 * The element `id` is opposed to, if its definition names one. Incendiary is
 * opposed to Cold, Shock to Deluge, Siege to Smoke and Colours to Terror.
 */
export function opposedElement(id: ElementKey): ElementKey | undefined {
  return getElement(id).opposedTo;
}

/**
 * `true` when `attacker` is the element naturally opposed to `defender`'s own
 * element (for example Incendiary striking a Cold-aligned unit). Content uses
 * this to derive a weakness when authoring an enemy's affinities.
 */
export function isOpposedTo(attacker: ElementKey, defender: ElementKey): boolean {
  return getElement(defender).opposedTo === attacker;
}
