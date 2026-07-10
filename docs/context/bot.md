# Context Pack — Auto-Hunt Bot / Automation

## Purpose

The bot plays the hero for the player (idle-game backbone; also the current game's headline hook per GDD v3: "MMO ที่เล่นตัวเองได้"). **Owner rule: automation stays DUMB, never optimal** — this is a deliberate design constraint, not a TODO. Endgame friction (e.g. no conditional/smart auto-cast) is intentional and has been explicitly rejected before when proposed.

## Current shape

- **Bot master switch** (`state.autoHunt`) defaults **OFF at every entry point** — including after offline-replay credit is applied, so a session that ends with bot off earns nothing during the next offline window (by design; income comes from bot-driven activity).
- Per-hero `BotSettings` ride `HeroConfig` (single writer `applyHeroConfig` in `src/engine/systems/heroConfig.ts`) — settings are per-character, not global, and survive party cohort collapse/re-form.
- Bot town trips: deterministic round-trip to NPC ป้าปุ๊ (potion restock / sell) via `src/engine/systems/bots.ts`; town-trip target routing also honors active quest zones (`botFarmTarget`).
- Ninja class has a dash-evade capability (`CONFIG.ninja.evade`, `HeroType.dashEvade`) so a swarmed AUTO ninja blinks out — other classes deliberately lack this (no dash primitive yet).
- Bot never initiates a world-boss engagement but will pile onto an already-engaged one solo.

## Read first

1. `src/engine/systems/bots.ts` — the deterministic town-trip logic (potion-restock/sell).
2. `src/engine/systems/heroConfig.ts` — the single writer for per-hero automation config.
3. `src/ui/components/BotMasterSwitch.tsx` — the ONE master ON/OFF switch + gear icon opening settings.
4. `src/ui/components/BotSettingsModal.tsx` — the ONE home for auto-* config (combat/potions/town-trips/drops/walking); legacy `src/ui/components/BotSettingsSection.tsx` still reads/queues `setBotSettings` off `state.bot` for older call sites.
5. `src/app/(game)/cohortBotTrip.ts` — pure "should my bot leave the cohort for a town trip right now" decision (party context).

## Tests to run

```
pnpm test src/engine/__tests__/bots.test.ts
pnpm test src/engine/__tests__/autoHunt.test.ts
pnpm test src/app/\(game\)/__tests__/cohortBotTrip.test.ts
```

## Known risks

- Bot behavior changes are balance-relevant — run the sim (see [economy.md](./economy.md)) after any change to targeting/routing/threshold logic.
- Bot-off-default has shipped as a fix TWICE for the same underlying bug class (0-step frame input drain swallowing the "set false" intent) — see [ui.md](./ui.md) "Do not touch" on `pendingInput` drain semantics before touching boot-time bot state.
- Party cohort collapse/re-form must not silently flip a member's bot setting — `cohortWallet.ts`'s config-diff latch exists specifically to avoid a stale `state.bot` read overwriting per-hero settings.

## Do not touch

- Bot must **never** warp/fast-travel on its own initiative outside its scripted town-trip state machine, and must **never** sell a legendary item (equipped items are double-protected; the keep-guard for epics is forced).
- Never make automation "smart"/optimal without an explicit owner ask — this has been rejected before (conditional auto-cast, 2026-07-08).
- Never change the bot-off-default behavior (income-forfeit-if-bot-off-at-session-end) without owner confirmation — it is a deliberate incentive design, not an oversight.
