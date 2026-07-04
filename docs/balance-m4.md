# M4 Balance Pass — ดึ๋งปุ๊ Idle Game

ClickUp: 86d3jvcxz · Branch: `develop`

All numbers below come from the headless balance harness
(`src/engine/__tests__/balance-sim.ts`, `pnpm sim`). The engine is deterministic
and pure, so every figure is reproducible: `SIM_SECONDS` and `SEEDS` are env
knobs (defaults `1800` and `1,2,3,42,1337`). The auto-pilot farms, challenges the
boss the instant `bossHint().ready` is true, and advances on victory.

The harness now reports, per seed **and** aggregated across seeds: time-to-clear
per stage, gold income rate per stage, boss attempts / wins / wipes, upgrade
levels at each clear, first-upgrade and first-boss-kill times, and boss-hint
accuracy (recommended power vs the team power that actually won). It also prints
a `SIM_JSON` machine-parsable summary line.

---

## TL;DR

- **Baseline had a wall at stage 7** (2.66x the previous stage) and never cleared
  stage 8 in 1800 s.
- The wall is **structural**: `heroAtk` is additive (`base·(1+per·level)`) while
  enemy/boss HP is geometric, so the atk level needed to keep pace — and its
  `growth^level` cost — grow super-linearly with stage. A hard stall is
  unavoidable; the design lever is _where_ it lands and _how smooth the ramp into
  it is_.
- Three config knobs move the wall from stage 7 to stage 9, flatten stages 3–8
  into a clean 1.08–1.17x ramp, and tighten the early hook. No wipes, no dominant
  upgrade line.
- The stage-9 stall (~16 min in, entering; ~13 min to grind) is the **natural
  first-prestige gate for M5**.

---

## Config changes

| Constant                              | Old                | New                           | Why                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------- | ------------------ | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `enemyHp` / `bossHp` scaling exponent | `1.23`             | `1.20`                        | Additive hero atk can't chase geometric HP forever. 1.20 is identical at stage 1 (exp 0) and only bends the **late** curve down — buys ~1 extra smooth stage and lowers the wall's height with zero effect on early-game feel. Reused base means the boss-power target (`rec = bossHp/26`) softens in lockstep.                                                                        |
| `UPGRADES.atk.growth`                 | `1.45`             | `1.38`                        | atk is the boss-gating stat (team power = Σ heroAtk), so its high-level cost _is_ the wall. 1.38 barely moves L0–L3 (25/35/48/66 vs 25/36/53/76) but roughly halves L12+, softening the stage-9 wall (~7.5x → ~4.9x) and shaving stage 1 (172 → 150 s). Also makes atk the cheapest-_growth_ line, so cheapest-first auto-buy funnels a bit more into the stat that advances the gate. |
| `goldPerKill`                         | `5 + n·2` (linear) | `round((5 + n·2)·1.05^(n-1))` | Linear income vs geometric costs = late-stage starvation. The gentle 1.05/stage multiplier leaves stage 1–3 effectively unchanged (7/9/12 vs 7/9/11) but lets income track the cost curve deeper, converting the old stage-8 stall into a comfortable stage.                                                                                                                           |

Nothing else changed. `killGoal`, `goldPerBoss`, `bossHintPowerDivisor`, the
per-line `base`/`per`, `SPEED_UPGRADE_CAP`, enemy/boss atk, and all combat/movement
tunables are untouched — the early game already felt good and I did not want to
redesign it.

Each change has a `// M4 tune:` comment in `src/engine/config/index.ts` recording
the intent and the before/after.

---

## Baseline vs tuned (aggregate, 5 seeds, 1800 s)

`dur` = mean time-to-clear the stage (enter → boss dead). `wallX` = dur ÷ previous
stage's dur (>2.5x is flagged a wall). `rec:team` = recommended power : team power
at the winning challenge.

### Baseline

| Stage | dur (s)                   | wallX            | gold/min | rec:team |
| ----- | ------------------------- | ---------------- | -------- | -------- |
| 1     | 172.1                     | —                | 181      | 15:15    |
| 2     | 81.0                      | 0.47x            | 203      | 19:23    |
| 3     | 89.6                      | 1.11x            | 260      | 23:39    |
| 4     | 100.1                     | 1.12x            | 314      | 29:41    |
| 5     | 117.5                     | 1.17x            | 348      | 35:44    |
| 6     | 128.9                     | 1.10x            | 397      | 43:48    |
| 7     | **342.4**                 | **2.66x ← WALL** | 457      | 53:53    |
| 8     | (never cleared in 1800 s) |                  |          |          |

first upgrade 13.2 s · first boss kill 172.1 s · 0 wipes · reached stage 8.

### Tuned

| Stage | dur (s)                 | wallX                             | gold/min | rec:team |
| ----- | ----------------------- | --------------------------------- | -------- | -------- |
| 1     | 150.0                   | —                                 | 174      | 15:15    |
| 2     | 79.3                    | 0.53x                             | 205      | 18:25    |
| 3     | 85.4                    | 1.08x                             | 290      | 22:41    |
| 4     | 100.2                   | 1.17x                             | 351      | 27:44    |
| 5     | 111.0                   | 1.11x                             | 423      | 32:48    |
| 6     | 130.4                   | 1.17x                             | 483      | 38:50    |
| 7     | 141.1                   | 1.08x                             | 561      | 46:53    |
| 8     | 157.8                   | 1.12x                             | 654      | 55:56    |
| 9     | **775.4**               | **4.91x ← stall / prestige gate** | 890      | 66:67    |
| 10    | (in progress at 1800 s) |                                   |          |          |

first upgrade 13.2 s · first boss kill 150.0 s · 0 wipes · reached stage 10.

**What moved:** the wall went from stage 7 (2.66x, and everything past it a brick)
to stage 9 (4.91x), with stages 3–8 now a clean 1.08–1.17x ramp — two extra
stages of comfortable, satisfying content before the stall. Early hook tightened
(first boss 172 → 150 s, still inside the 2–4 min target). Income rises with
stage instead of flat-lining.

---

## Pacing analysis vs idle norms

- **Early hook — good.** First upgrade at ~13 s (target < ~20 s); first boss kill
  at ~150 s (target ~2–4 min). Stage 1 is the longest early stage because you
  start with a single hero; that's an acceptable "learn the loop" beat.
- **The stage-2 dip is intentional.** Stage 2 (79 s) is _faster_ than stage 1
  because the archer unlocks — a hero unlock is a deliberate power spike. Hero #3
  (mage) at stage 3 is why stage 3 is also cheap. These are the two big
  early-game "power up" moments and they should land with juice (coordinate with
  `sr-uxui-game-designer`).
- **Mid game — smooth.** Stages 3–8 climb 1.08–1.17x each. No wall, no starvation,
  no runaway (gold is spent, not hoarded — final gold stays small).
- **No wipes anywhere.** Across all seeds and stages the auto-pilot never loses a
  boss fight, because it only challenges when `hint.ready` and the hint is a valid
  floor (see below). Retreat-loops are therefore not a live failure mode under the
  auto-buy policy.
- **The wall at stage 9 is the prestige gate, not a bug.** Because hero power is
  additive and enemy scaling geometric, _some_ stage will always flip from
  "trivial" to "impossible" within roughly one stage. Tuning positions that flip
  at stage 9 (~16 min to enter) and softens it from ~7.5x to ~4.9x, but cannot
  remove it without a systems-level change (multiplicative/compounding upgrades),
  which is out of scope for a config pass. This is the intended M5 hand-off.
- **Boss-hint accuracy.** At the binding stages (8–9) `rec ≈ team` at the win
  (55:56, 66:67) — the `bossHintPowerDivisor = 26` is well-calibrated to the
  actual win threshold, so I left it alone. At stages 3–6 the team shows up with
  1.5–1.9x the recommended power; the harness now labels this **"boss SOFT —
  kill-gated overshoot"** rather than "hint off". It is _not_ a bad hint: `rec` is
  a valid minimum, but the **kill goal** gates those stages, so you farm past the
  power floor and stomp the boss. Early bosses being satisfying stomps is fine
  idle design; if we ever want them to feel like real fights, trim `killGoal`
  growth rather than the hint divisor.
- **No dominant upgrade line.** Final level mix (summed over seeds) is atk/spd/hp
  ≈ 75/50/60 — roughly atk 40% / hp 32% / speed 28% (speed is `SPEED_UPGRADE_CAP`
  = 18-limited). All three lines stay individually meaningful under cheapest-first
  auto-buy; atk leads only because it's the boss gate and now the cheapest-growth
  line.

---

## Open questions for M5 (prestige)

1. **Where should the first prestige land?** The data says the natural stall is
   **stage 9, reached ~16 min into a fresh run, ~13 min to grind through.** First
   prestige should become _available_ around **stage 8** and clearly _worth it_
   by stage 9, so the player prestiges into the wall instead of grinding a 13-min
   stage. Target first-prestige at **~15–20 min** of active play.
2. **Reset currency curve.** Prestige gain should key off cleared stage (the thing
   that stalls), e.g. reset currency `∝ f(bestStage)`. Because the wall is
   geometric, a geometric-ish prestige payout (each stage worth meaningfully more)
   keeps resetting attractive as players push one stage deeper each run.
3. **What carries the multiplier?** A prestige **multiplier on hero atk** is the
   highest-leverage carry, because atk is the additive stat that loses the race to
   geometric HP. A multiplicative prestige bonus is exactly the compounding term
   the base economy lacks — it's what lets run _N+1_ blow past the wall that
   stopped run _N_. Consider also a small permanent gold-rate or auto-buy-speed
   bonus so re-clearing early stages is fast (avoid a boring re-grind).
4. **Second-order wall.** Even with a prestige atk multiplier, the additive-vs-
   geometric mismatch reasserts itself a few stages higher each run. That's the
   intended long-run loop, but M5 should sim it (extend this harness with a
   prestige-and-restart auto-pilot) to confirm each run reaches ~1 stage further
   and the time-per-prestige stays in a fun band.

---

## Offline earnings × the tuned gold curve (8 h cap)

`CONFIG.offlineCapHours = 8` and offline income is server-authoritative
(`src/server/offline.ts`). Relevant to this pass:

- **Idle should be meaningful but active must win.** Active gold/min climbs from
  ~174 (stage 1) to ~890 (stage 9). Offline should be paid at the player's
  _current-stage_ active rate times an **idle factor < 1** (suggest ~0.4–0.6), so
  8 h offline ≈ a few active-stages' worth of gold — enough to feel rewarding, not
  enough to skip the loop. Concrete: at stage 8 (~654 gold/min active), an 8 h cap
  at 0.5 idle factor ≈ 157 k gold, roughly one-and-a-half stage-9 grinds' worth —
  a nice "welcome back" bump that still leaves the wall to beat actively.
- **Cap the offline rate at the stage the player was _on_, server-side.** Never
  let the client assert its stage/rate — recompute from the saved stage. The
  geometric gold curve means a spoofed high stage would mint a lot of gold, so the
  8 h cap **and** the stage-derived rate must both be enforced in
  `src/server/offline.ts` (coordinate anti-cheat with `sr-backend-developer`).
- **Any change to `goldPerKill` / `goldPerBoss` is save-affecting** only insofar
  as it changes the offline-rate derivation, not the `SaveData` shape — these are
  pure curves, so no `SAVE_VERSION` bump is required for this pass. If M5 adds
  prestige fields to `SaveData`, bump `SAVE_VERSION` and add a `migrate()` branch
  then.

---

## Reproducing

```
pnpm sim                       # 1800 s, default seeds — full arc incl. the stage-9 stall
SIM_SECONDS=3000 pnpm sim      # see the wall grind out and stage 10 begin
SEEDS=7,8,9 pnpm sim           # different RNG streams
```

Output = per-seed table + a cross-seed AGGREGATE table + PACING FLAGS + a
`SIM_JSON {...}` line for tooling.

---

## Hero charge (ClickUp 86d3k2he0)

Player feedback: _"I want our heroes to RUN AT and SMASH the monsters."_ The old
movement had the team hold a formation anchor mid-left and wait for enemies to
walk in. This pass makes the **swordsman sprint across the field** at any enemy in
a wide seek range, and makes the **whole formation surge forward** on contact so
the ranged heroes visibly push up too (they keep their kite behaviour).

### New config knobs (all in `src/engine/config/index.ts`)

| Knob                | Value | Meaning                                                                                              |
| ------------------- | ----- | ---------------------------------------------------------------------------------------------------- |
| `battleAnchorLead`  | 130   | Anchor lead while enemies present (was `anchorLead` 170) — formation rides closer to the enemy line. |
| `battleMaxAnchor`   | 330   | Anchor forward cap in battle (was `maxAnchor` 300) — ranged heroes push ~30px further up.            |
| `battleAnchorSpeed` | 115   | Anchor ease speed in battle (was `anchorSpeed` 60) — the team surges forward ~2x faster on contact.  |
| `chargeSeekRange`   | 560   | Swordsman starts charging at any enemy within this (was the tight `meleeSeekRange` 260).             |
| `chargeSpeed`       | 265   | Sprint speed while charging (~1.77x `heroMove` 150) — the "run at them" feel.                        |
| `meleeChargeLeash`  | 260   | Loosened forward leash while a charge target exists (was `meleeLeash` 90).                           |
| `chargeCap`         | 470   | Hard forward cap while charging (~70px past `midCap` 400; far short of `spawnX` 860).                |

The non-battle (no-enemy) easing knobs (`maxAnchor` / `anchorSpeed` / `anchorLead`)
are untouched — the formation still eases calmly home between waves.

**Why `chargeCap` is only 470, not deeper.** A first pass used `chargeCap = 560`.
Charging that deep drags the engagement line to the right, **out of the archer/mage
range** (mage @ ~256 reaches ~586; a fight at ~606 falls outside it), so the team
loses ranged DPS and clears got _slower_ despite better melee uptime — stage 3 went
**+17% vs the M4 baseline**. Pulling the cap back to 470 keeps the fight inside
ranged coverage while still a clear sprint past the old hold (214 start → 470 = a
256px run). The swordsman still visibly runs across the field and smashes.

### Pacing: M4 baseline vs hero-charge (aggregate, 5 seeds, 1800 s)

| Stage | M4 dur (s) | charge dur (s) | Δ     | charge wallX | charge gold/min |
| ----- | ---------- | -------------- | ----- | ------------ | --------------- |
| 1     | 150.0      | 137.1          | −8.6% | —            | 190             |
| 2     | 79.3       | 72.0           | −9.2% | 0.53x        | 226             |
| 3     | 85.4       | 80.1           | −6.2% | 1.11x        | 309             |
| 4     | 100.2      | 92.5           | −7.7% | 1.16x        | 380             |
| 5     | 111.0      | 103.6          | −6.7% | 1.12x        | 453             |
| 6     | 130.4      | 120.7          | −7.4% | 1.16x        | 522             |
| 7     | 141.1      | 129.9          | −7.9% | 1.08x        | 612             |
| 8     | 157.8      | 148.3          | −6.0% | 1.14x        | 696             |
| 9     | 775.4      | 743.0          | −4.2% | 5.01x        | 928             |

**Net effect:** a uniform **4–9% speedup at every stage** — the "faster clears from
better melee uptime" the task anticipated, and well inside the ±15% band, so no
compensating change to the M4-tuned curves (`enemyHp`/`atk`, `UPGRADES`,
`goldPerKill`, `killGoal`, `bossHintPowerDivisor`) was needed. The stage-3–8 ramp
stays a clean 1.08–1.16x, the stage-9 prestige gate is preserved (4.91x → 5.01x),
and there are **0 wipes** across all seeds. Only the new charge knobs were tuned.

Reproduce: `pnpm sim` (or `node ./node_modules/tsx/dist/cli.mjs
src/engine/__tests__/balance-sim.ts`).

---

## Whole-team forward push (ClickUp 86d3k2nhm)

Player feedback after the hero-charge pass: heroes **still visibly wait** — the old
`chargeSeekRange` (560) only fired once an enemy walked in from the spawn edge
(860), so the swordsman idled at wave start, and the `chargeCap` (470) plus a
shallow `battleMaxAnchor` (330) kept fights inside the ranged band by keeping the
whole team _back_. The fix: the whole field triggers the charge, the anchor rides
**deep** so the archer/mage coverage travels WITH the fight, and the formation
**never retreats between waves**.

### Config knobs (old → new, all in `src/engine/config/index.ts`)

| Knob               | Old | New | Why                                                                                                                                                                                                           |
| ------------------ | --- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chargeSeekRange`  | 560 | 900 | Whole-field trigger. 900 ≥ the full span from the deepest a hero stands (~150) to `spawnX` (860), so a freshly-spawned enemy is charged the instant a wave appears — no wave-start idle.                      |
| `battleMaxAnchor`  | 330 | 510 | The team pushes DEEP. Archer/mage advance with the swordsman so their range covers the pushed-up fight instead of falling behind it.                                                                          |
| `battleAnchorLead` | 130 | 150 | Anchor tracks `minEnemyX − lead`; sized so the anchor rides right up near the engagement line while the ranged heroes still sit a touch behind it.                                                            |
| `chargeCap`        | 470 | 640 | Cap UNLOCKED now that the anchor (510) follows forward. The old 470 existed only to keep fights inside a _stationary_ ranged band; with coverage travelling, deep charging no longer strands the archer/mage. |

Ranged-coverage re-validation at the new depth: enemies stop ~`clash` (46) past the
swordsman, so a `chargeCap` fight at ~640 sits at ~686. mage @ (510−74=436) + range
330 → **766 ≥ 686**; archer @ (510−26=484) + 350 → **834 ≥ 686**. Both still cover
the deepest engagement, so the "charging deeper net-slows clears" trap from the 470
era does **not** reappear (confirmed by the sim below — every stage got _faster_).

Unchanged: `chargeSpeed` (265), `meleeChargeLeash` (260), `battleAnchorSpeed` (115),
the ranged kite behaviour (still steps back by `rangedKiteStep` when an enemy is
within `kiteDist`), the boss fight (boss `engageX` still derives from `frontHeroX`),
and all M4 curves (`enemyHp`/`atk`, `bossHp`/`atk`, `UPGRADES`, `goldPerKill`,
`killGoal`, `bossHintPowerDivisor`). No curve was touched.

### No retreat between waves

`updateAnchor` (`src/engine/systems/movement.ts`) previously eased the anchor back
toward `baseAnchor` whenever the field was empty — so the team walked _backwards_
during every `waveGap`. Now, while a stage is live (`phase === "battle"`) and no
enemy is alive, the anchor **holds its forward line** (early-returns, no movement).
It only eases home outside a live battle. The render layer's parallax already sells
"journeying forward"; the formation now agrees.

### Pacing: hero-charge baseline vs whole-team push (aggregate, 5 seeds, 1800 s)

`charge` = the previous (86d3k2he0) table; `push` = this pass.

| Stage | charge dur (s) | push dur (s) | Δ          | push wallX | push gold/min |
| ----- | -------------- | ------------ | ---------- | ---------- | ------------- |
| 1     | 137.1          | 106.8        | **−22.1%** | —          | 246           |
| 2     | 72.0           | 66.2         | −8.1%      | 0.62x      | 251           |
| 3     | 80.1           | 72.9         | −9.0%      | 1.10x      | 342           |
| 4     | 92.5           | 75.3         | **−18.6%** | 1.03x      | 471           |
| 5     | 103.6          | 91.2         | −12.0%     | 1.21x      | 519           |
| 6     | 120.7          | 106.4        | −11.8%     | 1.17x      | 597           |
| 7     | 129.9          | 116.1        | −10.6%     | 1.09x      | 682           |
| 8     | 148.3          | 134.7        | −9.2%      | 1.16x      | 772           |
| 9     | 743.0          | 670.6        | −9.7%      | 4.98x      | 1029          |

first upgrade 11.8 → 8.1 s · first boss kill 137.1 → 106.8 s · **0 wipes** · reached
stage 10.

**Net effect:** a uniform **~8–12% speedup** across stages 2–9 (all inside the ±15%
band), the stage-9 prestige gate preserved (5.01x → **4.98x**), the 3–8 ramp still a
clean 1.03–1.21x, and **0 wipes**. Only the charge/anchor knobs moved — no curve.

**Two intentional fast-side overshoots.** Stage 1 (−22.1%) and stage 4 (−18.6%)
exceed the ±15% band, both _faster_, and both are the direct, desired consequence of
the task ("eliminate every standing-around moment"), not balance drift:

- **Stage 1** is the pure-swordsman stage, where the old wave-start idle (waiting for
  each spawn to walk into the tight 560 range) was the single biggest time sink.
  Removing it is exactly the point; the effect is trigger-bound and cannot be tuned
  back without re-introducing the waiting (a gentler cap/anchor variant, 490/600,
  still lands stage 1 at −18%). first-boss-kill drops 137 → 107 s, still inside the
  2–4 min hook target.
- **Stage 4** is the first stage where all three heroes plus the deep anchor let the
  ranged coverage travel with a fast melee push — the "ranged advance with the fight"
  win the task asked for. gold/min jumps 380 → 471 accordingly.

The ramp shape stays smooth, the gate holds, nothing wipes, and no economy curve was
disturbed — so these two breaches are feature, not regression.

Reproduce: `pnpm sim` (or `node ./node_modules/tsx/dist/cli.mjs
src/engine/__tests__/balance-sim.ts`).

---

## Ranged-reach + no-park follow-up (ClickUp 86d3k2nhm follow-up)

Player playtest of the whole-team push surfaced three bugs:

1. **Archer & mage stood exactly stacked** ("มองไม่เห็นตัวละคร"). The ranged upper
   clamp was `min(homeX + rangedHomeFront, midCap 400)`. At `battleMaxAnchor 510`,
   archer homeX = 484 and mage homeX = 436 **both** clamp to 400 → exact overlap.
   `midCap` is a POC-era _absolute_ cap that stopped scaling once the anchor pushed deep.
2. **Swordsman still parks and waits** ("hero ยังยืนรอ...เซ็ง"). He sprinted to the
   static `chargeCap 640` and froze while a melee enemy walked 860 → ~686 (~174px ≈ 4s
   at speed 44). That frozen window _is_ the wait.
3. **Free hits** ("โดนมอนตีฟรี"). Root cause = **ranged-enemy-beyond-reach**: a ranged
   enemy stops as soon as it is within its 160 range of the nearest hero and then plinks
   forever (it never kites inward). With the swordsman pinned at `chargeCap 640` and the
   nearest hero, the ranged enemy rests at ~800; his 96 melee range can't span the 160
   gap, and his goal (774) clamps back to 640, so **he can never close** — permanent free
   damage with zero counterplay. No backline hero covered it either (archer @ 400 reaches
   750, mage @ 400 reaches 730 — both short of 800).

The three are one **coupled geometry** problem: naively raising `chargeCap` to fix (2)
without covering the deeper fight would just relocate the free-hit to whichever hero
_can't_ reach.

### Config knobs (old → new, all in `src/engine/config/index.ts`)

| Knob               | Old          | New                    | Why                                                                                                                                                                                                                                                                                             |
| ------------------ | ------------ | ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ranged upper clamp | `midCap 400` | `rangedForwardCap 740` | Spawn-relative safety net that never collides with `homeX` (max ~572). `homeX = anchorX + offset` already carries the −26/−74 formation spread, so spacing survives at ANY anchor depth — fixes (1).                                                                                            |
| `chargeCap`        | 640 (static) | 640 (floor)            | Now the **floor** of a **dynamic** forward cap: `upperCap = min(homeX + meleeChargeLeash, clamp(target.x − meleeApproachGap, chargeCap, chargeHardCap))`. The cap follows the target, so the swordsman never freezes short of it — fixes (2) — and can always close to melee range — fixes (3). |
| `chargeHardCap`    | — (new)      | 770                    | Dynamic-cap ceiling = `spawnX 860 − 90`. `770 + swordsman range 96 = 866 ≥ 860`, so the swordsman can always reach a ranged enemy resting at the spawn edge (must be ≥ 764). This is what structurally kills the free-hit — via the **swordsman's reach**, not a deeper backline.               |
| `battleMaxAnchor`  | 510          | **510 (held)**         | Deliberately NOT deepened (see below).                                                                                                                                                                                                                                                          |

`midCap` is retained — it still bounds the no-charge hold branch (harmless there).

### Why `battleMaxAnchor` stays 510 (a rejected 590 draft)

The first draft deepened the anchor to **590** so archer+mage coverage would ride all
the way up to the new fight line. It works mechanically, but the sim rejected it on
**balance**: the extra ranged uptime made clears **~18% faster on average**, throwing
**five** stages outside the ±15% budget (S5 −20%, S7 −23%, S8 −21%, plus S1/S2). A 560
midpoint was also too fast (S2 −26%, S8 −16%). **510** — i.e. leaving the anchor where
the push pass left it — is the only value that keeps every mid/late stage in budget,
because the free-hit fix does **not** need a deeper backline: the swordsman's
`chargeHardCap 770` reach (866) handles spawn-edge ranged enemies directly, and archer @
(510−26=484)+8+350 = **842 ≥ 840** still covers the melee fight line. The only cost is
that the mage (reach 774) covers the incoming _stream_ rather than the very front enemy
— acceptable, and the price of staying inside the economy budget without touching a
single curve.

### Pacing: push baseline vs this follow-up (aggregate, 5 seeds, 1800 s)

`push` = the previous (86d3k2nhm) table; `now` = this pass (`battleMaxAnchor 510`,
`chargeHardCap 770`, dynamic cap, `rangedForwardCap 740`).

| Stage | push dur (s) | now dur (s) | Δ        | now wallX | now gold/min |
| ----- | ------------ | ----------- | -------- | --------- | ------------ |
| 1     | 106.8        | 88.6        | −17.0%\* | —         | 296          |
| 2     | 66.2         | 55.8        | −15.7%\* | 0.63x     | 304          |
| 3     | 72.9         | 75.6        | +3.7%    | 1.36x     | 329          |
| 4     | 75.3         | 74.0        | −1.7%    | 0.98x     | 474          |
| 5     | 91.2         | 90.7        | −0.5%    | 1.23x     | 526          |
| 6     | 106.4        | 107.1       | +0.7%    | 1.18x     | 598          |
| 7     | 116.1        | 105.2       | −9.4%    | 0.98x     | 754          |
| 8     | 134.7        | 116.7       | −13.4%   | 1.11x     | 883          |
| 9     | 670.6        | 608.9       | −9.2%    | 5.22x     | 1132         |

first upgrade 8.1 → 6.8 s · first boss kill 106.8 → 88.6 s · **0 wipes** · reached
stage 10 on all seeds.

**Net effect:** stages 3–9 all inside the ±15% band, the stage-9 prestige gate
preserved (4.98x → **5.22x**), the 3–8 ramp still a clean shape, and **0 wipes**. No
economy curve was touched — only the charge/formation geometry.

**\* The two flagged stages (S1 −17%, S2 −16%) are the parking fix itself, not drift.**
S1 is the pure-swordsman stage: it has **no ranged heroes at all**, so `battleMaxAnchor`
cannot affect it — its speedup is entirely the removal of the ~4s/wave park (the
swordsman now engages near the spawn edge instead of freezing at 640). Trimming it
further would require lowering `chargeHardCap` below 764, which re-opens the free-hit.
S2 (+archer) is a hair over for the same reason. Both are _faster_, the ramp/gate/wipes
all hold, and no curve moved — so they are feature, not regression.

### Tests (headless, `src/engine/__tests__/charge.test.ts`)

- **no stacking at any depth** — 3 heroes, several enemy depths; asserts `|archer.x −
mage.x| ≥ 30` and that the spread ≈ the offset difference (48). (Failed pre-fix: both
  pinned at 400.)
- **no park** — a moving melee enemy walks in from spawn; counts frames where the
  swordsman has ~zero x-velocity while an enemy is alive and beyond melee range; asserts
  < ~1.0s. (Failed pre-fix: ~4s frozen at 640.)
- **ranged enemy reachable** — a high-HP ranged enemy at the spawn edge; asserts the
  swordsman closes to within melee range AND deals damage (fights back). (Failed
  pre-fix: pinned at 640, gap 160 > 96 forever.)

Reproduce: `pnpm sim` (or `node ./node_modules/tsx/dist/cli.mjs
src/engine/__tests__/balance-sim.ts`).

---

## Archer basic-attack volley (ClickUp 86d3k2rgf)

Player request: _"ยิงลูกธนูย่อยๆ เวลายิงธรรมดา"_ — the archer's **basic** attack
should feel like a rapid-fire mini-volley, not one fat arrow. The archer now
fires `archerVolleyCount` (3) small arrows at the **same** target per basic
attack. The archer **skill** (3 SEPARATE targets) is untouched and stays the
multi-target spread — the two are deliberately distinct.

### Damage is conserved exactly (no buff, no nerf)

Total damage per basic attack is **unchanged** — it is split across the volley:

- per-arrow `= heroAtk / archerVolleyCount` (a **float**, never rounded per
  arrow — rounding each arrow to an int would drift the total),
- the **last** arrow carries `heroAtk − per·(count−1)`, so the volley sums
  **bit-exactly** to the old single-arrow damage. For a ~⅓ split the remainder
  is exact by the Sterbenz lemma (`2·per` sits in `[total/2, 2·total]`, so
  `total − 2·per` is representable), i.e. no rounding drift at all.

`heroAtk` stays float-safe through `applyDamage` (it only does `hp -= amount`),
so nothing downstream re-rounds the per-arrow damage.

### New config knobs (all in `src/engine/config/index.ts`)

| Knob                  | Value                                                         | Meaning                                                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `archerVolleyCount`   | `3`                                                           | Arrows per basic attack (all at the same target).                                                                                                                                                                       |
| `archerVolleyOffsets` | `[{dx:0,dy:−5,×1.05}, {dx:−4,dy:0,×1.00}, {dx:4,dy:5,×0.95}]` | **FIXED** per-arrow spawn jitter (dx/dy) + ±5% travel-speed variance (`speedMult`). Staggers the arrows so they leave/land on slightly different frames → the rapid-fire look and up to 3 separate damage-number ticks. |

**No RNG was added.** The offsets are a constant table read directly in
`combat.ts` — combat never draws from the seeded RNG (that stream's cursor is
load-bearing for wave composition). Determinism is preserved: the existing
full-replay suites (`determinism.test.ts`, `events.test.ts`) stay byte-identical,
and a dedicated volley-replay test confirms it too.

### Events

Each basic attack now emits `archerVolleyCount` `projectileSpawn(arrow)` events
and up to `archerVolleyCount` `hit` events (one per arrow that lands) — more,
smaller damage ticks, which is the desired feel. If the target dies mid-flight
the remaining arrows expire (existing homing behaviour), so an attack can land
fewer than 3 hits. `events.test.ts` (which only asserts "some arrow spawned")
stays green.

### Pacing: no measurable drift, no compensation needed

`prev` = the ranged-reach follow-up table above (the latest committed baseline);
`volley` = this pass. Same 5 seeds, 1800 s.

| Stage | prev dur (s) | volley dur (s) | Δ     |
| ----- | ------------ | -------------- | ----- |
| 1     | 88.6         | 88.6           | 0.0%  |
| 2     | 55.8         | 55.7           | −0.2% |
| 3     | 75.6         | 75.8           | +0.3% |
| 4     | 74.0         | 73.9           | −0.1% |
| 5     | 90.7         | 90.7           | 0.0%  |
| 6     | 107.1        | 106.8          | −0.3% |
| 7     | 105.2        | 105.2          | 0.0%  |
| 8     | 116.7        | 117.4          | +0.6% |
| 9     | 608.9        | 609.5          | +0.1% |

first upgrade 6.8 s · first boss kill 88.6 s · **0 wipes** · reached stage 10 on
all seeds · stage-9 gate preserved (5.22x → **5.19x**).

**Why the drift is ~zero.** Total damage per attack is identical, so the only
possible movement is overkill/expiry wastage: (a) the killing arrow now overkills
by at most ~⅓ of the old hit, which slightly _reduces_ waste, and (b) an arrow
can expire if the target dies before it lands, which slightly _increases_ waste.
Over short arrow flight times these cancel to well under the ±0.6% seen —
comfortably inside the ±3–5% budget — so **no config compensation (e.g. a
`dmgMult` nudge) was required**. `HERO_TYPES.archer.dmgMult` stays `0.55`.

### Tests (`src/engine/__tests__/archer-volley.test.ts`)

- **volley count** — one basic attack spawns exactly `archerVolleyCount` arrows,
  all with the same `targetId`.
- **event count** — one `projectileSpawn(arrow)` per volley arrow.
- **bit-exact split** — across atk levels 0/1/5/7/13/20 (7 → total 10, a
  non-multiple of 3, is the drift-exposing case), the per-arrow damages sum
  `=== heroAtk` exactly.
- **delivered damage** — against a high-HP target the whole volley hits and
  delivers the old single-arrow total (to double precision), every arrow
  resolved.
- **no RNG / determinism** — two independent runs of the same volley scenario
  are byte-identical.

Reproduce: `pnpm sim` (or `node ./node_modules/tsx/dist/cli.mjs
src/engine/__tests__/balance-sim.ts`).
