# CODEMAP — file → responsibility index

One line per source file: path + what it's responsible for. **Structure-only** — never content-level detail (values, algorithms, current behavior), which rots in days here; structure doesn't.

**How it's used (CLAUDE.md "Orchestration workflow"):** the orchestrator pastes the relevant section into every agent brief instead of letting the agent explore. Fall back to the `Explore` agent only for what this map can't answer (unknown-cause debugging, cross-cutting behavior tracing).

**Maintenance rule (CLAUDE.md "Docs discipline", owner directive 2026-07-09):** any change that adds/moves/deletes/repurposes a source file updates its line here in the same change. Enforced by `src/__tests__/codemap.test.ts` — stale paths or unmapped non-test files fail `pnpm test`. Tests are summarized one line per `__tests__/` dir; `src/lab/` is a single grouped entry (owner's WIP zone).

Layer contracts live in the layer READMEs: `src/engine/README.md` · `src/render/README.md` · `src/ui/README.md` · `src/server/README.md` · `src/engine/systems/README.md`.

---
### src/engine/core/

- `src/engine/core/loop.ts` — fixed-timestep accumulator; `FIXED_DT`, `drainAccumulator`, speed = more sub-steps not bigger dt
- `src/engine/core/step.ts` — the single `step(state, input) -> state` transition; wires every system in POC update order
- `src/engine/core/math.ts` — pure helpers `clamp`/`lerp`/`sign`
- `src/engine/core/dmath.ts` — cross-engine deterministic transcendentals (`dsin`/`dcos` LUT, `dhypot`, `dpow`) for lockstep bit-parity
- `src/engine/core/hash.ts` — stateless splitmix32 hashing (`lootHash`/`lootFloat`) for drop rolls, separate from the wave-composition RNG stream
- `src/engine/core/rng.ts` — seeded deterministic mulberry32 RNG (`createRng`), reserved for wave composition only

### src/engine/config/

- `src/engine/config/index.ts` — `CONFIG` — the one home for all tunable balance constants/curves (sim-sweepable)
- `src/engine/config/items.ts` — item-template catalog + per-stage drop tables (`ITEM_TEMPLATES`, `dropTableForStage`); contract file shared w/ server claim/equip
- `src/engine/config/refine.ts` — M7.6 ตีบวก refine tunables + pure `refinedStat`/cost/success-chance derivations (engine never rolls)

### src/engine/state/

- `src/engine/state/index.ts` — `GameState`/`SaveData` shape definitions + hero/state init helpers
- `src/engine/state/events.ts` — per-step transient `GameEvent` union + event buffer contract (one-way engine→render/audio)
- `src/engine/state/saveSchema.ts` — zod schema validating an incoming POSTed save's shape/ranges
- `src/engine/state/version.ts` — `SAVE_VERSION` + `migrate()` upgrade chain for save shape changes

### src/engine/lockstep/

- `src/engine/lockstep/index.ts` — public barrel re-exporting turnLoop + stateHash symbols for the M8 party client
- `src/engine/lockstep/stateHash.ts` — deterministic FNV-1a `stateHash` over ordered sim-relevant fields; the desync canary
- `src/engine/lockstep/turnLoop.ts` — pure lockstep turn executor (`executeTurn`/`runTurns`/`LockstepClient`); 100ms turns, 2-turn input delay

### src/engine/entities/

- `src/engine/entities/factory.ts` — entity factories (`makeHero`/`makeEnemy`/`makeBoss`) building from config + seeded RNG
- `src/engine/entities/index.ts` — entity type definitions (Hero/Enemy/Boss/Projectile, HeroClass union, stat types) — data only

### src/engine/ (root)

- `src/engine/index.ts` — public engine API barrel; render/ui/server import ONLY from here, never engine internals

### src/engine/systems/

- `src/engine/systems/allocation.ts` — base-stat point allocation, manual (`allocateStat` intent) + auto-distribute-to-class-ratio
- `src/engine/systems/asura.ts` — ดินแดนอสูร endgame map systems: unlock gate, depth-ladder band, elite spawns, essence/hot-zone accrual
- `src/engine/systems/boss.ts` — boss fight flow (challenge/engage/slam/enrage/victory) + boss hint-panel data helper
- `src/engine/systems/bots.ts` — idle-automation bots (potion-restock trip, sell trip) — deterministic town round-trips
- `src/engine/systems/combat.ts` — core enemy/hero engagement update loop, projectiles, hit resolution (POC update-loop port)
- `src/engine/systems/consumables.ts` — NPC-shop potions/scrolls: buy, auto-use thresholds, cooldowns, gold sink
- `src/engine/systems/dailyQuests.ts` — per-hero daily quest roster install/progress-count/claim (server feeds roster)
- `src/engine/systems/damage.ts` — single HP-reduction choke point; emits `hit`/`heroDown` events, hero death/revive
- `src/engine/systems/dash.ts` — ninja dash reposition primitive (deterministic blink-to-target landing)
- `src/engine/systems/economy.ts` — `creditGold` choke point maintaining spendable gold + lifetime `goldEarned`
- `src/engine/systems/evolution.ts` — class-tier advancement (`evolveHero`), quest-gated, permanent atk/hp multiplier
- `src/engine/systems/flow.ts` — stage progression (`nextStage`) — resets battlefield/spawns on victory
- `src/engine/systems/gear.ts` — equip mutation + deterministic stateless drop rolls (hash-based, not RNG-stream)
- `src/engine/systems/hallOfFame.ts` — write-only HOF observers (boss-clear-best, level-cap moment) watching `step()`
- `src/engine/systems/heroConfig.ts` — single writer (`applyHeroConfig`) for per-hero automation config (auto-cast/allocate/hunt)
- `src/engine/systems/hunt.ts` — hunting-field spawn pool: scattered spawns, respawn cadence, re-entry burst fill
- `src/engine/systems/leveling.ts` — hero XP/level curve; kill-driven XP grant, level-up HP/atk bonus
- `src/engine/systems/mainQuest.ts` — main chapter chain wrapping the goal-ladder; completion derived from world unlock state
- `src/engine/systems/manual.ts` — manual play intents (`moveTo`/`attackTarget`/`cancelCommand`) onto hero's transient command
- `src/engine/systems/movement.ts` — formation anchor easing (`updateAnchor`); per-entity movement lives in combat.ts
- `src/engine/systems/questRewards.ts` — single choke point (`grantQuestReward`) for main/daily quest rewards (gold/materials/potions only)
- `src/engine/systems/quests.ts` — class-change quest framework: offer rule, accept intent, objective counting
- `src/engine/systems/shadow.ts` — M8 party shadow-body takeover flag transition + lane-policy for disconnected members
- `src/engine/systems/skills.ts` — hero skill kits (nova/strike/meteor/rain/bolt/buff resolvers), mana+cooldown cast guard
- `src/engine/systems/stats.ts` — derived hero stats: level+base-stats+tier+gear → atk/hp/mana/`combatPower`
- `src/engine/systems/targeting.ts` — pure positional queries (`nearestAny`, `aliveHeroes`, `enemyTargets`)
- `src/engine/systems/townNpcs.ts` — town NPC anchor geometry + interaction-range reads (ป้าปุ๊/ลุงดึ๋ง)
- `src/engine/systems/world.ts` — zone/navigation layer: maps, farm-zone unlock, transit, boss-room progression, respawn
- `src/engine/systems/worldBoss.ts` — hourly world boss "เสี่ยจ๋อง": pure schedule helpers + spawn/AI/death engine hooks

### src/engine/__tests__/

- `src/engine/__tests__/` — full engine regression + determinism suite (canonical sim gates, class/skill/quest/party/asura/ninja/refine/lockstep behavior, byte-identical hash checks); `balance-sim.ts` + `helpers.ts` support files; 42 files
- `src/engine/lockstep/__tests__/` — lockstep turn-executor multi-client hash-equality tests; 1 file

### src/server/

- `src/server/activeCharacter.ts` — active-character-slot cookie (`activeCharacterId`) read/write/resolve, trust-checked per request
- `src/server/asura.ts` — server-authoritative asura sigil ledger (daily claim uniqueness) + legendary craft item mint (consume t10, mint legendary)
- `src/server/auth.ts` — account/auth domain: register/login/guest-upgrade, scrypt password hashing, displayName rename
- `src/server/buildId.ts` — server-side read of the pinned build id for the update-available banner
- `src/server/characters.ts` — character CRUD (create/rename/delete/select), `power`/`level` cache derivation via engine `combatPower`
- `src/server/dailyQuests.ts` — server-authoritative daily-quest calendar (Bangkok day) + deterministic roster seed + claim ledger
- `src/server/friends.ts` — friends/social-graph domain: requests, canonical friendship pairs, presence derivation, emoji pings
- `src/server/hofSeason.ts` — HOF seasonal rewards: lazy monthly finalize, top-3 snapshot per board, title derivation, claim gating
- `src/server/identity.ts` — anonymous httpOnly identity cookie (`dpu_uid`) mint/read, the base user row
- `src/server/items.ts` — server-authoritative item ledger: claim/equip/unequip/sell/refine/buyback, anti-dupe tx invariants
- `src/server/leaderboard.ts` — HOF leaderboard ingest + board reads; server-recomputes power/stamps times, anti-cheat filtered
- `src/server/offline.ts` — offline-idle elapsed time computation with cap (server wall-clock based)
- `src/server/party.ts` — party membership container domain: invite/accept/leave, cap enforcement, DB row-lock invariants
- `src/server/partyTicket.ts` — HMAC-signed short-lived tickets for the zero-dep party/presence relay (party + world-socket tickets)
- `src/server/plausibility.ts` — anti-cheat re-derive: `judgePlausibility` verdict flags implausible characters as `suspect` (hidden from HOF)
- `src/server/save.ts` — server-authoritative save/load: zod validate incoming, `migrate()` outgoing, server-stamped `lastSeen`
- `src/server/uiConfig.ts` — cross-device UI/automation preference sidecar (`Character.uiConfig`), strict optional-field schema
- `src/server/worldBoss.ts` — world boss server-side: shared HP pool state/damage report + per-character reward claim ledger

### src/server/__tests__/

- `src/server/__tests__/` — server-layer unit/integration suite (auth, characters, items, friends, party incl. relay wire-format parity, save, HOF season, world boss, plausibility, uiConfig, rename, presence ticket) with mocked Prisma; 19 files

### src/app/api/

- `src/app/api/account/rename/route.ts` — POST self-service account displayName rename (once/Bangkok-day)
- `src/app/api/asura/awaken/route.ts` — POST guaranteed +1 legendary awakening, debits stones (DB) + gold (save-blob)
- `src/app/api/asura/craft/route.ts` — POST legendary "ตำราตำนาน" craft: consume t10 weapon + mint bind-on-craft legendary
- `src/app/api/asura/sigil/route.ts` — POST daily z10 ตราอสูร sigil claim, server-stamped Bangkok-day uniqueness
- `src/app/api/auth/guest/route.ts` — POST mint/reuse anonymous guest identity cookie, zero-friction entry
- `src/app/api/auth/login/route.ts` — POST verify credentials, repoint identity cookie, clear active-character cookie
- `src/app/api/auth/logout/route.ts` — POST clear identity + active-character cookies
- `src/app/api/auth/me/route.ts` — GET current account status (registered/email/displayName/friendCode)
- `src/app/api/auth/register/route.ts` — POST claim account layer onto current guest identity in place
- `src/app/api/characters/[id]/route.ts` — DELETE soft-delete a character (owner-checked, clears active cookie if active)
- `src/app/api/characters/[id]/select/route.ts` — POST set the account's active character cookie
- `src/app/api/characters/rename/route.ts` — POST self-service character rename (once/Bangkok-day)
- `src/app/api/characters/route.ts` — GET list live characters / POST create a character (≤3, unique name)
- `src/app/api/client-log/route.ts` — DEV-ONLY POST sink for client boot-error/hydration beacon logs
- `src/app/api/friends/emoji/route.ts` — POST send an emoji ping to a friend (rate-limited, allowlist)
- `src/app/api/friends/remove/route.ts` — POST delete a canonical friendship (idempotent)
- `src/app/api/friends/request/route.ts` — POST send a friend request by code or character name
- `src/app/api/friends/respond/route.ts` — POST accept/decline a friend request
- `src/app/api/friends/route.ts` — GET the whole friends panel (friends/requests/pings) in one poll
- `src/app/api/hof/claim/route.ts` — POST claim an HOF rank-1 fortifier award (compare-and-set on claimedAt)
- `src/app/api/hof/rewards/route.ts` — GET HOF seasonal rewards read; also the lazy season-finalize trigger
- `src/app/api/hof/route.ts` — GET Hall of Fame board (level/power/gold/boss/online), zod-validated query
- `src/app/api/hof/title/route.ts` — POST set/clear the character's chosen display title (server-validated against held titles)
- `src/app/api/items/buyback/route.ts` — GET repurchasable sold items / POST atomic buyback within the 3-day window
- `src/app/api/items/claim/route.ts` — POST batch-mint gear drops + credit enhancement stones, idempotent per rollId
- `src/app/api/items/equip/route.ts` — POST equip an item into its slot, unequips incumbent in the same tx
- `src/app/api/items/refine/route.ts` — POST server-rolled refine attempt (ตีบวก), atomic cost check + success/degrade/break
- `src/app/api/items/route.ts` — GET active character's non-deleted item instances + equipped loadout
- `src/app/api/items/salvage/route.ts` — 410 Gone stub (salvage removed; stones replaced it)
- `src/app/api/items/sell/route.ts` — POST NPC-sell unequipped items, soft-destroy + gold total returned
- `src/app/api/items/unequip/route.ts` — POST clear an equipped slot (idempotent)
- `src/app/api/lab/assets/route.ts` — GET/POST/DELETE `/lab` art-experiment asset storage (dev-only writes)
- `src/app/api/party/invite/route.ts` — POST invite a friend into my party (cap/friendship checks)
- `src/app/api/party/leave/route.ts` — POST leave my party (leader-promote / dissolve on last member)
- `src/app/api/party/respond/route.ts` — POST accept/decline a party invite
- `src/app/api/party/ticket/route.ts` — POST mint an HMAC party-relay auth ticket for the caller's party
- `src/app/api/presence/ticket/route.ts` — POST mint a world-socket (ghost-presence/chat) auth ticket, guests allowed
- `src/app/api/quest/daily/claim/route.ts` — POST server-validate daily quest claim against today's roster, idempotent ledger
- `src/app/api/save/route.ts` — GET load migrated save + offline credit / POST persist validated save, server-stamps lastSeen
- `src/app/api/worldboss/claim/route.ts` — POST world boss reward claim (gold/materials/fortifier), windowId vs server clock
- `src/app/api/worldboss/damage/route.ts` — POST report damage into the server-wide shared world-boss HP pool
- `src/app/api/worldboss/state/route.ts` — GET public read of the shared world-boss HP pool for zone-entry sync

### src/lib/

- `src/lib/buildId.ts` — resolves the build identifier (env var → git sha → timestamp fallback) into `NEXT_PUBLIC_BUILD_ID`
- `src/lib/db/index.ts` — Prisma client singleton, cached on `globalThis` to survive dev hot-reload

### src/lib/__tests__/

- `src/lib/__tests__/` — build-id resolution fallback-chain tests; 1 file
### src/render/ (root)
- `src/render/GameRenderer.ts` — public entry: `create`/`draw`/`destroy`, owns Pixi Application, layer stack (background/entities/projectiles/fx/overlay), hit-testing, resize.
- `src/render/Pool.ts` — generic id-keyed `Container` pool (mark-and-sweep per `draw()` — create on first sight, destroy on drop-out).
- `src/render/fxConfig.ts` — `RENDER_FX` knobs (currently: bloom filter on/off toggle for GPU budget).
- `src/render/townNpcs.ts` — derives `TOWN_NPCS` render anchors (name plates) from engine `CONFIG.townNpcs` (geometry stays engine-owned).
- `src/render/theme.ts` — shared Pixi color palette (`PALETTE`, `HERO_COLORS`, `ENEMY_COLORS`, `PROJECTILE_COLORS`) + `safeRadius()` clamp helper.
- `src/render/layout.ts` — logical world coordinate space (`WORLD_WIDTH`/`WORLD_HEIGHT`/`GROUND_Y`) + screen-fit transform math.

### src/render/fx/
- `src/render/fx/floatingText.ts` — pooled rising/fading `Text` labels (damage numbers + event text).
- `src/render/fx/hitFlash.ts` — brief flash-to-white on hit target via `ColorMatrixFilter`.
- `src/render/fx/screenShake.ts` — exponential-decay amplitude + rotating direction screen shake.
- `src/render/fx/arenaFlash.ts` — single reusable full-bleed flash rect (boss enrage/defeat/stage-advance).
- `src/render/fx/rings.ts` — pooled expanding/fading stroked-circle rings (casts, telegraphs, shockwaves).
- `src/render/fx/weaponTrail.ts` — swordsman weapon trail ribbon + charge speed-lines, reads live rig each frame.
- `src/render/fx/crescent.ts` — pooled slash-flash crescents + spin-nova shard chips for swordsman.
- `src/render/fx/ghostBlade.ts` — swordsman whirlwind afterimage snapshots, self-timed off spin cast.
- `src/render/fx/tracer.ts` — pooled light-trail tracer for in-flight hero projectiles (arrow/orb/meteor).
- `src/render/fx/flashLines.ts` — pooled quick directional streak flashes (archer fan-of-light beat).
- `src/render/fx/runeGlyph.ts` — pooled rotating rune-circle glyph (mage cast glyph + meteor ground rune).
- `src/render/fx/castAura.ts` — orbiting sparkle halo around mage during `castHold`.
- `src/render/fx/portal.ts` — pooled dark ground-portal ellipse for enemy spawn "materialize" beat.
- `src/render/fx/soulWisp.ts` — pooled rising/fading glowing mote for enemy/hero death "spirit leaving" beat.
- `src/render/fx/armorShard.ts` — pooled jagged plate-chip debris arc for tank-kind enemy death.
- `src/render/fx/lightPillar.ts` — pooled descending beam-from-above for hero revive.
- `src/render/fx/particles.ts` (`ParticlePool`) — shared ring-buffer dot pool backing kill pops/bursts/showers.
- `src/render/fx/levelUp.ts` — bespoke golden sunburst starburst shape for hero `levelUp` event.
- `src/render/fx/bossEcho.ts` — brief render-side "collapse forward" silhouette at boss-defeated position.
- `src/render/fx/travelPortal.ts` — pooled fast-travel swirl (wind-up/collapse/fizzle) at zone gates.
- `src/render/fx/groundCrack.ts` — pooled jagged ground-crack decal for swordsman whirl/quake skills.
- `src/render/fx/curtainSweep.ts` — archer rain-curtain sweep of falling streaks (arrow rain/barrage).
- `src/render/fx/meteorScene.ts` — mage meteor's sky flash + ground scorch patches (non-rune pieces).
- `src/render/fx/commandMarkers.ts` — tap-to-move/attack feedback: ground ripple, lock-on pulse, persistent target-lock reticle.
- `src/render/fx/skyDarken.ts` — brief full-bleed sky-darken overlay for tier-2/3 ultimate spectacles.
- `src/render/fx/rainScene.ts` — archer ARROW RAIN's falling-shadow markers + arrow-stuck-in-ground decal.
- `src/render/fx/arrowSwarm.ts` — archer STORM's pooled distant arrow-swarm silhouette band.
- `src/render/fx/hazardBand.ts` — boss FIELD HAZARD pulsing warn-band ground overlay + edge-glow bars.
- `src/render/fx/corpseEcho.ts` — pooled flattening/fading silhouette blob for regular enemy death.
- `src/render/fx/npcSpeechBubble.ts` — single pooled speech bubble above a town NPC's head, UI-triggered.
- `src/render/fx/cameraPunch.ts` — directed zoom-in-then-ease camera punch composed on top of shake/letterbox.
- `src/render/fx/shadowDash.ts` — ninja dash streak line + departure afterimage, reacts to `heroDashed` event.
- `src/render/fx/refineFxRecipes.ts` (`resolveRefineFxRecipe`) — pure rarity+refine(+legendary)→fx-layers recipe resolver.
- `src/render/fx/pixelWeaponFx.ts` (`createPixelWeaponFx`) — pooled pixel-particle weapon fx sim driven by the recipe resolver.
- `src/render/fx/gearSparkle.ts` (`GearSparklePool`) — tier-5+ armor looping sparkle/glint around chest anchor.
- `src/render/fx/championAura.ts` — HOF rank-1 tall vertical gold nimbus halo with orbiting motes.
- `src/render/fx/warCryAura.ts` — crimson rim-glow + rising chevrons for War Cry ATK buff.
- `src/render/fx/refinePrestige.ts` — +8/+9/+10 refine armor crackle/beat ladder riding gearSparkle's anchor.
- `src/render/fx/FxController.ts` — event/frame orchestrator wiring all fx pools to `GameEvent`s + continuous per-frame reads.
- `src/render/fx/impactFilters.ts` — transient attach-only-while-active `ShockwaveFilter`/`RGBSplitFilter` + bloom filter factory.
- `src/render/fx/__tests__/` — pins skill-spectacle, war-cry aura, world-boss fx, shadow-dash, champion aura, POV-gating, legendary tome, refine prestige/fx-recipes, world-depth fx, floating-text stroke behavior; 12 files.

### src/render/environment/
- `src/render/environment/colorUtils.ts` — pure HSL/RGB math (`shiftHue`/`lerpColor`/`adjustLightness`), no canvas APIs.
- `src/render/environment/clouds.ts` (`CloudField`) — slow drifting overlapping-circle cloud puffs, constant real-time pace.
- `src/render/environment/ambientParticles.ts` (`AmbientField`) — perpetual low-density drifting particle field per ambient kind (mote/leaf/dust/ember/snow/smoke).
- `src/render/environment/silhouettes.ts` — far-layer silhouette chunk builders per shape (hills/treeline/rock/ridge/peaks/rooftops).
- `src/render/environment/groundProps.ts` — near-layer scrolling foreground prop chunk builders keyed by biome prop style.
- `src/render/environment/townLlama.ts` (`TownLlamaActor`) — owner's decorative pixel-art llama actor, town-only, PNG-loaded, no-op on load failure.
- `src/render/environment/townHonorBoard.ts` — HOF seasonal champion plaque decor in town, pure render-only, invisible until `setEntries()` called.
- `src/render/environment/biomes.ts` — pure biome data; `biomeForZone()` resolves map-themed farm/town/boss biome families.
- `src/render/environment/Environment.ts` — owns background layer, crossfades current/incoming `BiomeScene`s on zone change.
- `src/render/environment/ParallaxLayer.ts` — generic wrap-scroll chunk primitive backing silhouettes/groundProps.
- `src/render/environment/bossDoor.ts` — grand boss-zone door prop, locked/unlocked visual states, live unlock-progress read.
- `src/render/environment/gateArch.ts` — themed farm/town zone-transition archway prop, built once at gate x.
- `src/render/environment/gateLockOverlay.ts` — locked/open live readout (padlock + kill-progress bar) layered on gate props.
- `src/render/environment/zoneGateProps.ts` — single call site wiring gate archway/boss-door/lock-overlay props into a scene.
- `src/render/environment/zoneGates.ts` — pure CONFIG-derived gate geometry (`gateX`/`bossZoneIdxOf`/`isLastFarmZone`/`gateFamilyFor`).
- `src/render/environment/BiomeScene.ts` — wires one resolved biome's sky+clouds+silhouettes+ground+props+ambient+weather into a Container.
- `src/render/environment/sky.ts` — flat-rect sky band + horizon glow builders (built once, no scroll).
- `src/render/environment/groundBand.ts` — static ground band fill + highlight + baked speckle texture, built once per biome.
- `src/render/environment/bossArena.ts` — boss-room-only fixed gate-pillar + lintel + vignette framing, built once.
- `src/render/environment/__tests__/` — pins grand-expansion biomes, town llama, town honor board, asura zones, gate hit-test, gate lock overlay, gate props, parallax layer, terrain ground; 9 files.

### src/render/views/
- `src/render/views/hpBar.ts` — shared HP-bar drawer (dark track + green/red fill, flips under 35%) used by all views.
- `src/render/views/projectileView.ts` — arrow/bolt/orb/meteor projectile shapes, rotated/colored per kind.
- `src/render/views/bossThemes.ts` — per-boss visual theme data (unique looks per map boss).
- `src/render/views/bossView.ts` — boss rig: hexagon body + crown/horns + armor plates + enrage/telegraph tint.
- `src/render/views/worldBossView.ts` — world-boss "เสี่ยจ๋อง" distinct flashy-tycoon rig + gold aura ring.
- `src/render/views/enemySpecies.ts` — 12 mob species data (maps 4-6) resolving kind→species visuals.
- `src/render/views/enemyView.ts` — kind-specific enemy silhouette rig (normal/fast/tank/ranged personality shapes).
- `src/render/views/npcView.ts` — town NPC rig + tap-interaction anchor rendering.
- `src/render/views/heroView.ts` — articulated per-class hero rig, gear paper-doll, weapon/armor anchor hooks, facing/attack anim.
- `src/render/views/ghostLayer.ts` — pooled ghost-presence rig rendering for other players' heroes (walk/idle + R3 edge-triggered `pa` pose pulses; no fx/camera/audio).
- `src/render/views/__tests__/` — pins headless rig bounds, enemy species, world boss, gear tier7-10, hero facing/party, asura elite, legendary weapon, npc view, ghost-layer pose/invariants; 10 files.

### src/render/worldDepth/
- `src/render/worldDepth/atmosphere.ts` (`createAtmosphere`) — day/night + weather + critters runtime composing pure math with pooled Pixi layers.
- `src/render/worldDepth/critters.ts` — pooled sky birds + night firefly ambient views for the living world.
- `src/render/worldDepth/dayNight.ts` — pure day/night palette cycle math (`samplePalette`), noon = OFF-identity baseline.
- `src/render/worldDepth/depthAssign.ts` — pure per-entity depth (d∈[0,1]) assignment via stable hash (heroes/enemies/ghosts).
- `src/render/worldDepth/depthBand.ts` — pure depth→screen-effect math (`depthOffsetY`/`depthScale`/`depthZIndex`), monotonic.
- `src/render/worldDepth/hitTestMath.ts` — pure pointer hit-test math un-projecting through base+camera transforms.
- `src/render/worldDepth/terrain.ts` (`createTerrain`) — pure cosmetic terrain heightmap (`groundY(x)`) from deterministic presets.
- `src/render/worldDepth/terrainZone.ts` — zone→terrain preset resolver, flattens ground exactly at gates/town/boss.
- `src/render/worldDepth/weather.ts` — screen-fixed pooled weather layer (rain/snow/ash/leaves Pixi views).
- `src/render/worldDepth/weatherSchedule.ts` — pure deterministic weather scheduler (hash zone+time-window→weather kind).
- `src/render/worldDepth/worldFxContext.ts` — shared pure world-fx seam recomputing groundY/footY/depth per (zone,x,entity).
- `src/render/worldDepth/camera.ts` — pure living-camera state/math (follow, lookahead, idle-zoom breathe, punch, clamp).
- `src/render/worldDepth/__tests__/` — pins atmosphere, depth-assign, camera (+game integration), day-night, depth-band, fx-context, hit-test math, terrain (+zone), weather-schedule; 11 files.

### src/render/audio/
- `src/render/audio/AudioEngine.ts` — lazy asset-free WebAudio synth toolkit (tone/noise/sweep primitives), never throws.
- `src/render/audio/index.ts` — public entry point re-exporting `AudioController`/`AudioEngine`/sfx helpers.
- `src/render/audio/refineSfx.ts` — standalone refine-station SFX palette (hammer-strike/success/break/degrade).
- `src/render/audio/AudioController.ts` — one-way `GameEvent[]` consumer switching events to `sfxMap.ts` recipes.
- `src/render/audio/sfxMap.ts` — `GameEvent`→synth recipe palette data (`SFX_PARAMS`) + per-event `play*` functions.

### src/render/__tests__/
- `src/render/__tests__/` — pins world-depth entity placement + fullscreen layout transform math; 2 files.
## Zone C — src/ui/**, src/app/(game)/**, src/app root, src/i18n/**, src/lab/**

### src/app/(game)/ — game-loop host + party/presence transport (LOAD-BEARING HUB)
- `src/app/(game)/GameClient.tsx` — **rAF loop host**: owns live `GameState`/Pixi `Application` in closures, drains input, runs `step()`, draws, syncs store; the engine/render/UI seam.
- `src/app/(game)/timeDirector.ts` — hit-stop/slow-mo wall-clock shaper feeding the fixed-step accumulator; never touches `GameState`.
- `src/app/(game)/catchUp.ts` — pure hidden-tab wall-clock-gap → replay-step-count helper.
- `src/app/(game)/soloFrameDrain.ts` — zero-loss solo-frame input drain (fixes 0-sub-step frames silently discarding intents).
- `src/app/(game)/buildFrameInput.ts` — pure `PendingInput` → `FrameInput` builder shared by solo loop + cohort scheduler; remaps hero-index-embedded intents.
- `src/app/(game)/partySession.ts` — the relay `WebSocket` transport for party lockstep; cohort derivation from zone beats, seq-gap detection, leader election (pure parts) + impure glue.
- `src/app/(game)/partyHandshake.ts` — pure zone-boundary re-seed handshake state machine (reseed-offer/ack, `buildCohortState`).
- `src/app/(game)/cohortTurnEngine.ts` — client-side lockstep turn/sub-step scheduler for an active cohort (issue/execute cadence, smooth sub-stepping).
- `src/app/(game)/cohortWallet.ts` — pure cohort economy-integrity primitives: personal-wallet virtualization, deterministic drop assignment, config diffing.
- `src/app/(game)/cohortProgress.ts` — pure cohort progression-integrity primitive (prevents world-unlock leak/wipe across party join/leave).
- `src/app/(game)/cohortBotTrip.ts` — pure "should my bot leave the cohort for a town trip right now" decision.
- `src/app/(game)/cohortBadges.ts` — pure HOF seasonal social-badge (title/champion) map builder for the render seam.
- `src/app/(game)/cohortNet.ts` — pure network-quality HUD chip math (RTT EMA, laggiest-member picker).
- `src/app/(game)/presence/worldSession.ts` — the "world socket": one WebSocket for ghost-presence + global chat + ping, pub/sub, lossy, zero engine coupling.
- `src/app/(game)/presence/presencePublish.ts` — pure sampling of MY hero into a presence wire snapshot (one-way read only).
- `src/app/(game)/presence/ghostStore.ts` — pure ghost-presence receive store: ingest `p` snapshots + R3 `pa` action frames → interpolated/faded/capped ghost list (action = pose/facing, never liveness) for render.
- `src/app/(game)/presence/relayUrlCache.ts` — one-slot module cache of the last-minted presence-ticket relay URL.
- `src/app/(game)/__tests__/` — lockstep/cohort/party pure-logic pins (catchUp, cohortBotTrip, cohortBadges, buildFrameInput, cohortNet, partyHandshake, partySession, cohortWallet, cohortProgress, cohortTurnEngine, soloFrameDrain); 11 files.
- `src/app/(game)/presence/__tests__/` — ghost-presence/world-socket pins (ghostStore, ghostAction R3 stream, presencePublish, ghostGuard "presence never touches engine", worldSession); 5 files.

### src/app/ — root routes
- `src/app/characterGate.ts` — read-only server-side "does this visitor have a resolvable active character" gate (cookie-read only, no writes).
- `src/app/page.tsx` — game page: server-gates via `characterGate`, redirects to `/welcome` or `/characters`, else mounts `GameClient`.
- `src/app/layout.tsx` — root layout: Kanit/Prompt/Geist font wiring + `NextIntlClientProvider`.
- `src/app/welcome/page.tsx` — entry screen route (guest/login/register lanes), ungated, mounts `WelcomeScreen`.
- `src/app/characters/page.tsx` — character roster/creation route shell, identity-cookie gated, mounts `CharactersScreen`.
- `src/app/lab/page.tsx` — unlisted/noindex art-experiment sandbox route, mounts `LabScreen`.

### src/i18n/
- `src/i18n/config.ts` — shared locale constants (`th`/`en`, default `th`, cookie name); framework-agnostic, safe for client + server.
- `src/i18n/request.ts` — next-intl request config resolving locale/messages from a cookie (deliberately not a `[locale]` route segment, to keep `GameClient`'s mount stable).

### src/lab/
- `src/lab/` — owner's WIP art-experiment zone (pixel weapon fx / animation sandbox churn) — agents must not touch; excluded from per-file mapping.

### src/ui/ (root)
- `src/ui/README.md` — architecture doc for the whole `ui/` layer (goal ladder, settings drawer, i18n pattern, onboarding, codex, gear).
- `src/ui/skillStats.ts` — pure per-skill live-stat-line formatter (damage/radius/mana/cooldown parts) for the skill detail popover.
- `src/ui/updateBanner.ts` — pure show/hide decision for the mid-session "new patch deployed" banner (build-id compare).
- `src/ui/questGuide.ts` — pure fast-travel destination picker for the quest card's "พาไปเลย" (guide me) button.
- `src/ui/openSettingsSignal.ts` — tiny `window` CustomEvent signal to request the Settings drawer open from an unrelated component.
- `src/ui/openFriendsSignal.ts` — tiny `window` CustomEvent signal to request the Friends panel open from an unrelated component (clone of `openSettingsSignal.ts`; used by `PartyTrackerList.tsx`'s manage button).
- `src/ui/goalLadder.ts` — pure rung-selection logic for the HUD's single "what do I do next" goal ladder + core-loop card.
- `src/ui/labels.ts` — static per-class/per-stat/rarity icon + color maps (cosmetic only, never fed back to engine).
- `src/ui/patchNotes.ts` — pure "what's new" patch-notes registry + show/skip/record decision logic.
- `src/ui/__tests__/` — headless pins for the pure root modules (patchNotes, skillStats, goalLadder, updateBanner, questGuide); 5 files.

### src/ui/hooks/
- `src/ui/hooks/usePulseOnIncrease.ts` — returns a brief "just increased" flag for CSS pulse juice (gold ticking up, etc.).
- `src/ui/hooks/usePatchNotes.ts` — React glue firing the patch-notes modal once per synced snapshot, off the pure `ui/patchNotes.ts` decision.
- `src/ui/hooks/useCastKey.ts` — detects a fresh cooldown start and returns a remount key to restart a CSS cooldown-sweep overlay.
- `src/ui/hooks/useMediaQuery.ts` — SSR-safe `useSyncExternalStore` media-query subscription for breakpoint-driven portal targets.

### src/ui/components/ (top-level)
- `src/ui/components/SoundToggle.tsx` — mute/unmute button flipping the UI-owned `soundMuted` store flag.
- `src/ui/components/CodexButton.tsx` — console-dock trigger opening `CodexPanel` as a modal.
- `src/ui/components/SwitchCharacterLink.tsx` — settings-row link navigating to `/characters`.
- `src/ui/components/LocaleSwitch.tsx` — ไทย/EN switch writing the locale cookie + `router.refresh()`.
- `src/ui/components/AutoPotionToggles.tsx` — HP/mana auto-use on/off + threshold steppers (UI-owned, mirrored onto engine state each frame).
- `src/ui/components/InventoryButton.tsx` — icon-tile trigger (top-right menu row) opening `InventoryPanel`.
- `src/ui/components/CharacterButton.tsx` — icon-tile trigger opening the new `CharacterPanel` (stats/loadout/switch-character); carries the `character-menu` FTUE anchor.
- `src/ui/components/CharacterPanel.tsx` — modal housing `StatPanel`/`EquippedLoadout`/`SwitchCharacterLink`, moved off the old in-flow settings row.
- `src/ui/components/CurrencyChipsRow.tsx` — gold + material `CurrencyChip` row, relocated off dissolved `HudBar.tsx` into the top-right overlay column.
- `src/ui/components/ExpClockStrip.tsx` — bottom-edge full-width thin EXP bar + local-time clock corner readout.
- `src/ui/components/HeroPortraitCard.tsx` — top-left overlay portrait card (roundel/Lv/name/power + HP/MP/EXP bars), extracted out of `SkillBar.tsx`.
- `src/ui/components/WarpButton.tsx` — icon-tile trigger opening `FastTravelPicker`, relocated off dissolved `HudBar.tsx`.
- `src/ui/components/WorldMapButton.tsx` — icon-tile trigger opening `WorldMapPanel`, relocated off dissolved `HudBar.tsx`'s zone chip.
- `src/ui/components/FastTravelChannelBar.tsx` — fast-travel channel progress fill, store-driven off `fastTravelChannel`.
- `src/ui/components/AutoReturnToggle.tsx` — death-behavior toggle (auto-return-to-farm vs wait in town).
- `src/ui/components/PatchNotesModal.tsx` — one-time "what's new" modal, no backdrop-dismiss, mounted at top level.
- `src/ui/components/ModalPortal.tsx` — portals a modal shell to `document.body` (iOS Safari `backdrop-filter` containing-block fix); mandatory for every new modal.
- `src/ui/components/InfoTip.tsx` — reusable tap-to-show ⓘ tooltip, mobile-first (no hover-only affordance).
- `src/ui/components/CancelCommandChip.tsx` — manual-play cancel affordance shown only while the hero has an active move/attack command.
- `src/ui/components/AnnouncementBanner.tsx` — full-width slide-down server-wide announcement strip (refine/level-cap/rank-1), queued one at a time.
- `src/ui/components/HallOfFameButton.tsx` — console-dock trigger opening `HallOfFamePanel`.
- `src/ui/components/StatPanel.tsx` — base-stat panel (+buttons, unspent badge, combat-power readout), optimistic tap accumulation.
- `src/ui/components/BotSettingsSection.tsx` — legacy idle-bot config form section reading/queuing `setBotSettings` off `state.bot`.
- `src/ui/components/UpdateBanner.tsx` — quiet, non-auto-dismiss "new patch deployed" banner sibling of `AnnouncementBanner`.
- `src/ui/components/SettingsButton.tsx` — console-dock trigger opening `SettingsPanel`.
- `src/ui/components/AutoSellRulesSection.tsx` — per-rarity auto-dispose (off/sell) toggle rules + epic keep-guard, localStorage-persisted.
- `src/ui/components/QuestBoardPanel.tsx` — ผู้ใหญ่บ้าน's quest board dialog (dailies + main chapter claim), town-only.
- `src/ui/components/TownNpcPanelHost.tsx` — hosts the three town-NPC dialog panels (Shop/Refine/QuestBoard) off `activeTownPanel`, auto-closes on walk-away.
- `src/ui/components/FriendsButton.tsx` — console-dock hub owning the single `useFriendsPoll` instance + badge/toasts/panel.
- `src/ui/components/dropFeedCoalesce.ts` — pure coalescing logic for the arena-corner drop feed (max-3 stack, stone-qty merge, overflow counter).
- `src/ui/components/DropFeed.tsx` — drop-claim toast juice; epic keeps the fixed top-center discovery beat, commons/stones go to the arena corner.
- `src/ui/components/GhostToggle.tsx` — "show other players" toggle for ghost-presence (`ghostsVisible`, localStorage-persisted).
- `src/ui/components/WorldBossBanner.tsx` — hourly world-boss countdown/found-it strip, presentational off `worldBossStatus`.
- `src/ui/components/RefineButton.tsx` — refine-station shortcut that kicks off an `npcTrip` (ลุงดึ๋ง target) from anywhere; currently unused in `GameHud.tsx` (owner-confirm-pending judgment call, see that file's doc).
- `src/ui/components/NpcTripWatcher.tsx` — renders nothing; drives the generalized `npcTrip` (any of the 3 town NPCs) state machine to completion off the throttled snapshot.
- `src/ui/components/NpcTripButtons.tsx` — R2.5-W3 menu-row ร้านค้า/ตีบวก/ภารกิจ icon tiles, each a `startNpcTrip(npcId)` walk-order (never a remote panel open); boss-phase/travel-blocked dim+toast guard, in-flight pulse badge.
- `src/ui/components/MiniMapCard.tsx` — top-right compact zone-summary card (zone name, live population, hero/gate/NPC dots strip); tap opens `WorldMapPanel`.
- `src/ui/components/FastTravelPicker.tsx` — zone-picker modal for warp travel, town pinned + per-map themed sections.
- `src/ui/components/GateTripWatcher.tsx` — renders nothing; drives the `gateTrip` walk-to-gate-then-transition state machine.
- `src/ui/components/SettingsPanel.tsx` — generic client-prefs drawer (sound/language only; automation lives in `BotSettingsModal`).
- `src/ui/components/icons.tsx` — small shared CSS-drawn icons (`Coin`, `MaterialIcon`, gold-line SVG set) — no emoji dependency.
- `src/ui/components/WorldFxToggles.tsx` — "โลกมีมิติ" world-depth/camera/atmosphere three independent render toggles.
- `src/ui/components/NoticeToast.tsx` — store-driven, capped, oldest-first plain i18n-keyed notice toasts (below drop feed).
- `src/ui/components/ShopPanel.tsx` — ป้าปุ๊'s buy/sell/buy-back 3-tab NPC shop dialog.
- `src/ui/components/AsuraHotZoneBanner.tsx` — ดินแดนอสูร daily hot-zone strip; renders nothing outside asura or pre-resolve.
- `src/ui/components/AsuraTomeButton.tsx` — "ตำราตำนาน" main-menu entry, invisible until `tomeUnlocked` (never spoils the secret quest).
- `src/ui/components/BuffBadgeHub.tsx` — arena-overlay active-buff badges (zero layout shift); badge set from pure `ui/buffs/activeBuffs.ts`.
- `src/ui/components/EquippedLoadout.tsx` — compact equipped weapon/armor summary off `HeroSummary.equipped` (sim-applied loadout, never DB inventory).
- `src/ui/components/GoalLadder.tsx` — R2.6 tabbed "what do I do next" tracker: TabRow **[เควส | ปาร์ตี้]** over tag-grouped `[หลัก]/[รอง]/[รายวัน]` quest lines (rung-selection off pure `ui/goalLadder.ts`); collapses to a chip on ALL viewports via the persisted `questTrackerCollapsed` store field.
- `src/ui/components/SellRow.tsx` — one sellable inventory row (shop sell tab), tap-again-to-confirm guard, optional multi-select mode.
- `src/ui/components/BotMasterSwitch.tsx` — the ONE bot master ON/OFF switch (`state.autoHunt`) + ⚙ opening `BotSettingsModal`.
- `src/ui/components/ConsumableBar.tsx` — potion quick-use bar (HP/mana/return-scroll) with cooldown sweep.
- `src/ui/components/EquipmentDoll.tsx` — equipment paper-doll (real weapon/armor slots + teaser slots), pinned beside the inventory bag.
- `src/ui/components/InventoryPanel.tsx` — RO-style per-instance inventory grid (equip/sell), best→worst sort, no stacking at tile level.
- `src/ui/components/RefinePanel.tsx` — town refine station (ตีบวก): reveal-on-final-strike suspense sequence, server-authoritative roll.
- `src/ui/components/BotSettingsModal.tsx` — consolidated automation settings modal (combat/potions/town-trips/drops/walking), the ONE home for auto-* config.
- `src/ui/components/SkillDetailModal.tsx` — skill list+detail pane (icon/desc/live stat lines), read-only (never casts, no leveling UI).
- `src/ui/components/SkillBar.tsx` — per-hero skill KIT ONLY (portrait card extracted to `HeroPortraitCard.tsx`; bot master switch extracted to `SkillDock.tsx` in R2.6 Wave 2): cast buttons w/ cooldown sweep, ⓘ popovers, auto-slot assignment.
- `src/ui/components/SkillDock.tsx` — R2.6 Wave 2 bottom-center dock wrapper: one row of `SkillBar` tiles + `BotMasterSwitch` + `ConsumableBar` quick-slots + a persisted whole-dock collapse-to-thin-strip (mirrors `GoalLadder.tsx`'s Wave-1 collapse idiom; bot master stays visible/tappable while collapsed).
- `src/ui/components/GoalLadderOverlaySlot.tsx` — portal target mounting the ONE `GoalLadder` onto the arena's left-mid overlay slot, viewport-independent (R2.6: dropped the old `compact`/`useMediaQuery` branch).
- `src/ui/components/GameHud.tsx` — fullscreen-canvas + all-overlay HUD composition (R2-W2 rewrite): top-left portrait/buffs, top-right currency/icon-menu/party-signal, left-mid quest tracker, bottom-center skill dock (`SkillDock.tsx`), bottom-edge EXP/clock strip; documents the z-index ladder.
- `src/ui/components/__tests__/` — pins for `dropFeedCoalesce`'s pure coalesce/dismiss/partition logic, the `GameHud` fullscreen/FTUE-anchor RTL smoke test, R2.6 `GoalLadder` tab/daily-lines/party-tab behavior (`questTracker.test.tsx`), issue #55 Wave A `InventoryPanel` "all" tab default/both-slots RTL smoke (`inventoryAllTab.test.tsx`), `RefinePanel` owned/required cost-chip fraction+red-tint RTL smoke (`refinePanelCostChips.test.tsx`), and issue #58 item 1 `BotSettingsModal`'s `SkillAutoSlotPicker` icon-tile reskin RTL smoke — slot-number badges + `setAutoSlot` toggle wiring unchanged (`botSettingsSkillPicker.test.tsx`); 6 files.

### src/ui/components/icons/ — issue #60 codegen game-icon set (filled silhouette + metallic/glass gradient + soft family glow; NOT the thin gold-line chrome of `../icons.tsx`)
- `src/ui/components/icons/iconBase.tsx` — shared seam: `IconSvg` (24-viewBox, className-driven size) + `useIconIds` (per-instance-unique gradient ids off `useId`) + `IconProps`; no `<filter>`/`<image>`/raster.
- `src/ui/components/icons/itemIcons.tsx` — `ITEM_ICON_COMPONENTS` registry keyed by engine `templateId` (rusty sword / short bow / epic apocalypse blade / cloth tunic / weapon fortifier); epic+fortifier carry the gold glow inside the icon.
- `src/ui/components/icons/skillIcons.tsx` — `SKILL_ICON_COMPONENTS` registry keyed by engine skill id (sword_whirl / mage_meteor / mage_frostnova / archer_rain), each lead by its element colour.
- `src/ui/components/icons/gameIcons.tsx` — public contract seam consumers import: re-exports both registries + `ItemIcon`/`SkillIcon` resolvers (registered component or the caller's `fallback` verbatim).
- `src/ui/components/icons/__tests__/iconRegistry.test.tsx` — guards item keys resolve via `lookupTemplate` (superset trap), skill keys exist in `SKILLS`, fallback render for unknown ids, and all 9 icons render crash-free.

### src/ui/components/primitives/ — R2 design-system primitives (presentational only, no store reads)
- `src/ui/components/primitives/Button.tsx` — 3-tier button skin (primary gold / secondary purple / danger red).
- `src/ui/components/primitives/Panel.tsx` — signature panel shell (`variant="gold"` for top-level panels, `"plain"` for nested boxes).
- `src/ui/components/primitives/PanelHeader.tsx` — panel title row w/ purple underline accent + optional icon/actions slots.
- `src/ui/components/primitives/Tab.tsx` — single tab button, purple active chrome.
- `src/ui/components/primitives/TabRow.tsx` — row of `Tab`s sharing one active id.
- `src/ui/components/primitives/CurrencyChip.tsx` — currency/counter pill (gold/materials/essence), caller-driven pulse only.
- `src/ui/components/primitives/StatBar.tsx` — labeled HP/MP/EXP/generic progress bar, non-tweened value text.
- `src/ui/components/primitives/ItemTile.tsx` — square gear tile (rarity frame/glow, qty/refine badges, selected ring).
- `src/ui/components/primitives/Toast.tsx` — single toast line skin (icon + text + optional dismiss), no timer/positioning.
- `src/ui/components/primitives/IconTileButton.tsx` — ~44px icon-only menu-row tile skin (R2-W2), every panel-opening HUD trigger renders through it.
- `src/ui/components/primitives/ConfirmPopup.tsx` — modal confirm dialog (ยกเลิก/ยืนยัน, danger variant), via `ModalPortal`.
- `src/ui/components/primitives/__tests__/` — issue #60 `ItemTile` glyph→`ItemIcon` wiring pin (in-registry `templateId` renders an `<svg>`, out-of-registry/omitted `templateId` keeps the `glyph` fallback verbatim); 1 file.

### src/ui/components/characters/
- `src/ui/components/characters/DeleteCharacterDialog.tsx` — type-the-name-to-confirm character deletion modal.
- `src/ui/components/characters/types.ts` — client-side `CharacterDTO` mirror of the `/api/characters*` shape.
- `src/ui/components/characters/CreateCharacterForm.tsx` — class-picker + name-field character creation step.
- `src/ui/components/characters/RenameCharacterDialog.tsx` — once-per-server-day character rename modal.
- `src/ui/components/characters/CharacterCard.tsx` — one roster card (class/level/power/created date + select/delete).
- `src/ui/components/characters/CharactersScreen.tsx` — top-level roster+creation screen, owns all `/api/characters*` interactivity.

### src/ui/components/welcome/
- `src/ui/components/welcome/LoginForm.tsx` — email/password login form (hard-navigates on success to reset the server gate).
- `src/ui/components/welcome/RegisterForm.tsx` — email/password(+displayName) registration form, reused in `/welcome` and Settings guest-upgrade.
- `src/ui/components/welcome/WelcomeScreen.tsx` — entry-screen composition: guest CTA + login/register segmented toggle.

### src/ui/components/settings/
- `src/ui/components/settings/TitleSection.tsx` — HOF seasonal chosen-display-title picker, hidden if the character holds no titles.
- `src/ui/components/settings/AccountSection.tsx` — Settings → My Account (guest pitch+register, or registered account info + logout).

### src/ui/gear/ — Gear & Drops pure logic + thin API wrappers (see `ui/README.md` §"Gear & Drops")
- `src/ui/gear/statDelta.ts` — pure stat-delta computation for the inventory compare-vs-equipped display.
- `src/ui/gear/sellFlow.ts` — shared imperative sell flow (POST-first, chunked-batch, then local mutate + `goldCredit` intent).
- `src/ui/gear/claimBuffer.ts` — pure drop-claim buffering/dedup for the frame-loop's `itemDrop` event collector.
- `src/ui/gear/inventoryOps.ts` — pure inventory-slice mutations (`mergeClaimedItems`/`applyEquipChange`/discovery-set derivation).
- `src/ui/gear/autoSell.ts` — pure selection of which instances a town trip should sell (per-rarity rules + epic keep-guard).
- `src/ui/gear/buybackFlow.ts` — imperative "ซื้อคืน" buy-back-a-sold-item flow (POST-first, signed goldCredit).
- `src/ui/gear/useConfirmGuard.ts` — tiny "tap again to confirm" hook for irreversible sell actions.
- `src/ui/gear/stacking.ts` — pure stack-grouping by `templateId:refineLevel` (used by RefinePanel/auto-sell, not the no-stack grid).
- `src/ui/gear/multiSelect.ts` — pure multi-select-sell helpers (toggle/selection bookkeeping) for `ShopPanel`'s sell tab.
- `src/ui/gear/types.ts` — UI-side `InventoryItem`/wire DTO shapes crossing the `/api/items/*` boundary (redeclared, never imported from `@/server`).
- `src/ui/gear/api.ts` — thin `fetch` wrappers over `/api/items/*`.
- `src/ui/gear/dollModel.ts` — pure equipment paper-doll slot-model builder (real + teaser slots).
- `src/ui/gear/sortRank.ts` — best→worst inventory sort + "sell all common" bulk id-picker, shared by Inventory + Shop sell tab.
- `src/ui/gear/refineReveal.ts` — pure reveal-on-final-strike state machine (`idle→pending→striking→reveal`) so a result never leaks early.
- `src/ui/gear/refineFlow.ts` — shared imperative refine flow (POST result held until the reveal machine says commit).
- `src/ui/gear/autoEquip.ts` — pure selection of the best owned candidate to auto-equip per slot (never swaps on a tie).
- `src/ui/gear/__tests__/` — headless pins (statDelta, stacking, buybackFlow, claimBuffer, inventoryOps, autoSell, multiSelect, itemI18n coverage, dollModel, sortRank, refineReveal, autoEquip); 12 files.

### src/ui/hof/ — Hall of Fame (leaderboards + seasonal rewards/titles)
- `src/ui/hof/types.ts` — wire/query types for the legacy `GET /api/hof` leaderboard route.
- `src/ui/hof/query.ts` — pure query-key + URL building for `/api/hof`.
- `src/ui/hof/format.ts` — pure per-board value formatting (level/power/gold, online-seconds split).
- `src/ui/hof/api.ts` — thin `fetch` wrapper over `GET /api/hof`.
- `src/ui/hof/titles.ts` — the ONE structural-title-id → localized-string mapping (`titleI18nKey`/`titleLabel`).
- `src/ui/hof/rewardsTypes.ts` — wire types for `/api/hof/rewards`, `/claim`, `/title`.
- `src/ui/hof/rewardsApi.ts` — thin `fetch` wrappers over the seasonal-rewards routes.
- `src/ui/hof/HofProfileModal.tsx` — read-only paper-doll profile popover for a tapped leaderboard row.
- `src/ui/hof/useHofRewards.ts` — mount-once fetch of `GET /api/hof/rewards`, feeds podium/banner/title cross-reference.
- `src/ui/hof/rewardsLogic.ts` — pure decision helpers (claim state, podium resolution) factored out of the panel components.
- `src/ui/hof/PodiumStrip.tsx` — fixed 2|1|3 podium stage per board, engraved placeholders for short boards.
- `src/ui/hof/HallOfFamePanel.tsx` — the top-10-per-board leaderboard modal, board-tab navigation + podium + live list.
- `src/ui/hof/__tests__/` — headless pins (format, query, titles, rewardsLogic); 4 files.

### src/ui/onboarding/ — FTUE + contextual tips framework (see `ui/README.md` §"Onboarding / FTUE")
- `src/ui/onboarding/useAnchorRect.ts` — tracks viewport rect of `[data-onboarding-anchor]` targets for the spotlight (resize+poll fallback).
- `src/ui/onboarding/mascotMood.ts` — shared `MascotMood` type (neutral/excited/warning), dependency-free.
- `src/ui/onboarding/TutorialOverlayShell.tsx` — shared spotlight+speech-bubble chrome for both FTUE and contextual tips.
- `src/ui/onboarding/ContextualTipOverlay.tsx` — renders the single active contextual tip using the shared shell.
- `src/ui/onboarding/Mascot.tsx` — procedural inline-SVG mascot (idle bob/blink, mood-swapped expression).
- `src/ui/onboarding/OnboardingOverlay.tsx` — the linear FTUE overlay (step-progress badge, skip-all/next row).
- `src/ui/onboarding/steps.ts` — pure `ONBOARDING_STEPS` registry + `resolveNextStepIndex`/`isFreshSave` (headlessly tested).
- `src/ui/onboarding/useOnboardingController.ts` — React glue: gate-in + auto-advance off the pure resolver.
- `src/ui/onboarding/useContextualTips.ts` — React glue for the contextual-tip registry (persisted seen-ids, trigger diffing).
- `src/ui/onboarding/tips.ts` — pure `CONTEXTUAL_TIPS` registry (progressive-disclosure one-off tips).
- `src/ui/onboarding/__tests__/` — headless pins (steps, tips); 2 files.

### src/ui/world/ — zone enumeration, gate/warp UX, world map
- `src/ui/world/zones.ts` — pure UI-side world-zone enumeration mirroring `engine/systems/world.ts`'s zone build, off public `CONFIG`.
- `src/ui/world/npcTrip.ts` — pure, npc-agnostic "walk to a town NPC" state-machine helper (fast-travel → walk to the target's anchor → auto-open dialog); generalized off the M7.6 smith-only `smithTrip.ts`.
- `src/ui/world/WorldMapPanel.tsx` — world map panel: live population, friends/party last-zone, hot zone, world-boss window, tap-to-travel.
- `src/ui/world/gateTap.ts` — pure zone-edge gate-tap → `walkToZone`/walk-then-transition action decision.
- `src/ui/world/gateTrip.ts` — pure "walk to the gate first, then transition" state-machine helper.
- `src/ui/world/mapTheme.ts` — per-map themed row/header Tailwind classes (anchored to render biome tones, no `@/render` import).
- `src/ui/world/useZoneCounts.ts` — relay `/presence/counts` population poll, `{ open, pollMs }`-driven cadence, pauses while the tab is hidden.
- `src/ui/world/worldMapModel.ts` — pure view-model builder for `WorldMapPanel` (lock state, badges, friend/party chips).
- `src/ui/world/__tests__/` — headless pins (zones, npcTrip, gateTap, gateTrip, worldMapModel); 5 files.

### src/ui/friends/ — Friends panel (M8 Phase 1)
- `src/ui/friends/format.ts` — pure zone-parsing display helpers for friend rows.
- `src/ui/friends/api.ts` — thin `fetch` wrappers over `/api/friends*`.
- `src/ui/friends/quickStart.ts` — pure party quick-start decision helpers (immediate-refetch-after-mutation shape).
- `src/ui/friends/sortFriends.ts` — pure friends-list ordering (online-first, then most-recently-seen).
- `src/ui/friends/types.ts` — wire types for `/api/friends*` (redeclared, never imported from `@/server`).
- `src/ui/friends/partyErrors.ts` — never-silent error-code → i18n-key mapping for friend/party mutations.
- `src/ui/friends/FriendsPanel.tsx` — the friends/party panel modal, presentational off `useFriendsPoll`'s state.
- `src/ui/friends/useFriendsPoll.ts` — owns the ONE friends/party poll for the whole HUD (5s open / 15s closed cadence).
- `src/ui/friends/__tests__/` — headless pins (quickStart, partyErrors, sortFriends); 3 files.

### src/ui/asura/ — ดินแดนอสูร daily hot zone + ตำราตำนาน legendary craft/awaken
- `src/ui/asura/schedule.ts` — pure daily hot-zone day-key derivation (Asia/Bangkok boundary), shared by client + `GameClient`.
- `src/ui/asura/tomeFlow.ts` — imperative POST-first sigil-claim + legendary-craft flows.
- `src/ui/asura/AsuraTomeAssembledModal.tsx` — one-time celebratory modal firing when the 3rd tome page lands.
- `src/ui/asura/types.ts` — wire shapes for `/api/asura/*` (redeclared).
- `src/ui/asura/api.ts` — thin `fetch` wrappers over `/api/asura/*`.
- `src/ui/asura/awakenFlow.ts` — imperative POST-first legendary-awaken flow (server debits/guarantees, client applies signed deltas).
- `src/ui/asura/awakenView.ts` — pure awaken cost/gate derivation (next target, cost, blocked-by-which-resource).
- `src/ui/asura/AsuraTomePanel.tsx` — the ตำราตำนาน craft panel: essence/zone-stones/sigil/gold checklist + t10-weapon picker + craft CTA.
- `src/ui/asura/__tests__/` — headless pins (schedule, awakenView); 2 files.

### src/ui/worldBoss/ — hourly world boss "เสี่ยจ๋อง"
- `src/ui/worldBoss/api.ts` — thin `fetch` wrapper over `POST /api/worldboss/claim`.
- `src/ui/worldBoss/schedule.ts` — pure schedule-derivation + countdown-display helpers, shared by `GameClient`/`WorldBossBanner`.
- `src/ui/worldBoss/__tests__/` — headless pin for `schedule`; 1 file.

### src/ui/party/ — party network-quality signal chip + R2.6 quest-tracker party tab
- `src/ui/party/PartySignalChip.tsx` — compact 4-bar signal-chip HUD element (RTT/lag), renders nothing while solo.
- `src/ui/party/signalChip.ts` — pure `cohortStatus`+RTT → visual (tone/bar-count/pulsing) mapping.
- `src/ui/party/PartyTrackerList.tsx` — R2.6 `GoalLadder` "[ปาร์ตี้]" tab: read-only member rows off `s.party` + a "จัดการปาร์ตี้" button opening `FriendsPanel` via `openFriendsSignal.ts`.
- `src/ui/party/__tests__/` — headless pin for `signalChip`; 1 file.

### src/ui/store/ — the engine↔React bridge (LOAD-BEARING HUB)
- `src/ui/store/gameStore.ts` — **the Zustand store**: throttled (~10Hz) engine snapshot for React reads, plus the player→engine `pendingInput` intent queue and UI-owned automation/preference flags (autoCast/autoAllocate/soundMuted/questTrackerCollapsed/etc).
- `src/ui/store/__tests__/` — headless pins (gameStore, gateTripActions, npcTripActions, questTrackerCollapsed localStorage round-trip); 4 files.

### src/ui/quest/
- `src/ui/quest/dailyClaimFlow.ts` — POST-first daily-quest claim flow, then queues the engine `claimDaily` intent.

### src/ui/codex/ — reopenable reference/guide (see `ui/README.md` §"Codex / Guide")
- `src/ui/codex/CodexPanel.tsx` — the codex modal: grouped-by-category cards, gear collection grid, "watch tutorial again" reset.
- `src/ui/codex/entries.ts` — pure `CODEX_CATEGORIES`/`CODEX_ENTRIES` registry + i18n-coverage helpers.
- `src/ui/codex/__tests__/` — headless pin for `entries`; 1 file.

### src/ui/characters/
- `src/ui/characters/validateName.ts` — client-side mirror of the server's character-name validation rules (hint only, server is truth).
- `src/ui/characters/constants.ts` — client-side mirror of `MAX_LIVE_CHARACTERS` (currently 4, ninja-gated 4th slot).
- `src/ui/characters/__tests__/` — headless pin for `validateName`; 1 file.

### src/ui/announcements/ — server-wide high-refine/level-cap/rank-1 feed
- `src/ui/announcements/types.ts` — wire + display shapes for the announcement feed (`AnnouncementKind`).
- `src/ui/announcements/queue.ts` — pure ingest logic (new-entry detection, unknown-kind forward-compat).
- `src/ui/announcements/__tests__/` — headless pin for `queue`; 1 file.

### src/ui/chat/ — global chat (M8 party Wave 3)
- `src/ui/chat/chatSendSignal.ts` — tiny `window` CustomEvent signal asking `GameClient` to send a chat message over the world socket.
- `src/ui/chat/ChatButton.tsx` — floating chat trigger + unread badge; `chatOpen` lives in the store (keeps the world socket alive).
- `src/ui/chat/chatMessages.ts` — pure parse/prune/unread helpers; the ONE place a raw relay chat frame is trusted.
- `src/ui/chat/ChatPanel.tsx` — the chat slide-in panel (mobile bottom-sheet / desktop right column), 30-min pruned history.
- `src/ui/chat/__tests__/` — headless pin for `chatMessages`; 1 file.

### src/ui/buffs/ — Buff Badge Hub
- `src/ui/buffs/activeBuffs.ts` — pure, extensible active-buff-badge-set builder (`BUFF_BADGE_BUILDERS` registry).
- `src/ui/buffs/animatedChips.ts` — pure enter/exit reducer for the chip row (fixes width-jitter on add/remove).
- `src/ui/buffs/useAnimatedChips.ts` — React timer glue wrapping `stepAnimatedChips`.
- `src/ui/buffs/__tests__/` — headless pins (activeBuffs, animatedChips); 2 files.
