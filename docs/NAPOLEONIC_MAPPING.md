# Napoleonic retheme — FFTA → Tactica mapping

This document maps **every FFTA system and data table** we scraped onto a
**Napoleonic Wars-era** setting. It is the design contract for the retheme: if a
FFTA concept exists, it should appear here with a Napoleonic equivalent.

> **Premise (working):** The player commands a **free company** (a hired
> "corps") in a Europe torn apart by the Napoleonic Wars. The company recruits
> specialists from the great powers, takes contracts from garrison towns, and
> fights skirmish-scale actions with black-powder weapons — all with FFTA's
> small-squad, grid-and-turn-based combat underneath. Long-term it grows into a
> formation that can sway whole campaign theatres.

Everything here is **original fiction inspired by history**. We do not copy
FFTA names, art, or prose, and we avoid ethnic stereotyping: the "powers" below
are defined by **military doctrine**, not by peoples.

---

## 0. Scale decision (read this first)

FFTA is a **small-squad** tactics game: ~6 units per side on a tile grid, each
tile roughly one person. Napoleonic battles are enormous. We keep FFTA's
structure and adopt a **detachment scale**:

- A unit = **one specialist or small crew** (a sharpshooter, a gun crew, a
  section of skirmishers, a cavalry trooper).
- A battle = a **detachment action**: seizing a bridge, storming a farmhouse,
  screening a withdrawal, ambushing a supply column.
- Mass battles are the backdrop; the player's company is the decisive small
  force inside them.

This preserves every FFTA mechanic (CTB turns, facing, height, combos, laws)
without redesigning them. A larger "battalion" scale can be a future mode.

**Decided (D0): detachment scale.** A unit is one specialist or small crew; a
battle is a small decisive action inside a larger war (a bridge, a farmhouse, a
supply column). Mass battles are the backdrop. This keeps every FFTA mechanic
(CTB turns, facing, height, Volleys, Articles of War) intact.

---

## 1. Naming dictionary (global)

| FFTA | Tactica (Napoleonic) | Notes |
| ---- | -------------------- | ----- |
| Ivalice / world map | **The Theatre** / **Campaign Map** | A fictionalized Europe |
| Clan | **Company** (also "the Corps") | The player's formation |
| Clan title | **Regimental Honours** | Reputation perks |
| Unit | **Soldier** / **Stand** | Individual specialist |
| Job | **Role** / **Post** | e.g. Rifleman, Surgeon |
| Race | **Power** (military school) | France, Britain, Russia, Austria, Prussia |
| A-Ability | **Action** | Active skill |
| R-Ability | **Reaction** | Triggered response |
| S-Ability | **Trait** | Passive |
| C-Ability | **Volley ability** | Combo with adjacent allies |
| MP | **Élan** *(proposed)* | Per-unit resource for actions |
| JP (Judge Points) | **Honour** | Fuels Volleys & Guard sorties |
| AP (Ability Points) | **Drill** | Learns abilities from kit |
| XP | **Experience** | Levels |
| Gil | **Crowns** | Currency |
| Law | **Article of War** | Daily standing order |
| Judge | **Provost Marshal** | Neutral enforcer |
| Yellow Card | **Reprimand** | Warning |
| Red Card | **Court-Martial** | Unit removed |
| Law/Antilaw card | **Standing Order / Counter-Order** | Issued by an Adjutant |
| Advanced Law | **General Order** | Company privilege |
| Jagd | **No-Man's Land** | No provost; losses permanent |
| Totema | **Guard Sortie** | National elite formation |
| Combo | **Volley** | Massed fire with neighbours |
| Monster Bank | **Auxiliary Barracks** | Captured/cajoled irregulars |
| Pub | **Officers' Mess** / **Billet** | Mission board |
| Shop | **Quartermaster's Stores** | Buy/sell |
| Mission (regular) | **Battle** | Story/campaign action |
| Mission (encounter) | **Skirmish** | Rival free company |
| Mission (dispatch) | **Detachment** | Send unit(s) away |
| Mission (area) | **Pacification** | Control a region |
| Area token | **Campaign Marker** | Placeable map tile |

**Decided (D1): the ability resource is named **Élan**.** (See §5.)

---

## 2. Powers (races)

Five FFTA races → five great-power **military schools**. Each keeps the three
mechanical roles a race played in FFTA: a restricted **role tree**, a **Guard
Sortie**, and **depot discounts** (cheaper gear from that power's stores).

| FFTA race | Mechanical identity | Power | Doctrine flavour |
| --------- | ------------------- | ----- | ---------------- |
| Hume | Versatile; widest role list; balanced | **France** | Combined arms, conscription, aggression |
| Viera | Fast; ranged/precision; all roles speed-based | **Britain** | Professional light troops, rifles, cavalry |
| Bangaa | Tough; melee; little magic | **Prussia** | Disciplined heavy infantry, shock |
| Nu mou | Magic/technical specialists; one melee role | **Russia** | Massed artillery, engineers, resilience |
| Moogle | Support, status, firearms, defensive growth | **Austria** | Defensive lines, skirmishers, technical support |

> **Why this mapping:** France is the balanced combined-arms school (Hume);
> Britain's edge was professional skirmishers and rifles (Viera's speed and
> precision); Prussia fielded disciplined shock infantry (Bangaa); Russia
> massed the largest artillery parks (Nu mou's "magic" = guns); Austria was the
> defensive, technical, multi-national army (Moogle support/status).

**Decided (D2): the player leads a multinational free company**, recruiting
specialists from all five powers (matches FFTA's mixed-race clan).

---

## 3. Role trees (all 39 jobs mapped)

Each FFTA job keeps its **mechanical kit** (its action list, stat profile and
unlock rules); only the fiction, names, weapon model and animations change.
"Shared" jobs appear under more than one power in FFTA and become **common
posts** here.

### France (Hume)

| FFTA job | Tactica role | Weapons / flavour | Kit preserved |
| -------- | ------------ | ----------------- | ------------- |
| Soldier | **Fusilier** | Musket + bayonet | Basic fighter, broad actions |
| Thief | **Forager** | Sabre + pistol | Steal gear, disarm, disengage |
| Archer | **Marksman** | Hunting piece | Ranged damage |
| White Mage | **Surgeon** | Medical kit | Healing, cleanse |
| Black Mage | **Artilleryman** | Field gun | Elemental damage |
| Fighter | **Grenadier** | Heavy musket + sabre | Raw physical power |
| Paladin | **Colour Guard** | Sabre + standard | Protect allies, defensive buffs |
| Ninja | **Hussar** | Sabre + pistol (mounted) | Fast, dual strike, evasion |
| Hunter | **Chasseur** | Rifle | Long-range, tracking, capture |
| Blue Mage | **Intelligence Officer** | Sabre + documents | Learns enemy actions |
| Illusionist | **Bombardier** | Incendiary shells | AoE to a target class |

### Prussia (Bangaa)

| FFTA job | Tactica role | Weapons / flavour | Kit preserved |
| -------- | ------------ | ----------------- | ------------- |
| Warrior | **Line Grenadier** | Musket + bayonet | Heavy basic melee/ranged |
| White Monk | **Assault Pioneer** | Bayonet + tools | Martial strikes + self-heal |
| Bishop | **Chaplain** | Cross + sabre | Holy support, protect/cleanse |
| Defender | **Cuirassier** | Heavy sabre + breastplate | Tanky melee |
| Dragoon | **Lancer** | Lance | Reach attacks, charge/"jump" |
| Gladiator | **Shock Grenadier** | Sabre | High-damage single strikes |
| Templar | **Line Officer** | Sabre | Command auras, dispel, buffs |

### Russia (Nu mou)

| FFTA job | Tactica role | Weapons / flavour | Kit preserved |
| -------- | ------------ | ----------------- | ------------- |
| Beastmaster | **Partisan** | Sabre + whistle | Recruit/control irregulars |
| Black Mage | **Artilleryman** (common) | Field gun | Elemental damage |
| White Mage | **Surgeon** (common) | Medical kit | Healing, cleanse |
| Alchemist | **Sapper** | Grenades + tools | Items, bombs, sabotage |
| Illusionist | **Signaller** | Flags + rockets | AoE signalling strikes |
| Morpher | **Impersonator** | Disguise kit | Assume captured identities |
| Sage | **Master Gunner** | Heavy ordnance | High-tier artillery |
| Time Mage | **Staff Officer** (common) | Maps + dispatch | Tempo (haste/slow/stop) |

### Britain (Viera)

| FFTA job | Tactica role | Weapons / flavour | Kit preserved |
| -------- | ------------ | ----------------- | ------------- |
| Fencer | **Sabreur** | Sabre | Fast melee chains |
| White Mage | **Surgeon** (common) | Medical kit | Healing, cleanse |
| Archer | **Rifleman** | Baker-type rifle | Ranged damage |
| Sniper | **Sharpshooter** | Long rifle | Very long-range precision |
| Red Mage | **Adjutant** | Sabre + pistol | Mixed blade/ranged, utility |
| Elementalist | **Rocketeer** | Congreve-style rockets | Elemental AoE |
| Assassin | **Long Rifle** | Rifle + knife | Assassination, concealment |
| Summoner | **Commodore** | Naval signals | Off-map heavy bombardment |

### Austria (Moogle)

| FFTA job | Tactica role | Weapons / flavour | Kit preserved |
| -------- | ------------ | ----------------- | ------------- |
| Animist | **Scout** | Horn + hounds | Calls support creatures |
| Black Mage | **Artilleryman** (common) | Field gun | Elemental damage |
| Thief | **Forager** (common) | Sabre | Steal, disengage |
| Gunner | **Fusilier** | Carbine | Reliable ranged |
| Mog Knight | **Lancer** | Lance | Reach, mounted-style charge |
| Time Mage | **Staff Officer** (common) | Maps + dispatch | Tempo |
| Juggler | **Grenadier** | Grenades + knives | Thrown weapons, gambits |
| Gadgeteer | **Engineer** | Gadgets + tools | Random/utility devices |

**Common posts** (shared across powers): Surgeon, Artilleryman, Forager,
Staff Officer. They gain small power-specific variants (weapon model, one
signature action) but share the core kit.

**Decided (D3): keep FFTA's ability shapes** — costs, ranges, power and status
effects — and rename/refavour them around black-powder weapons. Re-author for
feel later during balance.

---

## 4. Guard Sorties (Totema)

Each power's Totema becomes a **national guard formation** you may call on once
unlocked (by beating it in the story) for **10 Honour**. Race → Totema mapping
is preserved exactly.

| Power | FFTA Totema | Tactica Guard Sortie | Effect preserved |
| ----- | ----------- | -------------------- | ---------------- |
| France | Mateus | **The Old Guard** | Devastating all-enemy assault |
| Britain | Exodus | **The Heavy Brigade** | Draining charge (MP drain) |
| Prussia | Adrammelech | **The Death's Head Hussars** | Piercing shock attack |
| Russia | Ultima | **The Grand Battery** | Massive artillery barrage |
| Austria | Famfrit | **The Kaiser's Bombardiers** | Multi-hit explosive fire |

All five hit the whole battlefield, are hard to charge (10 Honour), and can be
disallowed by a "no Guard" Article of War. Keep the story beat: the player
fights each guard formation in a shrine-like set piece before unlocking it.

---

## 5. Resources

| FFTA | Tactica | Rules preserved |
| ---- | ------- | --------------- |
| MP | **Élan** *(working name)* | Spent by actions; regenerates over turns (FFTA rule to confirm) |
| JP (max 10) | **Honour** (max 10) | From legal kills + commended acts; fuels Volleys & Guard Sorties |
| AP | **Drill** | Earned by actions; masters gear-bound abilities |
| XP | **Experience** | Levels |
| Gil | **Crowns** | Economy |

**Decided (D1): name it Élan.** **Decided (D4): Élan doubles as morale** — a low
pool risks the unit becoming Shaken (and, at zero, Routed), adding a Napoleonic
signature on top of the FFTA maths. The exact regeneration rate stays a
tuning task (Phase 13).

---

## 6. Abilities: A / R / S / C

Keep the four ability classes 1:1, remapped in fiction:

- **A-Abilities → Actions.** Weapon-drill moves per role (Volley, Bayonet
  Charge, Canister, Case Shot, Form Square, Skirmish, etc.).
- **R-Abilities → Reactions.** Counter → **Riposte**; Return Magic →
  **Return Fire**; Reflex → **Dodge**; Auto-Potion → **Field Dressing**.
- **S-Abilities → Traits.** Half MP → **Thrift**; Weapon Def+ → **Drilled
  Guards**; Doublehand → **Two-Handed Grip**; etc.
- **C-Abilities → Volley abilities.** Unchanged mechanic: the initiator spends
  Honour and adjacent allies chain in; more Honour = more damage. Rename the
  skillset "Combo" → **Volley**.

The 98 enemy abilities (from the scrape) become **enemy troop actions**
(cavalry charge, canister blast, guerrilla ambush, etc.).

---

## 7. Elements

FFTA has eight elements. Two options:

**Option A — reflavour the eight (proposed):**

| FFTA | Tactica | Used by |
| ---- | ------- | ------- |
| Fire | **Incendiary** | Shells, combustibles |
| Ice | **Cold** | Winter/attrition |
| Lightning | **Shock** | Concussion, artillery |
| Earth | **Siege** | Mines, earthworks, debris |
| Water | **Deluge** | Rivers, naval, soaked powder |
| Wind | **Smoke** | Obscuration, dispersal |
| Holy | **Colours** | Inspiration, blessings |
| Dark | **Terror** | Atrocity, psychological |

**Option B — collapse to four casualty types:** **Ball** (small arms), **Steel**
(blade/lance), **Shell** (artillery), **Fire** (incendiary). Simpler to read,
less faithful to element laws.

**Decided (D5): Option A — keep all 8 elements**, reflavoured as above
(faithful, and it lets Articles of War forbid specific elements).

---

## 8. Status conditions (all 43 mapped)

| FFTA status | Tactica condition | Effect preserved |
| ----------- | ----------------- | ---------------- |
| Poison | **Bleeding** | Damage over time |
| Blind | **Dazed** | Reduced hit |
| Silence | **Deafened** | Blocks commands/casting |
| Sleep | **Unconscious** | Cannot act, wakes on hit |
| Confuse | **Panicked** | Attacks randomly/allies |
| Berserk | **Frenzied** | Auto-attack nearest |
| Charm | **Turned** | Acts for the enemy |
| Stop | **Stunned** | Loses turns |
| Petrify | **Broken** | Effectively out of action |
| Frog | **Disarmed** | Restricted to weak actions |
| Zombie | **Fevered** | Inverted healing/damage |
| Doom | **Mortally Wounded** | Countdown to KO |
| KO | **Out of Action** | Down; may be revived |
| Haste / Slow | **Double-Quick / Bogged** | Tempo up/down |
| Regen | **Steadied** | Heal over time |
| Protect / Shell | **Formed / Braced** | Physical / magical defence |
| Reflect | **Deflected** | Bounce attacks |
| Boost | **Rallied** | Temporary attack up |
| Defense | **Entrenched** | Temporary defence up |
| Cover | **Covering Fire** | Redirect/absorb hits |
| Immobilize | **Pinned** | Cannot move |
| Disable | **Lamed** | Cannot act |
| Addle | **Bewildered** | Cannot use actions |
| Astra | **Adjutant's Orders** | One-time immunity |
| Auto-Life | **Last Rites** | Auto-revive once |
| Hibernate | **Bivouacked** | Skip turns to recover |
| Conceal | **Camouflaged** | Hidden |
| Quicken | **Inspired** | Immediate extra turn |
| Expert Guard | **Parry** | Perfect block |
| Advice | **Counsel** | Higher crit |
| Control | **Suborned** | Player-controlled enemy |
| MPow/WAtk/WDef/MRes UP/DOWN | **Powder / Steel / Guard / Faith** modifiers | Stat up/down |

---

## 9. Judge, Articles of War & cards

- **Provost Marshal** stands on the field, neutral, issues **Reprimands**
  (Yellow) and **Court-Martials** (Red). Preserve escalation: 2nd offence or an
  illegal kill = Red; commander court-martialled = defeat.
- **Articles of War** = the daily law list (forbidden action / element / weapon /
  order / condition). Recommended acts grant **Honour**.
- **Commission / Colours** = Boss Medal (immune to court-martial) — given to
  named enemies and the player's key officers.
- **Standing Orders / Counter-Orders** = Law/Antilaw cards, issued by an
  **Adjutant** NPC (the Ezel analog).
- **General Orders** = Advanced Law (company privilege nullifies one Article).
- **No-Man's Land** = Jagd: no provost, no Honour, KO is permanent, commander's
  KO is defeat.

*Thematic win:* these rules map onto a real Napoleonic flavour — armies really
did operate under standing orders, and a court-martial was a real removal.

---

## 10. Campaign layer

| FFTA system | Tactica system | Preserved behaviour |
| ----------- | -------------- | ------------------- |
| Regular missions | **Battles** | Story/campaign set pieces |
| Encounter missions | **Skirmishes** | Rival free company roams the map |
| Dispatch missions | **Detachments** | Send units away for N days |
| Area missions | **Pacifications** | Liberate regions for discounts |
| Pub + fee + requirements | **Officers' Mess** contracts | Entry fee, item/post/unit gates |
| Equipment-bound AP learning | **Drill by kit** | Gear teaches abilities |
| Job-unlock thresholds | **Post prerequisites** | N actions from a post |
| Primary/secondary job | **Primary post / Attached post** | Stats from primary, kit from any mastered post |
| World map + area tokens | **Campaign Map + Markers** | Place tiles, shape the theatre, treasure hunts |
| Shops + race discount | **Depots** | Power-specific discounts |
| Monster Bank | **Auxiliary Barracks** | Store captured irregulars |
| Calendar + daily laws | **Campaign date + daily orders** | Laws rotate by day |
| Recruit by race in towns | **Recruiting offices** | By power |
| Link-cable multiplayer | **Online skirmish** | Command-replay netcode |

---

## 11. Enemies & irregulars (monsters → troops)

FFTA's monsters become **irregular and auxiliary troops**; the "capture" loop
(Beastmaster/Hunter, Monster Bank) becomes taking prisoners and turning
irregulars. Suggested roster:

| FFTA archetype | Tactica archetype |
| -------------- | ----------------- |
| Goblin / soldier-type | Militia / deserters |
| Bomb / Flan | Petard crews / powder teams |
| Malboro-type | Guerrilla bands |
| Floateye | Scout balloon / observer |
| Dragon-type | Heavy cavalry / armored train |
| Boss monsters | Named enemy generals / guard formations |
| Summoned creatures | Massed battery / cavalry wave |

Blue Magic → **Foreign Drill**: learn actions from enemy troops you fight.
Monster Bank → **Auxiliary Barracks**: deploy captured/cajoled irregular bands.

---

## 12. Combat mechanics (unchanged, renamed)

| FFTA mechanic | Tactica label | Notes |
| ------------- | ------------- | ----- |
| Charge Time Battle | **Orders Tempo** | Speed-driven turn order; keep integer ticks |
| Facing (front/side/back) | **Facing** | Flank/rear bonuses are very Napoleonic |
| Height | **Elevation** | Hills, redoubts, rooftops |
| Move / Jump | **Move / Climb** | Terrain + height cost |
| Knockback | **Shove** | Cavalry impact, explosions |
| Counter/Reaction | **Reaction** | Riposte, Return Fire |
| Volley (Combo) | **Volley** | Adjacent allies chain, costs Honour |
| Guard Sortie (Totema) | **Guard Sortie** | 10 Honour, whole-field |
| Range/LoS | **Range / Line of Sight** | Smoke and terrain can block |

Physical and magical damage formulas from the wiki become **Steel** and
**Powder** formulas (see `docs/wiki/pages/Attack_(command).md` and
`Magic_(command).md`), with the Power term renamed but the maths kept.

---

## 13. Example battle (end-to-end)

**Contract:** "Break the bridge at Sainte-Colombe." (a Battle mission)

1. **Officers' Mess** — pay the contract fee, see posted requirements.
2. **Deploy** the company: a France Fusilier, a Britain Rifleman, a Russia
   Sapper, a Prussia Lancer, an Austria Engineer, and a common Surgeon.
3. **Articles of War** for the day forbid *Incendiary* and *Cavalry charge*.
4. **Orders Tempo** runs; the Lancer rushes a flank but must avoid the banned
   charge or take a **Reprimand**.
5. The Rifleman and Fusilier form a firing line; a **Volley** action spends
   Honour to have adjacent allies fire together.
6. The Sapper lobs a **petard** (Fire-typed) — legal today; the enemy
   Artilleryman answers with **Case Shot** (Shock).
7. A platoon is Broken by casualties and **Holds**; a **Guard Sortie** (Old
   Guard) is called at 10 Honour to shatter the last position.
8. **Aftermath:** Crowns, captured kit, **Drill** toward new actions; the
   company earns a **Regimental Honour**.

---

## 14. Decisions (LOCKED)

All decisions are confirmed. This document is now the **frozen retheme
contract**; changing one means editing this table deliberately and noting why.

| # | Decision | Resolution |
| - | -------- | ---------- |
| D0 | Battle scale | **Detachment scale** — one specialist/small crew per unit |
| D1 | Ability resource name | **Élan** |
| D2 | Player faction | **Multinational free company** |
| D3 | Ability kits | Keep FFTA's kit shapes; rename + refavour |
| D4 | Élan as morale | **Yes** — low Élan risks Shaken/Routed |
| D5 | Elements | **8, reflavoured** (§7 Option A) |
| D6 | Naming policy | Fictionalized evocative names with historical flavour |
| D7 | Theatre & timeline | Peninsular + Central Europe, fictionalized, 1808–1815 |
| D8 | Tone | Adventurous-historical, not gratuitous |
| D9 | Grounded vs fantastical | **Grounded** — no literal spells; "magic" = tech, medicine, signals, morale |
| D10 | Grid geometry | **Square-isometric** (keeps FFTA facing/flank maths) |
| D11 | Lethality model | Hybrid leaning FFTA attrition, tightened by Élan/morale |
| D12 | Art direction | Minimalist board-game first; art pass later |
| D13 | Campaign structure | Open **contract sandbox** with a story spine |
| D14 | Game title | ***Lines of Glory*** (working title; codename `Tactica`) |
| D15 | Multiplayer scope | Stretch goal (Phase 12); keep determinism from day one |

### Consequences that follow

- **D0 + D11:** abilities are tuned at squad scale; FFTA numbers transfer with
  light reskins, not a full redesign.
- **D9:** every FFTA "spell" needs a mundane cause (gun, rocket, medicine,
  signal, morale). Keep the effects; change the fictional cause.
- **D10:** keep FFTA's 4-directional facing; no hex rewrite.
- **D13:** the `src/data/` layer must express contracts, regions and a story
  spine — not a linear level list.
- **D15:** the engine stays deterministic (seeded RNG, command log) from Phase 1.

With these locked, the `src/data/` schema can be scaffolded (Phase 0b).
