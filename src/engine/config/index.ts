/**
 * Tunable balance constants — ported faithfully from the POC `CONFIG` block
 * (plus the per-type stat tables it kept as separate objects).
 *
 * This is the ONLY home for magic numbers. Systems must read every constant from
 * here so the balance-sim harness can sweep them. Curves are functions of the
 * stage number `n`, exactly as the POC wrote them.
 */

import type {
  HeroClass,
  EnemyKind,
  AttackKind,
  EnemyBehavior,
  StatKey,
  HeroStats,
} from "@/engine/entities";

// M5 Character Pivot (docs/GDD.md v2): the 3-hero team became a SINGLE player
// character. The formation / targeting / multi-hero combat engine is KEPT intact
// (it becomes the M8 party engine) but gameplay spawns exactly ONE hero of the
// chosen class. The three purchasable upgrade lines (atk/speed/hp) are REMOVED —
// power now = level + tier (+ base stats/gear later). Balance is rebaselined for
// solo play (docs/balance-m5.md); the old docs/balance-m4.md team table is
// superseded and kept only for reference.

export const CONFIG = {
  // ---- existing engine-infra keys (do not remove) ----
  /** Speed multipliers the player can toggle. */
  speeds: [1, 2, 3] as const,
  /** Offline idle earnings are capped to this many hours (anti-cheat). */
  offlineCapHours: 8,
  /** Throttle for engine -> UI (Zustand) state sync, in Hz. */
  uiSyncHz: 10,

  // ---- world / zones (M6 "World & Town", ROADMAP task 1) ----
  // The world is a set of ordered MAPS (themes). Each map is a left-to-right run
  // of walkable ZONES: farm zones (one existing STAGE each) + a single BOSS ROOM.
  // The TOWN (safe hub + respawn point) is one zone at the LEFT edge of
  // `townMapId`. This REGROUPS the existing stage content (stages 1-5 -> map1's
  // five farm zones, 6-10 -> map2, 11+ -> map3 frontier) — per-zone enemy
  // rosters/scaling are still driven by `state.stage` (= the zone's stage), so
  // combat balance INSIDE a zone is UNCHANGED. Config-driven so M7/M8 add maps by
  // data. Progression + navigation live in systems/world.ts.
  //
  // A farm zone unlocks the NEXT zone once its kill quota (killGoal(stage)) is met;
  // clearing a farm zone grants the SAME xp/gold the old per-stage boss did
  // (xpPerBossKill/goldPerBoss are REUSED, so the leveling curve is preserved
  // WITHOUT a per-zone boss). The boss room unlocks after the last farm zone;
  // beating it unlocks the next map. map3 is the soft-wall frontier (bossStageId 15
  // sits past the current content ceiling — intended; extended by M7/M8 content).
  // Per-map fields:
  //  - `fieldWidth`: the zone's walkable width in engine units (M6 "สนามล่ามอน").
  //    Default = the current screen field (~900, the letterboxed logical width in
  //    render/layout.ts). A wider zone is a DATA change here (+ a camera-follow
  //    render task) — the hunt/spawn systems already read it, so no engine rework.
  //  - `hunt`: the per-map spawn-pool + temperament knobs (see the `hunt` block
  //    below for the shared defaults). `aggroStart`/`aggroEnd` ramp the AGGRESSIVE
  //    fraction across the map's farm zones (index 0 -> last farm before the boss),
  //    so aggression concentrates toward the boss room (GDD). `aggroRadius` is that
  //    map's aggressive aggro range (slightly larger in later maps).
  //
  // M6 "ALIVE FIELD" retune (2026-07-06): `maxAlive` was raised ~2.5× (6-8 -> 15/17/18)
  // so a zone reads as a busy hunting ground, `respawnDelay` cut so the denser field
  // stays populated. Because the aggressive-mob COUNT = aggroFraction × maxAlive, the
  // aggro FRACTIONS were cut in step (map3 0.35-0.60 -> 0.15-0.25) so the belt's
  // ABSOLUTE danger only rose modestly (no meat grinder) — danger toward the frontier
  // now comes mostly from tougher + more-aggressive mobs, not raw body count. The
  // clear-time ballpark is held by the ×1.6 killGoal (see the curve block); see
  // docs/balance-m6.md task 4 for the sim table + the archer frontier caveat.
  world: {
    maps: [
      {
        id: "map1", zoneStageIds: [1, 2, 3, 4, 5], bossStageId: 5, fieldWidth: 900,
        hunt: { maxAlive: 15, respawnDelay: 0.75, aggroStart: 0.0, aggroEnd: 0.1, aggroRadius: 125 },
      },
      {
        id: "map2", zoneStageIds: [6, 7, 8, 9, 10], bossStageId: 10, fieldWidth: 900,
        hunt: { maxAlive: 17, respawnDelay: 0.65, aggroStart: 0.09, aggroEnd: 0.18, aggroRadius: 145 },
      },
      {
        id: "map3", zoneStageIds: [11, 12, 13, 14, 15], bossStageId: 15, fieldWidth: 900,
        hunt: { maxAlive: 18, respawnDelay: 0.6, aggroStart: 0.15, aggroEnd: 0.25, aggroRadius: 145 },
      },
    ],
    townMapId: "map1",
    // Deterministic walk transit per hop (seconds). Negligible vs clear times;
    // render animates the actual multi-zone walk (a later task). Death respawn
    // reuses `heroReviveTime` as its walk-home time (unchanged death cost).
    transitSeconds: 0.6,
  },

  // ---- hunting field ("สนามล่ามอน", M6 combat rework, decided 2026-07-05) ----
  // The forward-march wave model is replaced by an OPEN FIELD the hero HUNTS across.
  // A per-zone spawn POOL keeps `maxAlive` mobs on the field (seeded RNG places +
  // composes them — spawn composition/placement is exactly what the RNG stream is
  // reserved for); a killed mob respawns after `respawnDelay`. Mobs idle-WANDER
  // gently around their spawn point via a DETERMINISTIC id-hashed phase (NOT the RNG
  // stream — mid-combat draws stay forbidden). Temperament: PASSIVE (default — never
  // initiates; fights back once HIT) + AGGRESSIVE (an aggro radius — engages when the
  // hero enters it). The AGGRESSIVE fraction ramps per map (`world.maps[].hunt`) so
  // danger concentrates toward the boss rooms. All knobs sim-tuned — docs/balance-m6.md.
  hunt: {
    // Spawn-pool defaults (a map's `hunt` block overrides maxAlive/respawnDelay).
    maxAlive: 7,
    respawnDelay: 1.6,
    /** Delay before the first spawn on zone entry (the field then bursts to full). */
    initialGap: 0.3,
    /** Spawn band as fractions of the zone `fieldWidth` (mobs placed in [min,max]). */
    // Widened (was 0.30-0.96) to spread 15-20 concurrent mobs over a longer stretch
    // so a fuller field reads less clumped. Placement is still uncollided random
    // uniform, so a fuller field WILL visually overlap at points (acceptable for now
    // — flagged in docs/balance-m6.md); a wider band lowers the overlap density.
    spawnMinXFrac: 0.22,
    spawnMaxXFrac: 0.98,
    // Idle wander around the spawn point (deterministic; no RNG). Amplitude in px,
    // a gentle drift speed cap, and an id-hashed frequency spread so mobs desync.
    wanderAmp: 22,
    wanderSpeed: 18,
    wanderFreqBase: 0.5,
    wanderFreqSpread: 0.4,
    /** Default aggro radius (per-map `aggroRadius` overrides). */
    aggroRadius: 150,
    // Hero auto-hunt: walk speed toward the target, the melee stop gap (+approach
    // short), and the ranged standoff (hold at range*frac; kite in below kiteDist).
    huntSpeed: 175,
    contactGap: 34,
    meleeApproachGap: 26,
    rangedStandoffFrac: 0.82,
    /** Engaged melee mob stops this far from the hero before swinging. */
    mobContactGap: 34,
    /** Hero field bounds: left clamp (don't back off-screen) + right margin. */
    heroMinX: 55,
    fieldRightMargin: 24,

    // ---- M6 hunt follow-ups (engine, 2026-07-06 — flagged in docs/balance-m6.md) ----
    // (1) Gradual RE-ENTRY fill. Entering/re-entering a farm zone used to BURST the
    // field to `maxAlive` in one step — on a death respawn that re-swarmed the
    // returning hero instantly (no retreat room; the squishy archer's AoE-aggro
    // death-spiral walled it at s13). Instead the field bursts only THIS FRACTION of
    // `maxAlive` on entry, then the normal respawn cadence (`respawnDelay`) trickles
    // it up to the cap over a few seconds — so a returning kiter gets breathing room
    // while the field refills. Still ends up FULL (the owner's "alive field" intent
    // is preserved; only the first seconds after each entry ramp). Deterministic.
    reentryBurstFrac: 0.35,
    // (2) Min-spacing spawn PLACEMENT (best-candidate). A spawn draws THIS many
    // candidate x's (a FIXED count so the RNG draw-count per spawn stays BOUNDED +
    // deterministic — spawn placement legitimately uses the seeded stream) and keeps
    // the one FARTHEST from the nearest existing mob, so a dense field reads spread
    // out instead of stacking mobs on a point. 1 = plain uniform random (old behaviour).
    spawnCandidates: 5,
    // (3) AoE-AGGRO rule. A single AoE (arrow rain / meteor / whirl / frost) DAMAGES
    // every mob in its blast (unchanged), but must NOT wake the whole passive cluster
    // — the archer's rain used to aggro every passive it clipped, swarming its kite in
    // a dense field. Retaliation is limited to the mobs NEAREST the impact, within
    // `aoeWakeRadiusFrac × blastRadius`, capped at `aoeWakeCap` per impact
    // (deterministic nearest-first + id tie-break; NO RNG — combat never draws from the
    // stream). Edge-of-blast passives take damage but stay passive, so an AoE farmer
    // keeps retreat room. The directly-targeted mob (at the impact centre) always wakes.
    aoeWakeRadiusFrac: 0.6,
    aoeWakeCap: 2,
  },

  // ---- NPC shop / consumables (M6 "เมืองหลัก + NPC shops", ROADMAP task) ----
  // The FIRST real gold sink since the upgrade lines were removed (gold otherwise
  // accumulates unused). Three NPC-bought, non-tradable, stackable consumables:
  //   hpPotion     — restore `restoreFrac` of MAX HP (idle sustain; cooldown-gated)
  //   manaPotion   — restore `restoreFrac` of MAX MANA (caster sustain)
  //   returnScroll — teleport to town from anywhere (consumed; instant)
  //
  // PRICING is STAGE-SCALED: `priceAt(item, stage) = round(basePrice *
  // priceStageBase^(stage-1))`. Gold income per kill itself grows (~1.05^n plus a
  // linear term), so a flat price would trivialise late-game; scaling at 1.12/stage
  // keeps a potion worth a meaningful slice (~4-6 kills) of the CURRENT zone's gold
  // at every depth — a real sink that bites hardest exactly at the frontier wall
  // (where the hero dies + drinks most). Non-tradable + fungible => plain COUNTS in
  // the save (SAVE v9), NOT M7 item-instances (see entities `ShopItemId`).
  //
  // AUTO-USE (the idle feature): settings-style toggles + thresholds (UI-owned like
  // autoCast, mirrored onto state each frame). `autoDefaults` seeds the initial
  // toggle/threshold values; a step-level, per-type-cooldown deterministic use
  // fires when the pool drops below the threshold (systems/consumables). Defaults
  // ON so idle play benefits without setup (same spirit as autoReturn).
  //
  // Sim-tuned — see docs/balance-m6.md (prices, sustain deltas, gold sink rate).
  shop: {
    /** Max held per item (a hand-edited save can't stockpile absurd counts). */
    stackCap: 99,
    /** Per-stage price multiplier (compounds on `basePrice`). */
    priceStageBase: 1.12,
    /** Initial (UI-owned) auto-use toggle + threshold values. */
    autoDefaults: {
      hpPotion: true,
      manaPotion: true,
      /** Auto hp-potion fires below this fraction of MAX HP. */
      hpThreshold: 0.35,
      /** Auto mana-potion fires below this fraction of MAX MANA. */
      manaThreshold: 0.25,
    },
    /** The catalog. `restoreFrac` / `cooldown` are 0 for the non-potion scroll. */
    items: {
      hpPotion: { basePrice: 60, restoreFrac: 0.5, cooldown: 8 },
      manaPotion: { basePrice: 45, restoreFrac: 0.45, cooldown: 10 },
      returnScroll: { basePrice: 150, restoreFrac: 0, cooldown: 0 },
    },
  },

  // ---- party / hero base ----
  // Party cap (M8 real-time party of ≤3). Solo gameplay spawns 1 hero, but the
  // multi-actor engine is retained for M8, so this stays as the formation cap.
  maxHeroes: 3,
  heroBaseAtk: 10,
  heroBaseHp: 150,
  // Solo RESPAWN (GDD: dead solo hero = respawn, town doesn't exist until M6).
  // The lone hero going down auto-respawns after this many seconds; the
  // battlefield is cleared so it never respawns into a pile-up death spiral
  // (see combat.resolveDeaths). No penalty — respawn at FULL HP.
  heroReviveTime: 4,
  /** Respawn HP fraction (1.0 = full, no death penalty per GDD). */
  reviveHpFraction: 1.0,

  // ---- formation / movement ----
  baseAnchor: 180,
  maxAnchor: 300, // anchor upper clamp when NO enemies are present (easing home)
  anchorSpeed: 60, // anchor ease speed when NO enemies present
  /** Anchor tracks (min enemy x - anchorLead), clamped to [baseAnchor,maxAnchor]. */
  anchorLead: 170,
  heroMove: 150,
  midCap: 400,
  clash: 46,
  meleeLeash: 90,
  kiteDist: 100,

  // ---- charge behaviour (task 86d3k2he0 -> 86d3k2nhm: heroes RUN AT + SMASH,
  //      whole team pushes forward at ALL times, no standing around waiting) ----
  // When ANY enemy is alive the swordsman sprints at the nearest one and the whole
  // formation surges deep so the ranged heroes' coverage TRAVELS with the fight.
  // These are the ONLY knobs that make the team aggressive; the non-battle
  // (no-enemy) easing above is untouched, and between waves the anchor now HOLDS
  // its forward line instead of retreating (see movement.ts / waveGap handling).
  battleAnchorLead: 150, // (86d3k2nhm: was 130) anchor tracks minEnemyX - this; sized so the anchor rides right up near the engagement line but the ranged heroes still sit a touch behind it
  // (86d3k2nhm follow-up) HELD at 510 — deliberately NOT deepened alongside the new
  // dynamic charge cap. The deepest engaged enemy now sits at chargeHardCap(770) +
  // clash(46) + enemyEngageJitter(24) = 840; archer @ (510-26=484)+rangedHomeFront(8)+
  // range 350 -> 842 >= 840 covers the fight line, and a spawn-edge ranged enemy is
  // reached by the SWORDSMAN's dynamic cap (770 + range 96 = 866 >= spawnX 860), NOT by
  // pushing the backline forward. So the free-hit fix does not require a deeper anchor.
  // Pushing this to 590 (as first drafted) gave archer+mage too much uptime and made
  // clears ~18% too fast — 5 stages fell outside the ±15% balance budget (S3 -14 -> S9
  // -14, S5/S7/S8 -20..-23%); 510 keeps every stage in budget except the two earliest,
  // which are inherently faster from removing the ~4s/wave park (S1 has no ranged heroes
  // at all). mage @ (510-74=436)+8+330 = 774 covers the incoming stream (the bulk of a
  // staggered wave) rather than the very front enemy — that trailing coverage cost is
  // the price of staying inside budget. Sim-validated; see docs/balance-m4.md.
  battleMaxAnchor: 510,
  battleAnchorSpeed: 115, // (was anchorSpeed 60) formation surges forward ~2x faster on enemy contact
  // Charge trigger is now whole-field: chargeSeekRange exceeds spawnX (860) - the
  // deepest a hero can stand (~150), so a freshly-spawned enemy is ALWAYS in range
  // and the swordsman charges the instant a wave appears (no wave-start idling).
  chargeSeekRange: 900, // (86d3k2nhm: was 560) >= full-field span; effectively "any enemy alive => charge"
  chargeSpeed: 265, // sprint speed while charging a target (~1.77x heroMove 150) — the "run at them" feel
  meleeChargeLeash: 260, // loosened forward leash while a charge target exists (was meleeLeash 90) — he genuinely runs across the field
  // Forward-cap FLOOR while charging. The swordsman's forward cap is now DYNAMIC
  // (combat.ts): upperCap = min(homeX + meleeChargeLeash, clamp(target.x -
  // meleeApproachGap, chargeCap, chargeHardCap)). chargeCap is the FLOOR — it keeps him
  // aggressive when the target is already close/behind — while chargeHardCap is the
  // ceiling. A STATIC 640 cap caused two playtest bugs (86d3k2nhm follow-up): (2) the
  // swordsman froze at 640 for ~4s while enemies walked 860 -> ~686, and (3) a ranged
  // enemy resting at nearestHero+160 (~800) sat 160px away > his 96 melee range, pinned
  // at 640 he could NEVER close -> permanent "free hits". The dynamic cap tracks the
  // target so he keeps closing (kills the park) and can always reach it (kills the free
  // hit).
  chargeCap: 640,
  // Dynamic-cap CEILING (spawn-relative: spawnX 860 - 90). 770 + swordsman range 96 =
  // 866 >= spawnX 860, so the swordsman can always close to melee range of a ranged
  // enemy resting at the spawn edge -> no permanent free-hits (must be >= 860-96 = 764).
  // Also leaves a small entrance corridor so waves still visibly read as they arrive.
  chargeHardCap: 770,

  // hero engagement tuning (pulled out of the POC update loop)
  meleeSeekRange: 260, // legacy hold-formation seek radius (superseded by chargeSeekRange for the charge behaviour; kept for reference)
  meleeStopGap: 34, // |d| > this => approach, else hold
  meleeApproachGap: 26, // stop this far short of the target
  meleeHomeBack: 60, // lower clamp = homeX - this
  meleeTargetMinD: -80, // (superseded by symmetric |Δx| ≤ range melee targeting — see combat.ts free-hit fix; kept for reference)
  rangedKiteStep: 46, // step back by this when an enemy is within kiteDist
  rangedHomeFront: 8, // ranged upper clamp = min(homeX + this, rangedForwardCap)
  rangedMinX: 55, // ranged lower clamp (don't back off the screen)
  // (86d3k2nhm follow-up) Ranged upper-clamp SAFETY NET, spawn-relative (spawnX 860 -
  // 120). REPLACES the POC-era absolute `midCap` (400) in the ranged clamp. midCap no
  // longer scaled with the deep-push anchor: at battleMaxAnchor 510 archer homeX(484)
  // and mage homeX(436) BOTH clamped to 400 -> exact stack (playtest bug 1). Because
  // homeX = anchorX + offset already carries the -26/-74 formation spread, a cap that
  // sits ABOVE the max ranged homeX (~572 at anchor 590) never collides, so spacing is
  // preserved at ANY anchor depth; this is purely a "don't walk into the spawn" net.
  rangedForwardCap: 740,

  // ---- waves ----
  waveGap: 1.2, // gap before each subsequent wave
  firstWaveGap: 0.5, // gap before the very first wave of a stage
  waveHpScale: 0.05, // per-wave multiplier wm = 1 + wave * this
  waveCountBase: 3,
  waveCountPerWave: 1.1,
  waveCountPerStage: 0.6,
  spawnX: 860, // enemies spawn at this x (right edge)
  spawnGap: 48, // stagger between spawned enemies
  enemyEngageJitter: 24, // engageOffset = rng() * this
  enemyInitialCdJitter: 0.8, // starting attack cd = rng() * this
  enemyMeleeAtkCd: 1.0, // melee enemy attack cooldown
  // Free-hit fix ("มอนตีดาบฟรี"): a melee enemy only lands hits inside a CONTACT
  // BAND around the front line. The upper edge is engageX (fX + clash + jitter, its
  // normal front stop); this is the lower edge — how far BEHIND the front hero it may
  // still attack from. When the swordsman sprint-charges (chargeSpeed 265) he outruns
  // slow melee enemies, leaving them behind him; with the POC's one-sided `e.x <=
  // engageX` test they kept plinking him from ARBITRARILY far back (well beyond his
  // 96 melee reach) and he could never retaliate = the "free hit". Kept < swordsman
  // range (96) so any enemy still allowed to attack sits inside his reach; a melee
  // enemy that has fallen further behind than this RE-APPROACHES the line (walks back
  // into contact) instead of free-hitting. Only ever triggers for left-behind enemies
  // — a normally-approaching enemy (e.x > engageX) is untouched, so wave pacing holds.
  // 90 sits strictly inside the swordsman's 96 melee reach, so every enemy still
  // ALLOWED to attack from behind is one he can symmetrically swing back at.
  enemyBehindReach: 90,
  // Free-hit fix (ranged counterpart of enemyBehindReach): a ranged enemy that
  // has ended up beyond EVERY alive hero's reach (the swordsman walled at
  // chargeHardCap becomes its nearest hero, so it parks at range 160 ≈ 930, past
  // his 96 melee reach and the anchor-capped backline's ~834/766 forward reach)
  // HOLDS FIRE and creeps forward at THIS speed until a hero can answer it (see
  // combat.ts). Deliberately far slower than its own approach speed (32): the
  // creep re-creates, as a FAIR fight, the ~10-35 s stall the un-killable shooter
  // used to impose — the clear time the M4.6 table is tuned around — instead of
  // deleting it (a straight pull-in ran S2-S6 25-45 % fast) or inflating it (a
  // freeze ran +9..+97 % and broke the S9 gate). 4 px/s ≈ a ~15 s close over the
  // typical overhang, which sim-lands every stage inside the ±15 % budget (worst
  // S8 +13 %) with the S9 prestige gate (~5x) and 0 wipes preserved.
  rangedReengageSpeed: 4,

  /** Stage-gated random thresholds for wave composition (POC rollWave). */
  waveComp: {
    fastChance: 0.2, // stage >= 1
    rangedChanceS2: 0.34, // stage >= 2
    tankChanceS2: 0.46, // stage >= 2
    rangedChanceS3: 0.55, // stage >= 3
  },

  // ---- curves (functions of stage n) ----
  // M6 hunt-density retune (2026-07-06): concurrent mobs per zone rose ~2.5×
  // (maxAlive 6-8 -> 15-20) to make the field feel ALIVE. Measured raw throughput
  // then rose ~1.6× (clear times ~halved), so the KILL QUOTA is the lever that
  // restores the M6 clear-time ballpark ("busier, not trivially faster"): killGoal
  // is scaled ×1.6 (10+5n -> 16+8n). Because level/gold-per-zone = quota × per-kill
  // reward, xpPerKill + goldPerKill are divided by the SAME 1.6 below so the
  // leveling trajectory, the map3 power wall, class-change-at-stage-5, and the
  // potion-sink %s all stay on the M6 curve — only the field density changed.
  killGoal: (n: number): number => 16 + n * 8,
  // M4 tune: HP scaling exponent 1.23 -> 1.20. `heroAtk` is ADDITIVE
  // (base*(1+per*level)) while enemy/boss HP is GEOMETRIC, so the atk level (and
  // its geometric cost) needed to keep pace grows super-linearly with stage — a
  // wall is structurally unavoidable. 1.20 is identical at stage 1 (exp 0) and
  // only bends the LATE curve down, buying ~1 extra smooth stage and lowering the
  // wall's height without touching the early-game feel. Same base is reused for
  // bossHp, so the boss-power target (rec = bossHp / divisor) softens in lockstep.
  enemyHp: (n: number): number => Math.round(25 * Math.pow(1.2, n - 1)),
  enemyAtk: (n: number): number => Math.round(6 * Math.pow(1.19, n - 1)),
  bossHp: (n: number): number => Math.round(25 * Math.pow(1.2, n - 1) * 16),
  bossAtk: (n: number): number => Math.round(6 * Math.pow(1.19, n - 1) * 2.1),
  // M4 tune: gold/kill was purely linear (5 + 2n) while upgrade costs are
  // geometric, so late stages starved and the wall spiked. A gentle 1.05^(n-1)
  // multiplier keeps stage 1-3 values effectively unchanged (7, 9, 12 vs 7, 9,
  // 11) but lets income track the cost curve deeper, converting the old stage-8
  // stall into a comfortable stage and pushing the hard stall out to stage 9.
  // M6 hunt-density retune: base coeffs are the old (5 + 2n) divided by the 1.6×
  // killGoal factor (≈ 3.125 + 1.25n) so gold-per-ZONE = killGoal × goldPerKill is
  // preserved — income trajectory and the depth-scaled potion-sink %s are unchanged.
  goldPerKill: (n: number): number => Math.round((3.125 + n * 1.25) * Math.pow(1.05, n - 1)),
  goldPerBoss: (n: number): number => 50 + n * 20,

  // ---- spatial layout ----
  // The POC hard-coded GROUND=232 (a render constant) but the update loop used it
  // for projectile spawn/impact y-coordinates, which affect hypot() travel timing.
  // Ported here so combat stays byte-for-byte faithful to the POC's geometry.
  layout: {
    groundY: 232,
    heroY: 200,
    enemyY: 200,
    heroProjSpawnYOffset: 30, // hero projectile spawns at groundY - 30
    heroProjImpactYOffset: 16, // hero projectile impact y = groundY - 16
    enemyProjSpawnYOffset: 24, // enemy bolt spawns at groundY - 24
    enemyProjImpactYOffset: 30, // enemy projectile impact y = groundY - 30
    heroProjSpawnXOffset: 10, // hero projectile spawns at h.x + 10
    boltSpawnXOffset: 6, // enemy bolt spawns at e.x - 6
    projMinStep: 12, // arrival threshold = max(this, speed * dt)
  },

  // ---- archer basic-attack volley (86d3k2rgf) ----
  // The archer's BASIC attack fires a mini-volley of `archerVolleyCount` small
  // arrows at the SAME target instead of a single arrow ("ยิงลูกธนูย่อยๆ" — a
  // rapid-fire feel). Total damage per attack is UNCHANGED: it is split across
  // the volley (per-arrow = heroAtk / count; the LAST arrow carries the float
  // remainder so the volley sums BIT-EXACTLY to the old single-arrow damage — no
  // rounding drift). The archer SKILL (SKILL_TYPES.archer, 3 SEPARATE targets)
  // is deliberately left alone and stays the multi-target spread; the basic
  // volley is 3 arrows at ONE target.
  //
  // `archerVolleyOffsets` is a FIXED per-arrow table (length must equal
  // `archerVolleyCount`). It carries NO RNG on purpose: the seeded RNG stream
  // order is load-bearing for wave composition, so combat must never draw from
  // it. The small spawn jitter (dx/dy) plus the ±5% speed variance (speedMult)
  // stagger the arrows so they leave slightly apart and arrive on different
  // frames — that is what sells the rapid-fire look and yields up to 3 separate
  // damage-number ticks instead of one lumped hit. Deterministic because the
  // table is constant.
  archerVolleyCount: 3,
  archerVolleyOffsets: [
    { dx: 0, dy: -5, speedMult: 1.05 },
    { dx: -4, dy: 0, speedMult: 1.0 },
    { dx: 4, dy: 5, speedMult: 0.95 },
  ] as const,

  // ---- archer ARROW RAIN skill drop pattern (86d3k2t18) ----
  // FIXED per-drop table (length MUST equal SKILL_TYPES.archer.targets). Carries NO
  // RNG on purpose (see archerVolleyOffsets). `dx` spreads the landing x around the
  // cluster centroid so the rain blankets a zone (not a single point); `ry` is extra
  // spawn HEIGHT so the drops fall for slightly different durations and land across
  // several frames (the raining-in look + staggered damage ticks) rather than one
  // lump. Deterministic because the table is constant.
  arrowRainOffsets: [
    { dx: -96, ry: 0 },
    { dx: -72, ry: 34 },
    { dx: -48, ry: 12 },
    { dx: -24, ry: 46 },
    { dx: 0, ry: 20 },
    { dx: 24, ry: 52 },
    { dx: 48, ry: 8 },
    { dx: 72, ry: 38 },
    { dx: 96, ry: 26 },
  ] as const,

  // ---- skills ----
  skills: {
    meteorSpawnY: -48, // meteor projectile spawns at this absolute y (falls to impact)
    mageFallbackAheadX: 150, // if no target, aim the meteor at h.x + this
    // Archer ARROW RAIN ("ฝนลูกธนู"): the skill spawns `SKILL_TYPES.archer.targets`
    // small point-target arrows that FALL from the sky (reusing the meteor mechanic)
    // onto a zone centred on the centroid of the foes within `arrowRainRange`. Each
    // drop is a small AoE (`SKILL_TYPES.archer.radius`) dealing heroAtk *
    // `SKILL_TYPES.archer.mult` (sim-tuned for effective DPS, not raw total). Landing
    // spread + spawn-height stagger come from a FIXED table (`arrowRainOffsets`) —
    // NO RNG (the seeded stream is reserved for wave composition), so it stays
    // deterministic.
    arrowRainSpawnY: -60, // base spawn y (above the top); each arrow adds its ry stagger
    // The rain ARCS from the sky, so it out-ranges the archer's direct-fire basic
    // attack (HERO_TYPES.archer.range 350): the guard + centroid use THIS range. The
    // archer's formation slot sits ~400px back from the enemy line on average, so a
    // 350 cast range gated the skill to ~6% of frames (vs the old spread, which had
    // NO range limit and fired every cooldown) — starving S2/S3 clears. A field-
    // spanning artillery range restores the old cast cadence; per-drop power is tuned
    // (SKILL_TYPES.archer.mult) to keep total DPS in the balance budget.
    arrowRainRange: 760,
  },

  // ---- hero XP / levels (M5 "Character XP + Level system", 86d3jv7m3) ----
  // With the upgrade lines REMOVED (M5 Character Pivot), per-hero LEVEL is the
  // PRIMARY interim power axis (base-stat allocation is a later task). The solo
  // hero banks ALL kill XP (no team split); each level grants an atk/hp bonus that
  // must keep pace with the GEOMETRIC enemy/boss HP curve (25 * 1.2^(n-1)), so
  // these are far more generous than the pre-pivot team knobs. NO RNG is drawn
  // here (kills are deterministic); the seeded stream stays wave-composition-only.
  // Sim-rebaselined per class solo — see docs/balance-m5.md.
  leveling: {
    // Level cap; the evolution gate keys off a threshold below this.
    levelCap: 60,
    // Per-level ADDITIVE bonuses (combine additively with the primary-stat atk
    // bonus, then the tier multiplier applies).
    //
    // M5 "Base stats" re-tune (avoid double-counting): pre-stats, LEVELS carried
    // ALL atk scaling at 0.10/level. Base stats now let the player allocate
    // `stats.pointsPerLevel` (3) points per level into the class PRIMARY stat for
    // `stats.atkPerPrimaryPoint` (0.02) each, so an auto-allocated hero adds
    // 3 * 0.02 = 0.06/level of atk from STATS. atkPerLevel is dropped 0.10 -> 0.04
    // so the innate level bonus (0.04) + auto-allocated primary bonus (0.06) sum
    // back to the SAME 0.10/level total power growth as the pre-stats baseline
    // (exact for an organically-levelled hero — see stats.ts / docs/balance-m5.md).
    // Manually diverting points into vit/dex trades atk for survivability/speed.
    atkPerLevel: 0.04,
    // hp stays LEVEL-driven at 0.09/level: auto-allocate feeds the PRIMARY stat
    // (never vit), so if HP scaling moved to vit an idle hero would get none and
    // die. VIT (below) is an OPTIONAL survivability investment ON TOP of this.
    // Unchanged from the pre-stats baseline, so auto-allocated HP == baseline.
    hpPerLevel: 0.09,
    // XP granted to the solo hero per NORMAL enemy kill; scales with stage so
    // deeper (tougher) kills are worth more and leveling keeps pace with HP.
    // M6 hunt-density retune: ≈ old (10 + 3n) divided by the 1.6× killGoal factor
    // so xp-per-ZONE = killGoal × xpPerKill is preserved — the leveling trajectory
    // (level-at-stage, class-change beat, map3 power wall) is unchanged despite the
    // ~2.5× denser field (which only made the same kills arrive faster).
    xpPerKill: (n: number): number => 6 + n * 2,
    // XP granted per BOSS kill — a chunky milestone reward (a level or more).
    xpPerBossKill: (n: number): number => 80 + n * 25,
    // XP needed to advance FROM `level` TO `level+1`. Strictly increasing; gentle
    // geometric growth so the hero keeps leveling deep into the run (reaching
    // ~L40+ by S10) rather than stalling at a hard cap mid-game.
    xpToLevel: (level: number): number => Math.round(30 * Math.pow(1.12, level - 1)),
  },

  // ---- base stats (M5 "Base stats", 86d3jv7m3) ----
  // Four RO-flavoured axes the player allocates on level-up (see entities StatKey).
  // A class's DAMAGE scales off its PRIMARY stat only (str/dex/int); dex also gives
  // a small UNIVERSAL atk-speed factor and vit a UNIVERSAL max-HP bonus. Bonuses
  // are computed from the amount ALLOCATED ABOVE the class base, so a fresh hero
  // sits exactly on its class baseline (stats.ts). Auto-allocate (UI toggle) dumps
  // points into the primary stat so idle players never drown in unspent points.
  // NO RNG (deterministic); the seeded stream stays wave-composition-only.
  stats: {
    // Points granted per level-up. The atk re-tune above is calibrated to this:
    // pointsPerLevel * atkPerPrimaryPoint (3 * 0.02 = 0.06) is exactly the atk/level
    // moved out of the innate level bonus, so auto == baseline (docs/balance-m5.md).
    pointsPerLevel: 3,
    // Per-stat allocation ceiling (no respec in this phase — a future NPC service).
    // Generous; exists only so a hand-edited save can't drive stats to absurdity.
    cap: 999,
    // ATK-mult per PRIMARY-stat point above base (additive with the level bonus).
    atkPerPrimaryPoint: 0.02,
    // HP-mult per VIT point above base (additive with the level hp bonus). VIT is
    // NOT auto-allocated, so this never perturbs the auto baseline — it's the
    // manual "tank" investment. (No mitigation axis exists in combat yet — VIT is
    // HP-only; a defense/mitigation factor is a documented future hook.)
    hpPerVitPoint: 0.03,
    // Universal atk-SPEED factor per DEX point above base (lower cooldown = faster).
    // Deliberately tiny: the archer's PRIMARY is dex, so auto-allocate funnels every
    // point into dex — a large factor would inflate archer DPS out of budget. At the
    // ~S10 clear level (~108 allocated dex) this is only ~+4% attack speed. It is
    // mostly a future-facing hook; a manual off-stat dabbler feels it slightly.
    atkSpeedPerDexPoint: 0.0004,
    // Per-class STARTING stat block (the zero-point for bonuses + the RO-flavour
    // display value). Primary stat highest; vit tracks the class survivability
    // identity (sword tanky, mage squishy). Because bonuses are measured ABOVE
    // base, these values grant NO power themselves — they set where allocation
    // begins. (The class HP identity itself still lives in HERO_TYPES.hpMult:
    // folding it into base vit is rejected because vit isn't auto-allocated, so
    // idle heroes would lose their class survivability — see docs/balance-m5.md.)
    base: {
      swordsman: { str: 8, dex: 4, int: 3, vit: 6 },
      archer: { str: 4, dex: 8, int: 3, vit: 5 },
      mage: { str: 3, dex: 4, int: 8, vit: 4 },
    } satisfies Record<HeroClass, HeroStats>,
  },

  // ---- mana (M5 "mana + skill framework v2", 86d3jv7m3) ----
  // Skills cost mana AND keep cooldowns (GDD: both). The pool + regen scale off
  // INT above the class base (`stats.base[cls].int`), giving the mage — whose
  // PRIMARY is int, so auto-allocate funnels every point into it — a real caster
  // identity (a deep pool + fast regen it can sustain multiple skills on), while
  // the str/dex classes live on the flat base pool + base regen and must be
  // economical with their one signature cast. CRITICAL (idle guarantee): base
  // regen alone MUST sustain each class's SIGNATURE skill at ~its cooldown
  // cadence, so a mana-starved hero never hard-stalls — a skipped skill is fine,
  // basic attacks (which cost NO mana) always continue and keep banking kills/XP.
  // NO RNG (deterministic). Sim-tuned — see docs/balance-m5.md.
  mana: {
    base: 60, // flat pool every class starts with (before INT scaling)
    perIntPoint: 3.5, // +max mana per INT point above the class base
    // Base regen is sized to sustain each class's SIGNATURE cast (idle guarantee)
    // with only a THIN margin — so a str/dex class (flat base regen) is genuinely
    // mana-gated on its EXTRA skills and can't spam its whole kit (that's the DPS
    // cut mana is meant to impose). The mage's INT-fed regen lifts it clear of the
    // gate, so it sustains its full kit — the caster identity.
    baseRegen: 7, // mana/sec every class regenerates (sustains the signature cast)
    regenPerIntPoint: 0.15, // +mana/sec per INT point above base (caster identity)
  },

  // ---- auto-cast slots (M5 "skill framework v2") ----
  // Up to `max` skills can sit in auto-cast slots; a slot at index i only fires
  // once the hero reaches `unlockLevels[i]`. Auto-cast walks the slots IN ORDER
  // (deterministic priority) and casts each slotted skill that is learned, off
  // cooldown, and affordable. The player assigns skills to slots (setAutoSlot
  // intent); slot 0 defaults to the class signature so a fresh hero auto-casts it.
  autoSlots: {
    max: 3,
    // Level thresholds that unlock slot 0 / 1 / 2 (length MUST equal `max`).
    unlockLevels: [1, 15, 30] as const,
  },

  // ---- combat power ("พลังต่อสู้") — the HOF metric + boss-hint gauge ----
  // A single scalar from a hero's EFFECTIVE DPS (basic + skill, so it no longer
  // under-reads the skill-heavy ranged classes the way raw summed atk did) plus a
  // survivability term from max HP. Monotonic non-decreasing in every stat point,
  // level, and tier. Weights are advisory-scale (the sim ignores the hint); tuned
  // so the boss-hint divisor lands "ready" near a real clear (see combatPower).
  power: {
    dpsWeight: 6,
    hpWeight: 0.5,
  },

  // ---- class advancement / evolution (M5 "ปลดคลาส evolution", 86d3jv7m3) ----
  // A second power axis on top of levels: the player advances the hero to tier 2,
  // granting a PERMANENT atk/hp multiplier (systems/stats tierAtkMult/tierHpMult).
  // PLAYER-TRIGGERED (evolveHero intent) but the TRIGGER is now the class-change
  // QUEST (M5 task 5, `quest` below): the old gold cost is GONE — quest EFFORT
  // replaces it. Requirement: tier 1 AND the class-change quest is COMPLETE
  // (systems/quests `isQuestComplete`); the quest is itself only offerable at
  // `levelRequired`, so the level gate still times the beat. Rejected (no-op) if
  // unmet or already tier 2. Single path in M5. NO RNG (deterministic).
  //
  // ECONOMY NOTE (task 5): removing the gold cost leaves NO gold sink until M6/M7
  // (NPC potions, marketplace) — gold accumulates freely by design; the pacing
  // that the gold gate used to add is now carried entirely by the quest objectives.
  evolution: {
    // Level gate — the class-change quest is auto-offered here (mid-run milestone).
    levelRequired: 15,
    // Permanent tier-2 multipliers. With the ±15% M4 budget gone (full rebaseline),
    // evolution can carry REAL offense: a meaningful atk + hp jump that helps the
    // solo hero break the boss gate. Sim-tuned per class — see docs/balance-m5.md.
    atkMult: 1.35,
    hpMult: 1.5,
  },

  // ---- class-change quest (M5 "เปลี่ยนคลาสผ่านเควส" v1, ROADMAP task 5) ----
  // The tier-1 -> tier-2 class change is gated by a lean QUEST instead of gold.
  // Auto-offered at level >= evolution.levelRequired while tier 1; the player
  // accepts (acceptQuest intent), objectives then count deterministically from the
  // hero's own kills / boss defeats (systems/quests, driven by combat — NO RNG, no
  // wall-clock), and completing them makes the class change available. Numbers are
  // sim-tuned so completion lands on the same mid-game beat the old ~level-15 gold
  // gate did (see docs/balance-m5.md "Class-change quest timing"). Same objective
  // numbers for every class in v1; per-class quest IDS (systems/quests
  // `classChangeQuestId`) let M8's full quest system diverge them later.
  quest: {
    classChange: {
      // Enemy kills to bank after accepting (the grind portion of the effort gate).
      kills: 60,
      // Boss defeats required (a stage-clear milestone — proves real progress).
      bossKills: 1,
    },
  },

  // ---- flow / progression ----
  // recommendedPower = round(bossHp / this), on the COMBAT-POWER scale (M5 base
  // stats): teamPower is now `sum(combatPower(hero))` (effective DPS + HP), not
  // raw summed atk, so the divisor was re-derived from 26 -> 2 to keep "ready"
  // landing near an actual clear. Advisory only (the sim challenges on the kill
  // goal + retry loop, never this hint).
  bossHintPowerDivisor: 2, // recommendedPower = round(bossHp / this)
  bossRetreatWaveGap: 1.0, // waveGap after a boss retreat / solo respawn
  nextStageWaveGap: 0.8, // waveGap at the start of a new stage

  // ---- boss (movement + slam/enrage tuning) ----
  boss: {
    y: 190,
    // Boss-phase anchor cap (playtest fix "ตัวตีไกลไม่ตีบอส" — ranged heroes not
    // hitting the boss). During the boss phase `getTargets` is the single boss, so
    // `updateAnchor` already tracks (boss.x - battleAnchorLead); but the shared
    // `battleMaxAnchor` (510) clamps the anchor too shallow for a boss that engages
    // near the spawn edge: the boss settles at frontHeroX + clash + engageExtra ≈
    // chargeHardCap(770)+66 = 836, while archer(510-26=484)+range 350 = 834 and
    // mage(510-74=436)+range 330 = 766 both fall SHORT of 836 -> the backline stands
    // idle. This boss-only cap lets the anchor ride up to (boss.x - battleAnchorLead)
    // ≈ 836-150 = 686 so mage(686-74=612)+330 = 942 and archer(686-26=660)+350 = 1010
    // both cover the boss with margin. It is boss-scoped on purpose: raising the
    // GLOBAL battleMaxAnchor would deepen the normal-wave push and blow the pacing
    // budget (see battleMaxAnchor note), whereas a lone boss (no wave stream to walk
    // into) is safe to close on. The swordsman is unaffected — his charge is capped
    // by chargeHardCap(770) regardless of anchor depth, so the boss still engages at
    // ~836 and this only pulls the backline into range. Sim-validated.
    maxAnchor: 700,
    initialCd: 1.2,
    initialSkillCd: 5,
    moveSpeed: 40,
    engageExtra: 20, // engageX = frontHeroX + clash + this
    enrageThreshold: 0.3, // enrage below this HP fraction
    slamMult: 1.7,
    slamCdEnraged: 4,
    slamCdNormal: 6.5,
    telegraphEnraged: 0.7,
    telegraphNormal: 1.0,
    attackCdEnraged: 0.7,
    attackCdNormal: 1.1,
  },
} as const;

export type SpeedMultiplier = (typeof CONFIG.speeds)[number];

// ---------------------------------------------------------------------------
// Per-type stat tables (POC HERO_TYPES / ENEMY_TYPES / SKILLS / UP).
// Visual-only fields (name/icon/color) are intentionally dropped — those belong
// to render/ui, not the pure sim.
// ---------------------------------------------------------------------------

export interface HeroType {
  /** x offset from the formation anchor (front heroes positive, back negative). */
  offset: number;
  attack: AttackKind;
  range: number;
  /** Seconds between attacks at base (lower = faster). */
  atkSpeed: number;
  dmgMult: number;
  /**
   * Per-class max-HP multiplier on `heroBaseHp` (M5 solo survivability knob):
   * the melee swordsman tanks a wave alone, the squishier ranged classes lean on
   * kiting + AoE. A precursor to full base-stat allocation (a later task).
   */
  hpMult: number;
  /** Projectile travel speed (ranged classes only; 0 for melee). */
  projSpeed: number;
  /** AoE radius for `aoe` attackers (0 otherwise). */
  aoe: number;
}

export const HERO_TYPES: Record<HeroClass, HeroType> = {
  swordsman: {
    offset: 34,
    attack: "melee",
    range: 96,
    atkSpeed: 0.5,
    dmgMult: 1.0,
    hpMult: 1.5,
    projSpeed: 0,
    aoe: 0,
  },
  archer: {
    offset: -26,
    attack: "arrow",
    range: 350,
    atkSpeed: 0.72,
    // Solo rebaseline: bumped from the team-era 0.55 — a lone archer needs real
    // single-target DPS (esp. vs the boss, where its arrow-rain AoE barely lands).
    dmgMult: 0.9,
    hpMult: 1.0,
    projSpeed: 660,
    aoe: 0,
  },
  mage: {
    offset: -74,
    attack: "aoe",
    // Solo rebaseline: faster cadence (1.35 -> 1.15) + more base (0.85 -> 1.0) so a
    // lone mage isn't helpless between meteors / on small early waves & the boss.
    range: 330,
    atkSpeed: 1.15,
    dmgMult: 1.0,
    hpMult: 0.95,
    projSpeed: 360,
    aoe: 46,
  },
};

/**
 * Canonical class list. Pre-pivot this was the stage-by-stage hero UNLOCK order;
 * post-pivot the player picks ONE base class at creation (hero-unlock progression
 * removed). Retained as the authoritative ordered class list — the server's
 * known-classes enum and the evolution cost index both key off it.
 */
export const SLOT_ORDER: readonly HeroClass[] = ["swordsman", "archer", "mage"];

/**
 * Each class's PRIMARY (damage-scaling) base stat, and the auto-allocate target
 * (M5 "Base stats"). Mirrors the attack kind: melee→str, ranged→dex, magic→int.
 * The class's `heroAtk` scales off this stat; off-affinity damage stats are inert.
 */
export const PRIMARY_STAT: Record<HeroClass, StatKey> = {
  swordsman: "str",
  archer: "dex",
  mage: "int",
};

export interface EnemyType {
  hpMult: number;
  atkMult: number;
  speed: number;
  size: number;
  behavior: EnemyBehavior;
  /** Attack range for ranged behaviour (0 for melee). */
  range: number;
  projSpeed: number;
  /** Attack cooldown for ranged behaviour (0 for melee — melee uses enemyMeleeAtkCd). */
  atkSpeed: number;
}

export const ENEMY_TYPES: Record<EnemyKind, EnemyType> = {
  // POC: grunt / runner / tank / shooter
  normal: {
    hpMult: 1.0,
    atkMult: 1.0,
    speed: 44,
    size: 1.0,
    behavior: "melee",
    range: 0,
    projSpeed: 0,
    atkSpeed: 0,
  },
  fast: {
    hpMult: 0.45,
    atkMult: 0.7,
    speed: 96,
    size: 0.8,
    behavior: "melee",
    range: 0,
    projSpeed: 0,
    atkSpeed: 0,
  },
  tank: {
    hpMult: 3.2,
    atkMult: 1.5,
    speed: 24,
    size: 1.5,
    behavior: "melee",
    range: 0,
    projSpeed: 0,
    atkSpeed: 0,
  },
  ranged: {
    hpMult: 0.8,
    atkMult: 1.1,
    speed: 32,
    size: 0.95,
    behavior: "ranged",
    range: 160,
    projSpeed: 300,
    atkSpeed: 1.7,
  },
};

/**
 * How a skill resolves (M5 "skill framework v2"). All reuse EXISTING combat
 * mechanics — no new ProjectileKind is introduced (footgun #6):
 *  - `nova`   : instant AoE centred on the HERO (swordsman whirl).
 *  - `strike` : instant AoE centred on the nearest in-range target's x (a ground
 *               slam / frost burst — the ranged counterpart of `nova`).
 *  - `meteor` : a single falling point-projectile AoE (mage meteor).
 *  - `rain`   : many small falling point-projectiles over the cluster (arrow rain).
 *  - `bolt`   : a single high-damage HOMING arrow at the nearest target (nuke).
 *  - `buff`   : a self ATK buff for a duration (no damage; war-cry).
 */
export type SkillKind = "nova" | "strike" | "meteor" | "rain" | "bolt" | "buff";

export interface SkillType {
  /** Unique, class-namespaced id (the key into `SKILLS`). */
  id: string;
  cls: HeroClass;
  /** Hero TIER required to have learned this skill (1 = base kit, 2 = evolution). */
  tier: 1 | 2;
  /** Hero LEVEL required to have learned it (unlock-by-level within the tier). */
  unlockLevel: number;
  kind: SkillKind;
  /** Mana cost to cast. */
  cost: number;
  cd: number;
  /** AoE radius: nova/strike blast, meteor blast, per-rain-drop splash (0 = none). */
  radius: number;
  /** Damage multiplier on heroAtk (PER falling arrow for `rain`; 0 for `buff`). */
  mult: number;
  /** For `rain` this is the NUMBER OF DROPS; 0 otherwise. */
  targets: number;
  /** Skill projectile speed (rain-drop / meteor / bolt fall); 0 for instant kinds. */
  projSpeed: number;
  /** Cast/guard range — the farthest a target may be for the skill to fire. */
  range: number;
  /** ATK buff multiplier for `buff` skills (1 = none). */
  buffMult: number;
  /** ATK buff duration in seconds for `buff` skills (0 = none). */
  buffDuration: number;
}

/**
 * The SKILL CATALOG (M5 "skill framework v2"): per class, a kit of skills
 * unlocked by LEVEL within a TIER. The signature skill of each class (whirl /
 * arrow rain / meteor) is kept as skill #1 with its established identity + fx —
 * its numbers are unchanged from the solo rebaseline. Each class gains one new
 * tier-1 skill (a distinct role using existing mechanics) and one tier-2 skill
 * (an evolution reward). All numbers here are sim-tuned — see docs/balance-m5.md.
 *
 * The mage's pool/regen (INT-scaled) lets it sustain several skills; the str/dex
 * classes run mostly their signature (base regen sustains it) and dip into their
 * extra skills opportunistically.
 */
const SKILL_LIST = [
  // ---- swordsman ----
  // Signature: WHIRL SLASH — instant AoE spin around the swordsman (unchanged).
  {
    id: "sword_whirl", cls: "swordsman", tier: 1, unlockLevel: 1, kind: "nova",
    cost: 24, cd: 8, radius: 95, mult: 2.2, targets: 0, projSpeed: 0, range: 95,
    buffMult: 1, buffDuration: 0,
  },
  // WAR CRY — self ATK buff (steroid). No damage; guarded on a nearby foe so it
  // isn't wasted while idle. Cheap enough that the swordsman's spare mana sustains
  // occasional uptime on top of the whirl.
  {
    id: "sword_warcry", cls: "swordsman", tier: 1, unlockLevel: 8, kind: "buff",
    cost: 20, cd: 16, radius: 0, mult: 0, targets: 0, projSpeed: 0, range: 260,
    buffMult: 1.4, buffDuration: 6,
  },
  // EARTHQUAKE (tier-2) — a heavy ground-slam AoE a short reach ahead (evolution
  // burst). Bigger radius/mult than the whirl; costs more mana.
  {
    id: "sword_quake", cls: "swordsman", tier: 2, unlockLevel: 15, kind: "strike",
    cost: 44, cd: 12, radius: 120, mult: 3.2, targets: 0, projSpeed: 0, range: 200,
    buffMult: 1, buffDuration: 0,
  },

  // ---- archer ----
  // Signature: ARROW RAIN — many drops fall over the cluster (unchanged).
  {
    id: "archer_rain", cls: "archer", tier: 1, unlockLevel: 1, kind: "rain",
    cost: 24, cd: 7, radius: 44, mult: 0.5, targets: 9, projSpeed: 900, range: 760,
    buffMult: 1, buffDuration: 0,
  },
  // POWER SHOT — a single high-damage homing arrow (single-target nuke; the
  // archer's answer to a lone boss, where its rain AoE barely lands).
  {
    id: "archer_powershot", cls: "archer", tier: 1, unlockLevel: 8, kind: "bolt",
    cost: 28, cd: 9, radius: 0, mult: 5.5, targets: 0, projSpeed: 1100, range: 700,
    buffMult: 1, buffDuration: 0,
  },
  // EXPLOSIVE SHOT (tier-2) — an instant AoE burst at the nearest target
  // (evolution wave-buster complementing the single-target power shot).
  {
    id: "archer_barrage", cls: "archer", tier: 2, unlockLevel: 15, kind: "strike",
    cost: 46, cd: 11, radius: 90, mult: 2.4, targets: 0, projSpeed: 0, range: 700,
    buffMult: 1, buffDuration: 0,
  },

  // ---- mage ----
  // Signature: METEOR — a single falling AoE nuke (unchanged; the mage's burst).
  {
    id: "mage_meteor", cls: "mage", tier: 1, unlockLevel: 1, kind: "meteor",
    cost: 40, cd: 10, radius: 90, mult: 5.5, targets: 0, projSpeed: 560, range: 330,
    buffMult: 1, buffDuration: 0,
  },
  // FROST NOVA — a cheap, fast, short-cooldown AoE burst at the nearest cluster
  // (sustained wave clear between meteors; the mage's INT-fed regen keeps it up).
  {
    id: "mage_frostnova", cls: "mage", tier: 1, unlockLevel: 8, kind: "strike",
    cost: 20, cd: 6, radius: 85, mult: 1.5, targets: 0, projSpeed: 0, range: 330,
    buffMult: 1, buffDuration: 0,
  },
  // CATACLYSM (tier-2) — a bigger, costlier meteor (evolution ultimate).
  {
    id: "mage_cataclysm", cls: "mage", tier: 2, unlockLevel: 15, kind: "meteor",
    cost: 58, cd: 15, radius: 110, mult: 8.0, targets: 0, projSpeed: 560, range: 330,
    buffMult: 1, buffDuration: 0,
  },
] as const satisfies readonly SkillType[];

/** The skill catalog, keyed by id (the single source of truth for skill tuning). */
export const SKILLS: Record<string, SkillType> = Object.fromEntries(
  SKILL_LIST.map((s) => [s.id, s]),
);

/** Ordered skill-id list per class (signature first, then by unlock). */
export const CLASS_SKILLS: Record<HeroClass, string[]> = {
  swordsman: SKILL_LIST.filter((s) => s.cls === "swordsman").map((s) => s.id),
  archer: SKILL_LIST.filter((s) => s.cls === "archer").map((s) => s.id),
  mage: SKILL_LIST.filter((s) => s.cls === "mage").map((s) => s.id),
};

/** Each class's SIGNATURE skill id (slot-0 default; the HOF/combat-power skill). */
export const SIGNATURE_SKILL: Record<HeroClass, string> = {
  swordsman: "sword_whirl",
  archer: "archer_rain",
  mage: "mage_meteor",
};

/**
 * Back-compat alias: the per-class SIGNATURE skill def. Render + the combat-power
 * metric read a class's signature tuning through this (radius / projSpeed / cd /
 * mult), unchanged from before the catalog existed.
 */
export const SKILL_TYPES: Record<HeroClass, SkillType> = {
  swordsman: SKILLS[SIGNATURE_SKILL.swordsman],
  archer: SKILLS[SIGNATURE_SKILL.archer],
  mage: SKILLS[SIGNATURE_SKILL.mage],
};
