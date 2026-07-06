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
