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
- **Mana + skill framework v2 (task 4): DONE** — see "Mana + skill framework v2"
  at the bottom. Skills now cost mana AND keep per-skill cooldowns; each class has
  a 2–3 skill kit unlocked by level/tier, with up to 3 auto-cast slots.
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

---

## Mana + skill framework v2 (task 4, 86d3jv7m3)

The single-skill-per-class model became a **kit** (2–3 skills/class), gated by
**mana** on top of the existing per-skill cooldowns (GDD: both). This is the M5
solo baseline's successor table — the pre-mana single-skill table above is
superseded for S8+.

### Mana model (`CONFIG.mana`, `systems/stats.heroMaxMana`/`heroManaRegen`)

| knob | value | effect |
|---|---|---|
| `mana.base` | **60** | flat pool every class starts with (before INT) |
| `mana.perIntPoint` | **3.5** | +max mana per INT point above the class base |
| `mana.baseRegen` | **7** | mana/sec every class regenerates |
| `mana.regenPerIntPoint` | **0.15** | +mana/sec per INT point above base |

Pool = `base + max(0, int − baseInt)·perIntPoint`; regen scales the same way. INT
is the mage's PRIMARY (auto-allocate funnels every point into it), so the mage
grows a deep pool + fast regen and **sustains its whole kit** — the caster
identity. The str/dex classes sit on the flat base pool + base regen: base regen
is sized to sustain each **signature** cast at ~its cadence (the *idle guarantee*
— a mana-broke hero never hard-stalls; basic attacks cost no mana and keep banking
kills/XP), with only a thin margin, so their **extra** skills are genuinely
mana-gated (that's the DPS cut mana imposes). Current mana persists (SAVE v6);
maxMana is re-derived from INT on load. INT allocation tops mana up by the added
headroom (feel-good, mirrors VIT→HP).

### Skill kits (`CONFIG.SKILLS`; id / role / mana / cd / unlock)

Signature skills keep their identity/fx + numbers; one new tier-1 skill and one
tier-2 (evolution) skill per class, all reusing existing mechanics (no new
`ProjectileKind`).

| class | id | role | kind | mana | cd | tier·Lv |
|---|---|---|---|---:|---:|---|
| sword | `sword_whirl` | AoE spin (signature) | nova | 24 | 8 | 1·L1 |
| sword | `sword_warcry` | self ATK buff (+40%/6s) | buff | 20 | 16 | 1·L8 |
| sword | `sword_quake` | heavy ground-slam AoE | strike | 44 | 12 | 2·L15 |
| archer | `archer_rain` | field-wide AoE (signature) | rain | 24 | 7 | 1·L1 |
| archer | `archer_powershot` | single-target nuke (boss) | bolt | 28 | 9 | 1·L8 |
| archer | `archer_barrage` | burst AoE at a cluster | strike | 46 | 11 | 2·L15 |
| mage | `mage_meteor` | single/cluster burst (signature) | meteor | 40 | 10 | 1·L1 |
| mage | `mage_frostnova` | cheap fast AoE clear | strike | 20 | 6 | 1·L8 |
| mage | `mage_cataclysm` | ultimate burst | meteor | 58 | 15 | 2·L15 |

Damage kinds: `nova`=AoE around hero, `strike`=instant AoE at nearest target,
`meteor`=falling AoE, `rain`=many falling drops, `bolt`=one high-dmg homing arrow,
`buff`=self ATK steroid. `sword_warcry` is the only non-damage skill.

### Auto-cast slots (`CONFIG.autoSlots`)

Max **3** slots, unlocked at level **1 / 15 / 30**. Slot 0 defaults to the
signature. Auto-cast walks the slots **in order** (deterministic priority) and
casts each slotted skill that is learned + off-cooldown + affordable. The player
assigns skills via the `setAutoSlot` intent (a skill can sit in only one slot);
non-slotted skills are manual (`castSkills`, once-per-click). The sim's auto-pilot
mirrors a real idle player: it fills open unlocked slots with newly-learned skills.

### Re-run (auto-slots ON, `SIM_SECONDS=2400`, 5 seeds)

Mean time-to-clear (s). Auto-pilot: auto-cast + auto-allocate + auto-evolve +
retry loop, now driving the auto-slot loadout.

| stage | swordsman | archer | mage | spread |
|------:|----------:|-------:|-----:|-------:|
| 1  |  34 |  37 |  51 | 1.50× |
| 2  |  54 |  50 |  60 | 1.19× |
| 3  |  79 |  45 |  64 | 1.77× |
| 4  |  93 |  51 |  73 | 1.83× |
| 5  |  90 |  59 |  79 | 1.53× |
| 6  | 100 |  63 |  85 | 1.60× |
| 7  | 112 |  74 |  98 | 1.51× |
| 8  |  88 |  92 | 102 | 1.16× |
| 9  |  90 | 103 | 110 | 1.23× |
| 10 | 107 | 116 | 122 | 1.15× |
| 11 | 127 | 144 | 144 | 1.14× |
| 12 | 439 | 158 | 159 | 2.78× |
| 13 |  —  | 895 | 252 |   —   |

**Targets met:** every class clears **S1–S12 on every seed (5/5)**, **0 boss wipes
through S11**, spread **≤1.83× through S11** (within the ~2× guideline). Mana
starvation never stalls (dedicated tests + long sims: heroes always kill *some*
enemies per life via basic attacks).

**Vs the pre-mana single-skill table:** S1–S7 are unchanged (the new tier-1 skills
unlock at L8 and the tier-2 at L15, so early stages are pure signature). S8–S11 run
~20–35 % faster because a levelled hero now fields 2–3 skills — an intentional
progression reward, only partly offset by the mana gate (str/dex classes are
gated on their extras; the mage sustains its full kit). The **content ceiling
moved deeper** as a result: from S12 (old, all classes) to **S13 for the
swordsman and S14 for archer/mage** — still a soft grind, not a freeze (respawn +
retry loop keep banking XP). S12 is the swordsman's soft wall (2.78× spike); the
ranged AoE classes push one stage further, thematically apt.

**Mana as a real resource:** the tightened regen (base 7) means a tier-2 str/dex
hero's full-kit demand slightly exceeds its regen, so it prioritises — the
auto-slot order decides which skill fires when the pool is short. The mage's
INT-fed regen lifts it clear of the gate (caster identity). Tuned knobs vs the
first pass: `baseRegen` 9→7, `regenPerIntPoint` 0.18→0.15, and the tier-1/2 extra
skills' costs nudged up (powershot 22→28, quake 42→44, barrage 40→46, cataclysm
52→58) to keep the extras gated and the mid-game inside ~2× spread.
