# How to play *Lines of Glory*

A practical guide to the build in this repository. It describes **what the live
game actually does**, and at the end notes which designed systems are still
module-only (they exist in the engine and tests but are not yet wired into the
combat loop). For the design rationale, see [`docs/BALANCE.md`](BALANCE.md) and
[`docs/NAPOLEONIC_MAPPING.md`](NAPOLEONIC_MAPPING.md).

---

## 1. Quick start

```bash
npm install
npm run dev     # open the printed local URL
```

The game opens on a sandbox **Field action** — *The River Ford* — with two
small detachments already deployed. You command the company (blue), the enemy is
driven by the AI.

Three ways in, from the top navigation bar:

| Where | What it is |
| ----- | ---------- |
| **Field** | The sandbox action you open on. Learn the controls; press **Resolve** in the Field panel to hand the rest to the AI and see it finish, then **Fight again**. |
| **Quick Battle** | A preset 4-v-4 action, *The Farmhouse*: a capture objective on a raised terrace. Ideal for testing combat and the AI. |
| **Drill Square** | A guided exercise that teaches the turn, Orders Tempo, the Articles of War and Drill in one pass. |

To play the **campaign**, open the **Officers' Mess**, take a contract, and the
Field deploys you onto that contract's battle map. You start with the
deterministic demo company, *The Greycoats* (day 12).

The campaign saves itself after every change; the **Saves** screen adds slots
and JSON export/import.

---

## 2. Controls

| Input | On the battlefield | In menus |
| ----- | ------------------ | -------- |
| **Arrows / WASD** / D-pad / left stick | Move the cursor one tile | Move focus |
| **Enter / Space** / gamepad **A** | Confirm the tile under the cursor | Activate the focused control |
| **Esc** / gamepad **B** | Back out one step | Leave the camp for the Field |
| **O** / gamepad **X** | Focus the **Orders** menu | — |
| **T** / gamepad **Y** | **End Turn** (a single `wait`) | — |
| **M** / gamepad **Start/Back** | Open the camp menu | Return to the Field |
| Click / tap | Focus that tile, then confirm | Click the control |
| Drag / mouse wheel | Pan the camera / zoom | — |

A click is told apart from a camera drag by a small movement threshold, so
panning never accidentally selects a tile. Mouse, pen and touch all work.

---

## 3. Reading the battlefield

- **The grid** is square-isometric, with four facings. Each tile has terrain
  (field, road, wood, village, river, marsh, hill, redoubt, wall, rubble, bridge,
  rooftop), a move cost, a height, and whether it blocks movement and sight.
- **Hover or move the cursor** to see the **tile card**: terrain name, category,
  absolute height, height relative to your soldier, move cost, passability,
  sight and whether a soldier stands there.
- **Click a soldier** (or confirm their tile) to see their **soldier card**:
  HP, Élan, Speed, facing, learned orders, equipment and conditions.
- **The Orders band** at the bottom lists the acting soldier's orders, with
  Élan cost, reach, area and charge time, plus **End Turn**.
- **Orders Tempo** at the bottom shows the upcoming turn order. Turns are not
  round-robin — see below.
- **The battle log** narrates what just happened (march, shot, hit, miss,
  condition, knockout).
- While you aim an order, the field previews its **reach** and **area** (which
  hits friends and foes alike) and the enemy's **danger zone** — the tiles they
  could strike next turn.

---

## 4. The turn: Orders Tempo

Every soldier charges a personal **Orders Tempo** counter in proportion to
Speed. At the threshold (100) that soldier acts, spends charge, and keeps the
whoever-has-most-charge-next tie-break. Faster soldiers act **sooner and more
often**.

A turn is **select → march (optional) → order or End Turn**:

1. **Select** the soldier whose turn it is. Only the acting soldier can be
   commanded; others can still be inspected.
2. **March (optional).** Walk the cursor to a reachable tile and confirm: the
   game previews the path, and confirming commits the march. **A march never
   ends the turn** — the same soldier then chooses an order.
3. **Give an order (or End Turn).** Pick an order from the Orders band, aim it,
   read the forecast, and confirm. Acting **ends the turn**. If there is no good
   order, **End Turn** passes with a single `wait` — often the better move.

What a closed turn costs your *next* turn, as a share of the threshold:

| How you closed the turn | Next-turn charge cost |
| ----------------------- | --------------------: |
| Spent an order | 80% |
| Marched, then held | 70% |
| Simply held (End Turn) | 50% |

So an action is a real commitment: waiting brings you back into the order
sooner. Your first turn of a battle always costs the full threshold.

Some orders have a **charge time** (a wind-up measured in tempo ticks). The
order is declared immediately and resolves when the bar fills; if the target
moves out of the aimed tile, or the caster is knocked out before the wind-up
finishes, the order **whiffs**.

---

## 5. Combat

### Aiming and the forecast

Before you confirm an order, the forecast shows the expected outcome: chance to
hit, expected damage, whether it could finish the target, what it would do to
allies caught in the area, and any reaction it might provoke. Use it.

### Hitting

```text
chance = accuracy − evasion + facing bonus        (clamped to 5…100)

facing bonus:  front +0   flank +15   rear +30
```

Attacking from the **flank or rear** is the single cheapest way to improve your
odds — and leaving your own soldiers facing the wrong way is how they die.

### Damage

- **Steel** (sabre, bayonet, small-arms fire):
  `(weapon attack − half the target's defence) × the order's power%`.
- **Powder** (artillery, medicine, signals, morale):
  `(magic − half the target's resistance) × the order's power%`.
- **Medicine** (healing): a flat dressing plus a share of your medical power —
  no defence term, because nothing opposes a bandage.
- **Weapon families matter.** Sabres, blades, lances, muskets and shields
  multiply your attack by the weapon's power; carbines, rifles, bows and tools
  average attack and speed; cannon use the weapon's power squared and ignore the
  crew's stats; signal staves use magic; horns average attack and magic. The
  order tooltip shows the power term.
- Damage is whole numbers and can fall to zero against a strong defence or a
  weakened attacker — the forecast tells you before you commit.

### Height and cover

Height matters: climbing costs movement, and a soldier who cannot cross a
height difference has to go around, which is what makes a sunken lane or a
walled yard a real obstacle. Walls, woods and buildings **block line of sight**,
so a ridge or a high bank can hide an approach — or hide a battery from you.
(The targeting rules can extend a ranged order's reach downhill for orders that
author it; none of the current orders do.)

### Élan and morale

**Élan** is the resource every order spends, and it doubles as **morale**:

| Élan | State | Effect |
| ---- | ----- | ------ |
| Above half | Steady | — |
| Half or less | **Shaken** | −3 ATK, −3 RES, −15 aim |
| Zero | **Routed** | Cannot use action abilities |

It recovers **20% of that soldier's maximum** every ten tempo ticks (at least
one point), so a battle of attrition rewards rotating your heavy spenders out to
hold for a turn.

### Conditions

Orders and terrain can apply **conditions** — Bleeding, Pinned, Braced, Formed,
Steadied, Dazed, Stunned and so on. They show on the soldier card and in the
HUD, and they last a set number of turns, tick at the start of a turn, or until
cleansed. Read the order's tooltip before you rely on one.

### Out of action

A soldier at 0 HP is **out of action** and leaves the board. In the current
build, casualties are **patched up after the action**; losing every company
soldier (or losing a defended point) is how you lose the battle.

### Objectives

Each battle map carries one win condition:

| Objective | Win when | Lose when |
| --------- | -------- | --------- |
| **Annihilation** | every enemy is out of action | your company is wiped |
| **Rout** | N enemies are out of action | your company is wiped |
| **Survive** | N completed turns | your company is wiped |
| **Capture** | a company soldier stands on the marked tile | your company is wiped |
| **Defend** | a company soldier holds the marked tile for N turns | an enemy stands on it, or your company is wiped |

The active objective and its progress are shown in the Field panel. Enemy AI
**plays objectives too** — it will march for the capture point or the defended
tile, so don't ignore the marker.

---

## 6. Your company

### Posts (roles)

Every soldier has a **primary post** and an **attached post**:

- The **primary post** sets their stats (per-level growth), equipment slots,
  weapon types and battlefield look.
- The **attached post** adds a second skillset — the orders they can bring in
  addition to their primary one.
- **Reaction**, **trait** and **volley** slots are learned once and equipped
  from any mastered post.

There are five national schools plus shared posts:

| Power | School flavour |
| ----- | -------------- |
| **France** | Line infantry, guns, staff work |
| **Britain** | Rifles, skirmishers, naval signals |
| **Prussia** | Heavy foot, pioneers, discipline |
| **Russia** | Massed ordnance, sappers, signals |
| **Austria** | Light troops, gadgets, grenades |

**Common posts** (Surgeon, Artilleryman, Forager, Staff Officer) are available
across the schools.

### Learning abilities, Drill and posts

- Abilities are **learned from kit**. Fighting awards **Drill** (AP), which
  trains the abilities your equipped items teach. When an item's requirement is
  met, that ability is **mastered**.
- Mastering enough abilities from a parent post unlocks a new one: **2** for a
  branch post, **3** for a deeper post.
- Experience levels soldiers (100 XP per level, cap 50). In the live campaign,
  **contract rewards are the source** of both Drill and Experience; the
  action/knockout formulas exist in the engine modules but are not wired into
  the campaign yet.
- The **Barracks** screen is where you change posts, attach a second skillset
  and equip learned reactions, traits and volleys.

### Kit

Weapons, offhand, armour, head and accessory. A post restricts which slots and
weapon types it may carry. Kit contributes flat stats on top of growth, and the
**Quartermaster** buys and sells it (each power's depot favours its own stores).

---

## 7. The camp

Open the camp with **M** / **Start**, or use the top navigation bar.

| Screen | What you do there |
| ------ | ----------------- |
| **Barracks** | Change primary/attached posts, equip abilities, plan the role tree. |
| **Officers' Mess** | Take contracts. Each shows fee, requirements, reward, the chapter that posts it, its **recommended level**, and an under-strength note when your company is below it. |
| **Campaign Map** | Place campaign markers, hunt treasures, march between regions and read the dispatch log. |
| **Quartermaster** | Buy and sell kit from the depots. |
| **Saves** | The rolling autosave, three filing slots, and JSON export/import. |
| **Settings** | Volume, mute, text speed, damage numbers, colour-blind palette and keybinds. |
| **Skirmish** | The online-style free-company skirmish prototype: match a rival, agree a seed, play the lockstep battle and compare state hashes. |
| **Drill Square** | The tutorial exercise. |

---

## 8. The campaign loop

1. **Take a contract** at the Officers' Mess. The entry fee is paid from your
   Crowns, and the contract becomes your active posting. Contracts are gated by
   story chapter and by requirements (an item, a post on the roster, a number of
   soldiers, Honour).
2. **The Field deploys you** onto the contract's map: your roster fills the
   map's company tiles (up to their number), facing the authored garrison. Each
   map has its own terrain, height, objective and recommended level.
3. **Fight.** Use the normal turn loop. The campaign panel also offers:
   - **Hold position** — the current soldier **braces** (a defensive stance)
     and ends their turn, after which the enemy takes its turns. To simply
     pass a turn, use **End Turn** (`T` / gamepad **Y**).
   - **Commit the company** — hand the rest of the action to the deterministic
     AI and watch it resolve.
4. **After-action report.** It names the outcome, the day (one day always
   passes), and the Crowns and Honours before → after.
   - **Victory** pays the contract's Crowns, Drill, Experience, Honours and kit.
     Drill trains equipped abilities; Experience can level soldiers; the
     contract is marked completed.
   - **Defeat** pays nothing and the contract stays on the board for another
     try. You lose the fee and the day.
5. **Dismiss** the report to return to the Mess. New chapters unlock as you
   complete contracts or reach calendar days.

### Story chapters and the conclusion

The spine runs **chapters 1–9**. Each chapter opens contracts (and some unlock
national Guard Sorties). The campaign ends with **Hold the Churchyard** and
**Take the Headquarters**; once the headquarters falls, the Mess shows **"The
Last Muster is won"** — and the contract sandbox stays open for as long as you
want to keep playing.

---

## 9. Quick Battle, sandbox and the tutorial

- **Field (sandbox).** An annihilation action with a **Resolve** button and a
  restart. Good for experimenting with orders and the AI.
- **Quick Battle.** A preset 4-v-4 capture action on the farmhouse board. Also
  has **Resolve** and a restart.
- **Drill Square.** A guided lesson: select and march, give an order, read the
  Orders Tempo, acknowledge the standing orders, and watch Drill train a
  kit-bound ability.

---

## 10. Numbers at a glance

| Rule | Value |
| ---- | ----- |
| Orders Tempo threshold | 100 charge (Speed per tick) |
| Turn costs | Act 80%, move-and-hold 70%, hold 50% of the threshold |
| Élan recovery | 20% of maximum per 10 ticks (minimum 1) |
| Morale | Shaken at ≤50% Élan, Routed at 0 |
| Hit chance | accuracy − evasion + facing (+15 flank, +30 rear); clamped 5–100 |
| Steel damage | `(weapon attack − ⌊defence ÷ 2⌋) × power%` |
| Powder damage | `(magic − ⌊resistance ÷ 2⌋) × power%` |
| Healing | `10 + ⌊medical power × power%⌋` |
| Levels | 100 XP per level, cap 50 |
| Post unlocks | 2 mastered abilities (branch), 3 (deeper) |
| Honour | capped at 10; awarded by contract rewards |
| Guard Sortie cost | 10 Honour (see the note below) |

---

## 11. Tips

- **Read the forecast and the danger zone** before every confirmation. The
  AI will punish a soldier left in the open.
- **Flank and rear attacks** are the cheapest accuracy you can buy. Turn to
  face threats with a `face` order if you must, but a turn spent facing is a
  turn not spent acting.
- **Use high ground** and cover; check whether a shot has line of sight before
  you close.
- **Wait when there is nothing worth doing.** A hold returns you to the turn
  order sooner than an action, and it lets Élan recover.
- **Rotate your heavy Élan spenders.** A Shaken soldier aims worse and hits
  softer; a Routed one cannot use abilities at all.
- **Fight for the objective.** On capture and defend boards the AI goes for the
  marker — so should you.
- **Mind the recommended level** on the contract card. Under-strength means the
  garrison is likely above your company's average; come back after a few easier
  contracts.
- **Save and export** before a hard contract. The Saves screen writes a JSON
  record you can restore or keep.

---

## 12. Designed systems not yet wired into live battles

The repository implements these systems as data, pure rules and tests, and the
design is documented — but the live combat loop currently accepts only
`wait`, `move`, `act`, `face` and `hold`, so you will not see them in play yet:

- **The Articles of War and the Provost Marshal.** The daily posting, the
  forbidding/commended Articles, Reprimands, Court-Martials and the lawless
  No-Man's Land are authored (`src/data/articles`, `src/engine/rules/articles`,
  `src/engine/provost.ts`) and the AI is article-aware, but no Provost is
  deployed and no law is enforced in a live battle. The Drill Square shows a
  sample posting.
- **Honour from play.** Legal knockouts and commended acts award Honour in the
  rules module, but in the live campaign Honour comes only from contract
  rewards.
- **Volleys and Guard Sorties.** The Combo-style volley and the five national
  Guard Sorties have executors and authored data, but the battle command layer
  rejects `volley`/`guardSortie` as unsupported today.
- **Speed conditions.** Haste/Slow helpers exist in the Orders Tempo module,
  but live battles read a soldier's base Speed, so no condition speeds a
  soldier up or slows them down yet.
- **Experience and Drill from actions/knockouts.** The action and knockout XP
  formulas are implemented and tested, but the campaign pays only the
  contract's authored reward.
- **Elevation range bonus.** The targeting rule supports extra downhill reach
  for orders that opt in; no authored order sets it yet.
- **No-Man's Land permanent losses.** The aftermath rule exists, but the
  campaign currently patches casualties up after ordinary actions.

If a system is missing from the live loop, that is a planned integration step,
not a hidden rule — the tests and docs tell you what each module guarantees.

---

## 13. Where to read more

| Document | What it covers |
| -------- | -------------- |
| [`README.md`](../README.md) | The pitch, quickstart and repository map |
| [`docs/COMBAT_LOOP.md`](COMBAT_LOOP.md) | The locked player-facing combat loop |
| [`docs/BALANCE.md`](BALANCE.md) | Authored numbers, baselines and what was measured |
| [`docs/NAPOLEONIC_MAPPING.md`](NAPOLEONIC_MAPPING.md) | FFTA → Napoleonic design contract |
| [`todo.md`](../todo.md) | What is built, what is next |

Found something the guide gets wrong? The guide describes `main`; the task board
and the tests are the source of truth for what a build actually does.
