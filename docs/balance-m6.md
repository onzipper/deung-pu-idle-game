# M6 World & Town — zone rebaseline

ClickUp: 86d3jv7m3 · Branch: `develop` · Builds on [balance-m5.md](./balance-m5.md)
(the M5 solo curves are unchanged — M6 only REGROUPS them into a walkable world).

## What changed (M6 task 1 — the zone/world engine)

The per-stage content was **regrouped**, not rebalanced. The world is now a set of
ordered **maps** (`CONFIG.world.maps`), each a left-to-right run of walkable
**zones**: farm zones (one existing stage each) + a single **boss room**, plus a
**town** at the left edge of map1. Combat inside a zone is byte-for-byte the old
stage combat (driven by `state.stage` = the zone's stage), so every M5 knob
(enemy/boss curves, formation/free-hit, leveling, mana, evolution, quest) is
**untouched**.

### Zone regrouping (map : zones)

| map | name | farm zones (stage) | boss room |
|---|---|---|---|
| map1 | โลกมนุษย์ (Human World) | 1, 2, 3, 4, 5 + **town** (left edge) | stage 5 |
| map2 | แดนอสูร (Demon Realm) | 6, 7, 8, 9, 10 | stage 10 |
| map3 | พรมแดนเถื่อน (Wild Frontier) | 11, 12, 13, 14, 15 | stage 15 |

- **Farm zone** unlock: reach the zone's kill quota (`killGoal(stage)`) → the next
  zone unlocks. Clearing a farm zone grants the **same xp/gold the old per-stage
  boss gave** (`xpPerBossKill`/`goldPerBoss` are REUSED — no new curve), so the
  leveling trajectory is preserved WITHOUT a per-zone boss.
- **Boss room** unlock: after the last farm zone of the map. Beating it unlocks the
  next map's first zone. Entering a boss room starts the boss encounter (existing
  boss mechanics — enrage/slam/telegraph — unchanged).
- **Death** → respawn in **town** (GDD, no penalty), then (toggle `autoReturn`, on
  by default) auto-walk back to the last farmed zone. The town-return reuses the old
  `heroReviveTime` (4 s) as its walk-home time, so the **death cost is unchanged**.
- **Transit** between adjacent zones is a deterministic `world.transitSeconds`
  (0.6 s) fixed-dt timer — negligible in the totals. No RNG in the world layer.

## Method

Rewritten harness `src/engine/__tests__/balance-sim.ts` (`pnpm sim`) — the autopilot
now WALKS the world (walk forward on unlock, enter the boss room, advance to the
next map on a boss-room victory; accept/evolve the class-change quest as before).
Death → town → auto-return is engine behaviour. `SIM_SECONDS=2400`, 5 seeds
(`1,2,3,42,1337`), auto-cast + auto-allocate + auto-return on.

## Results — per-zone clear time (mean s, 5 seeds)

`meanDur` = time from entering a zone to clearing it (farm = quota met; boss room =
boss beaten). Farm-zone clear time per stage:

| stage | swordsman | archer | mage |
|------:|----------:|-------:|-----:|
| 1  | 21  | 21  | 32  |
| 2  | 43  | 34  | 42  |
| 3  | 73  | 31  | 49  |
| 4  | 86  | 43  | 57  |
| 5  | 83  | 52  | 69  |
| 6  | 91  | 52  | 71  |
| 7  | 102 | 62  | 83  |
| 8  | 76  | 77  | 91  |
| 9  | 79  | 86  | 95  |
| 10 | 116 | 99  | 106 |
| 11 | 289 | 124 | 125 |
| 12 | **1219** | 132 | 136 |
| 13 | — | 158 | 156 |
| 14 | — | 195 | 174 |
| 15 | — | 563 | 310 |

Boss rooms (mean s to beat):

| boss room | swordsman | archer | mage | wipes (all seeds) |
|---|---|---|---|---|
| map1 (stage 5)  | 10 | 12 | 15 | 0 / 0 / 0 |
| map2 (stage 10) | 12 | 16 | 15 | 0 / 0 / 0 |
| map3 (stage 15) | not reached | 0/5 | 0/5 | — / 11 / 18 |

## Targets — met

- **No new walls.** Every class clears **map1 and map2 in full (through the stage-5
  and stage-10 boss rooms) on every seed, 0 boss wipes** — i.e. the whole M5-viable
  range (S1–S10) is clean. Class change still lands at **stage 5 (5/5, all classes)**.
- **Frontier preserved (map3 = 11+ soft-wall).** The old M5 content ceiling (S12–S14)
  reappears as the map3 frontier: the swordsman soft-walls at the s11→s12 farm grind
  (s12 clears 2/5), archer/mage push through the farm zones and reach the **stage-15
  boss room but can't beat it (0/5)** — the intended soft-wall, extended by later M6/M7
  content, never a permanent freeze (respawn + auto-return keep banking XP; final
  levels 47–49).
- **Transit negligible.** Boss rooms resolve in ~10–16 s; farm-zone times dominate
  the totals. A 0.6 s hop per zone and the (unchanged) 4 s death cost are lost in the
  noise.
- **Pacing.** Per-farm-zone times run ~30–40 % faster than the M5 per-STAGE times
  because a farm zone no longer bundles a boss fight — the boss beats now live only
  at the three map gates. Total map-to-map progression and the leveling curve
  (level-at-clear tracks the M5 table) are preserved; this per-zone table is the new
  M6 baseline. No M5 curve was retuned.

---

## M6 task 2 — NPC shop + consumables (เมืองหลัก)

The **first real gold sink** since the upgrade lines were removed (gold otherwise
accumulated unused). Three NPC-bought, non-tradable, **stackable COUNTS** (SAVE v9,
NOT M7 item-instances): `hpPotion`, `manaPotion`, `returnScroll`. Bought only in
**town** (the NPC is there — GDD); potions restore a % of the pool on a per-type
cooldown; the scroll teleports to town.

### Catalog (CONFIG.shop) + auto-use defaults

| item | effect | cooldown | base price | auto default |
|---|---|---|---|---|
| hpPotion | restore **50%** max HP | 8 s | 60 | ON, fire < **35%** HP |
| manaPotion | restore **45%** max mana | 10 s | 45 | ON, fire < **25%** mana |
| returnScroll | teleport to town (instant) | — | 150 | — |

- **Auto-use is the idle feature**: settings-style toggles + thresholds (UI-owned
  like `autoCast`, mirrored onto state each frame), resolved deterministically at
  the step level with per-type cooldowns. Defaults **ON** so idle play sustains
  without setup (same spirit as `autoReturn`). Manual quick-use buttons too.
- **Pricing is depth-scaled, NOT current-stage-scaled.** The NPC lives in town
  (whose content stage is always 1), so pricing by `state.stage` would flatten to
  base prices forever. Prices instead scale by the player's **farming depth**
  (`lastFarmZone`'s stage): `price = round(basePrice · 1.12^(stage−1))`. So a
  frontier potion costs ~4-6× its base — a meaningful slice of that depth's gold
  income (which itself grows), keeping the sink real at every depth. Stack cap 99.

### Sim (auto-use ON at defaults; autopilot restocks on town pass-through)

`pnpm sim`, `SIM_SECONDS=2400`, 5 seeds. The world autopilot only passes through
town on a **death respawn** (auto-return pops to town, then walks back), so it
restocks potions there with surplus gold to a target stack — a deterministic
"buy on pass-through" rule. `buyShopItem` is partial (buys what gold + stack room
allow), so a pricier frontier potion just buys fewer, never blocks.

**Gold economy (per class, full 2400 s run):**

| class | income | potion sink | sink % | potions used | gold banked (end) |
|---|---:|---:|---:|---:|---:|
| swordsman | ~60.9k | 45.8k | **75%** | 180 | 17.4k |
| archer | ~54.4k | 22.7k | **42%** | 69 | 34.2k |
| mage | ~51.5k | 8.6k | **17%** | 4 | 45.4k |

The sink **scales with need**: the melee tank (leans hardest on hp potions at the
wall) spends most of its gold; the self-sustaining mage (INT-fed mana regen, kites
away HP damage) barely buys. Nobody starves — every class banks positive gold and
buys are never blocked. This is deliberately a *first* sink that converts unused
gold into a real, difficulty-scaled decision without draining it to zero (M7 gear +
M8 warp/marketplace add the deeper sinks).

### Wall status — held (frontier preserved)

| gate | swordsman | archer | mage |
|---|---|---|---|
| map1 boss (s5) | 5/5, 0 wipes | 5/5, 0 wipes | 5/5, 0 wipes |
| map2 boss (s10) | 5/5, 0 wipes | 5/5, 0 wipes | 5/5, 0 wipes |
| map3 frontier (s15) | never clears s15 farm | s15 boss **0/5** (18 wipes) | s15 boss **0/5** (18 wipes) |

- **map1 + map2 stay clean** (all classes, 0 boss wipes) — potions can only help a
  range that was already viable, so nothing collapsed. Class change still lands at
  **stage 5** for all classes.
- **The s15 frontier soft-wall HOLDS.** Potions extend *survival* but not *DPS*:
  the s15 boss out-damages the sustain, so archer/mage still lose 0/5 and the
  swordsman never even clears the s15 farm zone — the intended wall, to be broken
  by later M7/M8 content, not by potions.
- **Potions did give real sustain where the design allows it.** The melee
  swordsman's old s12 death-spiral (M6 baseline: 1219 s, 2/5) smooths out with hp
  potions and it now reaches the s15 frontier — a wall *shift* the design
  explicitly permits ("acceptable for potions to push the wall"), still short of
  breaking s15.
- **Graceful post-map3 state.** No class beats the s15 boss in-sim, but if one ever
  does, `onBossRoomCleared` finds no map4 and emits a `frontierCleared` event; the
  UI shows the "สุดเขตแดนตอนนี้" banner and the hero sits in the paused victory able
  to walk LEFT to keep farming — never a crash/stall.

---

## M6 task 3 — Combat rework "สนามล่ามอน" (open-field hunting)

The forward-march wave model is replaced by an **open field the hero HUNTS across**
(GDD "โลกและการเดิน" — Zone = สนามล่ามอน). A per-zone **spawn POOL** scatters up to
`maxAlive` mobs at random field positions (seeded RNG — placement/composition is what
the stream is reserved for); a killed mob **respawns** after `respawnDelay`; idle mobs
**wander** their spawn point via a deterministic id-hashed sine (no RNG). Temperament:
**PASSIVE** by default (never initiates; fights back once HIT) + an **AGGRESSIVE belt**
(aggro radius) whose density **ramps toward the boss room**. The hero **auto-hunts** the
nearest mob (deterministic id tie-break), walking to attack range (melee closes, ranged
holds a standoff + kites). No formation anchor / forward pressure — the anchor survives
only for the boss fight + the render "marching" cue. The multi-actor engine (M8 party)
is reshaped, not removed: each actor hunts independently and the per-class `offset`
(spacing) is retained in config. **SAVE: unchanged (v9)** — the whole spawn/hunt state
is transient (`spawnCd`/`spawnBurst`/`spawnPaused`, mob temperament), never persisted.

### Knob defaults (per map — `CONFIG.world.maps[].hunt`, shared `CONFIG.hunt`)

| map | maxAlive | respawnDelay | aggro fraction (first→last farm) | aggroRadius |
|---|---:|---:|---|---:|
| map1 (Human World) | 6 | 1.7 s | 0.00 → 0.15 (zones 1-2 ~all passive) | 130 |
| map2 (Demon Realm) | 7 | 1.5 s | 0.18 → 0.40 (mid game ~25-40%) | 150 |
| map3 (Wild Frontier)| 8 | 1.35 s | 0.35 → 0.60 (last farm ~54-60%) | 175 |

Shared: `wanderAmp 22`, `huntSpeed 175`, `mobContactGap 34`, spawn band = 30-96% of
`fieldWidth` (900, the current screen field — a **zone-width knob is now data**, ready
for wide zones + camera-follow later). The aggressive fraction is `lerp(start,end)` over
a map's farm-zone index, so danger concentrates toward each boss room (GDD).

### Method

Same `pnpm sim` world autopilot (walk on unlock, enter boss room, advance on victory,
auto-cast/auto-allocate/auto-return + auto-potions ON). `SIM_SECONDS=2400`, 5 seeds.

### Results — farm-zone clear time per stage (mean s, 5 seeds), vs the M6 wave baseline

| stage | sword (new / base) | archer (new / base) | mage (new / base) |
|---:|---|---|---|
| 1 | 17 / 21 | 18 / 21 | 21 / 32 |
| 2 | 27 / 43 | 29 / 34 | 34 / 42 |
| 3 | 34 / 73 | 34 / 31 | 37 / 49 |
| 4 | 42 / 86 | 43 / 43 | 44 / 57 |
| 5 | 51 / 83 | 52 / 52 | 55 / 69 |
| 6 | 51 / 91 | 52 / 52 | 56 / 71 |
| 7 | 59 / 102 | 60 / 62 | 60 / 83 |
| 8 | 66 / 76 | 67 / 77 | 69 / 91 |
| 9 | 75 / 79 | 78 / 86 | 77 / 95 |
| 10 | 114 / 116 | 121 / 99 | 103 / 106 |
| 11 | 110 / 289 | 111 / 124 | 110 / 125 |
| 12 | 91 / 1219 | 161 / 132 | 147 / 136 |
| 13 | 125 / — | 232 / 158 | 165 / 156 |
| 14 | 199 / — | 525 / 195 | 182 / 174 |
| 15 | 393 / — | wall / 563 | 462 / 310 |

Boss rooms: map1 (s5) + map2 (s10) = **5/5, 0 wipes, all classes**. map3 (s15) =
sword 0/5 (3 wipes), mage 0/5 (11 wipes), archer never reaches it. Class change lands
at **stage 5 (5/5)** for every class, unchanged.

### Targets — met

- **Pacing ballpark preserved.** Early/mid zones (s1-s10) run 17-120 s — the same idle
  cadence as the wave baseline (18-116 s), just **smoother + more class-uniform** (no
  inter-wave idle gap; a continuously-populated field). The old melee mid-wall softened
  (sword s11 289→110 s, s12 1219→91 s) into an even ramp — a cleaner idle curve.
- **map1 + map2 = 0 permanent walls, 0 boss wipes, all classes.** Farm zones there are
  **all/mostly passive** (aggro ≤0.15), so they're **0-death safe** — farm danger drops
  exactly as designed.
- **Damage pressure concentrated in the aggressive belt + bosses.** Deaths are **0 across
  all of map1+map2** and pile up only in the map3 aggressive frontier (sword deaths:
  s14 8, s15-farm 106; archer s14 39, s15 106; mage s15-farm 53). So sustain/potions now
  **matter mainly in the aggressive belt + boss rooms** — the sword's potion sink doesn't
  collapse to zero, it **relocates to the frontier** (where its HP pressure now lives).
- **map3 s15 wall INTACT.** No class beats the s15 boss (sword/mage 0/5, archer walls at
  the s15 farm). The frontier is a soft-wall, not a freeze — respawn + auto-return keep
  banking XP (final levels 49-51). The aggressive belt is the tuning lever: the squishy
  **archer** feels the s14 belt hardest (525 s, 39 deaths) — emergent class pressure, the
  ranged glass-cannon caught in a 54%-aggressive swarm while the mage kites and the sword
  tanks. Still short of a permanent freeze.
- **Autopilot never stalls.** All 15 seeds×3 classes reach map3/s15 in 2400 s; mobs are
  always reachable (spawn band ⊂ hero clamp), the id tie-break prevents hunt ping-pong,
  and respawn keeps the field fed — verified by the long-sim + pure-farm anti-stall tests.

---

## M6 task 4 — "ALIVE FIELD" density retune (owner request 2026-07-06)

The owner asked the fields to feel **ALIVE**: raise concurrent mobs per zone from the
task-3 baseline of **6-8** to **15-20**, then retune pacing so the world is *busier,
not trivially faster*. This is a **knobs-only** pass — no wave/combat system code
changed (spawn placement, temperament, hunt AI untouched).

### The density model (why the levers couple)

Two facts from the sim drive everything:
1. **`respawnDelay` was the old throughput throttle**, not kill speed. A fast killer
   emptied the 6-mob burst then waited ~1/respawnDelay for each refill, so raising
   `maxAlive` alone barely helps (bigger burst, same steady-state trickle). To keep
   the field genuinely FULL, `respawnDelay` was cut so refill ≥ kill rate — which
   makes throughput **kill-limited** and ~1.6× higher (early/mid clears ~halved).
2. **Level/gold-per-ZONE = killGoal × per-kill reward**, and level-at-stage is what
   sets the class-change beat + the map3 power wall. Leveling is tied to the QUOTA
   (kills-to-clear), not to time.

So the retune is one coherent lever set: raise `maxAlive` (alive field) + cut
`respawnDelay` (keep it full) → throughput ~1.6× → raise `killGoal` **×1.6** to
restore the clear-time ballpark → divide `xpPerKill` **and** `goldPerKill` by the same
1.6 so per-zone XP/gold (hence leveling, the wall, and the potion-sink %s) are
**preserved**. The aggressive-mob COUNT = aggroFraction × maxAlive, so aggro
FRACTIONS were cut in step to stop the belt becoming a meat grinder.

### Knob table (was → now)

| knob | map1 | map2 | map3 |
|---|---|---|---|
| `maxAlive` | 6 → **15** | 7 → **17** | 8 → **18** |
| `respawnDelay` | 1.7 → **0.75** | 1.5 → **0.65** | 1.35 → **0.60** |
| `aggroStart→End` | 0.00-0.15 → **0.00-0.10** | 0.18-0.40 → **0.09-0.18** | 0.35-0.60 → **0.15-0.25** |
| `aggroRadius` | 130 → **125** | 150 → **145** | 175 → **145** |

Shared `hunt` band widened **0.30-0.96 → 0.22-0.98** of `fieldWidth` (spread the
fuller field over a longer stretch). Curves (functions of stage n):

| curve | was | now | per-zone effect |
|---|---|---|---|
| `killGoal` | 10 + 5n | **16 + 8n** (×1.6) | kills-to-clear ×1.6 (the pacing lever) |
| `xpPerKill` | 10 + 3n | **6 + 2n** (≈ ÷1.6) | XP/zone ≈ unchanged (product 0.98-1.05×) |
| `goldPerKill` | (5+2n)·1.05ⁿ⁻¹ | **(3.125+1.25n)·1.05ⁿ⁻¹** (÷1.6) | gold/zone unchanged → sink %s hold |

`xpPerBossKill` / `goldPerBoss` / the M5 combat curves are **untouched** (per-zone-clear
and per-boss counts are unchanged).

### Sim results (`pnpm sim`, `SIM_SECONDS=2400`, 5 seeds — final knobs)

Farm-zone clear time per stage (mean s), new vs the task-3 baseline:

| stage | sword (new/base) | archer (new/base) | mage (new/base) |
|---:|---|---|---|
| 1  | 19 / 17 | 26 / 18 | 26 / 21 |
| 2  | 28 / 27 | 38 / 29 | 41 / 34 |
| 3  | 30 / 34 | 32 / 34 | 42 / 37 |
| 4  | 38 / 42 | 50 / 43 | 45 / 44 |
| 5  | 64 / 51 | 60 / 52 | 59 / 55 |
| 6  | 39 / 51 | 53 / 52 | 57 / 56 |
| 7  | 52 / 59 | 65 / 62 | 65 / 60 |
| 8  | 51 / 66 | 66 / 77 | 79 / 69 |
| 9  | 87 / 75 | 94 / 86 | 99 / 77 |
| 10 | 71 / 114 | 173 / 121 | 167 / 103 |
| 11 | 96 / 110 | 456 / 111 | 143 / 110 |
| 12 | 148 / 91 | 610 / 161 | 159 / 147 |
| 13 | 387 / 125 | wall / 232 | 364 / 165 |
| 14 | 584 / 199 | wall / 525 | 484 / 174 |
| 15 | wall / 393 | wall / 563 | wall / 462 |

- **Leveling trajectory preserved.** Level-at-clear is byte-close to baseline: s1=7,
  s2=13, s3=17, s5=24, s10=37, final 47-51 (baseline 49-51) — the ÷1.6 xp
  compensation held.
- **Class-change lands at stage 5** for all classes on all seeds. Its **kill-60
  objective fills FASTER now** (denser field) but the beat is **boss-gated** (needs
  1 boss defeat; the first boss is the map1 boss at stage 5), so **60 was NOT raised
  — the beat holds structurally.**
- **map1 + map2: every class clears in full, 0 wipes.** Those maps are all/mostly
  passive (aggro ≤ 0.18) so the denser field stays safe.
- **map3 s15 wall INTACT** — no class clears the s15 frontier; the soft-wall holds
  (respawn keeps banking XP; final levels 47-51). Deaths concentrate exactly in the
  map3 aggressive belt + the frontier (map1/map2 ≈ 0-6 deaths/zone; map3 s12-s15 heavy).
- **Sword survivability fine.** The tank reaches the s15 frontier (5/5 through s14);
  its potion sink relocates to the frontier where the HP pressure now lives.
- **Early ranged clears run ~+25-40 % vs baseline** (e.g. archer s1 26 vs 18). The
  shared ×1.6 quota over-corrects for the ranged classes, whose raw throughput only
  rose ~1.35× (vs the sword's ~1.8×); a single quota can't split per class. This errs
  **slow, not fast** — the correct side of "busier, not trivially faster."

### Flagged (systemic / for follow-up)

> **Both items below RESOLVED 2026-07-06 — see "M6 task 5 — Hunt follow-ups" at the
> bottom of this doc** (engine-side gradual re-entry fill + AoE-aggro rule + min-spacing
> placement). Kept here for the trail of *why* they were engine work, not knobs.

- **[RESOLVED]** **Archer frontier wall shifted s15 → s13.** The squishy archer **self-aggros the
  passive field via its AoE arrow-rain** (passives retaliate once hit) and, in an
  15-20-mob field, its kite has **no retreat room** → it gets swarmed at the frontier.
  This is a **systemic interaction with density**, not a knob: cutting aggro fractions
  barely helped (the swarm is self-inflicted), and `maxAlive` had to drop to ~16 just
  to spare the archer *one* clean frontier zone (s11) — which departs from the owner's
  "map3 ~20" and still walls it at s13. Held map3 at **18** to honour the density +
  monotonic-ramp intent; the true fix is engine-side (owner: `game-engine-specialist`):
  a **gradual re-entry fill** instead of the full `spawnBurst` (the burst re-swarms the
  hero the instant it respawns back into a farmed zone), and/or a temperament/ AoE-aggro
  rule so a single AoE doesn't wake the whole cluster.
- **[RESOLVED]** **Spawn placement is uncollided uniform random**, so a 15-18-mob field **will visually
  overlap** at points (mobs can stack on a position). Acceptable for now; the band was
  widened (0.22-0.98) to lower overlap density. A min-spacing/Poisson placement is an
  engine follow-up if it reads badly.
- **No pathological hero behaviour** in-sim: the id tie-break still prevents hunt
  ping-pong across the crowded field, respawn keeps it fed, and the long-run + pure-farm
  anti-stall tests stay green. 15-18 enemy views/frame is a render-perf note (out of
  scope here) — nothing in the sim suggests engine-side thrash.
- **Tests updated honestly** for the new model: `hunt.test.ts` aggro-fraction threshold
  (0.50 → 0.25, matching the cut) + the pure-farm anti-stall test now tallies kill
  EVENTS (s.kills resets on the death→town trip an unsustained lvl-1 melee now takes in
  a dense field); `archer-volley.test.ts` + `phase-b.test.ts` scenarios now set
  `spawnPaused` to isolate their single hand-placed target from the denser/wider burst.

---

## M6 task 5 — Hunt follow-ups (engine, 2026-07-06)

Closes the two items flagged in task 4. All THREE mechanisms are **engine-side, pure,
deterministic** (no RNG drawn in combat — the seeded stream stays spawn-composition
only; spawn PLACEMENT legitimately uses it), **SAVE unchanged** (the whole spawn/hunt
state is transient), `state.events` untouched. Files: `engine/config`, `engine/systems/{damage,combat,skills,waves}.ts`.

### Mechanisms

1. **Gradual re-entry fill** (`waves.updateSpawns`). Entering/re-entering a farm zone
   used to `spawnBurst` the field to `maxAlive` in ONE step — on a death respawn that
   re-swarmed the returning kiter instantly (no retreat room → the archer's AoE-aggro
   death-spiral). Now the burst seeds only `reentryBurstFrac × maxAlive`; the normal
   `respawnDelay` cadence trickles it up to the cap over a few seconds. The field still
   ends up FULL (the "alive field" intent holds) — only the first seconds after each
   entry ramp, which is exactly when a returning hero needs room.

2. **AoE-aggro rule** (`damage.wakeNearestPassives` / `damageInRadius` / `applyAoeDamage`).
   An AoE still **damages every mob in its blast** (unchanged), but **retaliation** is
   limited: only the passive mobs NEAREST the impact — within `aoeWakeRadiusFrac ×
   radius`, at most `aoeWakeCap` — wake; edge-of-blast passives take damage but stay
   passive. Selection is deterministic (nearest-first, LOWER-id tie-break; no RNG).
   Single-impact AoEs (mage basic orb, meteor, whirl, frost) cap the wake **per impact**.
   The archer's **arrow rain is the special case**: its 9 drops would each re-aggro the
   field, so the volley decides its capped wake **ONCE at cast** (near the cluster
   centroid) and the drops then deal **no-wake** damage. The directly-targeted mob (at
   the impact centre) always wakes, so basic single-target attacks are unaffected.

3. **Min-spacing spawn placement** (`waves.pickSpawnX`). Best-candidate: each spawn draws
   a FIXED `spawnCandidates` count of candidate x's and keeps the one FARTHEST from the
   nearest existing mob. The fixed count keeps the per-spawn RNG draw-count **bounded +
   deterministic**. A dense field now reads spread out instead of stacking mobs on a
   point (no more visual overlap piles).

### Knobs (all new, in `CONFIG.hunt`)

| knob | value | effect |
|---|---:|---|
| `reentryBurstFrac` | 0.35 | fraction of `maxAlive` burst on zone entry; rest trickles in |
| `aoeWakeRadiusFrac` | 0.6 | inner wake radius as a fraction of the blast radius |
| `aoeWakeCap` | 2 | max passives an AoE impact (or one rain cast) may wake |
| `spawnCandidates` | 5 | best-candidate count for min-spacing placement (fixed RNG draws) |

Tuned FIRST (no existing curve touched): the ×1.6 `killGoal` / `xpPerKill` / `goldPerKill`
retune and the per-map `maxAlive` / `respawnDelay` / aggro knobs from task 4 are **unchanged**.

### Sim (`pnpm sim`, `SIM_SECONDS=2400`, 5 seeds) — archer frontier (the flagged range)

Farm-zone clear time (mean s) / clears, **before** = task-4 baseline (wall at s13),
**after** = this follow-up:

| stage | archer before | archer after |
|---:|---|---|
| s10 | 173 (5/5) | **116 (5/5)** |
| s11 | 456 (wall) | **300 (5/5)** |
| s12 | 610 (wall) | **317 (5/5)** |
| s13 | wall (0/5) | **422 (2/5)** |
| s14 | wall (0/5) | wall (0/5) — now **reached** |
| s15 | wall | not reached |

The archer's frontier wall **moved back s13 → s14**: it now clears s11 + s12 in full and
pushes into s13/s14 (deaths at the belt roughly HALVED — s11 12 vs the old swarm-outs).
Sword + mage frontiers also smoothed from the same AoE-aggro + gradual-fill relief
(sword s13 387→275, s14 584→294; mage s13 364→309) without breaking their walls.

### Acceptance — met

| criterion | result |
|---|---|
| archer wall moves back from s13 → s14/s15 | ✅ clears s12 5/5, s13 2/5, reaches s14 |
| **s15 soft-wall INTACT (no class beats the s15 boss)** | ✅ s15 farm 0/5 for every class that reaches it; no class reaches the s15 boss |
| map1 + map2 = 0 permanent walls / 0 boss wipes, all classes | ✅ all farm + both boss rooms 5/5, **0 wipes** (sword/archer/mage) |
| class change lands at stage 5 | ✅ 5/5 all classes, all seeds |
| autopilot never stalls | ✅ long-run + pure-farm anti-stall tests green (324 tests) |

### Tests

`hunt.test.ts`: gradual-fill test (partial burst → trickles to cap), AoE-aggro rule
(whole cluster damaged but ≤`aoeWakeCap` wake; edge-of-blast passives stay passive;
byte-identical replay = no RNG), min-spacing (no stacked mobs across seeds; deterministic).
`events.test.ts` mobAggroed window widened for the ramped fill. `world.test.ts` offline-replay
assertion made robust to landing mid death-cycle (bounded revive + fresh kill events) —
the RNG-stream shift from min-spacing moves which frame the hero is dead on; progress
(gold banked, kills resumed) is what's asserted.

## Flat shop pricing (2026-07-08, owner call — supersedes the stage-scaled pricing above)

Owner: "ราคาตายตัว... ไม่อยากให้มันยากไป" (players at depth could not afford potions; s30 hp potion had reached 1,605g). `priceStageBase` 1.12 → **1.0**: everything ป้าปุ๊ sells is now its base price forever — hp 60 / mana 45 / return 150 / warp 200. Early game unchanged (base prices were the s1-tuned values); every deeper player pays less. Canonical sim (5400s GEAR+REFINE, 5 seeds, all 4 classes): every gate holds (class-change s5, tier-3 s16, quest boss 5/5, s30 soft-wall unchanged); ninja deaths improved 562 → 449/run (sustain now affordable). KNOWN DEBT (owner-accepted): the potion sink no longer tracks income growth, so late-game gold accumulates faster — owner plans future events/sinks; revisit before the central-marketplace milestone. The scaling machinery stays in code behind the knob.
