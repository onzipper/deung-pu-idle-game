# Context Pack — World, Zones, Party, Presence

## Purpose

Everything about the game's spatial world and multiplayer-adjacent systems: maps/zones, gate-based zone transitions, town NPC interactions, the world map, real-time party lockstep, ghost presence of other real players, world chat, and the shared-HP world boss. This is the "open world MMO" arc (GDD v3) built on a deliberately 3-layer approach: presence (ghosts, render-only) / shared entities (world boss ledger) / party lockstep (≤6, the only tier that truly shares combat).

## Current shape

- **Maps/zones**: 7 maps (1-7), zone gates are tap-to-walk archways/doors, never buttons (`src/render/environment/zoneGates.ts`, `gateArch.ts`, `bossDoor.ts`).
- **Gate trip**: tapping a gate walks the hero to it first, then transitions — `src/ui/world/gateTap.ts` (pure tap→action decision) + `src/ui/world/gateTrip.ts` (state machine) + `src/ui/components/GateTripWatcher.tsx` (drives it to completion, renders nothing).
- **NPC trip**: generalized walk-to-any-town-NPC state machine — `src/ui/world/npcTrip.ts` + `src/ui/components/NpcTripWatcher.tsx` + `src/ui/components/NpcTripButtons.tsx` (menu-row buttons that ONLY command a walk-to-NPC, never open a panel remotely — binding owner rule, see `docs/ui-reference-map.md`).
- **World map**: `src/ui/world/WorldMapPanel.tsx` + `src/ui/world/worldMapModel.ts`, live population via `src/ui/world/useZoneCounts.ts` polling relay `/presence/counts`; `src/ui/components/MiniMapCard.tsx` is the compact HUD entry point.
- **Party lockstep** (≤6): relay = separate zero-dep service at `scripts/party-relay/` (HMAC-ticketed, single seq stream). Client: `src/app/(game)/partySession.ts` (transport/cohort derivation), `partyHandshake.ts` (zone-boundary re-seed), `cohortTurnEngine.ts` (turn/sub-step scheduler), `cohortWallet.ts`/`cohortProgress.ts` (per-member economy/progression integrity so party doesn't leak/duplicate gold or permanently unlock zones).
- **Ghost presence + world chat**: fully separate "world socket" (`src/app/(game)/presence/worldSession.ts`) from the party socket — render-only, publishes ~3Hz (`presencePublish.ts`), renders via `src/render/views/ghostLayer.ts` (walk/idle poses ONLY, no attack — owner cut it to avoid "hitting air").
- **World boss**: hourly shared-HP-pool boss (`src/engine/systems/worldBoss.ts` schedule/spawn/AI, `src/server/worldBoss.ts` server-side shared HP + claim ledger, `src/ui/components/WorldBossBanner.tsx` + `src/ui/worldBoss/`).
- **Day/night + weather**: `src/render/worldDepth/` (atmosphere, terrain, camera, depth).

## Read first

1. CODEMAP `src/ui/world/`, `src/app/(game)/`, `src/app/(game)/presence/` sections.
2. `docs/ghost-presence-design.md`, `docs/party-design-m8.md`, `docs/party-relay-protocol.md` for the design rationale behind the 3-layer split.
3. First files: `src/app/(game)/partySession.ts` (party transport), `src/app/(game)/presence/worldSession.ts` (presence/chat transport — deliberately separate socket), `src/engine/systems/world.ts` (zone/navigation engine-side).

## Tests to run

```
pnpm test src/ui/world
pnpm test src/app/\(game\)/__tests__
pnpm test src/app/\(game\)/presence/__tests__
pnpm test src/server/__tests__/party-relay.test.ts src/server/__tests__/party-relay-world.test.ts
pnpm test src/engine/__tests__/world.test.ts src/engine/__tests__/party.test.ts src/engine/__tests__/worldBoss.test.ts
```
The presence "zero engine coupling" guarantee is pinned by `src/app/(game)/presence/__tests__/ghostGuard.test.ts` (a 2-client×800-turn garbage-feed hash-equality guard — presence/chat must never touch `pendingInput`/engine state).

## Known risks

- Presence/chat code paths must have **ZERO** reach into engine state — this is the single rule the `ghostGuard.test.ts` test exists to pin. Any new presence/chat feature must stay render/store-only.
- Town zones **never** form lockstep cohorts (`deriveCohort` returns solo in town) — this is deliberate (avoids the town bot-potion-trip deadlock class of bug), don't "fix" it.
- Relay protocol changes require a specific **deploy order**: redeploy the relay FIRST, then web — an old relay must degrade silently against a newer client, never hard-fail.
- Cohort re-seed on party re-form resets world-boss HP tracking client-side (accepted v1 limitation, not a bug to silently "fix" without noting the tradeoff).

## Do not touch

- Relay opcodes are versioned/additive (`v:1` on presence payloads) — never repurpose an existing opcode; add a new one.
- Never let a presence/ghost/chat code path write to `pendingInput` or any engine-state field.
- Never make farmed-mob combat "shared" across strangers in the same zone — GDD's honesty rule: regular farm mobs are a private instance per player; only the world boss (and future zone elites) are genuinely shared-HP content.
