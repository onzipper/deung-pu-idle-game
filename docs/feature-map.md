# Feature Map — feature → docs / source / tests

Routing index: find a feature, jump straight to its docs + source + tests instead of exploring. Paths verified to exist on disk at time of writing; see `docs/CODEMAP.md` for the authoritative structural index (test-enforced) and `docs/context/*.md` for layer-level context packs.

## Game screen / HUD
Docs:
- docs/context/ui.md
- docs/ui-reference-map.md
Source:
- src/ui/components/GameHud.tsx
- src/ui/components/HeroPortraitCard.tsx
- src/ui/components/CurrencyChipsRow.tsx
- src/ui/components/ExpClockStrip.tsx
- src/app/(game)/GameClient.tsx
Tests:
- src/ui/components/__tests__/gameHudLayout.test.tsx
Notes:
- Fullscreen canvas + all-overlay HUD (R2.5); GameHud.tsx documents the z-index ladder — read it before adding an overlay element.
- ModalPortal.tsx is mandatory for every new modal (iOS Safari backdrop-filter containing-block bug).

## Inventory
Docs:
- src/ui/README.md (§"Gear & Drops")
Source:
- src/ui/components/InventoryPanel.tsx
- src/ui/components/InventoryButton.tsx
- src/ui/gear/inventoryOps.ts
- src/ui/gear/sortRank.ts
- src/ui/gear/api.ts
Tests:
- src/ui/gear/__tests__/inventoryOps.test.ts
- src/ui/gear/__tests__/sortRank.test.ts
- src/ui/gear/__tests__/claimBuffer.test.ts
Notes:
- No stacking at tile level (RO-style per-instance grid), best→worst sort.
- Drop-claim flush is buffered in a closure (`claimBuffer.ts`), not React state.

## Equipment / paper doll
Docs:
- docs/ui-reference-map.md (EQUIPMENT row)
Source:
- src/ui/components/EquipmentDoll.tsx
- src/ui/components/EquippedLoadout.tsx
- src/ui/gear/dollModel.ts
- src/render/views/heroView.ts
Tests:
- src/ui/gear/__tests__/dollModel.test.ts
- src/render/views/__tests__/rig.test.ts
- src/render/views/__tests__/gearTier7to10.test.ts
Notes:
- EquippedLoadout reads the sim's applied `HeroSummary.equipped`, not the DB-hydrated inventory slice.
- heroView.ts rebuilds gear graphics only on templateId change (edge-gated), not per frame.

## Bot settings
Docs:
- docs/context/bot.md
Source:
- src/ui/components/BotMasterSwitch.tsx
- src/ui/components/BotSettingsModal.tsx
- src/ui/components/BotSettingsSection.tsx
- src/engine/systems/heroConfig.ts
- src/engine/systems/bots.ts
Tests:
- src/engine/__tests__/bots.test.ts
- src/engine/__tests__/autoHunt.test.ts
- src/app/(game)/__tests__/cohortBotTrip.test.ts
Notes:
- Bot master switch defaults OFF at every entry; ending a session with bot off forfeits the next offline-idle window's income (by design).
- Automation must stay "dumb" — never optimal — per standing owner directive.

## World map
Docs:
- docs/context/world.md
Source:
- src/ui/world/WorldMapPanel.tsx
- src/ui/world/worldMapModel.ts
- src/ui/world/useZoneCounts.ts
- src/ui/components/MiniMapCard.tsx
- src/ui/components/WorldMapButton.tsx
Tests:
- src/ui/world/__tests__/worldMapModel.test.ts
Notes:
- Live population via relay `/presence/counts`, panel-open-only polling, pauses while tab hidden.

## Zone gates / gate trip
Docs:
- docs/context/world.md
- docs/GDD.md (§"โลกและการเดิน")
Source:
- src/ui/world/gateTap.ts
- src/ui/world/gateTrip.ts
- src/ui/components/GateTripWatcher.tsx
- src/render/environment/zoneGates.ts
- src/render/environment/gateArch.ts
- src/render/environment/bossDoor.ts
- src/render/environment/gateLockOverlay.ts
Tests:
- src/ui/world/__tests__/gateTap.test.ts
- src/ui/world/__tests__/gateTrip.test.ts
- src/render/environment/__tests__/gateHitTest.test.ts
- src/render/environment/__tests__/gateLockOverlay.test.ts
- src/render/environment/__tests__/gates.test.ts
- src/ui/store/__tests__/gateTripActions.test.ts
Notes:
- Tapping a gate WALKS to it first, then transitions — never an instant teleport on tap.
- Zone edge = themed archway; the map's last farm zone gets the grand `bossDoor.ts` instead of a plain arch.

## NPC trip
Docs:
- docs/context/world.md
- docs/ui-reference-map.md (การเคาะ row "ปุ่มร้านค้า/ภารกิจบน HUD")
Source:
- src/ui/world/npcTrip.ts
- src/ui/components/NpcTripWatcher.tsx
- src/ui/components/NpcTripButtons.tsx
- src/ui/components/TownNpcPanelHost.tsx
- src/engine/systems/townNpcs.ts
Tests:
- src/ui/world/__tests__/npcTrip.test.ts
- src/ui/store/__tests__/npcTripActions.test.ts
Notes:
- Menu-row NPC buttons ONLY command a walk-to-NPC (`startNpcTrip`) — they must NEVER open a panel remotely; this supersedes an earlier "no HUD shop button" rule (owner R2.5 decision, recorded in ui-reference-map.md).

## Skills / skill bar
Docs:
- docs/context/ui.md
Source:
- src/ui/components/SkillBar.tsx
- src/ui/components/SkillDock.tsx
- src/ui/components/SkillDetailModal.tsx
- src/ui/skillStats.ts
- src/engine/systems/skills.ts
Tests:
- src/ui/__tests__/skillStats.test.ts
- src/engine/__tests__/skills.test.ts
- src/engine/__tests__/skills-m77.test.ts
- src/engine/__tests__/mana-skills.test.ts
Notes:
- Up to 3 unlockable auto-cast slots; skills outside an auto slot are manual-cast only.
- SkillDetailModal is read-only — never casts, no skill-leveling UI (that's a parked backlog system).

## Quests / goal ladder
Docs:
- src/ui/README.md (§"Goal ladder")
- docs/quest-design-m8.md
Source:
- src/ui/goalLadder.ts
- src/ui/components/GoalLadder.tsx
- src/ui/components/GoalLadderOverlaySlot.tsx
- src/ui/components/QuestBoardPanel.tsx
- src/engine/systems/mainQuest.ts
- src/engine/systems/dailyQuests.ts
- src/engine/systems/quests.ts
Tests:
- src/ui/__tests__/goalLadder.test.ts
- src/ui/components/__tests__/questTracker.test.tsx
- src/engine/__tests__/quests.test.ts
- src/engine/__tests__/quest-m8.test.ts
- src/engine/__tests__/quest-leads-routing.test.ts
Notes:
- R2.6: TabRow [เควส|ปาร์ตี้] over tag-grouped [หลัก]/[รอง]/[รายวัน]; collapses to a chip on all viewports (persisted `questTrackerCollapsed`).
- `[รายวัน]` is read-only in the tracker — claiming stays Quest-Board-only.

## Refine (ตีบวก)
Docs:
- docs/ui-reference-map.md (ENHANCE row)
Source:
- src/ui/components/RefinePanel.tsx
- src/ui/gear/refineReveal.ts
- src/ui/gear/refineFlow.ts
- src/engine/config/refine.ts
- src/server/items.ts (refine endpoint logic)
- src/app/api/items/refine/route.ts
Tests:
- src/ui/gear/__tests__/refineReveal.test.ts
- src/engine/__tests__/refine.test.ts
Notes:
- Reveal-on-final-strike suspense state machine (`idle→pending→striking→reveal`) — a result must never leak before the final beat.
- Success chance is single-sourced: UI and server both read `engine/config/refine.ts`.

## Engine / simulation
Docs:
- docs/context/engine.md
- src/engine/README.md
Source:
- src/engine/core/step.ts
- src/engine/core/loop.ts
- src/engine/state/index.ts
- src/engine/state/version.ts
- src/engine/config/index.ts
- src/engine/systems/plane.ts
Tests:
- src/engine/__tests__/engine.test.ts
- src/engine/__tests__/loop.test.ts
- src/engine/__tests__/determinism.test.ts
- src/engine/__tests__/float-determinism-guard.test.ts
- src/engine/__tests__/plane.test.ts
Notes:
- `step(state, dt, input)` is the ONE transition; deterministic, no wall-clock reads inside.
- Check `src/engine/state/version.ts` for current SAVE_VERSION; bump + add migrate() for any SaveData shape change.
- R4 Wave A: the engine owns each entity's depth-plane row (`Entity.planeY`, `systems/plane.ts`, `CONFIG.plane`) — deterministic id-hashed y at spawn, ported from render's depth band, folded into `stateHash`, TRANSIENT (no SAVE bump). Unused by the sim this wave; Wave-B render reads it in place of recomputing depth.
- R4 Wave B: render cutover to the engine's `planeY`. The shared seam `worldFxContext.depthOf` reads the engine-owned `planeY` — Hero/Enemy feed their `planeY`, ghosts/town-NPCs use engine-exported `scatterPlaneY(cid)`, and `planeToDepth` inverts it back to a depth d (bit-exact, so footY/scale/zIndex reproduce the pre-cutover render-side hash values). Party heroes are fanned at cohort build (`buildCohortState` → `heroPlaneY(cls, cohortIndex, size)`) so render reproduces the fan from engine state. Stage boss / world boss / town NPCs stay on the static `DEPTH_NEUTRAL` row (never depth-scattered; their `planeY` is intentionally not consumed).
- R4 Wave C0: retire the Wave-B cutover scaffold. The `worldDepthFromEngineY` flag + its OFF branch and the render-side depth-ASSIGNMENT source (`depthAssign` heroDepth/enemyDepth/ghostDepth + HERO_* constants) are deleted — engine `planeY` is now the ONLY path at the seam. `depthAssign` keeps `hashUnit` (terrain-preset / weather-window selection + the seam's defensive no-`planeY` fallback). The temporary ON===OFF identity test is retired. Zero behavior change; sets up Wave C1's mutable-`planeY` movement against a single seam.

## Party lockstep
Docs:
- docs/context/world.md
- docs/party-design-m8.md
- docs/party-relay-protocol.md
- docs/party-dev-setup.md
Source:
- src/app/(game)/partySession.ts
- src/app/(game)/partyHandshake.ts
- src/app/(game)/cohortTurnEngine.ts
- src/app/(game)/cohortWallet.ts
- src/app/(game)/cohortProgress.ts
- src/engine/lockstep/turnLoop.ts
- src/engine/lockstep/stateHash.ts
- scripts/party-relay/server.js
Tests:
- src/app/(game)/__tests__/partySession.test.ts
- src/app/(game)/__tests__/cohortTurnEngine.test.ts
- src/app/(game)/__tests__/cohortWallet.test.ts
- src/app/(game)/__tests__/cohortProgress.test.ts
- src/engine/lockstep/__tests__/lockstep.test.ts
- src/server/__tests__/party-relay.test.ts
Notes:
- Cap 6 members; town zones never form a cohort (deliberate — avoids a bot-potion-trip deadlock class).
- `stateHash.ts` is the desync canary — a lockstep test failure is a stop-everything bug.

## Presence / relay (ghosts + chat)
Docs:
- docs/context/world.md
- docs/ghost-presence-design.md
- docs/party-relay-protocol.md (§12 `pa` action-stream opcode)
Source:
- src/app/(game)/presence/worldSession.ts
- src/app/(game)/presence/presencePublish.ts
- src/app/(game)/presence/ghostStore.ts
- src/render/views/ghostLayer.ts
- src/render/views/heroView.ts (playHeroPosePulse — additive-only pose)
- src/ui/components/GhostProfileCard.tsx (R3: tap-ghost view-only profile)
- src/ui/chat/ChatPanel.tsx
- src/ui/chat/chatMessages.ts
Tests:
- src/app/(game)/presence/__tests__/ghostGuard.test.ts
- src/app/(game)/presence/__tests__/ghostStore.test.ts
- src/app/(game)/presence/__tests__/worldSession.test.ts
- src/ui/chat/__tests__/chatMessages.test.ts
- src/server/__tests__/party-relay-world.test.ts
Notes:
- `ghostGuard.test.ts` pins the load-bearing rule: presence/chat have ZERO code paths into engine state — extended for R3 to also inject `pa` action traffic + ghost taps and assert hash-equality unchanged.
- Ghosts render walk/idle poses via the `p` opcode; R3 (issue #50) adds edge-triggered `basic`/`skill1-4`/`dash` POSES via a separate `pa` opcode (~8Hz, shares the ghost fps valve) — still no attack fx/projectiles/camera/audio, and tapping a ghost opens a view-only profile card with zero `pendingInput` writes.

## World boss
Docs:
- docs/context/world.md
- docs/balance-worldboss.md
Source:
- src/engine/systems/worldBoss.ts
- src/server/worldBoss.ts
- src/ui/components/WorldBossBanner.tsx
- src/ui/worldBoss/schedule.ts
- src/render/views/worldBossView.ts
- src/app/api/worldboss/damage/route.ts
- src/app/api/worldboss/state/route.ts
- src/app/api/worldboss/claim/route.ts
Tests:
- src/engine/__tests__/worldBoss.test.ts
- src/server/__tests__/worldBoss.test.ts
- src/ui/worldBoss/__tests__/schedule.test.ts
- src/render/fx/__tests__/worldBoss.test.ts
Notes:
- Server-wide SHARED HP pool with atomic floored decrement + participation-gated claim; cohort damage reports dedup to the lowest slot.
- Rewards are 0 xp/gold/quota from the boss itself; reward ledger is per-character-per-window.

## Economy / balance
Docs:
- docs/context/economy.md
- docs/balance-m7.md
- docs/balance-m79.md
- docs/balance-ninja.md
- docs/balance-asura.md
Source:
- src/engine/config/index.ts
- src/engine/config/items.ts
- src/engine/config/refine.ts
- src/engine/systems/economy.ts
- src/engine/__tests__/balance-sim.ts
Tests:
- src/engine/__tests__/economy.test.ts
Notes:
- `pnpm sim` is not a pass/fail test — adjudicate by eye against the matching `docs/balance-*.md` table, canonical config = 5400s + GEAR/REFINE.
- Flat shop pricing is an accepted owner-approved gold-debt tradeoff — don't "fix" without an ask.

## Hall of Fame
Docs:
- docs/hof-rewards-design.md
Source:
- src/ui/hof/HallOfFamePanel.tsx
- src/ui/hof/PodiumStrip.tsx
- src/ui/hof/rewardsLogic.ts
- src/server/hofSeason.ts
- src/server/leaderboard.ts
- src/app/api/hof/route.ts
- src/app/api/hof/rewards/route.ts
Tests:
- src/ui/hof/__tests__/rewardsLogic.test.ts
- src/ui/hof/__tests__/format.test.ts
- src/ui/hof/__tests__/titles.test.ts
- src/server/__tests__/hofSeason.test.ts
- src/engine/__tests__/hall-of-fame.test.ts
Notes:
- Monthly Thai-midnight (Asia/Bangkok) lazy-finalize; rank-1 gets a champion gold aura + town honor plaque + fortifier claim.
- Legacy `GET /api/hof` carries no characterId — profile badges resolve exactly only for the viewer's own row.

## FTUE
Docs:
- src/ui/README.md (§"Onboarding / FTUE")
Source:
- src/ui/onboarding/steps.ts
- src/ui/onboarding/useOnboardingController.ts
- src/ui/onboarding/OnboardingOverlay.tsx
- src/ui/onboarding/useAnchorRect.ts
- src/ui/onboarding/tips.ts
Tests:
- src/ui/onboarding/__tests__/steps.test.ts
- src/ui/onboarding/__tests__/tips.test.ts
Notes:
- Anchors resolve via `[data-onboarding-anchor]` + `querySelector` — a hidden duplicate breaks the anchor; always portal, never show/hide-duplicate an anchored component.
- 8-step sequence teaches the solo-hero loop end to end; new steps only need an `ONBOARDING_STEPS` entry + matching `messages/*.json` keys.
