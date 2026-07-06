# M7 Gear & Drops — engine core + gear balance

Branch: `develop` · Builds on [balance-m6.md](./balance-m6.md) (the M6 curves are
**untouched** — M7 adds gear as flat-additive power on top; an unarmored hero's
combat math is byte-identical to pre-M7). Persistence: [persistence-m7.md](./persistence-m7.md)
(DB `ItemInstance` ledger is authoritative; the save `equipped` is a sim cache).

## What landed (engine)

- **Catalog** (`src/engine/config/items.ts`) — **27 templates**, ids frozen ≤64 chars:
  18 weapons (3 classes × tiers 1-6, pure ATK) + 6 universal (class-null) armor
  (tiers 1-6, DEF+HP) + 3 class-specific tier-4 armors (flavour splits). Rarity
  common (t1-2) / rare (t3-5, + class armor) / epic (t6). Tiers band to stages:
  `tierForStage` = t1:s1-2, t2:s3-5, t3:s6-8, t4:s9-10, t5:s11-13, t6:s14-15.
- **Drop tables** — `dropTableForStage(n)` = the on-curve tier's items at per-kill
  chances (common 0.03 / rare 0.02 / epic 0.012 each; summed max **≈0.14**, and
  `maxSummedDropChance()` computes it HONESTLY from the live tables). Bosses are a
  **guaranteed roll**: `bossDropTableForStage(n)` is a weighted pool of the boss's
  on-curve tier **+ the next tier up** (better odds; `rollBossDrop` always mints one).
- **Equip model** — `Hero.equipped {weapon,armor}` (templateId|null). Stats apply
  flat: weapon ATK folds into `heroBaseAtkOf` (so combat + `combatPower`), armor HP
  into `heroMaxHpOf` (equip heals the headroom, unequip clamps), armor DEF is FLAT
  per-hit mitigation in `applyDamage` (hero targets only, floored at
  `CONFIG.gear.minDamage`, guarded on `def>0` so unarmored = untouched). `combatPower`
  gains a DEF term (`power.defWeight`). **classReq enforced engine-side** — the equip
  intent rejects a class-mismatch / wrong-slot / unknown id as a no-op.
- **Deterministic drops** — on every kill, `rollEnemyDrop`/`rollBossDrop` hash the
  persisted `(lootSalt, lootCounter)` via **splitmix32** (`core/hash.ts`) — **NEVER**
  the wave-composition RNG stream (verified: the no-gear sim is byte-identical to
  balance-m6, and existing hunt/world determinism tests pass **unmodified**). The
  counter ticks once per kill (monotonic), the value used is the `rollId`, and an
  `itemDrop {rollId, templateId, x, y, mobId}` event fires on a hit. Server claim key
  = `${characterId}:${rollId}` (idempotent mint).
- **SAVE v10** — adds `equipped` (cache), `lootCounter` (monotonic), `lootSalt`
  (per-save constant, decorrelates drop streams). `migrate` v9→v10 backfills empty
  gear + counter 0 + a salt DERIVED from save content (deterministic, since migrate
  has no seed); a v10 save's own fields are preserved (idempotent). zod schema +
  `FrameInput.equip` added.

## Gear power budget

Flat-additive stats, sim-swept so on-curve gear is **~+10-25% power**; the tier-6
**epic** is the deliberate above-curve reward (~+29% ATK, exceeds the on-curve band).

| tier (band) | weapon ATK | armor DEF/HP | on-curve ATK Δ vs hero |
|---|---:|---:|---|
| t1 (s1-2)  | 3  | 1 / 20  | ~+12-19% |
| t2 (s3-5)  | 5  | 2 / 35  | ~+11-15% |
| t3 (s6-8)  | 8  | 4 / 55  | ~+16% |
| t4 (s9-10) | 11 | 6 / 85  | ~+19% |
| t5 (s11-13)| 15 | 9 / 130 | ~+22% |
| t6 (s14-15, **epic**) | 22 | 12 / 190 | ~+29% (above budget — break tier) |

Class tier-4 armors: `a_sword_t4_fortress` 9/65 (tanky), `a_archer_t4_windcloak`
4/105 (mobile HP), `a_mage_t4_archrobe` 3/125 (caster HP).

## Sim — method

`node .../balance-sim.ts`, `SIM_SECONDS=2400`, 5 seeds, all classes. Two configs:
- **no-gear** (default `pnpm sim`) — drops are rolled but ignored; must reproduce
  balance-m6.
- **`GEAR=1`** — the autopilot "owns" whatever drops and wears the best-scoring
  class-compatible item per slot (weapon score = ATK; armor = DEF·4 + HP), equipping
  toward it one slot/step (the drop-equilibrium run).

## Sim — results

**No-gear = balance-m6, exactly.** Farm-zone clear times reproduce the M6 task-5
table to the second (sword s13 275 / s14 294, mage s13 309, archer s11 300 / s12 317
/ s13 422); class change **s5 (5/5 all classes)**, map1+map2 **0 wipes**, map3 s13/s14
soft-wall intact. **Drops do not perturb the reserved stream.**

**Geared run — softens the frontier, s15 boss unbeaten:**

| farm clear (mean s) | sword no-gear→gear | archer no-gear→gear | mage no-gear→gear |
|---|---|---|---|
| s11 | 90 → 81 | 300 → 110 | 173 → 140 |
| s12 | 170 → 104 | 317 → 206 | 297 → 170 |
| s13 | 275 → 129 | 422 → 238 (0/5→5/5) | 309 → 263 |
| s14 | 294 → 179 (walled→5/5) | wall → 735 | 260 → 367 (1/5→5/5) |
| s15 | wall → 269 (farm 5/5) | wall | wall → 468 (farm 2/5) |

Deaths drop with gear (sword 182→132, mage 71→37). Every class ends wearing the
**t6 epic** weapon + `a_aegis_t6_bulwark`.

### Acceptance — met

| criterion | result |
|---|---|
| no-gear identical-in-kind to balance-m6 (map1/2 clean, class change s5, s15 wall) | ✅ reproduces the M6 table exactly, 0 wipes |
| geared may soften s13/s14 | ✅ s13/s14 clear faster; archer clears s13 5/5, sword/mage clear s14 5/5 |
| **s15 boss stays unbeaten on-curve** | ✅ **0/5 for every class** (sword reaches the s15 boss with full t6-epic gear → 0/5, 1 wipe; mage s15 boss 0/5; archer walls at s15 farm) |
| drops don't perturb existing streams | ✅ no-gear byte-identical; hunt/world tests green unmodified |
| class change at s5 / map1+map2 0 wipes | ✅ 5/5 all classes, both boss rooms clean |

### Intended wall-break (the M7 loop)

Even the **best on-curve loadout** (t6-epic weapon + t6-epic armor, ~+29% ATK,
DEF 12, +190 HP) leaves the s15 boss unbeaten — the wall is ~a multiplicative gap
that a ≤+29% flat bonus can't close. Gear instead buys the **survivability to farm
s13/s14 safely** (sword now clears the s15 *farm*; deaths ~halve), so the break path
is the **gear + XP grind**: over-farm the now-survivable s14 (tier-6 drops) for the
epic set *and* keep leveling toward cap 60. That combined stack — not a single
on-curve equip — is what eventually crosses s15. In the 2400 s sim window it does
**not** cross, which is the intended soft-wall (extended by later content).

## Compromises / notes

- **DEF is flat per-hit mitigation** (floored), not %. Simple + balance-safe
  (unarmored = 0 = no change), but scales down late (a 12-DEF plate barely dents a
  ~240 boss slam) — intentional (armor's late value is its HP + the DPS from the
  weapon). A %-mitigation axis is a future knob if late armor feels weak.
- **`equipped` lives on the live `Hero`; SAVE persists it top-level** (alongside
  `consumables`), NOT under `hero` — keeps the exhaustive `hero`-shape round-trip
  tests untouched and mirrors the server `EquippedLoadout`.
- The DB item ledger is authoritative; the save cache exists only for offline/pre-boot
  power. The boot payload overrides it (GameClient's merge — server zone).

---

# M7.5 — Sell, Bots & Fast Travel (engine)

Branch `develop` · adds engine-side idle automations + fast travel + vendor pricing.
All DETERMINISTIC (no RNG — the wave-composition stream is untouched) and all bots
default **OFF**, so the no-gear / no-bot sim baseline is **byte-identical to M6/M7**
(verified: class change s5, map1/map2 0 wipes, same per-stage clear times).

## What landed (engine)

- **Potion-restock bot** (`systems/bots.ts`, SAVE v11 `state.bot`) — while FARMING,
  if a potion is below its target *and* at least one short potion is affordable above
  the `goldReserve` floor, it makes a town round trip: **warp via a held return
  scroll** (any held — the reserve is only the restock target), else a single direct
  **walk** transit (reusing `respawnToTown`'s walk-home, reason `"bot"`). In town it
  buys potions up to targets + scrolls up to `scrollReserve` within the gold floor,
  emits `townArrived`, then auto-returns to `lastFarmZone`. An **affordability gate**
  prevents a broke-hero trip livelock (it banks gold at the farm until a trip is
  worthwhile). Reuses the death/auto-return machinery — does not fork it.
- **Sell-trip bot** — the client feeds a transient `FrameInput.inventoryCount`; when
  it hits `INVENTORY_CAP` (100) and `sellTripEnabled`, the same town trip fires and
  emits `townArrived { reason }`. The engine knows **nothing** about item instances —
  the client fires the sell API off the event. Trips **coalesce**: restock + sell
  pending together = one trip (`reason: "restockSell"`).
- **SAVE v11** — additive `bot` block `{ enabled, sellTripEnabled, hpPotionTarget,
  mpPotionTarget, scrollReserve, goldReserve }`. `migrate` v10→v11 backfills the config
  defaults (both bots OFF); v11 settings are preserved (booleans coerced, targets
  clamped to the stack cap, gold floor ≥ 0 — idempotent). zod `botSettingsSchema` +
  `FrameInput.setBotSettings` added.
- **Fast travel** (`systems/world.ts`, `FrameInput.fastTravel`) — free hop to any
  UNLOCKED non-boss zone: a `fastTravelCastSeconds` (1.75 s) channel (hero stands
  still — offense frozen) then an instant arrival at the target's **left (entrance)
  gate x**. Rejected (event `fastTravelBlocked { reason }`) for locked / aggro (any
  engaged or in-radius aggressive mob) / dead / same / traveling / boss-phase /
  invalid target; **taking damage cancels** the channel (`"damaged"`). Events
  `fastTravelCastStart` / `fastTravelArrive` carry positions for render fx. The return
  scroll keeps its value (instant even while swarmed; fast travel demands a standoff).
- **Gate transit polish** — a WALK between zones now emits `zoneGateEnter { x, side }`
  at departure (out the travel-direction edge) and `zoneGateExit { x, side }` on
  arrival (in the opposite edge), exactly once each per hop, for render to place
  themed archways + whoosh. Only `"walk"` transits emit them (not scroll / death /
  bot / fast-travel). The M6 rule holds (ground still in zones; scroll only while
  walking) — this is additive events + a small `TravelState` sub-state.

## Vendor price tuning

`vendorPriceForTemplate = round(tier² × rarityMult)`, rarityMult **{common 1, rare
1.5, epic 2.5}** (was the placeholder `3 × tier² × {1,2,4}` — a ~4× cut).

**Goal:** a full 100-slot sell of on-curve drops is a *small-but-felt* share of the
kill gold earned over the time it takes to FILL the inventory at that stage band, so
selling is a bonus and **potions stay the dominant sink**. For a band: fill kills
`K = 100/dropΣ`, kill gold `G = K·goldPerKill(n)`, sell income `S = 100·price`, so
`ratio = price·dropΣ/goldPerKill(n)`.

| band (stage) | on-curve rarity | price/item | dropΣ/kill | goldPerKill | 100-sell | ~ratio vs kill gold |
|---|---|---:|---:|---:|---:|---:|
| t1 (s1–2)  | common | 1  | 0.12  | 4  | 100  | ~3% |
| t2 (s3–5)  | common | 4  | 0.12  | 11 | 400  | ~4% |
| t3 (s6–8)  | rare   | 14 | 0.08  | 18 | 1400 | ~6% |
| t4 (s9–10) | rare   | 24 | 0.14  | 24 | 2400 | ~14% |
| t5 (s11–13)| rare   | 38 | 0.08  | 35 | 3800 | ~9% |
| t6 (s14–15, **epic**) | epic | 90 | 0.048 | 43 | 9000 | ~10% |

All bands land **≤~14%** (mid/late ~9–14%, early lower); monotonic in tier; the epic
break-tier sells highest. t4 tops the range because its class-armor splits raise
dropΣ (0.14) — acceptable. Potions (stage-scaled, ~thousands per restock) dwarf this.

## Sim / smoke verdict

- **Baseline unchanged:** `pnpm sim` (bots OFF, no-gear) reproduces the M6/M7 table
  (class change s5, map1/map2 0 wipes, s1 23s … s9 124s …). Vendor-price + gate-event
  + bot-field additions do not perturb combat/economy/RNG.
- **Restock-bot smoke** (`bots.test.ts`, s6, restock ON, 30k steps): the bot makes
  town trips, the hero keeps farming (kills bank, no livelock/stall), gold stays
  positive, potions hover near targets, and it never strands mid boss room.
- **Determinism:** a fixed-input restock-bot run is byte-identical across two runs.

---

# M7.7 — Skill Spectacle & World Heat (engine)

Branch `develop` · owner-locked spec (ROADMAP "M7.7", 2026-07-06): **skills เบิ้ม —
bigger radius + damage, cooldowns short, MANA = the pacing governor** ("ยิงรัวได้แต่ถังแห้ง
เร็ว" → mana potions become a primary sink alongside hp potions); the world compensates
with **denser fields** (17/19/21) + a raised **killGoal for PACING** (difficulty comes
from the aggressive belt + retaliation, NOT the quota). **Boss stats UNTOUCHED** (owner
deferred boss buffs). Identity: sword = in-the-swarm brawler, archer = zone artillery,
mage = heavy nuker; **tier-2 skills = field-wide ultimates**. SkillKind set unchanged, **no
new ProjectileKind** (barrage reuses the rainArrow fall). **SAVE unchanged (v12)** — skill
ids/kit shape are the same; only tuning + a transient rule changed. Files:
`engine/config`, `engine/systems/{damage,skills,combat}.ts`, `__tests__/skills-m77.test.ts`.

## 1. Skill table (SKILL_LIST) — three layers per class

(a) a **signature spam** layer (bigger + cheaper + shorter-cd than M7, sustained by base
regen), (b) a **utility** layer (kept distinct in role, NOT nuke-ified), (c) a **tier-2
ULTIMATE** that is effectively **field-wide** (coverage spanning the ~900px field).
Ultimates cost <= 50 so they are AFFORDABLE from the flat 60 pool a str/dex class carries
(it allocates str/dex, never int) — a hard gate that nearly empties the pool, but castable
(a 72–90 cost made quake/barrage uncastable → the ultimate never fired for 2 of 3 classes,
a bug caught in the sim: sword drained 0 mana potions until the fix).

| skill | kind | tier | radius | mult | cost / cd | note (M7 -> M7.7) |
|---|---|---|---:|---:|---|---|
| sword_whirl | nova | 1 | 115 | 3.2 | 18 / 5 | signature (r95->115, mult 2.2->3.2, cheaper+faster) |
| sword_warcry | buff | 1 | — | x1.5 | 20 / 16 | utility steroid (kept) |
| **sword_quake** | strike | **2** | **460** | 6.5 | 50 / 10 | **field-wide** shockwave (r120->460) |
| archer_rain | rain | 1 | 46 | 0.9 | 20 / 6 | signature, 9 drops (mult 0.5->0.9; radius held tight — §3) |
| archer_powershot | bolt | 1 | — | 7.0 | 26 / 8 | utility single-target boss nuke |
| **archer_barrage** | rain | **2** | 80 | 1.0 | 50 / 10 | **field-wide** 13-drop blanket (`barrageOffsets`, ~±420 span) |
| mage_meteor | meteor | 1 | 130 | 7.0 | 36 / 6 | signature (r90->130, mult 5.5->7.0, cheaper+faster) |
| mage_frostnova | strike | 1 | 110 | 2.2 | 22 / 5 | utility sustained clear (kept) |
| **mage_cataclysm** | meteor | **2** | **460** | 13.0 | 90 / 11 | **field-wide** sky-fall (r110->460, mult 8->13) |

Signature cost/cd (whirl 3.6, rain 3.3, meteor 6.0 mana/s) all <= `baseRegen` 7/s, so the
**M5 no-hard-stall rule holds** — base regen alone sustains each signature.

## 2. Mana economy — the pacing governor

`regenPerIntPoint` cut **0.15 -> 0.05** (pool `base 60`, `perIntPoint 3.5` unchanged). The
mage keeps its **sustain identity** (signature + frost-nova ~10 mana/s < its ~11–15 regen
-> sustained) but the full heavy kit (adding the ~8 mana/s cataclysm) EXCEEDS regen, so
continuous spam drains even the deep INT pool. Str/dex classes run the flat 60 pool: an
ultimate nearly empties it, so the whole kit is mana-gated in seconds.

**Mana potions are a real sink for all three classes** (`pnpm sim`, 2400 s × 5 seeds,
auto-potion ON at 25%; the autopilot restocks the lower-stock potion on town passes):

| class | mana potions / run | hp potions / run |
|---|---:|---:|
| swordsman | **124** | 115 |
| archer | **181** | 125 |
| mage | **17** (M6 was ~4) | 77 |

## 3. Survivor-retaliation (replaces aoeWakeCap / aoeWakeRadiusFrac)

**ANY passive mob DAMAGED by a hit that SURVIVES (`hp > 0` after) becomes engaged; one
KILLED does not.** Enforced uniformly in `damage.applyDamage` (mob + survives -> engaged),
so it needs **no knob** — the old AoE-aggro cap (`wakeNearestPassives`, `aoeWakeCap`,
`aoeWakeRadiusFrac`) is **removed** and `applyAoeDamage`/`damageInRadius` share one path.
Deterministic (no RNG). The "เบิ้ม" skills one-shot most of a cluster (killed -> silent),
so heat concentrates on the **tough survivors at the frontier**. Basic-attack behaviour is
unchanged (a surviving target retaliates; a killed one is removed).

This is strictly MORE aggressive than the old cap-2 rule, so it bites the squishy
**archer** hardest (its rain self-wakes what it cannot kill). Mitigations kept map2 clean
and the archer walling at its M6 frontier region (s13): the rain radius was held tight
(**46** — a first-pass 70 swarmed map2 to s10 481 s), and the belt fractions trimmed (map1
0.00–0.05, map2 0.04–0.08, map3 0.10–0.16) so the **belt**, not a self-swarm, is the danger.

## 4. Density + pacing knobs

| knob | map1 | map2 | map3 |
|---|---|---|---|
| `maxAlive` | 15 -> **17** | 17 -> **19** | 18 -> **21** |
| `respawnDelay` | 0.75 -> **0.7** | 0.65 -> **0.6** | 0.6 -> **0.55** |
| `aggroStart→End` | 0.00–0.10 -> **0.00–0.05** | 0.09–0.18 -> **0.04–0.08** | 0.15–0.25 -> **0.10–0.16** |

`spawnCandidates` 5 -> **7**. Kill throughput rose ~1.5×, so:

| curve | M6/M7 | M7.7 | per-zone effect |
|---|---|---|---|
| `killGoal` | 16+8n | **24+12n** (×1.5) | clear-TIME held (the pacing lever) |
| `xpPerKill` | 6+2n | **4 + 4n/3** (÷1.5) | XP/zone **byte-identical** (product exact) |
| `goldPerKill` | (3.125+1.25n)·1.05ⁿ⁻¹ | **/1.5** | gold/zone **byte-identical** -> sink %s hold |

`24+12n = 1.5×(16+8n)`, so killGoal×perKill is exactly preserved -> leveling trajectory,
class-change-at-s5, and the map3 wall are unchanged.

## 5. Sim gates — met (2400 s × 5 seeds × 3 classes; no-gear AND GEAR=1)

- **Class change at stage 5 (5/5, every class, both configs).** OK
- **map1 + map2: every farm zone + both boss rooms 5/5, 0 boss wipes.** OK
- **s15 soft-wall INTACT (boss untouched).** s15 boss **0/5 for every class that reaches
  it** — no-gear (sword 0/5, mage 0/5, archer walls s13 farm) AND **GEAR=1** (sword 0/5,
  mage 0/5, archer reaches s14/s15 farm, never the boss). Gear softens frontier farm times
  but does **not** crack the boss — field-wide ultimates alone do not crack s15, so no
  ultimate-mult trim was needed. OK
- **Autopilot never stalls** — all seeds×classes reach the frontier, bank XP (final levels
  46–51); 494 tests green incl. long-run + pure-farm anti-stall suites. OK

### Farm-zone clear time (mean s) — M7.7 no-gear vs the M6/M7 baseline

| stage | sword / base | archer / base | mage / base |
|---:|---|---|---|
| 1  | 27 / 24 | 30 / 28 | 45 / 40 |
| 5  | 74 / 54 | 62 / 51 | 70 / 109 |
| 8  | 72 / 70 | 70 / 66 | 76 / 113 |
| 10 | 86 / 83 | 154 / 116 | 105 / 139 |
| 11 | 90 / 90 | 240 / 300 | 101 / 173 |
| 12 | 109 / 170 | 683 / 317 | 96 / 297 |
| 13 | 148 / 275 | wall / 422 | 135 / 309 |
| 14 | 176 / 294 | wall / — | 215 / 260 |
| 15 | 371 / — | wall | 521 / — |

Early/mid (s1–s10) hold the M6 ballpark. Frontier farms clear **faster** for sword/mage
(field-wide ultimates), but the **s15 boss is the wall** and it holds (0/5). The archer is
the survivor-retaliation-sensitive class: clears map2 clean, walls at s13 (its M6 region),
slower at s12 (683 s) — the accepted cost of removing the wake cap (GEAR=1 already reaches
s14/s15 farm).

## Compromises / notes

- **Ultimates cost-capped at 50** for str/dex castability (60 pool). A bigger gate would
  need a deeper pool (rejected — a deeper pool dries slower, against "ถังแห้งเร็ว").
- **Barrage kind changed strike -> rain** (13 wide drops) for the artillery read; emits
  `rainArrow` (render map already covers it — no new ProjectileKind).
- **Sword/mage frontier FARMS clear faster than M6** (strong ultimates) but the s15 BOSS
  is untouched and unbeaten — the soft-wall is the boss.
- **Archer s12 is heavy (683 s).** Survivor-retaliation on a spammy AoE kiter is inherently
  punishing (the exact interaction the M6 cap addressed); further trimming would blunt the
  "เบิ้ม" intent. Held; gear/refine (M7/M7.6) are the relief.

## Auto-allocate v2 (M7.7 last item, 2026-07-07)

Replaces "dump every point into the class primary" with a **per-class fixed ratio**
(`CONFIG.stats.autoAllocRatio`). Distributor: each unspent point goes to the ratio stat
with the lowest `stats[s] / weight[s]` measured on the hero's **current** stats (tie-break
by fixed str→dex→int→vit order). Deterministic, no RNG, no persisted counter, no
`SAVE_VERSION` bump — it self-corrects around manual allocation and differing class bases.
Capped stats drop out; all-capped → points stay unspent.

Swept on the M7.7 world sim (`SIM_SECONDS=1800`, seeds `1,2,3,42,1337`), no-gear. The
draft (sword 3:1, bow 2:1, mage 2:1) was **overruled** by the data. Totals over 5 seeds:

| class | ratio | total deaths | boss wipes | s15 farm clears | verdict |
|---|---|---:|---:|:--:|---|
| sword | dump STR (baseline) | 183 | 162 | 5/5 | boss-gate death loop |
| sword | 3 STR : 1 VIT | 27 | 3 | 5/5 | fixes the loop |
| **sword** | **4 STR : 1 VIT** ✅ | **24** | **2** | **5/5** | chosen — fewer deaths, more retained DPS (+~7% clear vs baseline) |
| archer | dump DEX (baseline) | 238 | 34 | 5/5 | best; DPS-race kiter |
| archer | 4 DEX : 1 VIT | 269 | 48 | 5/5 | worse (less throughput → more exposure) |
| archer | 2 DEX : 1 VIT | 263 | 5 | **3/5** | worse + new s15-farm soft-wall |
| **archer** | **PURE DEX** ✅ | **238** | **34** | **5/5** | chosen — every VIT share regressed; DEX = damage AND atk-speed |
| mage | dump INT (baseline) | 50 | 34 | 5/5 | fine but wipe-heavy |
| mage | 2 INT : 1 VIT | 43 | 26 | 5/5 | marginal |
| **mage** | **3 INT : 1 VIT** ✅ | **20** | **0** | **5/5** | chosen — mage survives on skill uptime (INT→mana), not HP |

**Chosen ratios:** sword `{str:4, vit:1}` · archer `{dex:1}` · mage `{int:3, vit:1}`.

**Gates (all held on the chosen set):** class-change quest completes ~**s5** (all classes,
all seeds) · **s15 boss soft-wall intact** (0/5, every class) · **0 stalls** (every farm
zone clears 5/5). The primary/damage stat stays the majority (or all) of allocated points,
so no single build is trivialised.

- **Archer stays pure primary** — the sweep disproved the VIT draft. A DPS-race kiter that
  clears the field slower stays exposed longer and dies *more*, so any VIT share strictly
  regressed (and 2:1 opened a fresh s15-farm wall). Its frontier squishiness is a
  content-balance matter (docs/balance-m6.md / gear / M7.6 refine), not an allocation fix.
- **Mage safety scales with INT, not VIT** — more INT deepens the mana pool that sustains
  the skill uptime the caster survives on, so the *less*-VIT 3:1 both out-survived and
  out-cleared the heavier 2:1 (0 boss wipes vs 26).

---

# M7.6 — Refine ("ตีบวก") balance sweep

Branch `develop` · tunables in `src/engine/config/refine.ts` (commit 52d704d draft).
RO-style +0..+10 refine: `refinedStat = round(base × (1 + N × statBonusPerRefine))`
folds through the EXISTING flat-additive equip pipeline (a +0 item is byte-identical to
pre-M7.6). The engine NEVER rolls a refine (server-authoritative); the harness plays the
server for this sweep.

## Method

The balance harness (`src/engine/__tests__/balance-sim.ts`) gained a `REFINE=1` /
`REFINE=sweep` emulation (requires `GEAR=1`). It models a player who **salvages every
non-worn drop on town trips → materials** (RO NPCs are town-only; feedstock capped at the
100-slot inventory), then **greedily refines the equipped gear** when materials + surplus
gold cover the next +1, feeding the resulting +N into COMBAT via the equip intent's
`refineLevel`. The refine roll uses a harness splitmix32 stream — **NEVER** the engine
wave-composition RNG. **Potions buy first**: the engine deducts potion gold from `s.gold`;
refine draws only the post-potion surplus (`wallet = s.gold − refineGoldSpent`), so refine
can never starve the M7.7 mana/hp sink (verified: sword 25 mana/run, archer 101, mage 17 —
in the M7.7 ballpark). Town-trip cadence = the sim's existing death→town→auto-return loop
(bots off). `REFINE_STRESS_SEC=45` adds a fixed-cadence trip (a bot-running player) to
stress the wall against aggressive refining. Sweep: `SIM_SECONDS=2400`, 5 seeds, 3 classes.

## Sweep — one-factor-at-a-time around the draft (aggregated over 15 runs/combo)

| combo | class-chg | s15 boss | s15 farm | +N@s10 (w/a) | +N@s15 (w/a) | mat earn/spend | refine gold % | breaks/drops | attempts→+10 |
|---|---|---|---|---|---|---|---|---|---|
| **draft** (.08 / .45·.35·.25 / gold×1) | s5.0 | **0/15** | 15/15 | 0.3/0.3 | 1.4/2.6 | 1181/792 | 59% | 1/163 | **359** |
| bonus .06 | s5.0 | 0/15 | 15/15 | 0.3/0.3 | 1.4/2.4 | 1179/784 | 58% | 1/163 | 359 |
| bonus .10 | s5.0 | 0/15 | 15/15 | 0.3/0.3 | 1.3/2.6 | 1177/793 | 59% | 1/163 | 359 |
| harsh band (.35·.25·.15) | s5.0 | 0/15 | 15/15 | 0.3/0.3 | 0.9/2.3 | 1176/791 | 59% | 2/163 | **1058** |
| gold ×2 | s5.0 | 0/15 | 15/15 | 0.6/0.3 | 2.6/1.2 | 1115/**391** | 56% | 0/163 | 359 |

## Chosen values = the DRAFT (every excursion rejected)

- **`statBonusPerRefine` = 0.08** (draft kept) — the bonus axis is **outcome-insensitive
  on-curve** (.06/.08/.10 all hold s15 boss 0/15; +N@s15 ≈ identical), because refine only
  reaches +1..~4 at the frontier where the flat gear block is a minority of hero power. 0.08
  is the felt-but-not-runaway middle; .10 adds theoretical late-game risk at a +10 the sim
  can't reach, for no measured gain.
- **`successChance` +8-10 = .45 / .35 / .25** (draft kept) — the harsh band barely moves the
  on-curve outcome but pushes **attempts-to-+10 from ~359 → ~1058** (pointless-slog
  territory). 359 keeps +10 a reachable pinnacle for a dedicated grinder → "lottery but not
  pointless".
- **`cost` gold (`goldPerTier2Level` = 5) + materials (`materialsPerTierLevel` = 1)** (draft
  kept) — gold ×2 flips the binding constraint to GOLD and leaves **materials piling up
  unspent** (392/1115 = 35% consumed) + starves armor (weapon-only refine). The draft keeps
  **materials the real sink** (tanky classes consume 83–89% of feedstock) — the intended
  "salvage ↔ cost ↔ break-loss" balance. `salvageYield` {common 1, rare 2, epic 4} and the
  break/degrade/safe bands are unchanged (they produce the ~1%-of-drops break-loss above).

## Gates — all held on the chosen (draft) set

| gate | result |
|---|---|
| s15 soft-wall INTACT for a geared+refining player | ✅ **0/15 boss** every combo; **0/15 even under `REFINE_STRESS_SEC=45`** (aggressive refining to +N@s15 w4.1/a3.2) — refine softens the frontier farm like gear did, never cracks the boss |
| class change ~s5 unchanged | ✅ **s5.0** every class/seed/combo (refine is barely available that early — realistic runs make ~0–1 town trips before s5) |
| material economy a real sink (constrained, not +10-everything) | ✅ equipped hovers **+1..~4** at the frontier; tanky classes spend 83–89% of feedstock, archer is gold-bound (potions) so materials pile — either way the player is constrained, never at +10 |
| break-loss lottery-like but not pointless | ✅ **attempts-to-+10 ≈ 359**; break-induced item loss ≈ **1–2 items/run vs ~163 drops (~1%)** — well under drop income |
| no-refine byte-identical to the geared baseline | ✅ `GEAR=1` (no `REFINE`) reproduces the geared baseline exactly (s15 boss 0/15, class change s5, levels 44); 541 engine tests green; +0 = ×1 = no effect |

## Expected +N ladder (equipped gear, time-averaged in-band)

| class (cadence) | +N@s10 (w/a) | +N@s15 (w/a) | town trips/run | mat earn/spend | refine gold % |
|---|---|---|---|---|---|
| swordsman (death-only) | 0.0/0.0 | 2.4/3.2 | 2 | 1089/912 | 71% |
| archer (death-only) | 0.6/0.5 | 0.7/0.4 | 70 | 1333/537 | 33% (potion-bound) |
| mage (death-only) | 0.4/0.4 | 1.0/4.3 | 2 | 1121/927 | 72% |
| sword / mage (`STRESS=45`, bot cadence) | ~3.5–4.2/~2.0 | ~4.1/~2.1–3.2 | 27–30 | ~1335/~1150 | 72–79% |

Refine is the **long-missing gold sink** for low-death classes (pre-refine gold accrued
unused): tanky heroes dump ~72% of earned gold into +N. The squishy **archer never benefits**
— its gold is eaten by frontier potions (33% to refine), so materials inflate and +N stays
~+0.5; consistent with the M7.7 finding that archer frontier squishiness is a content
matter, not fixable by allocation/refine.

## Compromises / notes

- **Town-gated cadence under-samples tanky classes** (2 death-trips/run) — realistic runs
  show refine landing late+small, so it barely moves farm times (s1–s10 byte-identical, mild
  s11–14 frontier help). A player running the M7.5 restock/sell bots refines far more
  (the `STRESS` row) — and even that leaves s15 boss 0/15.
- **A fully-ground +10/+10 endgame set is INTENDED to be part of the eventual wall-break**
  (M7's "gear + XP grind crosses s15" path); the gate is that on-curve, in-window refining
  does not DELETE the wall — which holds at every combo and under stress.
- The refine emulation lives entirely harness-side (gold/materials virtual, roll on a
  separate splitmix stream); it mutates only the hero's server-authoritative `equipped.refine`
  (which the engine consumes deterministically), so the reserved wave RNG is untouched.
