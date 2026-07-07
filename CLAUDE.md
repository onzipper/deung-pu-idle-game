# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

> ⚠️ This project uses **Next.js 16** (App Router). It has breaking changes vs. older Next.js — see `AGENTS.md` and consult `node_modules/next/dist/docs/` before writing framework code.

## Project

**ดึ๋งปุ๊ Idle Game** — a single-character idle MMORPG-lite for the web (Ragnarok × IdleOn feel). Players create a character (up to 3 per account), pick a base class (sword/bow/magic), walk between zones where mobs spawn scattered and the hero **auto-hunts** them (passive mobs never strike first; aggressive ones near boss rooms do), allocate stat points, manage mana/skills with 3 unlockable auto-cast slots, class-change via a quest, buy potions from town NPCs, and (upcoming) collect weapon/armor drops (tradable item-instances), party up in real time (max 3, lockstep), and climb a multi-category Hall of Fame. Power = level + stats + class/skills + gear — no purchasable upgrade lines, no speed multiplier (both removed).

**Source of truth (in-repo, NOT ClickUp):** vision/direction = `docs/GDD.md` · roadmap + task checklists = `docs/ROADMAP.md`. Update checkboxes there as work lands; if anything conflicts, GDD.md wins. ClickUp is a legacy pointer only — do not fetch or update it in normal work.

Status (2026-07-08 v3): **M1–M7.95 complete + UAT round-3 merged (PR #13) + UAT round-4 hotfix batch merged (PR #14–16)** (SAVE v16 unchanged; **DB PENDING: owner must run `prisma db push` for the new `SoldItem` table BEFORE deploying main** — the sell endpoint writes it, selling errors without it). Round-4 (owner live-playtest, same day): **town manual-play fix** (PR #14 — `step()`'s town early-return skipped `applyManualCommand`+`updateHeroes`, so tap-to-move was dead in town and the phase-3 NPC talk range was unreachable; new walk-only `tickTownManualWalk` in the town branch, botWalk keeps priority, fast-travel channel stands still; +5 regression tests that run through `step()` IN TOWN — the path the M7.8 suite never exercised) · **ป้าปุ๊ shop = 3 tabs** (PR #15–16: [ซื้อของ|ขาย·ย่อย|ซื้อคืน]) — sell/salvage tab reuses the inventory flows exactly (shared `ui/gear/sortRank.ts` + `useConfirmGuard` extracted; InventoryPanel behavior unchanged; hammerable, stays open per action) · **NPC buy-back** (PR #16 — additive `SoldItem` table, the sell endpoint records rows in the same tx; GET/POST `/api/items/buyback`: server-stamped 3-day window (`BUYBACK_WINDOW_DAYS`), atomic check-and-set restore re-mints the instance w/ refineLevel preserved + `origin:"buyback"` (drop-rate ceiling untouched) + `boughtBack` ItemEvent; salvaged items excluded by design (materials already granted — dupe risk); manual-only, no bot wiring; gold check reads the persisted save blob = the SAME refine MVP gap, not a new one) · patch-notes releases 2026-07-08c (town fix + shop sell) and 2026-07-08d (buy-back). Bot epic-dispose: owner asked for it — **already shipped** (v3 "option A": settings→Drops→ของตำนาน 3-way action, keep-guard forced, equipped items double-protected); no change made. Tests 1009/1009; engine change nav-only + server additive — no sim adjudication needed. In-browser pass of the new shop tabs (desktop+mobile) still owed. Round-3 highlights: **town NPCs full loop** (ป้าปุ๊ merchant / ลุงดึ๋ง smith — tap-again-to-talk, shop/refine panels ONLY via NPC talk via TownNpcPanelHost, bot walks to pahpu ~3.5s/trip, anchors = CONFIG.townNpcs) · **easy fast-travel** (channel starts mid-combat, damage never interrupts, death-only cancel; boss phase still locked) · **quest integrity rules (owner)**: climb-first tundra gate (`tier3GateCleared` — map3 boss room must be persist-unlocked; boot strand-guard), quest-leads routing (`botFarmTarget` — all auto-routes honor the quest zone), auto-advance ONLY on fresh unlock (deliberate old-zone farming respected), quest card outranks boss-door on the goal ladder, quest-boss softlock fixed (`returnToQuestFrontier`) · **in-session update banner** (build id rides /api/save, flush-then-reload) · patch-notes 2026-07-08b. Tests 984/984; canonical sim (5400s GEAR+REFINE) all gates hold, quest boss won 3/3 classes. NOTE for sim runs: default SIM_SECONDS=1800 without GEAR CANNOT beat the tier-3 quest boss (false alarm history — always adjudicate with the canonical config). Next: M8 Party (VPS/websocket spike first). **M7.95 Hall of Fame + UAT round-2 polish CLOSED + merged (PR #12)** — HOF 5 boards (level/power/goldEarned/boss-times/online) + class filter + profiles + anti-cheat re-derive (M5 debt closed; suspect=hidden not banned) + first-to-90/rank-1 announcements + deleted-char purge; tier-3 quest reborn (map4-z1 tundra preview grant → 90 kills → quest-scaled young Glacial Sovereign → evolve → s15); bot single-switch + consolidated settings + per-character `Character.uiConfig` persistence; 12 mob species maps 4-6 (enemySpecies.ts); aim-driven hero facing (Hero.aimX transient); war-cry buffs ALL allies (party-ready) + aura/chip; UX-fix wave ×10 (quest actions live on the quest card now — SkillBar affordance deleted; skill ⓘ inspectors via skillStats.ts); warp menu themed; inventory unstacked best-first; refine tap-to-skip; wave remnants purged (waves.ts→hunt.ts, state.wave/waveGap gone). Owner cadence rules: NEVER merge to main without per-merge confirm; automation must stay dumb; /proto-shaders rejected+removed. DB schema fully in sync as of 2026-07-08 (owner ran `prisma db push` after PR #12 — announcements schema applied; the P2022 `kind` error is resolved). Next queued: town NPCs (plan approved, awaiting arrival-behavior pick) → M8 Party (VPS/websocket spike first). Earlier: **M7.9 Grand Expansion merged (PR #10-11)** (SAVE v15, world ×2 maps 4-6, class tier 3, gear t7-10, boss variety, ModalPortal rule for all modals). **M7.9 "Grand Expansion" CLOSED + merged to main (PR #10)** — world ×2 (maps 4-6: ice tundra s16-20 / desert ruins s21-25 / hell city s26-30, levelCap 90, s1-15 byte-identical), class tier 3 @Lv40 quest (จอมอัศวิน/ราชันพราน/อาร์คเมจ, SAVE v15 domain-widening, skill-4 `sword_skyfall`/`archer_storm`/`mage_apocalypse` + spectacles incl. 0.16s time-freeze via timeDirector, auto slot 4 tier-gated), gear t7-t10 (46 templates, refine ceiling t10+10 = 126 atk), 6 unique boss looks (`bossThemes.ts`) + boss mechanics s20 CHARGE / s25 SUMMON / s30 FIELD HAZARD with full telegraph fx/sfx (5 new events), codex/FTUE/i18n complete, patch-notes release 2026-07-07c. Same-day owner asks: fast-travel picker closes on select; **mobile modal stacking fix — iOS Safari treats ancestor backdrop-filter as a containing block for fixed children, ALL modals now render through `ModalPortal` (new modals MUST too)**. Balance = `docs/balance-m79.md` (all 6 gates hold; sim-harness now routes the tier-3 quest backtrack + BOSSISO mode). Open flags: archer s26-30 friction high (class-design follow-up), in-browser visual pass of all M7.9 render work still recommended (boss horns vs HP bar, skill-4 spectacles). Tests 736/736. Earlier same-date history: M7.7 "Skill Spectacle & World Heat" (SAVE v13). M7.7 landed: 3-layer skill rework (signatures bigger, utilities keep roles, tier-2 = field-wide ultimates r460/13-drop; NO new ProjectileKind), mana = pacing governor (regenPerIntPoint 0.05; potions/run sword 124 / archer 181 / mage 17 — a real sink), survivor-retaliation replaces the aoeWake caps (skill-damaged survivor engages), denser fields 17/19/21 + killGoal ×1.5 with xp/gold ÷1.5 (per-zone totals byte-identical), per-skill render language + ultimate spectacle (skyDarken/groundCrack/curtainSweep, shake 15-17), mana bar promoted in HUD. Same-day fixes: class bug (every new char booted swordsman — repairHeroClass + boot fallbackClass, 1d5ba4d), zone-unlock gauge persistence (SAVE v13 `zoneKills` — town trips no longer wipe it), bossReady arms ONLY at the boss-gate zone (was quota-anywhere → dead glowing button; test/sim autopilots now advance on next-zone UNLOCK), wave-era copy sweep (boss-door language, FTUE bossChallenge step re-taught), bot-status toasts, context-aware goal card (town/free-farm hints, power% display-capped 999). **M7.7 CLOSED (2026-07-07)** — auto-allocate v2 landed: per-class ratio distributor ("next point to the stat farthest below `stats[s]/weight[s]`", self-correcting, no persisted counter, no SAVE bump); sim overruled the draft → **sword 4STR:1VIT, archer PURE DEX** (any VIT share regressed — DPS-race class), **mage 3INT:1VIT**; gates held (class change s5, s15 wall intact, 0 stalls; deaths sword 183→24, mage 50→20) — details in balance-m7.md "Auto-allocate v2". PR #3 (M6+M7) and PR #4 (M7.6+M7.7+M7.8) merged to main; **PR #5 (UAT batch: playtest fixes + prestige/announcements/stat-tap/patch-notes/catch-up) open** awaiting owner merge. **M7.6 Refine ตีบวก CLOSED (2026-07-07)** — 4 waves: engine (SAVE v14, `refinedStat = base×(1+N×8%)`, materials counter, engine never rolls) → server (additive refineLevel/materials columns db-pushed, salvage/refine endpoints, atomic check-and-set + crypto roll, ItemEvent refined/salvaged) → sim (draft rates CONFIRMED unchanged: s15 wall 0/15 even refine-stressed, materials a real sink, +10 ≈ 359 attempts, break ≈ 1% of drops; REFINE=1/sweep/STRESS knobs) → UI (town refine station w/ hammer-strike juice, bulk salvage + yield preview, compound templateId:refineLevel stacking, materials HUD readout, +N names, aura step-up at +7; goldCredit intent now signed). Known MVP gaps: gold check reads persisted save-blob (save-before-refine, client-authoritative gold), town-only client-enforced like sell, final in-browser visual pass of the refine panel unverified. **UAT polish batch CLOSED (2026-07-07, post-playtest)** — bot dispose hardening (auto-equip failure no longer silently skips sell/salvage; owner-confirmed fixed), ranged kite jitter one-line fix (target-relative servo + regression test), INT share sword 4:1:1 / archer 4:1 (potion burn −55%; balance-m7.md "Owner INT pass"), +8/+9/+10 prestige aura ladder (render-only, pooled, distinct from t6), UAT patch-notes modal (once per release id, skips brand-new players), tab-return catch-up replay (>5s hidden → boot offline path, capped/budgeted). ROADMAP "UAT polish batch" has the list. **M7.8 Manual Play CLOSED (2026-07-07)** — engine: moveTo/attackTarget/cancelCommand FrameInput intents (Hero.command transient, no SAVE bump; boss forced-combat wins; auto path byte-identical; paves M8 lockstep) · UI/render: hitTestPointer via baseTransform (shake-safe), tap ground→move w/ ring ping, tap monster→persistent lock reticle, cancel chip beside AUTO, first-AUTO-off tip th/en, mouse+touch equal. Manual skill-cast buttons deferred to backlog (overlaps mana governor). In-browser device pass unverified — recommend owner playtest. Next: **M8 Party** (FIRST: VPS/websocket infra spike decision). **M6.5b UI Skin: owner REJECTED the warm-fantasy title (3rd art attempt struck down) — reverted (4c856df), shelved again; next attempt must start from owner-provided visual references, not from building.** **Owner directive 2026-07-06: every UI/interaction must play comfortably on BOTH desktop and mobile** (touch-first, responsive HUD). → M8 Party (FIRST: VPS/websocket spike decision) → M9. PvP cut; prestige on hold. Balance baselines = `docs/balance-m6.md` (world) + `docs/balance-m7.md` (gear/vendor + M7.7 section).

Git: `develop` = integration branch (work lands here per-task), `main` = stable (merged via PR at milestone boundaries).

## Commands

Package manager is **pnpm**.

| Command | What it does |
|---|---|
| `pnpm dev` | Next.js dev server → http://localhost:3000 |
| `pnpm build` / `pnpm start` | Production build / serve |
| `pnpm lint` | ESLint (includes the engine-purity boundary rule) |
| `pnpm format` / `pnpm format:check` | Prettier write / check |
| `pnpm test` | All Vitest suites (headless, Node env; 125+ tests, <1s) |
| `pnpm sim` | Balance harness — per-stage time-to-clear/gold/boss metrics; env knobs `SIM_SECONDS`, `SEEDS` |
| `pnpm db:generate` / `db:migrate` / `db:studio` | Prisma (needs `DATABASE_URL` in `.env`) |

Single test file: `pnpm test src/engine/__tests__/loop.test.ts` · by name: `pnpm vitest run -t "seeded rng"`

**Env quirk (subagent shells):** the pnpm `.cmd` shims sometimes can't resolve `node` (nested cmd.exe PATH issue). Workaround — invoke binaries directly: `node node_modules/eslint/bin/eslint.js .`, `node node_modules/.pnpm/vitest@*/node_modules/vitest/vitest.mjs run`, `node node_modules/tsx/dist/cli.mjs src/engine/__tests__/balance-sim.ts`. Not a project bug; don't spend time diagnosing it.

## Architecture — the load-bearing rule

Three layers, **strictly separate** (ESLint-enforced):

```
src/
  engine/   ← pure TS simulation. NO DOM/canvas/React/Pixi/Next/Zustand.
  render/   ← PixiJS: views (entities), fx (juice), environment (biomes), audio (WebAudio SFX). One-way reads.
  ui/       ← React HUD via throttled Zustand snapshot (~10Hz) + intent queue.
```

- **`engine/` is pure & deterministic**: `step(state, input)` advances exactly one `FIXED_DT` (1/60). Speed = more sub-steps, never bigger dt. Seeded RNG only (`core/rng.ts`) — **the RNG stream is reserved for wave composition; combat/skills must NEVER draw from it** (use fixed offset tables). All tunables in `engine/config` (the sim sweeps them). Save shape changes go through `SAVE_VERSION` + `migrate()` (`state/version.ts`).
- **`state.events`** (per-step, transient, deterministic, never persisted): 15+ event types (hit/kill/skillCast/boss lifecycle/…) consumed one-way by render/audio. Frame loops MUST collect events across ALL sub-steps before draw (they're cleared each step).
- **render/**: `GameRenderer.draw(state, frameEvents)`; pooled views keyed by entity id (build-once, transform-only per frame); `fx/` = pooled, capped, real-dt effect modules with knobs at top; `environment/` = stage-keyed biomes + parallax; `audio/` = synthesized SFX (no asset files), AudioContext after first gesture.
- **ui/**: components read narrow store selectors; player intents go into `pendingInput`, drained ONCE per real frame by `GameClient` (a click applies exactly once). `autoCast/autoAllocate/autoReturn/auto-potion thresholds/soundMuted` are plain UI-owned store fields (speed and autoUpgrade no longer exist).
- **`GameClient.tsx`** hosts the rAF loop (engine state in a closure, never React state) + `timeDirector.ts` (hit-stop/slow-mo: shapes ONLY the accumulator input; renderer/audio/UI keep real time — effects play through freezes by design).

Each layer has a `README.md` with its contract; `render/README.md` carries the **binding art direction** (desaturated scenery vs jewel-tone entities, flat-alpha layering).

## Persistence & economy

- MySQL (Hostinger) + **Prisma 6** (pinned; v7 needs driver adapters). Schema applied via **`prisma db push`** — shared host denies the shadow DB (P3014), so no migration history; baseline when the DB moves.
- Identity = anonymous httpOnly cookie (`src/server/identity.ts`, swappable for real auth). One save slot per user (`SaveState.userId @unique`).
- `POST /api/save` zod-validates strictly; **server stamps `lastSeen`** (client timestamps discarded). Offline idle capped `CONFIG.offlineCapHours`, replayed client-side through `step()` under a 250ms wall-clock budget.
- M5 target: re-derive max-plausible progress server-side; slot marked in `persistSave`.

## Hard-won footguns (each cost a real debugging round — don't re-learn them)

1. **Pixi transform double-subtraction**: Pixi applies `(local − pivot)` itself. Graphics paths inside pivoted containers must use absolute GROUND_Y-relative coords — never pre-subtract the pivot in path data, or rigs collapse toward y≈0. Guarded by `render/views/__tests__/rig.test.ts` (headless bounds).
2. **`Graphics.arc().fill()` without `moveTo`** collapses toward the stale pen position — use point-sampled `poly()` (see `arcFanPoints` in heroView).
3. **Every radius through `safeRadius()`**; no hand-built canvas gradients (layered flat alpha / Pixi filters only) — the original POC crash class.
4. **Windows 10 has no Unicode-13+ emoji glyphs** (🪙🪄…) — UI icons must be pre-2020 emoji or CSS-drawn.
5. **Absolute-position caps rot**: POC-era constants like `midCap` silently broke formation spacing when the anchor design deepened — prefer anchor/spawn-relative bounds with config knobs.
6. **New `ProjectileKind`/enum members need their render map entries in the same change** (`PROJECTILE_COLORS` etc.) or the client crashes at runtime ("Unable to convert color undefined") — grep for `Record<ProjectileKind` when extending engine unions.
7. **Balance changes must run the sim** vs the latest table in `docs/balance-m5.md` (per-class solo, 0 permanent walls; balance-m4 is the superseded team-comp baseline). Tune new knobs before touching tuned curves.
8. **Next 16: `cookies().set()` during a Server Component render throws** (`ReadonlyRequestCookiesError`) — cookie writes belong in Route Handlers / Server Actions only. Gate/redirect helpers in server components must be strictly read-only (see `src/app/characterGate.ts`).
9. **vitest does NOT typecheck and `next build` excludes test files** — type drift in test fixtures ships silently. After changes to shared engine types (Hero, saves), run a raw `node node_modules/typescript/bin/tsc --noEmit` sweep (ignore stale `.next/types` lines).
10. **Additive blend fx white-out on bright scenes** — flame/glow effects over daytime skies must use solid flame colors on normal blend + a darker outline, not `add` (learned in the /proto rounds; applies to the M7 weapon-aura work).

## Orchestration workflow

**You (Fable) are the orchestrator.** Plan, decompose, synthesize; execution goes to subagents. Keep your own context lean — agents return short conclusions.

Routing: reasoning-heavy → Opus domain agent or `deep-reasoner` · mechanical → Sonnet domain agent or `fast-worker` · trivial fully-specified single-file edits → `haiku-worker` · high-stakes → two independent perspectives in parallel, synthesize without cross-showing.

**Token discipline (learned from the M4 build-out):**
- One agent = one task; spawn fresh with a tight brief instead of chaining SendMessage (chained context re-reads cost 2-3x). Exception: urgent fixes on work the agent just wrote.
- Knob/feel tuning on known files → the orchestrator edits directly; no agent for a constant change.
- Batch same-area items into one medium task (~100-150k tokens); avoid 10+ item mega-passes and single-item micro-agents (fixed ~20-40k read-in each).
- Agent returns ≤20 lines; detail goes in commit messages / `docs/`.
- Cross-task context lives in repo files (render/README.md, docs/balance-m4.md), never chat history.
- Parallel agents must own disjoint file zones (engine vs render vs ui); the orchestrator commits per-zone by path.

## Project subagents

Personas in `.claude/agents/`, each pinned to a model:

| Agent | Model | Scope |
|---|---|---|
| `deep-reasoner` / `fast-worker` / `haiku-worker` | Opus / Sonnet / Haiku | generic tiers (see routing) |
| `game-engine-specialist` | Opus | pure-TS sim core, determinism (`engine/**`) |
| `game-economy-balance-designer` | Opus | curves, pacing, prestige, sim analysis |
| `sr-dba` | Opus | MySQL/Prisma schema, indexing (`prisma/**`) |
| `sr-backend-developer` | Opus | save/load, offline idle, anti-cheat (`server/**`, `api/**`) |
| `sr-nextjs-developer` | Sonnet | App Router, GameClient loop, store wiring (`app/**`, `ui/**`) |
| `sr-uxui-game-designer` | Sonnet | game feel, fx/animation/biomes, HUD design (`render/**`, `ui/**`) |
| `qa-test-engineer` | Sonnet | headless Vitest strategy, regression suites |
