# Balance — นินจา (Ninja), the 4th class (SAVE v18)

Balance close for the ninja (wave 5 of the ninja epic). Tunes ONLY the ninja zone
(`HERO_TYPES.ninja` + `CONFIG.ninja` + the 4 ninja skills + `autoAllocRatio.ninja`);
the swordsman/archer/mage curves are **byte-identical** (canonical sim hash unchanged —
see gate 1). Supersedes the `docs/ninja-design.md §3/§8` draft numbers where the sim
proved a draft value unviable (same authority the auto-alloc-v2 sweep used to overrule
its drafts, `docs/balance-m7.md`).

## Method

Canonical harness `balance-sim.ts` `GEAR=1 REFINE=1 SIM_SECONDS=5400`, 5 seeds, organic
world autopilot. Ninja routed via `CLASSES=ninja` (the env knob now accepts `ninja`;
default `CLASSES` unchanged → the 3-class canonical run is byte-identical). Two harness
fixes were required (both ninja-only, canonical-neutral):
- `baseStatsOf(ninja)` returned the mage base (fell through the else) → now `{str5,dex8,int3,vit4}`.
- `allocStats`/`ISO_STATS` for ninja aligned to the final 4:1:1 ratio.

Boss single-target DPS isolated with `BOSSISO=1` (maxed L90 t10+10 hero per boss room).
Engine wiring (dagger drop-gating, dash primitive, quests) was already complete from
waves 1–4; this wave changed **only balance constants** — no SAVE-shape change, no engine
logic. `dropTableForStage` class-gates the daggers, so a ninja organically rolls its own
`w_dagger_*` line while the 3 legacy tables stay composition-identical.

## Final knobs (draft → shipped)

| knob | draft | shipped | why |
|---|---|---|---|
| `HERO_TYPES.ninja.hpMult` | 1.15 | **1.35** | draft 1.15 death-spiralled (see "hpMult overrule") |
| `HERO_TYPES.ninja.atkSpeed` | 0.45 | 0.45 | kept — fastest cadence identity |
| `HERO_TYPES.ninja.multiHitMult` | 0.55 | 0.55 | kept — effective boss DPS only +6% (see "DPS band") |
| `CONFIG.ninja.twinSplashFrac` | 0.5 | **0.6** | twinfang carries field clear (no AoE signature) |
| `ninja_dashstrike` cost | 20 | **16** | signature; 4/s ≤ baseRegen 7, mana relief |
| `ninja_twinfang` cost/cd/radius | 35 / 8 / 80 | **20 / 7 / 120** | sustained cleave tool |
| `ninja_massacre` cost | **90** | **40** | **CRITICAL: 90 was uncastable** (see "massacre mana") |
| `ninja_massacre` cd/mult/targets | 20 / 1.4 / 8 | **12 / 2.0 / 10** | real tier-2 field burst |
| `ninja_eternal` cost/cd/mult | **170 / 45 / 2.2** | **72 / 14 / 9.0** | reworked into a functional skill-4 |
| `autoAllocRatio.ninja` | `{dex3,vit1}` | **`{dex4,vit1,int1}`** | ratio sweep (below) |

## Gate pass (canonical, ninja, 5 seeds × 5400s, GEAR+REFINE)

| metric | result |
|---|---|
| bosses s5/s10/s15/s20/s25 | **5/5** each |
| boss s30 | **0/5** — soft-wall (reached by all 5 seeds), like sword/mage |
| class-change (t2) | **s5** (5/5) |
| tier-3 evolve | **s16** (5/5) |
| tier-3 quest boss (young Sovereign) | **5/5**, attempts 3,3,5,1,1 (deaths 2,2,4,0,0), winT ~21–22s |
| reached | **map6/s30 all 5 seeds**, final level 60, final gear t10 apocalypse |
| deaths | 562 · boss wipes 72 |
| mana pot/run | **114** · hp pot/run 299 |

**Six gates:** (1) 3-class canonical **byte-identical** — held (hash below). (2) class-2 ~s5 —
held. (3) no permanent wall s16–29, tier-3 reached — held (all farms 5/5, tier-3 @ s16).
(4) s30 soft-wall — held (0/5 boss, reached by all; breaches only at maxed t10+10 in BOSSISO).
(5) mana a real sink — held (114/run, martial band). (6) bosses winnable without perfect play —
held (s20/s25 5/5 organic, young Sovereign 5/5).

## Time-to-clear vs the other classes (farm mean s)

| stage | sword | archer | mage | **ninja** | | stage | sword | archer | mage | **ninja** |
|---|---|---|---|---|---|---|---|---|---|---|
| 5 | 62 | 62 | 74 | **64** | | 20 | 142 | 140 | 182 | **139** |
| 10 | 90 | 89 | 107 | **89** | | 25 | 173 | 193 | 190 | **215** |
| 15 | 119 | 184 | 124 | **255** | | 28 | 203 | 230 | 189 | **356** |
| 16 | 166 | 161 | 149 | **321** | | 30 | 256 | 306 | 235 | **522** |

The ninja is on-pace s1–10, then progressively **slower** than sword through the frontier
(s16 = the tier-2 map4 quest expedition; s26–30 = the deep-map single-target-melee tax).
It never OUT-clears sword (no farm trivialisation). It is a hard-mode class in the archer's
neighbourhood — slower deep-farm, higher potion burn — trading farm efficiency for boss burst
+ mobility.

## Boss TTK (BOSSISO, maxed L90 t10+10) — the clean DPS band

| boss | sword | **ninja** | Δ vs sword |
|---|---|---|---|
| s20 | 5.2s | **4.3s** | **+17%** |
| s25 | 7.2s | **6.9s** | +4% |
| s30 | 13.4s | **14.0s** | −4% |

Effective single-target DPS averages **~+6% over sword** (not the raw basic's ~+22%, which is
eaten by short-range repositioning + the mana-gated kit + a weak-single-target ult). This lands
a touch UNDER the doc's +10–15% target — coherent because `hpMult` landed at 1.35 (less thin than
the draft's 1.15), so a smaller DPS compensation is fair. See FLAG 4 if the owner wants the full band.

## massacre mana — THE critical flag (resolved: cost cut)

The draft `ninja_massacre` (tier-2 ultimate) cost **90** but a DEX ninja's flat pool is **60** —
**uncastable**; its signature tier-2 ult never fired all game (sim: 341 mana pot/run of pure
attrition, walls s15/s16, never reaches tier 3). Decided by sim among {cut cost / add INT /
CONFIG pool bonus}: **cut to 40**. Rationale — this matches the established rule (`docs/balance-m7.md`:
sword_quake/archer_barrage tier-2 ults cost ≤50 precisely so the flat 60 pool affords them). An
INT share was ALSO added (ratio, below) but for pool depth, not to force a 90-cost cast; a CONFIG
pool bonus was rejected (`tier3PoolBonus` is shared config, out of the ninja zone, and would leak
to tier-2). 40 fires reliably in the auto-cast rotation from base 60 AND the 4:1:1 tier-2 pool.

## eternal rework — flagged deviation

Draft `ninja_eternal` (170 / cd 45 / mult 2.2) barely fired (cd 45 vs the peers' 13–16) → the
ninja had NO tier-3 deep-farm clear engine and death-spiralled map5–6 (r2: reached s25, 790 deaths).
Reworked to **72 / cd 14 / mult 9.0**, landing it in the skill-4 band (skyfall 80/14, storm 45/13,
apoc 120/16). This broke the spiral (map5 s21–24 deaths 36/64/75/112 → 5/5/7/14) and carried the run
to s30. Single-target boss contribution stays modest (9× / 14s = 0.64×/s < skyfall's 0.71×/s), so
eternal is a FARM tool — the ninja leans on basics vs bosses. **The spectacle/feel is unchanged**
(render keys off the `skillCast` event; no new event) — only the mechanical role shifted from
"rare big nuke" to "regular field clear."

## Auto-allocate ratio — sweep (canonical, ninja, 5×5400s)

| ratio | DEX share | mana pot/run | deaths | reached s30 | verdict |
|---|---|---|---|---|---|
| **4 DEX : 1 VIT : 1 INT** ✅ | 4/6 (67%) | **114** | 562 | **5/5** | chosen |
| 4 DEX : 1 INT (no VIT) | 4/5 | 94 | 535 | **4/5** | VIT third buys s30 consistency (like sword) |
| 3 DEX : 1 VIT : 1 INT | 3/5 | 95 | 534 | 5/5 | mana drifts to mage-comfort, weaker DPS identity |

**Verdict: 4 DEX : 1 VIT : 1 INT** (mirrors sword's 4:1:1 shape — a MELEE needs the VIT third,
unlike the archer whose every VIT share regressed). DEX stays the 67% damage+tempo majority. The
1/6 INT share (not 1/5) is deliberate: 1/5 INT drops mana burn to ~94 (near the mage's 87 comfort),
1/6 keeps it at **114 in the martial-pressure band** the pacing rule wants. Dropping VIT (4:1)
reached s30 only 4/5 — the VIT trickle earns its place on the thin melee body, exactly as it did
for the sword.

## hpMult overrule — flagged

Draft `hpMult 1.15` was **unviable**: a range-70 melee CANNOT kite the aggressive belt the way the
squishy archer does at range 350, so it ate constant damage — 723 deaths, walls s15/s16, never
reaches tier 3. Raised to **1.35** (still clearly below the sword TANK's 1.5, above the ranged
classes' 0.95–1.0), the ninja reaches the s30 soft-wall at archer-tier deaths (562). This is a
DESIGN-IDENTITY change (the doc's "thinner body" flavour) — see FLAG 1.

## LOUD FLAGS (owner-decidable)

1. **hpMult 1.15 → 1.35 is a design-identity call.** The doc specified a thin body (1.15); the sim
   proved it unsurvivable for a melee. 1.35 keeps "thinner than the tank" but is closer to sword
   than drafted. If the owner insists on 1.15, the ONLY way to make it work is turning the ninja
   into a true glass-cannon (much higher DPS to kill-before-dying), which blows the +10–15% band
   and risks farm trivialisation + a swingy feel — a bigger design change, not a tune.
2. **Ninja is the highest-friction class** (deaths 562, hp 299 pot/run) — the melee-in-the-belt tax,
   same systemic root the archer's friction pass flagged: auto-hunt has no evasion/kite, so a
   short-range hero eats the aggressive belt. Not fixable by pure tuning short of sword-level bulk.
   An engine "dash-to-evade" or aggro-spread behaviour (`game-engine-specialist`) would relieve it.
   Recommend an owner playtest to confirm the *feel* is "hard, mobile" not "grindy."
3. **eternal deviates hard from the draft** (170/45/2.2 → 72/14/9.0). The draft's rare-spectacle
   shape was mechanically non-functional; the reworked skill-4 does the same on-screen (spectacle
   keys off `skillCast`) but plays as a regular field-clear. Owner approved the "shape"; flagging
   the number magnitude.
4. **Boss DPS ~+6% over sword, under the doc's +10–15% target.** Deliberate: I did NOT buff basics
   (that speeds farm → dominant-card risk). With `hpMult` at 1.35 the smaller compensation is
   coherent. If the owner wants the full +10–15%, the lever is a small `dashstrike`/basic bump —
   at the cost of nudging toward "strictly better than sword" on the raw card.

## Gates / determinism

- **3-class canonical byte-identical:** `GEAR=1 REFINE=1 SIM_SECONDS=5400` md5
  `bdd6e2f30150ada52712050e167a0da9` — identical before/after every change (config edits are all
  inside the ninja zone; the daggers class-gate out of the legacy drop tables).
- **No SAVE-shape change** — only balance constants; `SAVE_VERSION`/`migrate()` untouched.
- Vitest **1443/1443** green, `tsc --noEmit` clean, `eslint src/engine` clean. i18n ninja skill
  descriptions (th/en) are number-free flavour text — no stale numbers to fix.
