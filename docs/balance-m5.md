# M5 Solo Rebaseline — ดึ๋งปุ๊ Idle Game

ClickUp: 86d3jv7m3 · Branch: `develop` · Supersedes [balance-m4.md](./balance-m4.md)
for team composition (that table was a 3-hero baseline; it no longer applies).

> **Base-stats update (task 3)** is documented in its own section at the bottom
> ("Base stats — the STAT re-tune"). It re-runs the sim with **auto-allocate on**
> and lands within ~±1% of the solo table below for S1–S10 (the re-tune is
> calibrated to be baseline-neutral by construction). Read that section for the
> per-point stat effects, the combat-power formula, and the new sim table.

## What changed (M5 Character Pivot)

The game went from a **3-hero team** to a **single player character** (docs/GDD.md
v2). Two structural removals drive the rebaseline:

1. **Upgrade lines removed.** The three purchasable atk/speed/hp lines (and their
   gold costs / auto-buy) are gone. Gold now just accumulates (sinks arrive in
   M6/M7: NPC potions, marketplace).
2. **Power axis is now LEVEL + TIER.** With upgrades gone, per-hero **level** is
   the primary interim power axis (base-stat allocation is a later task), plus the
   gold-paid **tier evolution** (level 15 gate). The solo hero banks **all** kill
   XP (no team split).

The formation / targeting / multi-hero combat engine is **kept intact** (it becomes
the M8 party engine); gameplay just spawns exactly one hero of the chosen class.

The enemy/boss HP+atk curves, wave composition, and formation/free-hit knobs from
M4 are **unchanged** and were re-validated for solo play.

## Method

Headless harness `src/engine/__tests__/balance-sim.ts` (`pnpm sim`), deterministic
and reproducible. Env knobs: `SIM_SECONDS` (default 1800), `SEEDS`
(default `1,2,3,42,1337`), `CLASSES`. It runs **each base class SOLO** with an
auto-pilot: auto-cast on, challenge the boss once the kill goal is met, **farm one
more level between failed boss attempts** (the realistic retry loop — this removes
the raw-atk hint bias that made low-atk / high-DPS classes over-farm), auto-evolve
when the level+gold gate is met, advance on victory.

Figures below: `SIM_SECONDS=2400`, 5 seeds. `meanDur` = mean time-to-clear (enter
stage → boss defeated) over seeds that cleared it in the window; `clears` = seeds
that cleared it; `a/w` = total boss attempts / wipes; `deaths` = solo respawns.

## Targets (all met for S1–S10)

- All 3 classes solo-viable S1→S10, **0 permanent walls**.
- Overall pacing in the same order-of-magnitude ballpark as the old team table.
- Classes within **~2×** of each other per stage.

## Per-stage time-to-clear (seconds, mean of 5 seeds)

| stage | swordsman | archer | mage | spread |
|------:|----------:|-------:|-----:|-------:|
| 1  |  34 |  37 |  51 | 1.50× |
| 2  |  54 |  50 |  60 | 1.19× |
| 3  |  81 |  49 |  70 | 1.66× |
| 4  |  94 |  60 |  85 | 1.58× |
| 5  |  93 |  68 |  93 | 1.36× |
| 6  | 103 |  72 |  99 | 1.42× |
| 7  | 114 |  86 | 112 | 1.33× |
| 8  | 136 | 103 | 130 | 1.32× |
| 9  | 146 | 112 | 148 | 1.32× |
| 10 | 165 | 131 | 170 | 1.30× |
| 11 | 316 | 184 | 382 | 2.07× |
| 12 |  —  |  —  |  —  |  wall |

**Every class clears S1–S10 on every seed** (5/5), spread ≤1.66×. Hero level at
S10 clear ≈ 36–37; ~44 by S11.

## The wall at S12 is intended (soft grind, not a freeze)

S11 is a soft grind (spread ~2×, still 5/5 or 4/5 clears); **S12 is the current
content ceiling** — no seed clears it inside the window. This is by design: with no
gear (M7), town/potions (M6), or class-change quests yet, the solo hero runs out of
power axes around S10–S11. Crucially it is **not a permanent stall**: the hero keeps
leveling toward the cap (60) off the kills it lands each life, and death →
respawn → field-clear means it is never frozen (it always kills *some* enemies per
life → XP). Future milestones extend progression past here.

## Anti-permanent-stall guarantees (verified)

- **Solo respawn** (GDD: dead solo hero = respawn, no penalty). On the lone hero's
  death mid-battle the battlefield is **cleared** (`combat.resolveDeaths`) and new
  waves are **held** until it revives (`waves.updateWaveSpawns`), so it never
  respawns into the pile-up that killed it. Kills banked toward the boss are kept.
  Respawn is at **full HP** (`reviveHpFraction = 1.0`).
- **Boss retry loop** unchanged: a wiped boss retreats and can be re-challenged;
  the hero farms/levels between attempts. Sim shows finite wipe counts and steady
  level gain, never a lock.
- **Free-hit history preserved.** The M4 ranged/melee free-hit fixes
  (`enemyBehindReach`, `rangedReengageSpeed`, dynamic charge cap) are untouched and
  still hold for a single hero (a solo swordsman walled at `chargeHardCap` is still
  reached by the shooter's forward creep). Long unattended sims (2400s) show no
  free-hit stalls.

## Key knob changes vs M4

| knob | M4 (team) | M5 (solo) | why |
|---|---|---|---|
| upgrade lines (atk/speed/hp) | 3 buyable | **removed** | pivot — power is level+tier now |
| `leveling.atkPerLevel` | 0.001 | **0.10** | levels are the primary power axis now |
| `leveling.hpPerLevel` | 0.015 | **0.09** | survivability must track geometric enemy atk |
| `leveling.xpPerKill(n)` | 4+n | **10+3n** | solo hero must level fast enough to keep pace |
| `leveling.xpPerBossKill(n)` | 30+10n | **80+25n** | chunky milestone |
| `leveling.xpToLevel(l)` | 20·1.15^(l−1) | **30·1.12^(l−1)** | gentler so it keeps leveling to ~44 by S11 |
| `leveling.levelCap` | 50 | **60** | headroom for the grind wall |
| `evolution.atkMult` | 1.0 | **1.35** | ±15% M4 budget gone — evolution can carry real offense |
| `evolution.hpMult` | 1.5 | 1.5 | unchanged |
| `evolution.cost(i)` | 800·(i+1) | 600·(i+1) | gold accumulates freely now |
| `HERO_TYPES.*.hpMult` (new) | — | sword 1.5 / archer 1.0 / mage 0.95 | solo survivability differs by class |
| `HERO_TYPES.archer.dmgMult` | 0.55 | **0.9** | lone archer needs real single-target DPS |
| `HERO_TYPES.mage.dmgMult` | 0.85 | **1.0** | — |
| `HERO_TYPES.mage.atkSpeed` | 1.35 | **1.15** | faster so it isn't helpless between meteors |
| `SKILL_TYPES.archer.mult` | 0.29 | 0.5 | per rain-drop |
| `SKILL_TYPES.mage` | cd 12, mult 3.2 | **cd 10, mult 5.5** | the meteor is the mage's only lone-boss answer |
| `reviveHpFraction` | 0.5 | **1.0** | solo respawn = no penalty (GDD) |

## Notes for phase-2 M5 tasks

- **Base stats (task 3): DONE** — see "Base stats — the STAT re-tune" below.
- **Mana (task 4):** skills are cooldown-only here. A solo hero's skill is a large
  slice of its DPS (esp. the mage meteor vs bosses); gating skills behind mana will
  materially cut effective DPS and require a re-run.
- **Class-change quests (task 5):** they replace the current player-triggered
  `evolveHero` gold trigger; the tier-2 multipliers stay the power delta.
- **Boss hint** (`bossHintPowerDivisor`, `teamPower`): **FIXED in task 3.**
  `teamPower` is now `sum(combatPower(hero))` — effective DPS (basic + skill) plus a
  survivability term — so it no longer under-reads the skill-heavy ranged classes.
  `bossHintPowerDivisor` was re-derived 26 → 2 for the new combat-power scale.

---

## Base stats — the STAT re-tune (task 3, 86d3jv7m3)

Four RO-flavoured axes the player allocates on level-up: **STR** (melee atk),
**DEX** (ranged atk + a small universal atk-speed factor), **INT** (magic atk; the
future mana pool keys off it — task 4), **VIT** (max HP; no mitigation axis exists
in combat yet, so VIT is HP-only — a defense/mitigation factor is a documented
future hook). A class's DAMAGE scales off its **primary** stat only
(sword=STR, archer=DEX, mage=INT); an off-affinity damage stat is inert. The
universal effects (DEX atk-speed, VIT HP) apply to every class.

### Per-point effects & knobs

| knob | value | effect |
|---|---|---|
| `stats.pointsPerLevel` | **3** | points granted per level-up |
| `stats.atkPerPrimaryPoint` | **0.02** | +2% of class-base atk per PRIMARY point above base (additive) |
| `stats.hpPerVitPoint` | **0.03** | +3% of class-base HP per VIT point above base (additive) |
| `stats.atkSpeedPerDexPoint` | **0.0004** | attack-speed factor per DEX point above base (`atkSpeed / (1 + dex·k)`) — tiny on purpose (see archer note) |
| `stats.cap` | 999 | per-stat allocation ceiling (no respec — a future NPC service) |
| `stats.base.*` | sword `{8,4,3,6}` · archer `{4,8,3,5}` · mage `{3,4,8,4}` (str,dex,int,vit) | RO-flavour starting block + the bonus ZERO-POINT (grants no power itself) |

**No-double-count calibration.** Pre-stats, levels carried all atk at **0.10/level**
(`atkPerLevel`). That axis is split: `atkPerLevel` drops **0.10 → 0.04**, and an
auto-allocated hero adds `pointsPerLevel · atkPerPrimaryPoint = 3 · 0.02 = 0.06`/level
from stats. `0.04 + 0.06 = 0.10` — an organically-levelled auto-allocated hero
reproduces the pre-stats atk curve **exactly** (unit-tested). HP stays LEVEL-driven
(`hpPerLevel` unchanged at 0.09) because auto-allocate feeds the PRIMARY stat, never
VIT — moving HP scaling to VIT would leave idle heroes with none.

**Why `hpMult` is NOT folded into VIT** (the handoff flag): `HERO_TYPES.hpMult`
(sword 1.5 / archer 1.0 / mage 0.95) stays as the class HP identity. VIT isn't
auto-allocated, so folding class survivability into it would erase it for idle
players; and mage's sub-1.0 multiplier can't be expressed as a positive additive VIT
bonus without inflating base-stat magnitudes out of a lean RO range. VIT is instead
the player's OPTIONAL survivability investment ON TOP of the class base.

**Manual allocation matters** (the FEEL target): a level's 3 points is either +6%
atk (primary) or +9% HP (VIT) or a slice of atk-speed (DEX) — a real, visible
damage/survivability/tempo trade. Auto-allocate dumps everything into the primary
stat so idle players never drown in unspent points; it emits **no** event, whereas a
manual allocation emits a `statAllocated` event (UI feedback only).

### Combat power ("พลังต่อสู้") — the HOF metric + boss gauge

`combatPower(hero)` (pure, exported) = a single scalar:

```
offense = heroAtk/heroAtkSpeed  +  heroAtk·skillEffectiveMult / skillCd   (basic + skill DPS)
combatPower = round(offense · power.dpsWeight + heroMaxHp · power.hpWeight)   // 6 · offense + 0.5 · HP
```

`skillEffectiveMult` is derived from `SKILL_TYPES` (archer = `mult · targets` for the
9-drop rain; others = `mult`), so it counts skill DPS and no longer under-reads the
ranged classes the way raw summed atk did. It is non-decreasing in every stat point,
level, and tier. `bossHint.teamPower` is now `sum(combatPower)`; `recommendedPower =
bossHp / 2` lands "ready" near an actual clear (advisory only — the sim challenges on
the kill goal + retry loop, never the hint).

### Re-run (auto-allocate ON) — baseline-neutral

`SIM_SECONDS=2400`, 5 seeds, `s.autoAllocate = true`. Mean time-to-clear (s):

| stage | swordsman | archer | mage | Δ vs pre-stats table |
|------:|----------:|-------:|-----:|:--|
| 1  |  34 |  37 |  51 | ≈0 |
| 2  |  54 |  50 |  60 | ≈0 |
| 3  |  81 |  49 |  70 | ≈0 |
| 4  |  94 |  59 |  85 | ≈0 |
| 5  |  93 |  68 |  93 | ≈0 |
| 6  | 103 |  72 |  99 | ≈0 |
| 7  | 114 |  85 | 112 | ≈0 |
| 8  | 136 | 102 | 130 | ≈0 |
| 9  | 146 | 110 | 148 | ≈0 |
| 10 | 165 | 129 | 170 | ≈0 |
| 11 | 316 | 159 | 382 | archer −14% (DEX atk-speed at high lvl — an improvement, in budget) |

Every class clears **S1–S10 on every seed (5/5)**, **0 boss wipes** through S10,
spread ≤1.65× (unchanged). The only material move is **archer S11 184 → 159s**:
because DEX is the archer's primary, auto-allocate funnels points into it and the
small atk-speed factor compounds at high level — a modest speed-up, within the ±15%
budget, and only at the S11 soft grind. The **S12 content ceiling is intact**
(0/5 — intended; extended by M6/M7). The tiny per-point atk-speed factor
(`0.0004`) exists precisely so this archer effect stays in budget rather than
blowing it.
