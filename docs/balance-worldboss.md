# Balance — WORLD BOSS "เสี่ยจ๋อง" (hourly, party-gated)

Balance-verify + tune of the world-boss engine wave (`src/engine/systems/worldBoss.ts`,
`CONFIG.worldBoss`). Only `CONFIG.worldBoss` knobs (hp / atk / mechanic mults) were touched;
every other engine value is FROZEN and the canonical solo sim stays byte-identical (the world
boss is DORMANT with no `spawnWorldBoss` intent → all hooks no-op).

## Methodology

New `WORLDBOSS=1` sim mode in `balance-sim.ts` (follows the `PARTY` / `BOSSISO` knob patterns).
It seats a hero/party in the boss's map1 farm zone (`worldBossLocationFor(0)` = map1/z4),
FREEZES the mob field (`spawnPaused`), injects the `spawnWorldBoss` intent, and runs the full
15-min window on autopilot (auto-cast full kit + auto-slots + auto-potion, 999999 potions).
Because the isolated boss fight draws NO RNG (fixed mechanic-timing + fixed skill-offset
tables, mobs frozen) it is **fully deterministic — one seed is canonical**. Two hero profiles:

- **SOLO MAXED** — L90 tier-3, full **t10+10** (the `BOSSISO` `ISO_STATS`/`ISO_GEAR`). Target 1.
- **PARTY member** — level-parametric (`WB_LEVEL`, default 60), tier-3, era gear (t7 → t10 by
  level) at +`WB_REFINE` (default 6). Target 2.

Both a **DPS-ceiling** run (heroes made un-killable → uptime is not the bottleneck, the raw HP
wall) and a **realistic** run (real HP + auto-potion) are measured. Dev knobs `WB_HP / WB_ATK /
WB_SLAM / WB_CHARGE / WB_HAZTICK / WB_LEVEL / WB_REFINE` sweep without recompiling (sim-only,
like `applyRefineCombo`).

## The load-bearing engine finding (overturned the first-pass plan)

The first-pass `CONFIG.worldBoss` comment assumed the solo gate came from **survivability**: a
solo hero eating AOE dies → walks home → the boss despawns → uptime lost. **This is false in
the sim AND in real play**, because `updateWorldBossAI` is SKIPPED while the state is
`traveling`, and a solo death → `respawnToTown` → `autoReturn` round-trip (town is map1 too)
keeps the hero *continuously* traveling and lands it back in the boss zone — the boss (15-min
lifetime) **never despawns**. A solo just loses ~4.7 s/death and grinds on. Confirmed by
instrumentation: at atk 2200 the maxed solo dies 13-30× and STILL kills the boss.

Consequences that shaped the tune:

1. The gate cannot be "solo dies → despawn". It must be a pure **HP / uptime wall**.
2. Raising atk to make a maxed hero die *more* barely helps — a respawn actually *repositions*
   a ranged hero to a cleaner nuke angle, so a dying maxed mage is no slower than an immortal one.
3. **Structural DPS ratio**: a 2-3× Lv60 party's total DPS is only **~1.75×** a single maxed
   L90's (a maxed hero is far stronger per-body). To make solo fail 15 min while a party wins in
   3-6 min you'd need an effective party/solo DPS ratio of **> 2.5** — impossible via hp/atk.
4. **Power-gap wall**: the solo you must gate (L90 t10+10) is far *tankier* than the party you
   must enable (L60 t8). Any per-hit damage that threatens the L90 one-shots an L60 — so the
   gate cannot come from damage, only from HP.

Net: **Targets 1 and 2 are partly mutually exclusive under worldBoss-knob tuning alone.** The
ship prioritizes Target 1 (the stated MUST — "this is the party gate"), keeps the party viable
in-window at every level, and flags the residual for the owner (below).

## Final tuned knobs (before → after)

| knob (`CONFIG.worldBoss`) | before | after | why |
|---|---|---|---|
| `hp` | 400,000 | **1,900,000** | the solo HP wall — a maxed sword/archer can't out-DPS it in 15 min |
| `atk` | 350 | **800** | dangerous-but-survivable for a maxed hero (a wall, not an instakill) |
| `boss.slamMult` | 1.7 | **2.2** | single-target gate (front hero only); a party rotates it, a solo can't |
| `bossBehavior.charge.hitMult` | 1.6 | **2.2** | reaches the ranged solo (dashes to target); single-target so a party rotates it |
| `bossBehavior.hazard.tickMult` | 0.3 | **0.10** | arena-wide → kept LOW so a hazard channel can't simultaneously wipe a party |

`periodMs` / `preAnnounceMs` / `lifetimeMs` / `mapId` / mechanic timings unchanged. No SAVE
change (world-boss state is transient; these are config constants — no `SAVE_VERSION` bump).

## Target 1 — SOLO must NOT kill it (maxed L90 t10+10, any class)

| class | DPS-ceiling (immortal) | realistic | verdict |
|---|---|---|---|
| swordsman | survives, 81% chunked | survives, **99% chunked**, 16 deaths | **GATE HELD** |
| archer | survives, 73% chunked | survives, **77% chunked**, 46 deaths | **GATE HELD** |
| mage | survives, 93% chunked | **KILLED 12.99 min**, 28 deaths | ⚠ **LEAK** (flagged) |

Sword + archer maxed solos CANNOT finish in 15 min — they chunk most of the bar and survive the
whole window with potions (16-46 deaths over 15 min = a war of attrition, never an instakill →
the "wall, not instakill / survives reasonably" clause holds). Every *non-maxed* solo (the
realistic 99% of players) is gated far harder.

**⚠ LOUD FLAG — the maxed MAGE leaks (~13 min).** A high-DPS ranged caster evades slam and kites
charge, so only the (deliberately low) arena hazard reliably reaches it; its DPS-per-uptime is
high enough to grind 1.9M in ~13 min. There is **no HP that stops the mage while keeping a 2p
party viable in the window** (see the tradeoff). Owner options (nothing changed silently):
- **(a) Accept it.** It requires a *flawless maxed L90 mage* soloing for 13 uninterrupted
  minutes — an extreme edge case; the gate holds against every other maxed class and all
  non-maxed solos.
- **(b) Structural party-gate** (recommended, `game-engine-specialist`): make the world boss
  only *damageable* with ≥2 live heroes present (or scale its HP by headcount). This enforces
  "party-gated" by design instead of via a stat wall, and would let HP drop back so 2-3p hit the
  snappy 3-6 min band.

## Target 2 — party time-to-kill

Shipped config, per party size (mixed classes). Fully deterministic; deaths = total across the
party over the fight (revive-in-place — a partial wipe never ends the run; no simultaneous total
wipe occurred at any size/level).

| comp | Lv50 | Lv60 | Lv70 | Lv80 | Lv90 |
|---|---|---|---|---|---|
| 2p [sword,mage] | ~13 min | **12.5 min** | ~10 min | 8.3 min | 7.9 min |
| 3p [sword,archer,mage] | 11.5 min | **9.8 min** | 7.8 min | 6.6 min | 5.9 min |
| 6p [2×each] | 5.9 min | **4.6 min** | 3.6 min | 3.2 min | 2.8 min |

(Lv60 column measured directly; other levels from the `WB_LEVEL` sweep at the shipped config.)

- **The 6-member melt (owner asked to quantify, not tune against):** ~4.6 min at Lv60, down to
  **~2.8 min at Lv90**. Monotonic in headcount and power. Acceptable per the brief.
- **⚠ FLAG — the "~3-6 min for 2-3p" aspiration only holds for ENDGAME parties.** At the owner's
  stated Lv50-70, a 2-3p runs **8-12 min** (still a one-window clear, within the 15-min lifetime).
  It reaches 3-6 min for a 3p only at Lv80+. This is the direct flip side of the 1.9M HP wall that
  gates the solo — see the tradeoff. If the owner wants Lv50-70 2-3p in 3-6 min, take option (b)
  above (structural gate) so HP can drop.

### The tradeoff, quantified (why both targets can't hold at once)

| HP | maxed solo (sword/archer/mage) | 2p Lv60 | 3p Lv60 | 6p Lv60 |
|---|---|---|---|---|
| 800k | KILLS 6.4 / 8.0 / 5.4 min (gate FAILS all) | **5.3 min** | **4.1 min** | 1.9 min |
| 1.2M | KILLS 10.1 / 13.7 / 8.5 min (gate FAILS all) | 7.2 min | 5.7 min | 3.1 min |
| **1.9M (shipped)** | **GATED / GATED / 13.0 min** | 12.5 min | 9.8 min | 4.6 min |
| 2.2M | gates all incl. mage | ~14.4 min (⚠ non-viable) | ~11 min | 5.3 min |

At 800k both targets' party pacing is perfect but no solo is gated (feature purpose defeated);
at 2.2M the mage is finally gated but a 2p party can no longer reliably clear the window. 1.9M is
the highest HP that keeps a 2p viable, and it gates every maxed solo except the mage.

## Target 3 — reward inflation (rewards owner-FIXED: 5000 gold + 350 stones / member / window)

Normal farm income measured in-sim (600 s in-zone, era-appropriate hero per progression point).
The reward is per hourly window, compared to hourly farm income.

| progression point | gold/hr | stones/hr | gold boost | stone boost |
|---|---|---|---|---|
| NEWBIE Lv10 / map1 s3 | 25,830 | 2,100 | **+19%** | +17% |
| early Lv20 / map2 s8 | 71,496 | 3,870 | +7% | +9% |
| mid Lv50 / map4 s18 | 271,206 | 8,550 | +2% | +4% |
| end Lv80 / map6 s28 | 699,960 | 14,238 | +1% | +2% |

**No distortion flag.** The owner-fixed reward is a small fraction of normal income at EVERY
point — even a carried newbie sees only **+19%** gold (well under the 3× / +300% concern; a truly
fresh Lv5 carried char would see more but still bounded < +100%). At mid/endgame the reward is a
**rounding error (+1-4%)**. If anything the *opposite* note for the owner: the fixed gold/stone
reward is **underwhelming** at mid-to-endgame — the world boss's real draw must be elsewhere
(social / prestige / a special drop, if added later), not these currencies. Left as an owner call
(rewards are owner-fixed).

## Gates

- **Canonical solo sim BYTE-IDENTICAL** — the world boss is dormant without a `spawnWorldBoss`
  intent (state.worldBoss stays null, every hook no-ops), and only `CONFIG.worldBoss` VALUES
  changed (shape unchanged), so `GEAR=1 REFINE=1` before/after is identical. Verified.
- **Full vitest green** incl. the world-boss engine + render suites (the render fixtures build
  their own mock entity literals, not the CONFIG value, so the hp change doesn't touch them; the
  engine test's "400k HP survives an early hero" now survives 1.9M all the more).
- **tsc / eslint clean.** No new events/enums (footgun #6 N/A — pure value tweaks). No SAVE bump.

## Residual flags for the owner (nothing changed silently)

1. **Maxed L90 MAGE solos it in ~13 min** — irreducible via knobs (ranged kites the single-target
   gate; no viable HP stops it without making a 2p party non-viable). Accept, or add a structural
   min-party-size damage gate (`game-engine-specialist`).
2. **"3-6 min for 2-3p" only holds at Lv80+** — at Lv50-70 a 2-3p runs 8-12 min (still one-window).
   Same structural root as (1); the structural gate would fix both by letting HP drop.
3. **The fixed reward is small** (+1-19% of hourly income; +1-4% at endgame) — no progression
   distortion, but possibly underwhelming; owner's call (rewards are owner-fixed).
