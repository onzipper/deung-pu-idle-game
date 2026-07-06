# Balance — M7.9 "Grand Expansion" (s16-30 close)

Rebaseline of the maps-4-6 frontier (s16-30), the tier-3 power spike, gear t7-10, and
the three new boss mechanics (charge / summon / hazard). Supersedes the first-pass
smoke numbers in the gear/boss-variety commits (aca6fd4 / 9fe047a / 993c315). s1-15 is
untouched — see `docs/balance-m6.md` (world) + `docs/balance-m7.md` (gear/vendor).

## Methodology

Headless harness `src/engine/__tests__/balance-sim.ts` (deterministic, pure engine),
`GEAR=1 REFINE=1 SIM_SECONDS=5400`, 5 seeds × 3 classes, organic world autopilot (walk
+ auto-cast + auto-allocate + auto-return + accept-quest + evolve + auto-potion + a
death-cadence refine emulation). Two harness additions were required for M7.9 (no engine
change):

1. **Tier-3 quest routing.** The tier-3 quest's second objective is a REPEAT kill of the
   MAP2 boss, but the forward-only autopilot never backtracks — so pre-fix runs NEVER
   reached tier 3 (class-change stage read "5" for all; heroes fought s16-30 as tier-2
   and died catastrophically). The nav autopilot now: while the tier-3 quest is accepted
   + incomplete, stays in map3 to bank kills, then walks LEFT into the map2 boss room
   (directly left-adjacent to map3/s11 in the global zone order), finishes the objective,
   and evolves. Result: **tier-3 fires at s10** (the map2-boss-rekill location) for every
   class/seed, `final tier: 3`.
2. **Boss-isolation mode** (`BOSSISO=1`): drops a maxed L90 tier-3 hero in full **t10+10**
   gear into each frontier boss room — the gate-4 endgame-band verifier the organic run
   (which under-refines on the death-only town cadence) can't reach.

Iterate loop: change `config/**` → `pnpm sim` → read time-to-clear / deaths / boss
clears → adjust. Boss curves tuned via `bossVariety` scales only; farm curves via a
per-stage overlay (identity for s1-15) + per-map hunt knobs + gear stats. No class
multipliers (`HERO_TYPES`), no `autoAllocRatio`, no pre-s16 knob touched.

## Knobs changed (before → after)

**Boss scales** (`CONFIG.bossVariety`) — softened ATK more than HP so fights stay long
(real DPS checks) but survivable-without-perfect-play for the non-caster classes:
- s20 (charge): hpScale 0.85→**0.70**, atkScale 0.90→**0.62**
- s25 (summon): hpScale 0.42→**0.30**, atkScale 0.68→**0.40**
- s30 (hazard): hpScale 0.25→**0.24**, atkScale 0.44→**0.40**

**Boss mechanics** (`CONFIG.bossBehavior`):
- charge `hitMult` 2.4→**1.6**, `hitRange` 95→**78**, `cd` 7.0→**8.0**, `cdEnraged` 4.5→**5.0**
- summon `thresholds` [0.6,0.3]→**[0.45]** (2 waves → 1), `addKinds` ["fast","normal"]→**["normal"]** (2 adds → 1)

**Farm enemy overlay** (NEW, `config/index.ts`, folded into `enemyAtk`/`enemyHp`;
identity for n≤15 → s1-15 byte-identical; s16+ bends the geometric curve down gently):
- `enemyAtkDamp(n)` = 1 for n≤15, else 0.92^(n-15) → s20 ≈0.66, s25 ≈0.44, s30 ≈0.29
- `enemyHpDamp(n)`  = 1 for n≤15, else 0.94^(n-15) → s20 ≈0.73, s25 ≈0.54, s30 ≈0.40
- killGoal / gold / xp per-kill LEFT untouched (leveling + economy stay on-curve; the HP
  damp cuts clear TIME via faster TTK, not the kill count).

**Per-map hunt** (`CONFIG.world.maps`, maps 4-6 only; maps 1-3 untouched) — the belt was
trimmed BELOW map3's tail (a map3-sized aggressive fraction × the high s16-30 enemyAtk
was a death-spiral) and density eased for the single-target archer:
- map4: aggroStart 0.14→**0.07**, aggroEnd 0.20→**0.10**, aggroRadius 150→**140**
- map5: maxAlive 23→**18**, aggroStart 0.18→**0.07**, aggroEnd 0.24→**0.11**, aggroRadius 155→**138**
- map6: maxAlive 25→**16**, aggroStart 0.22→**0.09**, aggroEnd 0.30→**0.13**, aggroRadius 160→**142**
- (belt still ramps monotonically map4<map5<map6, all < map3)

**Gear armor** (`config/items.ts`, t7-10 only; t1-6 byte-identical) — DEF is flat per-hit
mitigation (`damage.ts amount - def`), the sanctioned survival lever vs the belt:
- universal [def,hp]: t7 [16,270]→**[30,300]**, t8 [21,380]→**[46,430]**, t9 [27,530]→**[66,760]**, t10 [35,740]→**[92,1050]**
- t8 class splits: sword [30,250]→**[64,290]**, archer [14,470]→**[34,520]**, mage [11,520]→**[30,560]**

**Harness** (`balance-sim.ts`): tier-3 quest backtrack routing, `isEvolutionQuestOffered`
accept (tier-aware), `BOSSISO` mode, tier-2/tier-3 stage tracking in the report.

## Final results (organic, 5 seeds, 5400s, GEAR+REFINE)

Boss clears (all classes): s5 / s10 / s15 / s20 / s25 = **5/5**; s30 = **0/5** (soft-wall).

| class | class-change (t2) | tier-3 | s20 boss | s25 boss | s30 boss | reached | deaths | boss wipes | mana pot/run |
|---|---|---|---|---|---|---|---|---|---|
| swordsman | s5 | s10 | 5/5 15s | 5/5 13s | 0/5 (wall) | s30 (all) | 522 | 319 (s30) | 23 |
| archer | s5 | s10 | 5/5 16s | 5/5 15s | 0/5 (wall) | s29-30 | 644 | **0** | 52 |
| mage | s5 | s10 | 5/5 13s | 5/5 12s | 0/5 (wall) | s30 (all) | 58 | 0 | 53 |

Boss-isolation (maxed L90 tier-3, full t10+10 gear):

| boss | swordsman | archer | mage |
|---|---|---|---|
| s20 | WIN 7.5s | WIN 8.1s | WIN 7.0s |
| s25 | WIN 7.7s | WIN 8.1s | WIN 8.5s |
| s30 | WIN 17.6s | WIN 18.4s | WIN 14.5s |

Farm-zone clear time (mean s) — steady, monotonic climb; s1-15 unchanged from baseline:

| stage | sword | archer | mage | | stage | sword | archer | mage |
|---|---|---|---|---|---|---|---|---|
| 16 | 110 | 122 | 117 | | 24 | 172 | 303 | 200 |
| 17 | 121 | 131 | 138 | | 25 | 193 | 353 | 234 |
| 18 | 129 | 144 | 142 | | 26 | 226 | 455 | 237 |
| 19 | 130 | 156 | 148 | | 27 | 245 | 562 | 265 |
| 20 | 139 | 177 | 156 | | 28 | 283 | 708 | 283 |
| 21 | 155 | 220 | 207 | | 29 | 321 | 653 | 294 |
| 22 | 158 | 234 | 208 | | 30 | 416 | — | 380 |
| 23 | 169 | 274 | 204 | | | | | |

## The six gates

1. **s1-15 byte-identical** — HELD. Every s1-15 curve INPUT is unchanged: the enemy
   overlays return exactly 1 for n≤15; killGoal/xp/gold/leveling untouched; bossVariety
   s5/s10/s15 = identity (1); gear t1-6 unchanged. Combat is deterministic → identical
   outcomes. (The sim's s13-15 clear-time *measurement* shifts only because the tier-3
   backtrack re-farms map3 as tier-3 — a harness-behavior artifact, not an engine change;
   s1-12 clear times match the pre-change run to the second.) 736/736 tests green.
2. **class-2 ~s5, s15 wall breaks with tier-3** — HELD. class-change(t2) = s5 for all;
   the tier-3 quest completes at s10 (map2-boss rekill), the atk×1.6/hp×1.7 spike (on
   top of tier-2 → effective atk×2.16, hp×2.55) then carries the s15 boss + map4 entry.
   All classes clear s15 boss 5/5 as designed.
3. **s16-29 steady climb, no permanent stall; s25 farm wall fixed** — HELD. All three
   classes clear s16-25 farms 5/5 and the s20+s25 bosses 5/5; farm clear times climb
   monotonically. The first-pass s25 FARM wall (a symptom of the unbeatable s25 boss —
   heroes ground map5 forever) is gone. Sword/mage reach s30 on every seed; archer
   reaches s28-30 (its hard-mode character, see risks) — progressing, not stalled.
4. **s30 soft-wall; all 3 win at t10+10** — HELD. Organic (unrefined t9/t10) walls at the
   s30 boss 0/5; the boss-iso run wins on all three classes at t10+10 (14.5-18.4s — the
   hardest fight, breachable only by a maxed, refined tier-3 hero). The gap between
   "unrefined-t9 wall" and "t10+10 win" IS the soft-wall progression.
5. **Mana a real sink at tier 3** — HELD. tier-3 skill-4 costs ~120 vs a 150-pool str/dex
   hero (tier3PoolBonus 90 → a cast nearly empties the pool). Mana potions/run: sword 23,
   archer 52, mage 53 — a felt sink for all, comparable to the M7.7 targets, not runaway.
6. **Bosses winnable without perfect play** — HELD. s20/s25 clear 5/5 organically for
   every class (autoplay survives charge/summon at the in-band gear); s30 wins for all
   at the refined band. Softening ATK over HP kept them long fights, not lotteries.

## Residual risks / flags

- **Deaths inflate at the deepest frontier (flagged).** Sword 522 / archer 644 vs the s15
  baselines (~24 / ~20) — dominated by (a) the s30-boss retry loop (sword 319 wipes) and
  (b) the archer's map6 farm grind. Mage (58) stays near-baseline. This is expected for
  2× the content behind a hard soft-wall, but the sword s30-boss and archer map6 death
  rates are the highest-friction spots — an owner playtest should confirm the *feel* is
  "hard climb," not "grind wall." Elevated, not a stall.
- **Archer is the hard-mode class.** Its weak single-target arrow-rain wakes clusters it
  can't one-shot (survivor-retaliation), so its deep-farm clear times run ~1.5-2× the
  others. The fix (damp-from-s16 + trimmed belt + eased density) makes it PROGRESS and
  win every boss to s25, but it's on the edge at s26-30 farms. A cleaner fix (its AoE
  power or a VIT share) lives in engine/skills or would break the s1-15 auto-alloc
  invariant — out of scope here; left as a class-design follow-up.
- **Overlay implementation.** The s16-30 enemy damp is a per-stage multiplier folded into
  the `enemyAtk`/`enemyHp` config curves (identity ≤s15). It's config-only (the sim sweeps
  it via `STAGE_*_DAMP_*` consts) — no system logic moved — but a future engineer adding
  a piecewise enemy curve should be aware the geometric base + overlay compose here.
- **Boss-iso stat model.** The maxed-hero stat block is a hand-computed ~270-point ratio
  allocation, not an organically-levelled hero; treat the boss-iso times as directional
  (win/loss + rough duration), not exact.
- **No SAVE bump.** This wave changes only balance constants + gear stats (item IDs frozen,
  unchanged) — no save-shape change, so `SAVE_VERSION`/`migrate()` are untouched.
