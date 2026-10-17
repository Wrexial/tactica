import { describe, expect, it } from "vitest";

import {
  POST_KEYS,
  POST_LIST,
  POSTS,
  canTakePost,
  commonPosts,
  getPost,
  isPostKey,
  meetsPostRequirement,
  meetsPostRequirements,
  postsForPower,
  unlockablePosts,
  type MasteredByPost,
  type PostKey,
} from "../../src/data/posts";
import {
  EQUIP_SLOTS,
  POWER_KEYS,
  PostDefSchema,
  WEAPON_TYPES,
  type PowerKey,
} from "../../src/data/schema";

/* --------------------------------------------------------------------------
 * T046 / T047 — Post (job) definitions & the authored power role trees
 *
 * Pins the tasks' "done when":
 *   - T046: every {@link PostDef} carries a **power restriction**, **stat
 *     growth**, **usable kit** (equip slots + weapon families), **skill sets**
 *     and **unlock requirements**.
 *   - T047: all five powers and their role trees are authored, with **≥ 25
 *     posts** whose **names come from mapping §3**.
 *
 * The authored roster lives under `src/data/posts/` (one module per power plus
 * the common posts). These tests check the data is complete, well-formed,
 * grounded in the reference tables, and that the pure helpers (power gating,
 * unlock gating) behave.
 * ------------------------------------------------------------------------ */

/** The Napoleonic names mapping §3 assigns to each authored post. */
const NAPOLEONIC_NAMES: Record<PostKey, string> = {
  // France (Hume)
  fusilier: "Fusilier",
  grenadier: "Grenadier",
  marksman: "Marksman",
  "colour-guard": "Colour Guard",
  hussar: "Hussar",
  chasseur: "Chasseur",
  "intelligence-officer": "Intelligence Officer",
  bombardier: "Bombardier",
  // Britain (Viera)
  rifleman: "Rifleman",
  sharpshooter: "Sharpshooter",
  sabreur: "Sabreur",
  adjutant: "Adjutant",
  rocketeer: "Rocketeer",
  "long-rifle": "Long Rifle",
  commodore: "Commodore",
  // Prussia (Bangaa)
  "line-grenadier": "Line Grenadier",
  cuirassier: "Cuirassier",
  "assault-pioneer": "Assault Pioneer",
  chaplain: "Chaplain",
  lancer: "Lancer",
  "shock-grenadier": "Shock Grenadier",
  "line-officer": "Line Officer",
  // Russia (Nu mou)
  partisan: "Partisan",
  sapper: "Sapper",
  signaller: "Signaller",
  impersonator: "Impersonator",
  "master-gunner": "Master Gunner",
  // Austria (Moogle)
  scout: "Scout",
  gunner: "Fusilier",
  "mog-knight": "Lancer",
  juggler: "Grenadier",
  engineer: "Engineer",
  // Common
  surgeon: "Surgeon",
  artilleryman: "Artilleryman",
  forager: "Forager",
  "staff-officer": "Staff Officer",
};

/** The home-school posts per power (excluding the shared posts). */
const POWER_EXCLUSIVE: Record<PowerKey, readonly PostKey[]> = {
  france: [
    "fusilier",
    "grenadier",
    "marksman",
    "colour-guard",
    "hussar",
    "chasseur",
    "intelligence-officer",
    "bombardier",
  ],
  britain: [
    "rifleman",
    "sharpshooter",
    "sabreur",
    "adjutant",
    "rocketeer",
    "long-rifle",
    "commodore",
  ],
  prussia: [
    "line-grenadier",
    "cuirassier",
    "assault-pioneer",
    "chaplain",
    "lancer",
    "shock-grenadier",
    "line-officer",
  ],
  russia: ["partisan", "sapper", "signaller", "impersonator", "master-gunner"],
  austria: ["scout", "gunner", "mog-knight", "juggler", "engineer"],
};

/** The four shared posts from mapping §3. */
const COMMON_POST_KEYS: readonly PostKey[] = [
  "surgeon",
  "artilleryman",
  "forager",
  "staff-officer",
];

/** The seven stats a post's growth table covers (FFTA job-table columns). */
const GROWTH_STAT_KEYS = ["hp", "mp", "atk", "def", "mag", "res", "spd"] as const;

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

/** The authored first-tier unlock chains, mirroring FFTA's "2× post abilities". */
const UNLOCK_CHAINS: ReadonlyArray<readonly [PostKey, PostKey, number]> = [
  ["grenadier", "fusilier", 2],
  ["marksman", "fusilier", 2],
  ["sharpshooter", "rifleman", 2],
  ["cuirassier", "line-grenadier", 2],
  ["engineer", "forager", 2],
  ["sapper", "partisan", 2],
  ["mog-knight", "gunner", 2],
];

/* --------------------------------------------------------------------------
 * Roster integrity
 * ------------------------------------------------------------------------ */

describe("authored posts (data/posts)", () => {
  it("authors the canonical roster in the documented order", () => {
    expect(POST_LIST).toHaveLength(POST_KEYS.length);
    expect(POST_LIST.map((post) => post.id)).toEqual([...POST_KEYS]);
    expect(Object.keys(POSTS)).toHaveLength(POST_KEYS.length);
    expect(new Set(POST_KEYS).size).toBe(POST_KEYS.length);
  });

  it("authors at least 25 posts across all five powers (T047)", () => {
    expect(POST_LIST.length).toBeGreaterThanOrEqual(25);
    for (const power of POWER_KEYS) {
      expect(
        POWER_EXCLUSIVE[power].length,
        `${power} needs a role tree of at least five posts`,
      ).toBeGreaterThanOrEqual(5);
    }
  });

  it("covers all five great-power military schools", () => {
    const powers = new Set(POST_LIST.map((post) => post.power));
    for (const power of POWER_KEYS) {
      expect(powers.has(power), `no post for ${power}`).toBe(true);
    }
  });

  it("round-trips every post through PostDefSchema untouched", () => {
    for (const id of POST_KEYS) {
      expect(PostDefSchema.parse(POSTS[id])).toEqual(POSTS[id]);
    }
  });

  it("carries the mapping §3 Napoleonic name for every post", () => {
    for (const id of POST_KEYS) {
      const post = POSTS[id];
      expect(post.name).toBe(NAPOLEONIC_NAMES[id]);
      for (const field of ["name", "description", "flavour"] as const) {
        const text = post[field];
        expect(text.trim(), `${id}.${field}`).not.toBe("");
        expect(hasPlaceholder(text), `${id}.${field} has a placeholder`).toBe(false);
      }
    }
  });

  it("keeps the FFTA-shaped id but a Napoleonic display name", () => {
    expect(POSTS.fusilier.id).toBe("fusilier");
    expect(POSTS.rifleman.name).toBe("Rifleman");
    expect(POSTS.rifleman.name).not.toBe("Archer");
    expect(POSTS["line-grenadier"].name).toBe("Line Grenadier");
    // Distinct FFTA jobs may share a mapping name; the ids stay unique.
    expect(POSTS.gunner.name).toBe("Fusilier");
    expect(POSTS.gunner.id).toBe("gunner");
    expect(POSTS.juggler.name).toBe("Grenadier");
    expect(POSTS["mog-knight"].name).toBe("Lancer");
  });

  it("marks exactly the four shared posts as common", () => {
    expect(commonPosts().map((post) => post.id)).toEqual([...COMMON_POST_KEYS]);
    for (const post of POST_LIST) {
      expect(post.common, post.id).toBe((COMMON_POST_KEYS as readonly string[]).includes(post.id));
    }
  });

  it("assigns every exclusive post to its mapping power", () => {
    for (const power of POWER_KEYS) {
      for (const id of POWER_EXCLUSIVE[power]) {
        expect(POSTS[id].power, `${id} should belong to ${power}`).toBe(power);
        expect(POSTS[id].common, `${id} should not be common`).toBe(false);
      }
    }
  });
});

/* --------------------------------------------------------------------------
 * Power restriction
 * ------------------------------------------------------------------------ */

describe("power restriction", () => {
  it("returns only a power's own posts plus the common posts", () => {
    for (const power of POWER_KEYS) {
      const posts = postsForPower(power);
      expect(posts.length).toBeGreaterThan(0);
      for (const post of posts) {
        expect(post.power === power || post.common, `${post.id} for ${power}`).toBe(true);
      }
      // Every power can access the shared posts.
      for (const common of COMMON_POST_KEYS) {
        expect(
          posts.some((post) => post.id === common),
          `${common} for ${power}`,
        ).toBe(true);
      }
      // And every one of its own exclusive posts.
      for (const exclusive of POWER_EXCLUSIVE[power]) {
        expect(
          posts.some((post) => post.id === exclusive),
          `${exclusive} for ${power}`,
        ).toBe(true);
      }
    }
  });

  it("never offers another school's exclusive post", () => {
    const britain = postsForPower("britain").map((post) => post.id);
    expect(britain).toContain("rifleman");
    expect(britain).not.toContain("fusilier");
    expect(britain).not.toContain("partisan");

    for (const power of POWER_KEYS) {
      const offered = new Set(postsForPower(power).map((post) => post.id));
      for (const [otherPower, ids] of Object.entries(POWER_EXCLUSIVE) as ReadonlyArray<
        [PowerKey, readonly PostKey[]]
      >) {
        if (otherPower === power) continue;
        for (const id of ids) {
          expect(offered.has(id), `${power} should not hold ${id} (${otherPower})`).toBe(false);
        }
      }
    }
  });

  it("gates a post by home school or the common flag", () => {
    expect(canTakePost("fusilier", "france")).toBe(true);
    expect(canTakePost("fusilier", "britain")).toBe(false);
    expect(canTakePost("surgeon", "britain")).toBe(true);
    expect(canTakePost("surgeon", "russia")).toBe(true);
  });
});

/* --------------------------------------------------------------------------
 * Usable kit
 * ------------------------------------------------------------------------ */

describe("usable kit", () => {
  it("declares at least one equip slot drawn from the canonical slots", () => {
    for (const post of POST_LIST) {
      expect(post.equipSlots.length, `${post.id} has no equip slots`).toBeGreaterThan(0);
      for (const slot of post.equipSlots) {
        expect(EQUIP_SLOTS).toContain(slot);
      }
      expect(new Set(post.equipSlots).size).toBe(post.equipSlots.length);
    }
  });

  it("declares at least one weapon family drawn from the canonical families", () => {
    for (const post of POST_LIST) {
      expect(post.weaponTypes.length, `${post.id} has no weapon families`).toBeGreaterThan(0);
      for (const weaponType of post.weaponTypes) {
        expect(WEAPON_TYPES).toContain(weaponType);
      }
      expect(new Set(post.weaponTypes).size).toBe(post.weaponTypes.length);
    }
  });

  it("gives each post a kit fitting its role", () => {
    expect(POSTS.fusilier.weaponTypes).toContain("musket");
    expect(POSTS.rifleman.weaponTypes).toEqual(["rifle"]);
    expect(POSTS.artilleryman.weaponTypes).toEqual(["gun"]);
    expect(POSTS["staff-officer"].weaponTypes).toEqual(["staff"]);
    expect(POSTS["shock-grenadier"].weaponTypes).toContain("blade");
    expect(POSTS.commodore.weaponTypes).toContain("instrument");
    // Shoulder-arms troops do not fill an off-hand slot.
    expect(POSTS.rifleman.equipSlots).not.toContain("offhand");
    // Melee-capable troops can.
    expect(POSTS.grenadier.equipSlots).toContain("offhand");
    expect(POSTS["colour-guard"].weaponTypes).toContain("shield");
  });
});

/* --------------------------------------------------------------------------
 * Stat growth
 * ------------------------------------------------------------------------ */

describe("stat growth", () => {
  it("carries exactly the seven growing stats as finite non-negative numbers", () => {
    for (const post of POST_LIST) {
      expect(Object.keys(post.growth).sort()).toEqual([...GROWTH_STAT_KEYS].sort());
      for (const key of GROWTH_STAT_KEYS) {
        const value = post.growth[key];
        expect(Number.isFinite(value), `${post.id}.${key}`).toBe(true);
        expect(value, `${post.id}.${key}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("matches the authored growth table for representative posts", () => {
    // Re-authored from the FFTA job tables (docs/wiki/pages/..._jobs.md): the
    // Soldier, Warrior, Nu mou Time Mage and Moogle Gadgeteer profiles.
    expect(POSTS.fusilier.growth).toEqual({
      hp: 8.4,
      mp: 1.1,
      atk: 8.8,
      def: 8.8,
      mag: 6.0,
      res: 7.2,
      spd: 1.1,
    });
    expect(POSTS["line-grenadier"].growth.hp).toBe(9.2);
    expect(POSTS["staff-officer"].growth.mag).toBe(10.2);
    expect(POSTS.engineer.growth.res).toBe(10.2);
    expect(POSTS["shock-grenadier"].growth.atk).toBe(9.8);
  });

  it("gives each power at least one post with a distinct growth identity", () => {
    // Fast roles out-speed the heavy ones; gunners out-cast the liners.
    expect(POSTS.hussar.growth.spd).toBeGreaterThan(POSTS.fusilier.growth.spd);
    expect(POSTS["master-gunner"].growth.mag).toBeGreaterThan(POSTS["line-grenadier"].growth.mag);
    expect(POSTS["shock-grenadier"].growth.hp).toBeGreaterThan(POSTS.sharpshooter.growth.hp);
  });
});

/* --------------------------------------------------------------------------
 * Skill sets
 * ------------------------------------------------------------------------ */

describe("skill sets", () => {
  it("gives every post at least one skillset with a stable, clean id", () => {
    for (const post of POST_LIST) {
      expect(post.skillsetIds.length, `${post.id} has no skillset`).toBeGreaterThan(0);
      expect(new Set(post.skillsetIds).size).toBe(post.skillsetIds.length);
      for (const skillsetId of post.skillsetIds) {
        expect(skillsetId.trim()).not.toBe("");
        expect(skillsetId).not.toMatch(/\s/);
        expect(skillsetId.endsWith("-kit")).toBe(true);
      }
    }
  });

  it("names each post's own kit after the post", () => {
    for (const id of POST_KEYS) {
      expect(POSTS[id].skillsetIds).toContain(`${id}-kit`);
    }
  });
});

/* --------------------------------------------------------------------------
 * Unlock requirements
 * ------------------------------------------------------------------------ */

describe("unlock requirements", () => {
  it("only ever names a known post, and never itself", () => {
    for (const post of POST_LIST) {
      for (const requirement of post.requires) {
        expect(isPostKey(requirement.postId), `${post.id} -> ${requirement.postId}`).toBe(true);
        expect(requirement.postId).not.toBe(post.id);
        expect(requirement.abilities).toBeGreaterThan(0);
      }
    }
  });

  it("has an acyclic prerequisite graph (every tree is enterable)", () => {
    const visiting = new Set<PostKey>();
    const done = new Set<PostKey>();

    function visit(id: PostKey): void {
      if (done.has(id)) return;
      expect(visiting.has(id), `cycle at ${id}`).toBe(false);
      visiting.add(id);
      for (const requirement of POSTS[id].requires) {
        visit(requirement.postId as PostKey);
      }
      visiting.delete(id);
      done.add(id);
    }

    for (const id of POST_KEYS) visit(id);
  });

  it("gives every power at least one starting post with no prerequisites", () => {
    for (const power of POWER_KEYS) {
      const starters = postsForPower(power).filter((post) => post.requires.length === 0);
      expect(starters.length, `${power} has no starting post`).toBeGreaterThan(0);
    }
  });

  it("authors the first-tier unlock chains from the mapping", () => {
    for (const [postId, requiredPost, abilities] of UNLOCK_CHAINS) {
      expect(POSTS[postId].requires, postId).toEqual([{ postId: requiredPost, abilities }]);
    }
    // Starting posts have no prerequisites.
    expect(POSTS.fusilier.requires).toEqual([]);
    expect(POSTS.rifleman.requires).toEqual([]);
    expect(POSTS.sabreur.requires).toEqual([]);
    expect(POSTS.partisan.requires).toEqual([]);
    expect(POSTS.scout.requires).toEqual([]);
  });

  it("counts mastered abilities per post", () => {
    const requirement = { postId: "fusilier", abilities: 2 };
    expect(meetsPostRequirement(requirement, {})).toBe(false);
    expect(meetsPostRequirement(requirement, { fusilier: ["a"] })).toBe(false);
    expect(meetsPostRequirement(requirement, { fusilier: ["a", "b"] })).toBe(true);
    expect(meetsPostRequirement(requirement, { fusilier: ["a", "b", "c"] })).toBe(true);
  });

  it("requires every prerequisite to be satisfied", () => {
    const grenadier = POSTS.grenadier;
    expect(meetsPostRequirements(grenadier, {})).toBe(false);
    expect(meetsPostRequirements(grenadier, { fusilier: ["a", "b"] })).toBe(true);
  });

  it("gates secondary posts behind mastery in unlockablePosts", () => {
    const empty: MasteredByPost = {};
    const franceEmpty = unlockablePosts("france", empty).map((post) => post.id);
    expect(franceEmpty).toContain("fusilier");
    expect(franceEmpty).not.toContain("grenadier");

    const franceDrilled = unlockablePosts("france", { fusilier: ["a", "b"] }).map(
      (post) => post.id,
    );
    expect(franceDrilled).toContain("grenadier");
    expect(franceDrilled).toContain("marksman");
    expect(franceDrilled).not.toContain("colour-guard"); // needs three

    // Another power's post is never offered even with the right drill.
    const britain = unlockablePosts("britain", { fusilier: ["a", "b"] }).map((post) => post.id);
    expect(britain).not.toContain("grenadier");
  });
});

/* --------------------------------------------------------------------------
 * Lookups & purity
 * ------------------------------------------------------------------------ */

describe("lookups", () => {
  it("accepts canonical keys and rejects everything else", () => {
    for (const id of POST_KEYS) {
      expect(isPostKey(id)).toBe(true);
    }
    for (const value of ["soldier", "Fusilier", "", 1, null, undefined, {}]) {
      expect(isPostKey(value), String(value)).toBe(false);
    }
  });

  it("returns the authored definition and throws on unknown ids", () => {
    expect(getPost("rifleman")).toBe(POSTS.rifleman);
    expect(() => getPost("soldier" as PostKey)).toThrow(RangeError);
  });

  it("reads power queries deterministically", () => {
    const first = postsForPower("prussia").map((post) => post.id);
    const second = postsForPower("prussia").map((post) => post.id);
    expect(first).toEqual(second);
    expect(first).toContain("line-grenadier");
    expect(first).toContain("cuirassier");
  });
});

/* --------------------------------------------------------------------------
 * The `PowerKey` type is re-used by the roster
 * ------------------------------------------------------------------------ */

describe("power typing", () => {
  it("keeps every post on one of the five schools", () => {
    for (const post of POST_LIST) {
      const power: PowerKey = post.power;
      expect(POWER_KEYS).toContain(power);
    }
  });
});
