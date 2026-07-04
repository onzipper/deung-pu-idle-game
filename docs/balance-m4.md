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
