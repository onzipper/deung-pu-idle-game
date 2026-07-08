# Balance — ดินแดนอสูร (Asura hard-map) · endgame v1, sim wave 4

Owner gate (docs/endgame-design.md v1.1): with **bot potions ON**, an **L60-70** char —
**+8 BARELY survives z1-3** (real deaths + potion burn, progresses but does NOT wall) · **+9
comfy z4-7** · **+10 comfy z8-10** · **+7 and below = wall at z1**. The refine level should be
**THE key** that opens each band.

Tuning knobs (all `CONFIG.asura` / `CONFIG.killGoal`, global — NO per-class knobs):
`src/engine/config/index.ts`. Verifier: `HARD=1` mode in `src/engine/__tests__/balance-sim.ts`
(env `REFLVL=8,9,10`, `HARD_START=<depth>` band-isolation, `SIM_SECONDS`, `SEEDS`, `CLASSES`).
Locks: `src/engine/__tests__/asura.test.ts`.

## Final knobs

| Knob | Value | Was (W1) | Intent |
|---|---|---|---|
| `killGoal` (asura override, s31-40) | **130 flat** | 396-504 (base curve) | zone-UNLOCK pace = maps 4-6, not a grind. s1-30 byte-identical. |
| `hpMultByDepth` z1..z10 | **1.15 1.18 1.21 · 1.30 1.33 1.36 1.39 · 1.35 1.30 1.25** | 1.0…2.0 | TTK/clear-pace lever (secondary). |
| `atkMultByDepth` z1..z10 | **1.18 1.20 1.22 · 1.28 1.29 1.30 1.30 · 1.24 1.18 1.12** | 1.0…1.45 | incoming-damage = deaths (primary gate lever). |
| `zoneStoneGoal` (ศิลาโซน) | 80 (unchanged) | 80 | SEPARATE long-tail "climb once" counter. |
| `elite` cadence/hp/atk/xp/gold/stone/essence | 60 / 6 / 2.2 / 8 / 10 / 20 / 1 (unchanged) | same | see economy. |
| `hotZone.rewardMult` | 1.4 (unchanged) | 1.4 | daily +40% throughput in 1 zone. |

**Why the deep-zone overlay DAMPS (mults fall z8→z10):** the *base* geometric curve already makes
s40 enemies **~2.3× atk / ~3.0× hp** vs s31 (`(1.19·0.92)^9`, `(1.20·0.94)^9`) — a very steep
inherent ladder. A flat/rising overlay on top makes z8-10 impossible for everyone. The overlay is
sculpted so the **total** enemy atk rises *gently and monotonically* (×1.18→×2.53 s31→s40) — deeper
is always harder, never easier, but +10 stays survivable. `enemyHp/enemyAtk` monotonic-increasing
across s31-40 is asserted in `asura.test.ts`.

## Band table — deaths per 100 kills (killGoal-independent survivability), 4200s × 3 seeds

`d/100kill` (lower = safer) · `*` all zones cleared this band · **bold** = the band's gate refine.

| Class | refine | z1-3 (entry) | z4-7 (mid) | z8 / z9 / z10 (deep) | verdict |
|---|---|---|---|---|---|
| **Sword** (reference) | **+8** | 3.0 / 4.8 / 6.5 * | 11 / 14 / 15 / 16 * | 18 / 19 / 32 * | z1-3 real pressure, deep sweaty |
| | +9 | 2.5 / 3.7 / 6.1 * | 11 / 13 / 15 / 16 * | 18 / 18 / 24 * | mid comfy |
| | **+10** | 2.5 / 3.5 / 5.3 * | 12 / 12 / 15 / 17 * | 18 / 18 / 24 * | **deep comfy** ✅ |
| **Archer** | +8 | 1 / 4 / 5 * | 9 / 13 / 21 / 28 * | 42 / 53 / 64 (z10✗) | deep runs hot |
| | **+10** | 2 / 3 / 3 * | 7 / 13 / 18 / 26 * | 34 / 43 / 60 * | clears z10 only at +10 ⚠ |
| **Mage** | +8 | 0 / 1 / 2 * | 2 / 4 / 5 / 7 * | 8 / 10 / 11 * | trivial ⚠ (ceiling) |
| | +10 | 0 / 1 / 1 * | 2 / 4 / 3 / 5 * | 6 / 6 / 10 * | trivial ⚠ |
| **Ninja** | +8 | 3 / 6 / 10 * | 24 / 34 / 53 / 95 * | 154 (z8✗) | z4 cliff, walls z8 ⚠ |
| | +10 | 2 / 5 / 8 * | 23 / 30 / 48 / 59 * | 98 (z8✗) | walls z8 ⚠ (floor) |

Clear pace (sword): z1 ~70s, z1-3 68-148s (maps-4-6 feel), deep z8-10 ~290-435s (tanky-endgame).
Potion burn (sword): z1-3 6-9, z4-7 15-22, z8-9 ~24, z10 ~190 (z10 = the tankiest grind).

## The core finding — refine CANNOT gate bands via global mults (LOUD FLAG)

**+8, +9, +10 produce nearly identical `d/100kill` in every zone** (sword z8: +8 = 18 vs +10 = 17;
z1-3 +5-vs-+8 within noise; +7 clears z1 as easily as +8). Reason: the refine bonus is
`stat × (1 + N·8%)`, so +8→+10 is only **~10% more stat**, a small fraction of an L65 t10 hero's
total power — and a **global** enemy multiplier scales all refine levels *equally*, so it can never
widen the +8/+9/+10 gap. The only refine-separation that appears is at z10, where +10's extra DPS
shortens the huge-HP fight (sword z10: +8 = 32 → +10 = 24 d/100kill). **"+7 walls at z1" and "refine
is THE key" are NOT physically realizable with the band-multiplier knobs I own.**

**Recommendation (→ owner + `game-engine-specialist`, structural, out of balance scope):** make the
refine gate a **hard door**, matching the owner's literal spec (*"z4-7 ต้อง +9"*): zone-entry
requires min equipped refine (z4 ⇒ +9, z8 ⇒ +10). That makes refine *literally* the key; the band
mults then tune difficulty **within** "you're allowed in" (which is what they now do, tuned to the
gate refine). Alternatives: (b) asura-only steeper refine scaling, (c) a "refine-deficit" enemy
damage amplifier. Option (a) is cheapest and cleanest. **Absent the door**, the ladder still works
as a *depth* escalation (deeper = harder = more reward), just not gated by refine.

## Class outliers (global fit tuned to SWORD; anticipated by the brief)

- **Mage — ceiling, trivializes** (z10 ≤ 12 d/100kill at any refine): ranged AoE apocalypse clears
  fields without taking hits. Safe (no exploit), but the gate never pressures mage.
- **Ninja — floor, walls z8** (z8 ≥ 98 d/100kill even +10; z4 cliff at ~23): thin DEX-glass melee
  in the densest fields (`maxAlive 18`). Hard-capped ~z7. Ninja needs more levels/skill, not more
  refine, for the deep band. (If unacceptable, the only global fix is easing z4-10 for everyone,
  which pushes mage/sword further into faceroll.)
- **Archer — runs hot deep** (z8-10 34-64; clears z10 only at +10): kite-into-cluster exposure —
  the same class-design friction already flagged for s26-30. Doable at +10, sweaty.

Sword satisfies the gate cleanly; archer acceptably-hot; mage/ninja are the flagged structural
outliers. A single global band **cannot** put all four classes at their knee simultaneously
(effective-HP spread is ~3× mage↔ninja).

## Economy (not inflationary)

- **killGoal 130**: zone unlock at ~130 kills (vs 396-504) → maps-4-6 advance pace. The ศิลาโซน 80
  counter is the untouched separate long-tail.
- **Elite** (cadence 60, replaces every 60th spawn): if killed, adds **+11.7% xp / +15% gold** over
  the 60-kill baseline. **Realized far lower** — only 0-6 elites *killed* per run vs ~20-25 spawned
  (6× HP tank; melee often leaves it), so ~2-5% realized. Elite stones (+20 flat) < 5% of stone
  income. **Not inflationary.** essence accrual 0-6/run → craft (~10-15) ≈ 2-3 full climbs ≈ ~1
  active-day — on-target for the v1.3 "first legendary ≈ 1-1.5 day" intent. *Soft flag:* melee banks
  essence ~3× slower than mage; if it feels too slow, drop `elite.hpMult` 6→4 or `cadence` 60→45.
- **Hot zone ×1.4**: +40% xp/gold/stone in 1 of 10 zones/day = a nice "log in, hit today's zone"
  daily bump (throughput, never power). Farm-only-hot = +40% that day; spread = +4% avg. Sane.
- **xp/hr → L65→90 active runway**: sword 103k → **2.3 days** · archer 69k → 3.4 · mage 133k → 1.8 ·
  ninja 51k → 4.6 (active-days = 24h farming; far longer in wall-clock). Healthy endgame long-tail;
  fills the empty L60→90 leveling road the map exists to provide.

## Verification

- **s1-30 canonical BYTE-IDENTICAL** (GEAR+REFINE 1800s × 3 seeds × 4 classes, diff empty) — the
  killGoal override + overlay are identity for stage < 31.
- Full suite **1658/1658**, `tsc --noEmit` clean, eslint clean.
