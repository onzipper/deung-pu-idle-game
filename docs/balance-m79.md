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

## Archer friction pass (owner: "ธนูตายบ่อยกว่าเพื่อน ช่วยบัพ")

Follow-up to the close above. Owner flagged archer deaths (644) > sword (522) > mage (58).
Investigation overturned the diagnosis, then fixed the real cause.

### Root cause: the harness never cast the tier-3 ultimate (HARNESS BUG)

`balance-sim.ts fillAutoSlots` called `unlockedAutoSlotCount(hero.level)` **without the
tier arg** (it defaults to `tier=1`). The 4th auto-slot is `tierRequired=3`
(`CONFIG.autoSlots.tierRequired = [1,1,1,3]`), so the sim NEVER slotted or cast any
class's tier-3 skill-4 (`archer_storm` / `sword_skyfall` / `mage_apocalypse`) — even
though the engine extends `autoSlots` to length 4 on tier-3 evolve and the real UI passes
tier. **The 644 "farm-attrition death spiral" was an artifact of an archer that never
fired its tier-3 ultimate.** Fix (harness-only): pass `hero.tier`. This changes ONLY s13+
for every class (slot 3 unlocks at L40 ≈ s12-13); **archer s1-12 stays byte-identical**
and s13-15 shifts land inside the band gate-1 already excuses as the tier-3-backtrack
artifact (verified: s1-12 diff empty).

### Corrected baseline (harness fixed, config still shipped)

With the ultimate actually cast, the archer's farm attrition largely evaporates
(s26-29 farm deaths 71/106/158/64 → 4/8/16/21) and its real friction is **boss wipes**:
auto-cast fires `archer_storm` at lone bosses, where its 20 drops scatter ±430 (mostly
missing) AND drain the dex pool → `powershot` starves → **s25/s30 boss wipes + a s25
stall** (only 2/5 seeds cleared past s25). Corrected totals: archer **710** (464 boss
wipes), sword **672** (585 s30-boss wipes), mage **122** (84). All three classes waste
their AoE ultimate's mana at single-target bosses — a systemic auto-cast-targeting issue
(engine, out of scope here; flagged below).

### Knobs changed (archer-only, before → after)

- `archer_storm` (`config/index.ts`): mult **1.1→2.0** (drops now one-shot deep-field
  clusters → fewer retaliating survivors, and the few landing near a boss actually chip
  it), cd **15→13**, radius **80→95**, cost **120→90**. The cost cut is load-bearing:
  at 120 the sustained storm starved the pool (302 mana-pot/run, boss DPS collapsed →
  725 deaths); 90 = 60% of the 150 tier-3 pool, so it's still a real gate (197 pot/run,
  mana sink INTACT) but leaves mana for `powershot` at bosses. Storm is a SUSTAINED ~4s
  barrage (re-cast often), unlike the single-nuke skyfall/apocalypse, so an asymmetric
  cost is justified; sword/mage skill-4 stay 120.
- `w_bow_t9_obsidian` / `w_bow_t10_apocalypse` (`config/items.ts`): ATK **53→66 / 70→88**
  via a new optional `atkOverride` on the `weapon()` factory (class-locked `classReq`,
  so sword/mage byte-unchanged; t9/t10 drop only at s23+, so s1-22 byte-identical). Lifts
  single-target basic+powershot boss DPS (the boss-wipe lever).

### Final results (organic, 5 seeds, 5400s, GEAR+REFINE, harness fixed)

| class | deaths | boss wipes | s25 boss | s26-29 farm deaths | s30 boss | reached | mana pot/run |
|---|---|---|---|---|---|---|---|
| swordsman (unchanged) | 672 | 585 | 5/5 | 5/5/8/13 | 0/5 wall | s30 all | 193 |
| archer (fixed) | **571** | 263 | **5/5** | 15/24/48/65 | 0/5 wall | s30 (4/5) | 197 |
| mage (unchanged) | 122 | 84 | 5/5 | 4/2/3/3 | 0/5 wall | s30 all | 97 |

Archer **710→571** (< sword 672 — owner target met: archer no longer the highest). The
s26-29 farm spiral is flattened + monotonic (15→65, was 71→158); the remaining bulk is
the s30 soft-wall retry loop, the same regime as sword. Sword/mage totals are the
corrected-harness baseline (config untouched; only archer changed — verified byte-equal).

Boss-iso (maxed L90 t10+10, harness fixed): s30 **sword 13.4s / archer 14.9s / mage 12.7s**
— archer is the slowest, NOT trivial; s30 soft-wall preserved (organic 0/5 all classes).

### Gate re-verdicts (all HELD)

1. **s1-15 byte-identical** — HELD (s1-12 diff empty; s13-15 in the gate-1-excused band).
2. **class-2 ~s5 / s15 breaks via tier-3** — HELD (unchanged: t2@s5, tier3@s10, s15 5/5).
3. **s16-29 no stall all 3** — HELD; the archer's s25-boss stall (2/5) is FIXED (5/5), all
   s16-29 farms 5/5.
4. **s30 soft-wall; all win at t10+10** — HELD (organic s30 boss 0/5 all; boss-iso all win,
   archer 14.9s not trivialised by the buff).
5. **mana sink real** — HELD (archer 197 pot/run; storm 90 = 60% of pool, still gating).
6. **bosses winnable without perfect play** — HELD (s20/s25 organic 5/5 all classes).

### Residual flags

- **Systemic: auto-cast wastes the tier-3 AoE ultimate at lone bosses** (all classes; sword
  585 / archer 263 / mage 84 s30-boss wipes). A conditional-cast rule ("skip field-wide
  ultimates when only the boss is present") is an ENGINE change (`systems/skills` auto-cast
  targeting) — hand to `game-engine-specialist`; would cut boss-wipe counts across the board.
- **The harness fix re-baselines the whole M7.9 frontier** (sword 522→672, mage 58→122 as
  REPORTED — their config is byte-unchanged). The pre-fix balance-m79 tables above measured a
  phantom no-ultimate hero; the corrected model is the accurate one going forward.

---

## Appendix — Tier-3 quest REDESIGN (owner "option ข", 2026-07-08)

The tier-3 quest no longer backtracks to the map2 boss. It now ties into the NEW M7.9
frontier: a **single kill objective, scoped to the map4-zone-1 ice-tundra field (s16,
"ทุ่งหน้าด่านทุนดรา")** — no boss objective, no refine condition.

**Design as implemented.** `CONFIG.quest.tier3` = `{ kills: 90, killMapId: "map4" }` (was
`kills:120/killMapId:map3` + a map2-boss objective). `tier3QuestFor` emits ONE
`{type:"kill", count:90, mapId:"map4"}` objective. Accepting the quest (Lv40, tier 2) grants
**deterministic preview access to map4 zone 1 ONLY** (`systems/world.questGrantsZoneAccess`,
derived from `hero.quest` — NOT a persisted unlock); zones 2+ and the boss room stay gated
behind the s15 boss kill. The map-scope on `killMapId` is effectively "zone 1 only" because a
tier-2 hero can't reach the deeper map4 zones during the quest. Flow: tier-2 Lv40 hero
fast-travels into the frontier, banks 90 kills as a dangerous expedition, evolves (atk×1.6 /
hp×1.7), then returns and beats the s15 boss — after which the NORMAL unlock takes over.

**Kill count = 90 (sim-tuned).** Start point 120 (the old map3 count) scaled DOWN for map4's
much tougher mobs. 90 ≈ 42% of `killGoal(16)` (216) — a serious-but-fair frontier grind that
all three classes bank without a permanent stall; a higher count only deepens the squishy
archer's tier-2 exposure for no design gain.

**Sim evidence** (organic, GEAR+REFINE, 5 seeds × 5400s, all 3 classes):

| class | class-2 | tier-3 | reached | frontier stall? | mana pot/run |
|---|---|---|---|---|---|
| swordsman | s5 (5/5) | **s16 (5/5)** | map6/s30 (5/5) | none | 192 |
| archer | s5 (5/5) | **s16 (5/5)** | map6/s30 (5/5) | none | 200 |
| mage | s5 (5/5) | **s16 (5/5)** | map6/s30 (5/5) | none | 93 |

Tier-2-on-s16 viability CONFIRMED: every seed banks the 90 kills as tier-2 and evolves at
s16, then breaks the s15 boss as tier-3 and clears the whole s16-30 frontier (only the s30
boss walls — the intended soft-wall). Archer (the binding squishy constraint) survives the
tier-2 frontier expedition (deaths are frequent but never a permanent stall). No s16 enemy
curve was touched (tier-3 fresh-spike pacing byte-identical); the aggro belt in map4 z1 was
left as-is (0.07 — already trimmed) since no class stalled.

**Access-grant mechanism.** `isZoneUnlocked = isZonePersistUnlocked OR questGrantsZoneAccess`
(used for entering / walk arrows / fast travel). `checkZoneUnlock` guards on
`isZonePersistUnlocked` ONLY, so the quest-granted preview zone NEVER cascades a real unlock
to map4 z2 (the core invariant: no map4 progression without the s15 boss). `effectiveUnlockedZones(state)`
folds the grant into a COPY of the count map (never mutates/persists it) — the UI zone /
fast-travel surface reads this (GameClient snapshot) so the preview zone shows through the
same `unlockedZones` read path.

**Migration.** The quest id (`tier3_<cls>`) and persisted `HeroQuest` shape are unchanged, so
NO `SAVE_VERSION` bump. An in-flight OLD-shape quest (2-entry progress: map3 kills + map2 boss)
is caught by an objective-length guard in `normalizeQuest` (version.ts) + its twin
`normalizeHeroQuest` (state/index.ts): a saved accepted tier-3 quest whose `progress.length` ≠
the new def's objective count (1) is RESET to `null` (re-offered at L40) — never crashes, never
mis-maps the old count.

**Gate verdicts (re-verified):** s1-15 engine byte-identical (no curve touched; the
checkZoneUnlock guard is a no-op for persist-unlocked zones) — HELD. class-2 ~s5 — HELD.
tier-3 achieved without stall (s16, 5/5 all classes) — HELD. s15 boss breaks with tier-3 after
(reaching map4-6 requires the s15 boss kill) — HELD. s16-30 + M7.9 frontier gates — HELD (only
s30 boss walls). Mana sink intact — HELD.

## Appendix — Tier-3 quest BOSS objective (owner "fight the MAP4 boss", 2026-07-08)

The tier-3 quest gains a **SECOND objective** after the 90-kill grind: **defeat the map4 boss**,
a quest-scaled "young" Glacial Sovereign. The real s20 Sovereign (`bossVariety[20]` hp×0.7/
atk×0.62) is tier-3-tuned and provably unbeatable at tier 2, so while the quest is the ACTIVE
reason for boss-room access the Sovereign spawns with softer **quest-override scales** instead.

**Design as implemented.** `CONFIG.quest.tier3` gains `{ bossKills:1, bossHpScale:0.58,
bossAtkScale:0.5 }`. `tier3QuestFor` now emits TWO objectives (0 = `kill×90 @map4`, 1 =
`killBoss×1 @map4`; order load-bearing). The access grant EXTENDS to the map4 boss room once
objective 0 is banked (`questGrantsZoneAccess` + `isTier3BossObjectiveActive`) — zones 2-5 stay
locked (the boss-room grant is a per-loc boolean, deliberately NOT folded into
`effectiveUnlockedZones`, which a count map can't express). "Challenge" from the frontier walks
DIRECTLY into the boss room (non-adjacent, z2-5 never traversed). `startBossFight` picks the
override via `tier3QuestBossScale` (keys off QUEST STATE, not tier — a post-quest tier-3 hero
gets the REAL boss). The young Sovereign KEEPS the CHARGE mechanic + telegraphs (teaches the s20
fight early); only hp/atk soften. Beating it completes the quest + rewards the fight but SKIPS
the map unlock / HOF s20 record / guaranteed drop (`onBossKilled` guards on the captured
`isTier3QuestBossFight` flag) — the hero still returns to beat the REAL s15 boss for the
persisted map4 unlock. The grant revokes the instant objective 1 fills / the quest is consumed.

**Scales = 0.58/0.5 (sim-tuned).** The real boss's 0.7/0.62 stalls sword/archer hard (0-1/5
wins) while the mage facerolls — the CHARGE punishes the melee/archer who must close. Softening
to 0.58/0.5 (a genuinely "young" version, ~83%/81% of the real hp/atk) makes it a real,
multi-attempt-tolerant fight: **sword 2-3 attempts (1-2 deaths), archer 1-2 (0-1 deaths), mage 1
(0 deaths)**, every class winning in **~20-26s** (well under the 60s target), **no seed where a
class never wins**. The harness now FARMS ~70 frontier kills between failed attempts (a real
player grinds gear/xp before retrying) — this smooths the sharp "faceroll-vs-never-win" cliff
that immediate re-challenging created, so a marginal seed builds power to a guaranteed win.

**Squishiest-class survivability (owner constraint).** Archer tier-2 Lv40 max-HP ≈ 1015 (+gear);
the charge hit = `round(atk × charge.hitMult 1.6)` = `round(round(bossAtk(20)×0.5) × 1.6)` ≈ 275,
**~27% of HP** — a scary telegraphed spike, never a one-shot. Verified in the engine suite
(`grand-expansion-tier3.test.ts`: `chargeHit < maxHp*0.5`).

**Sim evidence** (organic, GEAR, 5 seeds; quest-boss line from the balance-sim report):

| class | quest-boss attempts | deaths | won | win time | tier-3 | reached (4600s) |
|---|---|---|---|---|---|---|
| swordsman | 2,3,1,2,1 | 1,2,0,1,0 | 5/5 | ~20s | s20 (5/5) | map6/s30 |
| archer | 1,2,1,2,1 | 0,1,0,1,0 | 5/5 | ~26s | s20 (5/5) | map6/s30 |
| mage | 1,1,1,1,1 | 0,0,0,0,0 | 5/5 | ~22s | s20 (5/5) | map6/s30 |

**Migration.** Still NO `SAVE_VERSION` bump — the quest id + `HeroQuest` shape are unchanged.
The 1→2 objective-count change rides the SAME objective-length guard (`normalizeQuest` +
`normalizeHeroQuest`): an in-flight length-1 (option-B) quest resets to `null` (re-offered at
L40) rather than mis-map the banked kills onto the wrong objective. Verified crash-proof in the
suite (both a migrate() reset test and a live `initGameState` reset test).

**Gate verdicts (re-verified):** s1-15 engine byte-identical (no curve/`bossVariety[5/10/15]`
touched; every new branch is guarded off quest state) — HELD. tier-3 achieved without stall (now
s20, after the boss fight — "may shift later than s16" per owner) — HELD. s15 breaks post-tier-3
(mage 3.5s, 5/5) — HELD. s16-30 pacing monotonic to s30 — HELD. Mana sink intact (51-149 pot/run)
— HELD. s30 boss soft-wall (0/5 clears, reached by all) — HELD.

**Events / render.** No new events — the young Sovereign reuses the full boss lifecycle
(`bossSlamTelegraph/Land`, `bossChargeTelegraph/Hit`, `bossEnraged`, `bossDefeated`, …). The
render `bossVariety`/CHARGE fx key off `mapId` (map4 → ice-tundra + charge visuals), NOT boss
stats, so the scaled boss draws identically. The render side needs NOTHING new.

---

## Mana relief pass (owner request 2026-07-08)

Owner: **"มานาใช้เยอะไป ซื้อยามานาจนตังหมด"** — mana burn is too aggressive; the flat-pool
str/dex classes (esp. sword mid-late + the owner's own run) drain gold on mana potions. Goal:
roughly **halve** sword/archer mana-potion burn, keep the mage ~as-is (already tiny), and hold
every M7.9 gate. Mana stays a real sink (owner: don't make it irrelevant) — just not bankrupting.

### Diagnosis

Potion count ≈ (mana consumed beyond regen, over the frontier where the sink bites) ÷ (restore
per potion = `restoreFrac 0.45 × MAX mana`). Candidate levers, judged for the "keep mage as-is"
constraint:

- **baseRegen / regenPerIntPoint up** — rejected: both cut the mage's burn as much as (or more
  than) the flat classes' (mage sits near regen break-even on a deep pool), so they can't relieve
  sword/archer without also slashing the mage. Not mage-neutral.
- **manaPotion.restoreFrac up** — rejected: a uniform % restore boost cuts ALL classes equally,
  so it would drop the mage by the same fraction. Not mage-neutral.
- **tier3PoolBonus up (chosen)** — an ADDITIVE pool bump is a large % restore for the shallow
  str/dex pools (~250) but a tiny % for the mage's deep INT pool (~615). Asymmetric by
  construction, and tier-3-only → s1-15 untouched.
- **Per-skill cost down, tier-3 skill-4 ONLY (chosen)** — cutting consumption directly. Only
  `sword_skyfall` / `archer_storm` qualify: they unlock at L40 and auto-cast solely from the
  tier-gated slot 4 (evolve ~s16), so they touch ONLY s16+. The other big archer drains
  (`archer_barrage` L15, `archer_powershot` L8) and sword's `sword_quake` (L15) fire from ~s6+,
  so cutting them would break the s1-15 byte-identical gate — left untouched. The mage kit is
  left 100% byte-identical (relief comes only from its share of the pool bump).

### Knobs changed (before → after)

| knob (`config/index.ts`) | before | after | scope |
|---|---|---|---|
| `mana.tier3PoolBonus` | 90 | **170** | tier-3 only (evolve ~s16); mage-light by design |
| `SKILLS.sword_skyfall.cost` | 120 | **80** | tier-3 skill-4, s16+ only |
| `SKILLS.archer_storm.cost` | 90 | **45** | tier-3 skill-4, s16+ only |

`mage_apocalypse` / `mage_cataclysm` / all tier-1/2 skills / all farm+boss curves: **unchanged.**
No `mana.base`, `baseRegen`, `regenPerIntPoint`, `restoreFrac`, or `autoAllocRatio` touched (those
would hit s1-15 and/or the mage). No SAVE-shape change.

### Before / after (organic, 5 seeds × 5400s, GEAR+REFINE — the canonical mode)

Mana-potion burn (the sink) and deaths:

| class | mana pot/run before | after | Δ | deaths before | after |
|---|---|---|---|---|---|
| swordsman | 198 | **103** | **−48%** | 657 | 543 |
| archer | 210 | **112** | **−47%** | 478 | 360 |
| mage | 94 | **87** | −7% (as-is) | 38 | 49 |

Gold spent on mana tracks the count at the stage-scaled price (`45 × 1.12^(stage-1)`, bought
mostly at the frontier) — so gold-on-mana falls ~in step with the count (≈halved for sword/archer).
Deaths IMPROVED for both flagged classes vs baseline (the deeper pool + cheaper storm also cut
archer's wasteful boss-spam death loop, 478 → 360; sword 657 → 543); mage deaths flat (38 → 49).

Time-to-clear (mean s) — s1-15 **byte-identical** (diff empty; all three levers are tier-3 /
L40-gated); s16-30 modestly faster from the extra skill uptime, never trivialised:

| stage | sword b→a | archer b→a | mage b→a |
|---|---|---|---|
| 20 | 142→140 | 143→140 | 193→182 |
| 25 | 184→173 | 209→193 | 182→190 |
| 30 | 261→256 | 407→306 | 299→235 |

(archer s30 407→306 is the biggest single gain — the storm relief eases the hard-mode class's
deep-farm grind; s30 boss still walls.)

### Gate checklist (all HELD)

1. **s1-15 byte-identical** — HELD. Farm-time diff s1-15 is EMPTY; every changed knob is tier-3 /
   L40-gated (heroes are tier 1/2 through s15). s5/s10/s15 boss = 5/5 all classes.
2. **class-change ~s5** — HELD (s5, 5/5 all classes/seeds).
3. **tier-3 quest reached, no stall** — HELD (tier3 @ s16 all; young-Sovereign quest boss won
   5/5 all classes at ~20-25s; all reach map6/s30).
4. **s16-25 climb + s20/s25 bosses** — HELD (s20 5/5, s25 5/5 all classes; farm times monotonic,
   modestly faster, not trivial).
5. **s30 soft-wall** — HELD (s30 boss 0/5 all classes; reached by all).
6. **Mana a real sink** — HELD. Sword 103 / archer 112 / mage 87 pot/run — a felt gold sink for
   all three, just no longer bankrupting. skyfall 80 ≥ the tier-2 quake (50); storm 45 stays a
   real chunk; the sink SPIRIT (mana matters, isn't irrelevant) is intact even though the
   individual "ultimate nearly empties the pool" gating softens by owner intent.

**Tests / typecheck.** `grand-expansion-tier3.test.ts` "meaningful mana cost" updated to the new
exact costs (80 / 45) with a `≥40` floor guard (never trivial); the tier-3/L40 STRUCTURAL gate
asserts are untouched. 1044/1044 vitest green, `tsc --noEmit` clean. No SAVE bump.

---

## หินเสริมพลัง drop conversion (M7.6 follow-up, owner 2026-07-08)

**Ask.** Refine materials came ONLY from SALVAGING gear (M7.6: server-minted into
`Character.materials` on the salvage endpoint). Owner found salvage cumbersome → enhancement
**stones now DROP from mobs directly and auto-collect into the SAME `materials` counter**. Salvage
stays a source for now; a later server/UI wave removes it (existing stockpiles survive = the
compensation). Engine-side only here.

**Mechanism / stream choice.** A stone roll rides every kill's gear roll (`systems/gear`
`rollEnemyDrop`/`rollBossDrop`). It hashes a SEPARATE domain-tagged stream (`core/hash.stoneFloat`
= `lootHash(salt ^ STONE_DOMAIN, counter)`) off the **same persisted `(lootSalt, lootCounter)`** the
gear roll uses — **reusing the counter, consuming NO extra tick**. So the gear-drop cadence is
untouched → the existing gear sequence is byte-identical, and there is **no SAVE-shape change / no
`SAVE_VERSION` bump** (a second persisted counter would have forced one; it buys nothing since
`splitmix32`'s avalanche fully decorrelates the two streams off a constant XOR). Never the wave RNG.

**Claim contract (server agent).** New per-step event `stoneDrop { rollId, qty, x, y, mobId }`.
`rollId` = the kill's loot-counter value (SAME id as that kill's gear `itemDrop`, if any). The
server credits `Character.materials += qty`, **idempotent on claim key `${characterId}:stone:${rollId}`**
— namespaced apart from gear's `${characterId}:${rollId}` so a kill that drops both never collides.
Monotonic + save/load-disjoint like gear (no re-credit on reload/offline replay). Follows the gear
claim idiom exactly; the `:stone:` prefix keeps the server change additive. (Render/UI wave: this
event kind needs a toast + fx map entry — footgun #6; unhandled it falls to the safe FX default.)

**Config (`CONFIG.stoneDrops`, all sweepable).** `mapTier` = ceil(stage/5) clamped to 6.
- Normal kill: drop chance `baseChance 0.18 + (mapTier-1)*chancePerMapTier 0.02` (→ 0.18…0.28);
  qty `qtyBase 2 + (mapTier-1)*qtyPerMapTier 1` (→ 2,3,4,5,6,7).
- Boss kill: GUARANTEED `bossBonusBase 8 + (mapTier-1)*bossBonusPerMapTier 4` (→ 8…28).

**Rate tuning — income before/after vs salvage-era** (canonical sim: `GEAR=1 REFINE=1`, 5 seeds ×
5400s, full climb to s30). Target = the salvage-era material BANK, ±20%, never a nerf.

| class | salvage-era `mat earned`/run | หินเสริมพลัง stones/run | Δ |
|---|---|---|---|
| swordsman | 9008 | 8633 | −4.2% |
| archer | 8533 | 8575 | +0.5% |
| mage | 8441 | 8625 | +2.2% |

All within ±5% — a clean match (materials were never the binding refine constraint anyway: banked
~9000 vs spent ~4000-5000, GOLD gates refining, so `+N`-reached / attempts are unchanged). Stone
income is deep-weighted like salvage — mean stones/run by map: **m1 ~122 · m2 ~402 · m3 ~811 ·
m4 ~1471 · m5 ~2300 · m6 ~3504** (deeper maps trickle bigger stacks, matching salvage's own
tier-weighted yield and the tier-scaled refine cost).

**Gates (all HELD, byte-identical s1-15 gear drops).** Gear `drops`/run byte-identical to the
pre-stone baseline (sword seed1/2 `572,537` = baseline `572,537`; archer `573,536`; mage `572,544`)
+ a unit test proves the whole `itemDrop` sequence matches a pure gear-only recompute off
`(salt,counter)`. Class-change **s5** (5/5 all classes), tier-3 quest reached **s16** + young
Sovereign won 5/5, s20/s25 cleared, **s30 boss soft-wall intact** (0/5). Refine attempts/breaks
unchanged (119-133 attempts, 4-7 breaks / ~550 drops).

**Tests / typecheck.** +7 tests (`stone-drops.test.ts`: stream primitive independence, drop
determinism, qty depth-scaling, **stream isolation** = gear byte-identical + one-tick-per-kill,
claim-key uniqueness/idempotence + save-load disjointness). **1051/1051** vitest green,
`tsc --noEmit` clean, eslint clean. No SAVE bump.

---

## Float determinism rebaseline (party P1a) — 2026-07-07

**What & why.** Lockstep party (M8) needs the sim to be bit-identical across JS engines
(V8/JavaScriptCore/SpiderMonkey). IEEE-754 only mandates correct rounding for `+ - * /` and
`sqrt`; `Math.sin/cos/pow/hypot/...` are implementation-defined and can diverge by an ULP →
desync. All such calls whose RESULT ENTERS SIM STATE were moved to the new
`src/engine/core/dmath.ts`: `dsin/dcos` (4096-entry quarter-wave LUT + lerp, the table itself
built at load from a Taylor polynomial using only `+ - *` — never `Math.sin`), `dhypot` (=
`sqrt(x²+y²)`, IEEE-exact), `dpow` (exact integer exponentiation-by-squaring). Call sites swapped:
mob wander `sin` (combat.ts), two projectile-distance `hypot` (combat.ts), and every growth-curve
`Math.pow` (config: enemyHp/enemyAtk/bossHp/bossAtk/goldPerKill/xpToLevel/enemyAtk|HpDamp; shop
priceStageBase). A source-scan guard test (`float-determinism-guard.test.ts`) fails the build if a
banned `Math.*` transcendental reappears in `engine/` outside dmath/tests.

**Observed drift = ZERO at reporting resolution.** Ran the canonical `GEAR=1 REFINE=1
SIM_SECONDS=5400` (5 seeds × 3 classes) and `BOSSISO=1` BEFORE and AFTER the swap on the same
current code: **every reported metric is byte-identical** — deaths (sword 543 / archer 360 / mage
49), mana pot/run (103 / 112 / 87), stones/run (8633 / 8575 / 8625), quest-boss winT, and BOSSISO
s20/s25/s30 win-times (s30 sword 13.4s / archer 14.9s / mage 12.7s). Reason: every `pow` result
flows through `Math.round` in a config curve, so the sub-integer `dpow` delta rounds to the same
integer; the `dsin` wander perturbation is <1e-4 px and never crosses an engagement threshold in
these runs. The underlying raw floats do shift microscopically (dsin/dpow ≠ libm bit-for-bit) —
that is the intended one-time move — but it stays below the sim's measurement resolution.

**Gates (all HELD):** class-change s5 (5/5), tier-3 quest reached s16 + young Sovereign won 5/5,
s20/s25 organic clears, **s30 boss soft-wall intact** (organic 0/5, BOSSISO wins all t10+10), no
stalls to the frontier, mana relief + stone income unchanged. **This is the new baseline.** No
curve was retuned; no SAVE bump. Vitest 1069/1069 green (+13 dmath/guard tests), `tsc` + eslint
clean.

## Cohort exp pass (M8 P4 era) — same-zone party reward — 2026-07-07

**Goal (owner, `docs/party-design-m8.md` §3 + answers):** farming TOGETHER in the SAME zone is
rewarded (exp buff + shared exp); different zones = nothing; **drops + gold stay personal**
("จอใครจอมัน"). Activate the three inert P1b hooks (`CONFIG.party.*`) and tune so 2-3p same-zone
progression is meaningfully faster **per member** than solo (~1.2-1.5× xp/hr, an incentive) but
NOT a mandatory meta (<1.6×), with no starvation and the s15/s30 walls intact.

### Mechanics wired (engine, no SAVE bump — all curves transient config)
- **Shared xp** (`systems/leveling.grantKillXp`): every ALIVE cohort hero banks a kill's xp ×
  `party.expKillMult(size, alive)`. The engine does NOT attribute a kill to one hero (no
  `lastHitBy`), so this credits the design §5 **equal-to-all-present** form = the mean-field of
  "killer 1.0 + others share" (identical in aggregate when heroes kill at equal rates). True
  per-killer anti-leech attribution needs a structural `applyDamage` change → **flagged for
  `game-engine-specialist`** (out of a balance-tuning scope).
- **Density** (`systems/hunt.updateSpawns`): `maxAlive` × `party.spawnMaxAliveScale(size)`.
  Scales the field cap only — NOT `killGoal` (zone-unlock quotas stay personal/unchanged) and NOT
  the seeded spawn draw order.
- **Gold**: `party.goldShareMult` kept **INERT** (identity) per owner — gold is personal.

### Knobs chosen (drafts → tuned)
| knob | draft | shipped | per-size effect |
|---|---|---|---|
| `PARTY_EXP_SHARE_RATE` | 0.5 | **0.6** | non-killer present hero's share of a kill's xp |
| `PARTY_EXP_BUFF_PER_MEMBER` | +0.10 | **+0.04** | cohort xp buff: 2p ×1.04, 3p ×1.08 |
| `PARTY_SPAWN_SCALE_PER_MEMBER` | — | **+0.50** | maxAlive: 2p ×1.5, 3p ×2.0 |

Net per-hero-per-kill xp multiplier `expKillMult`: 2p ×0.832, 3p ×0.792 (below 1 — a present
non-killer gets a *fraction* of a kill they didn't land; the per-member GAIN comes from the extra
kills happening in the shared field + faster survival, not a raw >1 multiplier).

### Results (1800s × 5 seeds, per-member xp/hr vs a size-1 baseline through the same runner)
| class | 2p xp/hr× | 3p xp/hr× | 2p kills/hero/min | 3p kills/hero/min |
|---|---|---|---|---|
| swordsman | **×1.25** | **×1.26** | 64% of solo | 45% |
| archer | ×1.57 ⚠ | ×1.66 ⚠ | 78% | 56% |
| mage | **×1.32** | **×1.34** | 68% | 47% |
| mixed[sw,ar,mg] | — | **×1.46** | — | 51% |

Sword + mage land squarely in the 1.2-1.5 incentive band; **mixed 3p = ×1.46**. Deaths PER BODY
drop sharply in a cohort (e.g. archer solo 45/run → 28 across 2 bodies / 16 across 3) — the co-op
survival benefit is the dominant driver of the net gain (fewer respawns → deeper reach → xp/kill
compounds geometrically), which is why the fixed-horizon xp/hr multiplier is larger than the raw
`expKillMult`.

### The buff-vs-ceiling structural finding
Solving "sword-2p ≥ 1.2 **and** archer-3p < 1.6" simultaneously forces `expBuffPerMember ×
expShareRate → 0`: a *per-member* buff hands a 3p cohort **2×** the boost of a 2p one, colliding
with the archer's already-high 3p snowball. So the buff is held to +0.04 (genuinely live, but
small). If the owner wants a bigger, safe buff, make it **flat per-cohort** (same at 2p/3p)
instead of per-member — a design change, not a tune.

### Open flags (owner decisions — nothing silently changed)
1. **⚠ Archer runs hot (×1.57/1.66).** This is a *denominator artifact* of the known solo-archer
   frontier death-spiral (this doc's "Archer friction pass"): solo archer walls at s15 with ~45
   deaths, so grouping rescues it disproportionately. Options: (a) accept — party rescuing the
   frontier-friction class is arguably good; (b) fix solo-archer survivability further (class task,
   not party); (c) flat-buff. **Not fixed here** — flagged.
2. **⚠ Kills/hero/min = 45-65% of solo (below the ~70% "no starvation" goal).** Root cause is NOT
   mob scarcity — it's **auto-hunt TARGET-CLUSTERING**: both heroes chase the *nearest* mob and
   converge, capping cohort TOTAL throughput at ~1.1× (2p) regardless of density (raising
   `maxAlive` ×1.4→×2.0 barely moved it). Real fix = spatial target-spreading in auto-hunt
   (**structural, `game-engine-specialist`**). The reward is carried by SHARED xp, so per-member
   *progression* is still clearly ahead despite the lower personal kill rate.
3. **⚠ Bosses melt at headcount.** s5/s10 clear in **0.05-0.54× solo time** at 2-3 bodies (s15/s20
   likewise once the faster-levelling cohort arrives); the sim doesn't reach s25/s30 in 1800s but
   the melt is monotonic in body count, so the deep soft-walls would melt to 2-3 *maxed* bodies
   too. **Boss HP-per-headcount scaling is a DESIGN decision for the owner** — NOT silently
   applied (per the task's "flag loudly, don't silently buff boss HP"). Note the walls that matter
   for gating (personal drops/gold, personal zone-unlock quotas) are untouched; only shared XP
   accelerates leveling.

### Quota semantics in a cohort (documented, NOT redesigned)
`state.kills` (the farm-zone unlock counter) and `zoneKills` (persisted per-zone progress) are
**shared-state, single counters** incremented **once per mob kill** in `resolveDeaths`
(`state.kills++`), regardless of how many heroes are present — P1b swept quests/economy to hero
*loops* but left these as one shared tally. So a cohort fills a zone's `killGoal` at the COHORT's
combined kill rate (faster wall-clock), but the QUOTA VALUE (`killGoal(n)`) is unchanged and NOT
scaled by headcount — i.e. the zone-unlock requirement stays "personal-sized" and is reached
sooner simply because more bodies kill faster. `spawnMaxAliveScale` deliberately scales density
only, never `killGoal`, so quotas are never inflated by party size. (Class-change / tier-3 kill
quests are per-hero `hero.quest.progress`, advanced per hero in `advanceQuestObjective`.)

### Gates
- **Solo canonical sim BYTE-IDENTICAL** (diff of `pnpm sim` before/after = empty): the size-1 fast
  path returns identity on every cohort curve (`expKillMult(1,·)=1`, `spawnMaxAliveScale(1)=1`).
- Engine vitest **549** green, full repo **1238** green; `tsc --noEmit` + eslint clean. New tests
  (`party.test.ts`): share/buff config math, alive-count division (dead member earns nothing),
  slot-order xp symmetry, and the 1-hero solo-identical guard.
- Harness: `PARTY=2|3` (+ `PARTY_MIX=1`) cohort mode added to `balance-sim.ts` (per-hero input
  lanes; per-member xp/hr, kills/hero/min, deaths, farm/boss clear vs a size-1 baseline). Dev
  `PSHARE`/`PBUFF`/`PSCALE` env override for sweeps (sim-only, like `applyRefineCombo`).

## Party feel pack (engine wave) — closes the 3 Cohort-exp flags — 2026-07-08

Three owner-approved decisions, engine-only, no SAVE bump (all transient config). Solo canonical
sim BYTE-IDENTICAL for ALL FOUR classes (state-hash diff empty). Repo 1555 green; tsc/eslint clean.

1. **Target SPREAD (flag 1, "มอนไม่พอแบ่ง").** `systems/combat.updateHeroes`: a MULTI-hero cohort
   fans out — each MELEE hero prefers the nearest UNCLAIMED farm mob (claim = a lower-slot hero's
   approach target this step), sharing when mobs < heroes. RANGED heroes keep plain nearest (they
   fire from a standoff; forcing them onto a farther mob only adds travel — measured a small archer
   dip, so scoped OUT). Solo / boss / world-boss keep `huntTarget` (byte-identical). **Owner boss
   rule "แต่มีบอส ทุกคนต้องรุม":** a boss ALWAYS pulls the whole party — stage/quest-boss phase (enemy
   list cleared) all target the boss; an ENGAGED world boss (hp<maxHp) is a `forcedBoss` every auto
   hero converges on, EXEMPT from claim/spread (a boss is claimable by all simultaneously).
   *Result:* kills/hero/min UNCHANGED (sword 64%/45%, mage 68%/47%, archer 64%/54% of solo at 2p/3p)
   — because the farm field is **SPAWN-RATE-capped** (`respawnDelay`), NOT clustering-capped: solo
   already ~saturates the respawn cadence, so extra bodies can't add kills regardless of targeting.
   **LOUD FLAG:** the real "no-starvation" lever is a per-headcount SPAWN-RATE scale (`respawnDelay ÷
   f(size)`), a density/economy call — NOT silently applied. The spread is a FEEL fix (no melee
   dog-pile) + the mechanism the boss dog-pile rule needs; per-member PROGRESSION is carried by
   shared xp + the buff below, well above solo.

2. **QUEST-boss HP headcount scaling (flag 2).** STAGE bosses stay melty (owner: a party reward).
   QUEST bosses (tier-1 class-change EXAM + tier-2 young Glacial Sovereign) scale HP ×(1 + 0.8×(N−1))
   — `CONFIG.party.questBossHpScale`, applied in `startBossFight`; atk unscaled; solo ×1.0 (byte-
   identical). Detection = `isQuestBossFight` (tier-3 fight OR any cohort hero's pending class-change
   killBoss). *Result:* the s5 class-change exam went from **melt** (×0.05–0.54 of solo time,
   TRIVIALIZED) to **~solo duration** (2-3p clear 7–9s vs solo 8–10s, no longer flagged). STAGE
   bosses s10+ still melt as intended. **FLAG:** a pure 3×archer party can wall the *scaled* young
   Sovereign (squishy comp × the tier-3 exam it already finds hard solo) — a mixed party is fine;
   lower `questBossHpPerMember` if the owner wants the tier-3 exam gentler than the class-change one.

3. **XP buff reshape (flag 3).** `PARTY_EXP_BUFF_PER_MEMBER` 0.04 → **0.10** = the owner's spec:
   +10% per ADDITIONAL member (`partyExpBuff(size)=1+0.10×(size−1)`: 2p ×1.10, 3p ×1.20 … 6p ×1.50).
   expShareRate 0.6 unchanged. *Measured per-member xp/hr × solo* (1800s×5 seeds): sword 1.31/1.38,
   mage 1.39/1.47, **mix-3p 1.60**, archer **1.16/1.75** (2p/3p). **FLAG (owner call):** the owner
   chose +10%/คน knowingly so the spec ships un-reduced; the hottest reading is **archer-3p ×1.75**
   (under the ~1.8 concern line — still the solo-archer death-spiral denominator artifact, now +buff).
   If the owner wants it trimmed, the safe lever is `expShareRate` 0.6 → ~0.5 (do NOT touch his +10%).

### Share trim (after respawn-rate scaling + archer evade) — 2026-07-08

The numbers in point 3 above **predate two later landings**: (a) `PARTY_RESPAWN_SCALE_PER_MEMBER`
(7778f1c) — the "real no-starvation lever" that point 1 flagged — which lifted cohort throughput
from 45-68% of solo to **~95-100%**, and (b) the archer **dash-evade** (this wave), which raised the
archer SOLO denominator (fewer death-spiral deaths → higher solo xp/hr). With throughput no longer
starved, the `expShareRate 0.6` compensation became a **surplus**: measured per-member party xp/hr
had inflated well past the ×1.3-1.5 band. Owner-approved a share trim (sweep 0.20-0.30; ladder buff
stays owner-locked at +10%/member; measured with everything in play, archer-evade solo baselines).

**Measured per-member xp/hr × solo (1800s × 5 seeds), archer-evade denominators:**

| size | share | sword | archer | mage | ninja | mixed |
|---|---|---|---|---|---|---|
| 2p | 0.6 (old) | 2.17 | 1.56 | 2.21 | 1.37 | — |
| 3p | 0.6 (old) | 2.73 | 3.88 | 3.77 | 3.07 | 3.66 |
| 2p | **0.20 (chosen)** | 1.54 | 1.02 | 1.31 | 1.27 | — |
| 3p | **0.20 (chosen)** | 1.71 | 1.87 | 2.15 | 1.89 | 2.39 |

Sweep context (2p / 3p per-class): at 0.25 → 2p 1.66/1.08/1.47/1.54, 3p 1.79/2.36/2.32/2.02; at
0.30 → 2p 1.74/1.11/1.56/1.37, 3p 1.96/1.91/2.59/2.18. **0.20 minimizes total band deviation and
gives the tightest 3p spread.**

**Chosen: `PARTY_EXP_SHARE_RATE = 0.20`.** It re-seats **2p** at/near band (sword 1.54, mage 1.31,
ninja 1.27 in-band; archer 1.02 dips slightly UNDER — two clustered archers barely out-earn the now-
stronger solo archer) and compresses **3p** from ×2.7-3.9 down to ×1.7-2.4.

**LOUD FLAG (owner call):** **3p cannot be pulled strictly into ×1.3-1.5 by the share at ANY value in
range** — the residual is a STRUCTURAL co-op snowball (shared survival → deeper reach in a fixed-time
sim → geometrically higher xp/kill) STACKED on the owner-LOCKED +10%/member ladder (×1.20 at 3p) and
the respawn throughput, none of which `expShareRate` governs (even share→0 leaves 3p ≳1.3-1.8). 0.20
is the best BOTH-sizes-at-once compromise. If the owner wants 3p ≤1.5 strictly, the levers are the
ladder buff (locked) or a reach/level-gap cap — NOT the share. Headcount ladder is preserved (3p >
2p at every size). Gold/drops stay personal; quest-boss HP headcount scaling (point 2) untouched.
