# Balance decisions

This page is the single record of the **authored numbers** that the reference
mirror does not provide (or provides ambiguously), plus the reference facts we
did choose to keep. It exists because `agents.md` §3 says derived numbers must
be re-authored as our own data, and §10 says "verify, don't assume" — so every
decision below states what the wiki actually documents, what we chose, and where
the number lives.

Decision ids continue `docs/NAPOLEONIC_MAPPING.md` §14 (`D0`–`D15`).

| Status | Meaning |
| ------ | ------- |
| ✅ documented | The mirror states the rule; we keep it (re-authored as data). |
| ⚠️ ambiguous | The mirror contradicts itself; we picked one reading and say why. |
| ❌ absent | The mirror has no rule; the value is entirely ours. |

---

## D16 — Steel and Powder damage (T033/T034)

- **Reference:** ✅ documented, with one ⚠️ garbled line.
  `docs/wiki/pages/Attack_(command).md` gives `base = WeaponAtk −
  floor(TargetWeaponDef / 2)`, then `damage = base × Power / 100`.
  `docs/wiki/pages/Magic_(command).md` gives the same shape for magic. The
  physical page then adds a one-line "final formula" that multiplies by
  `weapon att/100` and adds `caster strength`.
- **Decision:** trust the step-wise prose. The one-liner double-counts both the
  weapon (already in `WeaponAtk`) and Strength (already folded into the
  equipment-derived attack upstream in `stats.ts`).
- **Values:** `defenseDivisor: 2`, `powerDivisor: 100` for both channels, kept
  as **separate** data so Steel and Powder can diverge later.
- **Lives in:** `STEEL_FORMULA`, `POWDER_FORMULA` in
  `src/engine/rules/damage.ts`.
- **Retune:** the two divisors are the main lethality knobs (D11). Changing
  `defenseDivisor` alone shifts every damage value; changing `powerDivisor`
  rescales per-ability `power` instead.

## D17 — Medicine (healing) (T036)

- **Reference:** ❌ absent. `White_Magic_(Tactics_Advance).md` lists ability
  `Power` values (Cure 40, Cura 60, Curaga 80) but no formula anywhere in the
  mirror.
- **Decision:** authored formula with the same `Power/100` convention as damage
  so content tunes uniformly, but no defence term (nothing opposes a bandage)
  and a small flat base so a weak dressing is still worth a turn:
  `heal = 10 + floor(MedicalPower × Power / 100)`.
- **Lives in:** `HEALING_FORMULA`, `computeHealing` in
  `src/engine/rules/damage.ts`.
- **Retune:** `flatHeal` sets the floor of early-game healing; `powerDivisor`
  sets how fast medicine scales with the `mag` stat.

## D18 — Weapon-family offense (T035)

- **Reference:** ✅ documented for the *Final Fantasy Tactics* parent game, not
  FFTA: `PA × WP` (swords/spears), `(PA + Spd)/2 × WP` (knives/bows),
  `MA × WP` (staves), `(PA + MA)/2 × WP` (instruments), `WP²` (guns).
- **Decision:** model the families as **data-driven weights** — `atkWeight`,
  `spdWeight`, `magWeight`, `offenseDivisor`, `weaponPowerMode` — rather than a
  hard-coded switch, and run every family through the D16 kernel.
- **Values:** the five authored family formulas in `src/data/weapons.ts`
  (`MELEE_FORMULA`, `PRECISION_FORMULA`, `ARCANE_FORMULA`, `SUPPORT_FORMULA`,
  `ORDNANCE_FORMULA`).
- **Retune:** per-family weights; changing one family does not touch the shared
  defence subtraction.

## D19 — Orders Tempo (T019/T148)

- **Reference:** ✅ the FFTA section of `docs/wiki/pages/Charge_time.md`:
  each tick a unit's CT rises by Speed (×2 Haste, ÷2 Slow, rounded down); at
  ≥1000 the unit acts; **after** the turn CT is set to 500, then lowered by 300
  if it acted or 200 if it moved.
- **Decision:** scale the 1000-point clock to a **100-point threshold** for
  legible integers (`agents.md` §7). Charge is spent at the **start of the next
  turn**, keeping the overshoot as progress. The post-turn reading becomes the
  cost of the *closed* turn:
  - **act** — 80% of threshold (FFTA's 200/1000 remaining),
  - **move then close** — 70% (300/1000),
  - **hold** — 50% (500/1000),
  - **first turn** — full threshold (no closed turn to price yet).
- **Determinism:** same-charge ties break by **charge descending, then unit id
  ascending**; the scheduler consumes no randomness (the RNG rides inside the
  state for combat rolls only).
- **Charge times:** `chargeTime` is authored per ability (e.g. 15–20 ticks in
  `src/data/abilities/`) — FFTA has no ability charge times, so these are ours.
- **Lives in:** `TEMPO_THRESHOLD`, `TEMPO_TURN_COSTS`, `turnCostFor`,
  `recordTurnCost`, `spendTurn` in `src/engine/turn.ts`; the turn closure that
  records the cost is `step` in `src/engine/battle.ts`.
- **Retune:** the three percentages set how much a wait is worth; the threshold
  sets overall battle pace; per-ability `chargeTime` sets how telegraphed heavy
  actions are.

## D20 — Élan recovery and morale (T040/T149)

- **Reference:** ❌ absent for FFTA — the `MP_(stat).md` FFTA section is an empty
  stub. The **A2** section documents 0 MP at battle start, +10 MP per turn, ×2
  with MP Channeling; we do not copy A2 directly.
- **Decision:** recovery is a **share of each soldier's maximum pool** — 20%
  (floor, minimum 1) every 10 tempo ticks, roughly one step per turn at the
  reference Speed range. A flat amount would refill a small pool faster in
  relative terms and make the morale thresholds fire at different rates for the
  same play. Élan starts **full**.
- **Morale:** **Routed** at 0 Élan; **Shaken** at or below **50%** of maximum;
  otherwise steady. Morale is derived from the pool, never stored separately.
- **Shaken penalty:** `atk −3`, `res −3`, `hitModifier −15`. The first authored
  value was `atk −10`, which the T152 baseline caught zeroing a low-strength
  soldier's damage entirely (`atk 15 − 10` vs `def 8` → `1 × 90/100 = 0`), so
  two Shaken soldiers could never hurt each other and the battle stalled at the
  turn cap. The smaller flat penalty still bites, but a landed blow is not
  erased.
- **Lives in:** `ELAN_REGEN_RATIO_PERCENT`, `ELAN_REGEN_INTERVAL_TICKS`,
  `SHAKEN_ELAN_RATIO`, `DEFAULT_ELAN_REGEN_SCHEDULE`, `regenAmountFor` in
  `src/engine/rules/elan.ts`.
- **Retune:** the ratio sets how freely abilities can be spent; the interval
  sets how much a fast soldier benefits; the Shaken ratio sets how punishing a
  short fight is.

## D21 — Post unlock thresholds (T046)

- **Reference:** ✅ the *shape* is documented (`Final_Fantasy_Tactics_Advance_
  jobs.md`: a job unlocks by mastering N abilities from another job); the counts
  per FFTA job are not mirrored cleanly.
- **Decision:** authored **two tiers**: a branch post needs **2** mastered
  abilities from its parent post, a deeper post needs **3**. Starting posts
  have no requirement. Each post's `requires` is data, not logic.
- **Lives in:** `requires` in `src/data/posts/*.ts`;
  `meetsPostRequirements` in `src/data/posts/index.ts`.
- **Retune:** raising a count lengthens the drill curve for that branch; the
  per-ability Drill costs (`EquipmentDef.teaches[].ap`) set the pace.

## D22 — Articles of War frequency and weighting (T055)

- **Reference:** ✅ the escalation shape (`Law_system_(Tactics_Advance).md`:
  FFTA's law list grows as the story advances); the exact per-day cadence is
  ours.
- **Decision:** campaign day is the clock. Forbidding/commended counts step up
  at days **1 / 8 / 16 / 32**: `1+1` → `2+1` → `2+2` → `3+2`. Articles are drawn
  **weighted, without replacement**, by each Article's authored `weight`
  (0.5–2 in `src/data/articles/`). A commended act pays the Article's `honour`
  (1–3), a legal KO pays 1, Honour caps at 10.
- **Lives in:** `DEFAULT_ARTICLE_FREQUENCY`, `frequencyForDay`,
  `drawDailyArticles` in `src/engine/rules/articles.ts`;
  `HONOUR_LEGAL_KO`, `HONOUR_MAX` in `src/engine/rules/honour.ts` and
  `src/engine/unit.ts`.
- **Retune:** the schedule makes the mid-campaign stricter; weights make a
  particular prohibition common or rare without removing it.

## D23 — Volley multiplier (T061/T150)

- **Reference:** ✅ Honour term (`Combo_(Tactics_Advance).md`:
  `(10 + 4×JP)/10`, at least one JP required); ❌ the firing-line term is
  mentioned ("other characters join in … further increases damage") but never
  quantified.
- **Decision:** `(10 + 4×honour + 2×min(linkers, 4)) / 10`, truncated once.
  Each chaining ally adds 20% to every shot, capped at four allies so a crowd
  cannot dwarf the Honour commitment (+400% at 10 Honour vs +80% at the cap).
  Only the initiator spends Honour; linkers spend nothing. At zero linkers the
  curve is exactly FFTA's.
- **Lives in:** `VOLHONOUR_BASE`, `VOLHONOUR_PER_HONOUR`, `VOLHONOUR_PER_LINKER`,
  `VOLHONOUR_MAX_LINKERS`, `DEFAULT_VOLLEY_LINK_RANGE` in
  `src/engine/actions/volley.ts`.
- **Retune:** the per-linker weight and cap are the coordination knobs; Honour
  cost and cap (`GUARD_SORTIE_COST`, `HONOUR_MAX`) set the economy.

## D24 — Stat growth, levels and Experience (T018/T049)

- **Reference:** ❌ absent — `Stat_growth.md`'s FFTA section is an empty stub;
  the job tables give growth **values and ranks**, not the applied formula.
- **Decision:** `effective[stat] = floor(growth[stat] × level) + flat mods +
  kit`, truncating each growth term **once**. A level-up applies the increment
  `floor(growth × (level+1)) − floor(growth × level)`, so incremental growth
  telescopes to the same value as a from-scratch derivation. Level cap **50**,
  **100** Experience per level, action XP **10 ± 2 per level of difference**
  clamped **1..99** (all reference values).
- **Lives in:** `deriveStats` in `src/engine/stats.ts`; `MAX_LEVEL`,
  `EXPERIENCE_PER_LEVEL`, `ACTION_EXPERIENCE`,
  `EXPERIENCE_PER_LEVEL_DIFFERENCE`, `MIN_EXPERIENCE_AWARD`,
  `MAX_EXPERIENCE_AWARD` in `src/engine/progression/level.ts`.
- **Retune:** growth tables are per-post content; the XP constants set campaign
  pacing, not combat balance.

## D25 — Drill to mastery (T048)

- **Reference:** ✅ shape only (AP masters equipped abilities); the per-item AP
  costs are ours.
- **Decision:** every teachable ability carries its own `ap` cost on the
  equipment that teaches it; Drill earned in battle is applied to every equipped
  item's pending teaches.
- **Lives in:** `EquipmentDef.teaches[].ap` in `src/data/equipment/`;
  `src/engine/progression/drill.ts`.

---

## Baseline measurement (T152)

`tests/unit/balanceBaseline.test.ts` plays the authored **Quick Battle**
(`skirmishSetup()`) through the headless gauntlet on eight fixed seeds, with
both sides on the shipped field AI (`AGGRESSIVE_FIELD_AI`, the policy the
Resolve control uses) and again with a `recruit` company against an `elite`
enemy. Reproduce with:

```bash
npm run test -- --run tests/unit/balanceBaseline.test.ts
```

The **first** run was the "before" picture: every seed finished (115–203 turns)
but the **enemy won 8/8**, losing only 0–3 soldiers. One seed also stalled at
the 512-turn cap on three mutually Shaken soldiers who could each deal exactly
0 damage — that is what produced the Shaken change in D20 above. T153 traced
the lopsided result to the roster's **Speed spread** (40/36/30/32): the fastest
soldier committed alone and was focus-fired. Holding every other stat fixed and
tightening the line to 35/32/34/33 turned the same eight seeds into a 4–4
split; raising HP changed nothing and raising attack made it 8–0, so Speed
cohesion is the lever.

The table below is the **after** picture, and the values the scenarios ship.
T154 then added an `isolation` term to the utility AI (enemies that could reach
the destination next turn beyond the allies that could support it), so the
soldiers no longer feed in one at a time; that moved the same seeds from 4–4 to
**6–2** for the company and lengthened the average fight by roughly eight turns.

| seed        | winner | outcome        | turns | lost (company/enemy) |
| ----------- | ------ | -------------- | ----: | -------------------: |
| baseline-1  | B      | companyDefeat  |   113 |                  4/1 |
| baseline-2  | A      | companyVictory |   109 |                  3/4 |
| baseline-3  | A      | companyVictory |   110 |                  2/4 |
| baseline-4  | A      | companyVictory |   107 |                  2/4 |
| baseline-5  | A      | companyVictory |   113 |                  3/4 |
| baseline-6  | A      | companyVictory |   111 |                  2/4 |
| baseline-7  | A      | companyVictory |   100 |                  1/4 |
| baseline-8  | B      | companyDefeat  |   116 |                  4/3 |

Average length is ~110 turns with ~2.8 casualties a side: a decisive firefight,
not a grind. The company is favoured when both AI sides play the field policy,
which is acceptable for the protagonist's sandbox, but the enemy is a real
threat (it wins two seeds and takes three to four company soldiers). The
recruit-vs-elite run finishes 3–5 for the company, so the difficulty tiers move
the result but do not flip it. The spec asserts only that **both sides win at
least twice** across the fixed seeds — a walkover tripwire, not a target split.

T160 added the missing mission term: for `capture` and `defend` objectives every
AI candidate is scored by how far its march closes on the objective tile (plus a
holding bonus for standing on it, for both sides). The Quick Battle table above
is an **annihilation** board, so it is unchanged by that term — verified by
re-running the spec. It does change `capture`/`defend` actions: the chapter-8
churchyard siege (company holding a walled plateau for six turns) now resolves
on every seed at company levels 5–8 instead of stalling at the turn cap when the
company killed the garrison without standing on the altar.

**Treat this as a baseline, not an equilibrium.** The result is extremely
sensitive to Speed and to AI weights: shifting the same line by a single point
(34/33/35/34) flipped the eight seeds from 4–4 to 1–7, making the marksman
fastest again (36/35/37/36) made it 7–1, and the isolation weight alone takes
the company from 4–4 (0) to 6–2 (1) to 8–0 (2). Speed buys extra turns, and a
cohesive line converts turns into focus fire, so small differences compound.
Expect any future roster or AI change to require a fresh baseline run, not a
local tweak.

- **Content breadth.** Formula decisions do not fix the thin campaign data
  (contracts, maps, enemies); that is future content work, not balance.

