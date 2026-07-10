# Decision index

Locked owner + architecture decisions. **Do not re-propose anything marked Locked.**
"Superseded" rows stay listed so agents can see the chain. Add a row whenever the owner
เคาะ a decision that future work must respect; source column points at the full record.

## Product / design

| Decision | Status | Reason | Source |
|---|---|---|---|
| Open world MMO RPG 2.5D with bots playing for you — NOT full 3D, no camera rotation | Locked (GDD v3) | Scope + idle identity | `docs/GDD.md` |
| Server-authoritative MMO architecture | Rejected | Would destroy solo/offline/idle architecture (2 independent deep-consults) | `docs/GDD.md` |
| World = 3 layers: rich presence (~8Hz action stream) / shared-entity ledgers / party lockstep | Locked | Replaces server-authoritative; never promise "everyone hits every mob together" | `docs/GDD.md` |
| No purchasable upgrade lines, no speed multiplier | Locked | Power = level + stats + class/skills + gear only | `docs/GDD.md` |
| Automation stays DUMB — no conditional auto-cast, no optimal play | Locked | Endgame friction is intentional | owner 2026-07-08 |
| Bot master switch defaults OFF at every entry; session ending with bot off ⇒ offline window earns nothing | Locked | Owner asked for opt-in AUTO; replay uses saved state | M8.8 R1, `docs/history/claude-status-log.md` |
| No virtual joystick | Locked | Tap-to-move + AUTO cover current needs | `docs/ui-reference-map.md` |
| Epic rarity stays gold; purple = UI chrome | Locked | Players already trained by existing rarity language | `docs/ui-reference-map.md` |
| Shop/refine panels only via NPC talk (no HUD shop button) | **Superseded (R2.5)** | Owner เคาะ NPC walk-order HUD buttons (walk-order-only; dim+toast, not native disabled) | `docs/ui-reference-map.md` |
| Refine success-% shown to player | Locked (R2) | Single-sourced from `src/engine/config/refine.ts` for UI + server | `docs/ui-reference-map.md` |
| Flat shop pricing (priceStageBase 1.0 — potions cost base forever) | Locked, with accepted debt | Owner call; late-game gold accumulates faster — event sinks planned, revisit before central marketplace | `docs/history/claude-status-log.md` |
| Legendary (ตำราตำนาน) content never appears in patch notes | Locked | Discovery is fully in-game | owner 2026-07-09 |
| Map2 = Greenmill Hamlet / Farm Border Road; zone-progression (a): zones 6-10 = hamlet/golden field -> broken cart road -> lantern bend -> forest mouth outer/deep | Locked (2026-07-10) | Owner confirmed on PR #73 vs the #79 Reference v1 board; option (b) full-composition-per-zone rejected | issue #79, PR #73, `docs/map-direction.md` |
| Skill leveling (gold sink) + collections | Backlog (parked) | Owner parked; do not build uninvited | `docs/ui-reference-map.md` |
| Guilds / pets / equipment sets / channels | On hold | Owner พัก | `docs/ui-reference-map.md` |

## Process / workflow

| Decision | Status | Reason | Source |
|---|---|---|---|
| Never merge develop→main without explicit per-merge owner confirm | Locked | Owner cadence rule 2026-07-08 | `CLAUDE.md` |
| Art: references-first — owner supplies visual references / own pixel art; never invent a look | Locked | 3 art attempts rejected before rule | `docs/ui-reference-map.md` |
| Every UI must play comfortably on BOTH desktop and mobile (touch-first) | Locked | Owner directive 2026-07-06 | `CLAUDE.md` |
| Docs sync in the same change (CODEMAP + current-state + affected docs) | Locked | Owner directive 2026-07-09/10, test-enforced | `CLAUDE.md`, `src/__tests__/codemap.test.ts` |
| Production deploys are owner-triggered; relay redeploys FIRST when its protocol grows | Locked | Live incidents from stale relay | `docs/context/deployment.md` |

## Technical

| Decision | Status | Reason | Source |
|---|---|---|---|
| Engine RNG stream reserved for wave composition; combat/skills use fixed offset tables | Locked | Determinism / party lockstep | `src/engine/README.md` |
| Schema via `prisma db push`, no migration history; Prisma pinned to v6 | Locked | Shared host denies shadow DB (P3014); v7 needs driver adapters | `docs/context/deployment.md` |
| All modals render through `ModalPortal` | Locked | iOS Safari backdrop-filter containing-block bug | `docs/known-traps.md` |
| UI icons = pre-2020 emoji or CSS-drawn only | Locked | Windows 10 lacks Unicode-13+ glyphs | `docs/known-traps.md` |
| Presence/chat are render/store-only — zero code paths into engine state | Locked | Pinned by garbage-feed hash-equality test | `docs/ghost-presence-design.md` |
| World projection = C "MMO field board with subtle depth" (fixed low camera; A flat side-scroller / B steep iso rejected) | Locked (R4.5) | Ragnarok/idle-MMO feel without true 3D; A reads 1D, B needs tile occlusion rebuild | issue #69, `docs/map-direction.md` |
| Depth scale band capped 0.95↔1.06 (cap, don't flatten); offsets unchanged; orthographic (flat-1.0) fallback if it ever reads as jitter | Locked (R4.5) | Old 0.8↔1.12 40% swing read as "tiny", not "far" — scale is a whisper, composition sells depth | issue #69, `docs/map-direction.md` |
