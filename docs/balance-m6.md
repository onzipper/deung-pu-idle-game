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
