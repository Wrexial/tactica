import { describe, expect, it } from "vitest";

import { CONDITION_KEYS } from "../../src/data/conditions";
import {
  EQUIPMENT,
  EQUIPMENT_KEYS,
  EQUIPMENT_LIST,
  equipmentForSlot,
  getEquipment,
  isElementalOrAfflicting,
  isEquipmentKey,
  statsOf,
  teachesAbility,
  type EquipmentKey,
} from "../../src/data/equipment";
import {
  ELEMENT_KEYS,
  EQUIP_SLOTS,
  EquipmentDefSchema,
  POWER_KEYS,
  WEAPON_TYPES,
} from "../../src/data/schema";

/* --------------------------------------------------------------------------
 * T050 — Equipment model
 *
 * Pins the task's "done when": weapons, uniforms/armour and accessories with
 * **stat mods**, **taught abilities (Drill cost)**, **elements** and **on-hit
 * conditions**. The authored kit lives in `src/data/equipment.ts`; these tests
 * check the registry is complete and well-formed, then exercise the pure
 * lookups.
 * ------------------------------------------------------------------------ */

/** Markers that mean "content not authored yet" (checked case-insensitively). */
const PLACEHOLDER_PATTERNS: readonly RegExp[] = [
  /\bTBD\b/i,
  /\bTBC\b/i,
  /\bTODO\b/i,
  /\bFIXME\b/i,
  /\bXXX\b/i,
  /\bplaceholder\b/i,
  /lorem\s+ipsum/i,
  /\?{3,}/,
];

function hasPlaceholder(text: string): boolean {
  return PLACEHOLDER_PATTERNS.some((re) => re.test(text));
}

/** The nine stat keys every parsed modifier block carries. */
const STAT_KEYS = ["hp", "mp", "atk", "def", "mag", "res", "spd", "move", "jump"] as const;

/** Representative items the tests pin by hand. */
const SAMPLE: Readonly<Record<string, EquipmentKey>> = {
  sabre: "cavalry-sabre",
  rifle: "baker-rifle",
  gun: "six-pounder",
  armour: "cuirass",
  head: "shako",
  accessory: "spyglass",
};

/* --------------------------------------------------------------------------
 * Registry integrity
 * ------------------------------------------------------------------------ */

describe("authored equipment (data/equipment)", () => {
  it("authors the canonical kit in the documented order", () => {
    expect(EQUIPMENT_LIST).toHaveLength(EQUIPMENT_KEYS.length);
    expect(EQUIPMENT_LIST.map((item) => item.id)).toEqual([...EQUIPMENT_KEYS]);
    expect(Object.keys(EQUIPMENT)).toHaveLength(EQUIPMENT_KEYS.length);
    expect(new Set(EQUIPMENT_KEYS).size).toBe(EQUIPMENT_KEYS.length);
  });

  it("authors weapons, uniforms/armour, headgear and accessories", () => {
    expect(EQUIPMENT_LIST.length).toBeGreaterThanOrEqual(20);
    for (const slot of EQUIP_SLOTS) {
      expect(
        equipmentForSlot(slot).length,
        `no authored kit for the ${slot} slot`,
      ).toBeGreaterThan(0);
    }
  });

  it("round-trips every item through EquipmentDefSchema untouched", () => {
    for (const id of EQUIPMENT_KEYS) {
      expect(EquipmentDefSchema.parse(EQUIPMENT[id])).toEqual(EQUIPMENT[id]);
    }
  });

  it("carries authored Napoleonic text on every item", () => {
    for (const id of EQUIPMENT_KEYS) {
      const item = EQUIPMENT[id];
      for (const field of ["name", "description", "flavour"] as const) {
        const text = item[field];
        expect(text.trim(), `${id}.${field}`).not.toBe("");
        expect(hasPlaceholder(text), `${id}.${field} has a placeholder`).toBe(false);
      }
    }
  });

  it("keeps the FFTA-shaped id but a Napoleonic display name", () => {
    expect(EQUIPMENT["baker-rifle"].id).toBe("baker-rifle");
    expect(EQUIPMENT["baker-rifle"].name).toBe("Baker Rifle");
    expect(EQUIPMENT["charleville-musket"].name).toBe("Charleville Musket");
    expect(EQUIPMENT["six-pounder"].name).toBe("Six-Pounder Gun");
  });
});

/* --------------------------------------------------------------------------
 * Slots & weapon families
 * ------------------------------------------------------------------------ */

describe("slots & weapon families", () => {
  it("uses only canonical equip slots", () => {
    for (const item of EQUIPMENT_LIST) {
      expect(EQUIP_SLOTS, item.id).toContain(item.slot);
    }
  });

  it("declares a weapon family on every weapon/off-hand item, and only there", () => {
    for (const item of EQUIPMENT_LIST) {
      if (item.slot === "weapon" || item.slot === "offhand") {
        expect(item.weaponType, `${item.id} needs a weapon family`).toBeDefined();
        expect(WEAPON_TYPES).toContain(item.weaponType);
      } else {
        expect(item.weaponType, `${item.id} should not be a weapon`).toBeUndefined();
      }
    }
  });

  it("covers every weapon family (T035)", () => {
    const covered = new Set(
      EQUIPMENT_LIST.filter((item) => item.weaponType !== undefined).map(
        (item) => item.weaponType,
      ),
    );
    for (const weaponType of WEAPON_TYPES) {
      expect(covered.has(weaponType), `no kit uses the ${weaponType} family`).toBe(true);
    }
  });

  it("gives each role-fitting item its expected family and slot", () => {
    expect(EQUIPMENT[SAMPLE.sabre].weaponType).toBe("sabre");
    expect(EQUIPMENT["baker-rifle"].weaponType).toBe("rifle");
    expect(EQUIPMENT["six-pounder"].weaponType).toBe("gun");
    expect(EQUIPMENT["pavise-shield"].slot).toBe("offhand");
    expect(EQUIPMENT["pavise-shield"].weaponType).toBe("shield");
    expect(EQUIPMENT.cuirass.slot).toBe("armour");
    expect(EQUIPMENT.shako.slot).toBe("head");
    expect(EQUIPMENT.spyglass.slot).toBe("accessory");
  });

  it("reads a slot deterministically", () => {
    const first = equipmentForSlot("armour").map((item) => item.id);
    const second = equipmentForSlot("armour").map((item) => item.id);
    expect(first).toEqual(second);
    expect(first).toContain("cuirass");
    expect(first).not.toContain("baker-rifle");
  });
});

/* --------------------------------------------------------------------------
 * Stat modifiers
 * ------------------------------------------------------------------------ */

describe("stat modifiers", () => {
  it("gives every item a full, integer stat block", () => {
    for (const item of EQUIPMENT_LIST) {
      expect(Object.keys(item.stats).sort()).toEqual([...STAT_KEYS].sort());
      for (const key of STAT_KEYS) {
        expect(Number.isInteger(item.stats[key]), `${item.id}.${key}`).toBe(true);
      }
    }
  });

  it("gives every item at least one meaningful modifier", () => {
    for (const item of EQUIPMENT_LIST) {
      const total = STAT_KEYS.reduce((sum, key) => sum + Math.abs(item.stats[key]), 0);
      expect(total, `${item.id} modifies nothing`).toBeGreaterThan(0);
    }
  });

  it("matches the authored modifiers for representative kit", () => {
    expect(EQUIPMENT["baker-rifle"].stats).toMatchObject({ atk: 13, spd: 2 });
    expect(EQUIPMENT.cuirass.stats).toMatchObject({ def: 16, hp: 8, spd: -2 });
    expect(EQUIPMENT["powder-flask"].stats.mp).toBe(12);
    expect(EQUIPMENT["water-canteen"].stats).toMatchObject({ hp: 10, res: 2 });
  });

  it("exposes stat modifiers through statsOf without mutation", () => {
    const first = statsOf("cuirass");
    const second = statsOf("cuirass");
    expect(first).toEqual(second);
    expect(first.def).toBe(16);
    // The helper returns the stored block, not a fresh copy, so callers cannot
    // silently drift: mutating it would be a data bug, not a runtime one.
    expect(first).toBe(EQUIPMENT.cuirass.stats);
  });
});

/* --------------------------------------------------------------------------
 * Taught abilities (Drill cost)
 * ------------------------------------------------------------------------ */

describe("taught abilities (Drill by kit)", () => {
  it("binds abilities to kit with a positive Drill cost", () => {
    let authored = 0;
    for (const item of EQUIPMENT_LIST) {
      const seen = new Set<string>();
      for (const teach of item.teaches) {
        expect(teach.abilityId.trim(), `${item.id} teaching`).not.toBe("");
        expect(teach.abilityId).not.toMatch(/\s/);
        expect(Number.isInteger(teach.ap), `${item.id} -> ${teach.abilityId}`).toBe(true);
        expect(teach.ap, `${item.id} -> ${teach.abilityId}`).toBeGreaterThan(0);
        expect(seen.has(teach.abilityId), `${item.id} teaches ${teach.abilityId} twice`).toBe(
          false,
        );
        seen.add(teach.abilityId);
        authored += 1;
      }
    }
    expect(authored).toBeGreaterThanOrEqual(10);
  });

  it("matches the authored Drill costs for representative kit", () => {
    expect(teachesAbility("charleville-musket", "volley-fire")).toEqual({
      abilityId: "volley-fire",
      ap: 100,
    });
    expect(teachesAbility("baker-rifle", "aim-vitals")?.ap).toBe(150);
    expect(teachesAbility("six-pounder", "canister-shot")?.ap).toBe(200);
    expect(teachesAbility("pavise-shield", "parry")?.ap).toBe(70);
  });

  it("returns undefined when the item does not teach the ability", () => {
    expect(teachesAbility("baker-rifle", "volley-fire")).toBeUndefined();
    expect(teachesAbility("cuirass", "parry")).toBeUndefined();
  });
});

/* --------------------------------------------------------------------------
 * Elements & on-hit conditions
 * ------------------------------------------------------------------------ */

describe("elements", () => {
  it("uses only the eight reflavoured element keys", () => {
    for (const item of EQUIPMENT_LIST) {
      if (item.element === undefined) continue;
      expect(ELEMENT_KEYS, item.id).toContain(item.element);
    }
  });

  it("keeps innate elements on weapons only", () => {
    for (const item of EQUIPMENT_LIST) {
      if (item.slot === "weapon" || item.slot === "offhand") continue;
      expect(item.element, `${item.id} should not carry an element`).toBeUndefined();
    }
  });

  it("maps each elemental weapon to its reflavoured cause (mapping §7)", () => {
    expect(EQUIPMENT["six-pounder"].element).toBe("lightning"); // Shock / concussion
    expect(EQUIPMENT["congreve-rocket"].element).toBe("fire"); // Incendiary
    expect(EQUIPMENT["signal-staff"].element).toBe("holy"); // Colours
    expect(EQUIPMENT["sappers-tools"].element).toBe("earth"); // Siege
  });
});

describe("on-hit conditions (mapping §8)", () => {
  it("inflicts only known, FFTA-shaped condition ids", () => {
    for (const item of EQUIPMENT_LIST) {
      for (const conditionId of item.inflicts) {
        expect(
          (CONDITION_KEYS as readonly string[]).includes(conditionId),
          `${item.id} inflicts unknown condition ${conditionId}`,
        ).toBe(true);
      }
    }
  });

  it("matches the authored on-hit conditions for representative kit", () => {
    expect(EQUIPMENT["baker-rifle"].inflicts).toEqual(["poison"]); // Bleeding
    expect(EQUIPMENT["six-pounder"].inflicts).toEqual(["blind"]); // Dazed
  });

  it("flags elemental or afflicting kit", () => {
    expect(isElementalOrAfflicting("baker-rifle")).toBe(true); // inflicts
    expect(isElementalOrAfflicting("six-pounder")).toBe(true); // element + inflicts
    expect(isElementalOrAfflicting("signal-staff")).toBe(true); // element only
    expect(isElementalOrAfflicting("cuirass")).toBe(false);
  });
});

/* --------------------------------------------------------------------------
 * Cost & power
 * ------------------------------------------------------------------------ */

describe("cost & power", () => {
  it("gives every item a non-negative Crowns cost or null (unique kit)", () => {
    for (const item of EQUIPMENT_LIST) {
      if (item.cost === null) continue;
      expect(Number.isInteger(item.cost), item.id).toBe(true);
      expect(item.cost, item.id).toBeGreaterThanOrEqual(0);
    }
  });

  it("assigns power discounts only from the five schools", () => {
    for (const item of EQUIPMENT_LIST) {
      if (item.power === undefined) continue;
      expect(POWER_KEYS, item.id).toContain(item.power);
    }
  });

  it("leaves common kit without a power discount", () => {
    expect(EQUIPMENT["campaign-shirt"].power).toBeUndefined();
    expect(EQUIPMENT["forage-cap"].power).toBeUndefined();
    expect(EQUIPMENT["water-canteen"].power).toBeUndefined();
  });

  it("matches the authored costs for representative kit", () => {
    expect(EQUIPMENT["baker-rifle"].cost).toBe(900);
    expect(EQUIPMENT.cuirass.cost).toBe(700);
    expect(EQUIPMENT["pavise-shield"].cost).toBe(220);
  });
});

/* --------------------------------------------------------------------------
 * Lookups & purity
 * ------------------------------------------------------------------------ */

describe("lookups", () => {
  it("accepts canonical keys and rejects everything else", () => {
    for (const id of EQUIPMENT_KEYS) {
      expect(isEquipmentKey(id)).toBe(true);
    }
    for (const value of ["sabre", "Baker Rifle", "", 1, null, undefined, {}]) {
      expect(isEquipmentKey(value), String(value)).toBe(false);
    }
  });

  it("returns the authored definition and throws on unknown ids", () => {
    expect(getEquipment("baker-rifle")).toBe(EQUIPMENT["baker-rifle"]);
    expect(() => getEquipment("musket" as EquipmentKey)).toThrow(RangeError);
  });
});
