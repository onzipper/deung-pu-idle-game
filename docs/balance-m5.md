# M5 Solo Rebaseline — ดึ๋งปุ๊ Idle Game

ClickUp: 86d3jv7m3 · Branch: `develop` · Supersedes [balance-m4.md](./balance-m4.md)
for team composition (that table was a 3-hero baseline; it no longer applies).

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

- **Base stats (task 3):** with upgrades gone, the per-class `HERO_TYPES.hpMult`
  is a placeholder survivability axis — fold it into the real base-stat allocation.
  Level growth (atk/hp per level) currently carries all scaling; adding player-
  allocated stats will need a re-tune to avoid double-counting.
- **Mana (task 4):** skills are cooldown-only here. A solo hero's skill is a large
  slice of its DPS (esp. the mage meteor vs bosses); gating skills behind mana will
  materially cut effective DPS and require a re-run.
- **Class-change quests (task 5):** they replace the current player-triggered
  `evolveHero` gold trigger; the tier-2 multipliers stay the power delta.
- **Boss hint** (`bossHintPowerDivisor`, `teamPower`) still sums raw hero atk, which
  under-reads high-DPS-low-atk classes (archer/mage). It's advisory-only now (the
  sim ignores it); if the UI leans on it, make it effective-DPS-aware.
