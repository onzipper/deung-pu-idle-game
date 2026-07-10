# Ghost Presence Layer — "เห็นคนอื่นในโลก" (design v2, owner-approved)

Status: **APPROVED — in implementation.** Owner decisions (2026-07-08):
- Poses limited to **walk/idle ONLY** in all zones (attack/dash poses cut — resolves the
  "fighting invisible air" concern; §5's wave split is superseded: all zones ship at once).
  **SUPERSEDED 2026-07-10 (issue #50, R3):** the action stream (§7 decision log) adds
  edge-triggered `basic`/`skill1-4`/`dash` POSES on top of walk/idle — still no swing fx,
  projectiles, hit sparks, or sfx (that part of the original decision stands). See the
  updated invariant wording in §2 row 4 and the new decision-log entry in §7.
- **Global chat added** (§7): text-only, 30-minute history, rides the same world socket.
- **Town zones are excluded from lockstep cohorts** (bot-stall fix): in town everyone is
  solo-sim; party members in town appear via THIS ghost layer instead.
- Signal-bar party indicator replaces the "เล่นกับ xxx ในโซนนี้" strip (arena top-right).

Owner directive that shapes this entire document: *"ระวังเรื่องไป control คนอื่นให้มากๆ สูงๆ"* —
the party lockstep stabilization arc burned many rounds on exactly that bug class
(non-leader skill taps commanding the leader's hero, friend ultimates hijacking the
camera, swapped wallets, hash divergence). This design makes those bugs **structurally
impossible**, not merely tested-against.

## 1. Goal & non-goals

**Goal:** while playing normally (solo or in a party), you SEE other online players who
are in the same zone — their character walks, fights, and idles near you, with a
nameplate, class look, gear auras, and HOF title. The world feels alive.

**Non-goals (v1, deliberate):**
- Ghosts do NOT share your mobs, drops, xp, or economy. Everyone fights their own
  instanced spawns (standard idle-MMO practice; players rarely notice).
- Ghosts are NOT tappable targets and grant NO gameplay effect (no buffs, no assists).
- No chat. Emoji pings stay a friends-list feature.
- Not a replacement for party lockstep — cohorts remain the shared-progress co-op mode.

## 2. The One Rule and its six invariants

**The One Rule: presence data is render-only. It never enters the simulation, and no
network message can ever move, command, or affect a hero.**

Each invariant below names the past bug it kills and the *structural* enforcement:

| # | Invariant | Kills the bug class | Enforced by |
|---|---|---|---|
| 1 | Presence data never enters `engine/` — no ghost field on `GameState`, ever | hash divergence / desync (cohort wallet, reseed classes) | ghosts can't diverge what they never touch; ESLint layer boundary already forbids engine importing ui/render |
| 2 | Presence rides a **separate relay room namespace** (`p:<zoneKey>`), unordered, lossy, **no seq** | turn-stream corruption / freeze (turns 0-1 bug) | party rooms and presence rooms share zero code paths for message application; a presence message cannot be parsed as a `TurnMessage` |
| 3 | Receiving a presence message **never enqueues `pendingInput`** and never calls any engine mutator | "my tap controlled the LEADER's hero" (`buildFrameInput` remap bug) | the ghost store's write surface is `upsertGhost(zoneKey, snapshot)` only; it has no reference to the input queue |
| 4 | Ghost actions (from `pa` or otherwise) may drive **POSE ONLY** — they never trigger fx, camera, `timeDirector`, screen shake, skyDarken, audio/sfx, the engine, or POV changes | friend-ultimate camera hijack (fixed by pov-gating in PR #21) | ghost render path (`ghostLayer.ts` `GhostPose`) draws rig + nameplate + pose only, edge-triggered once per advancing `at`; it emits no `state.events` and calls no fx/camera/audio module — `heroView.playHeroPosePulse` is additive-only (arm pose, no fx/camera/audio) |
| 5 | Tapping a ghost creates **no command intent** | tap-to-attack locking onto a non-entity → undefined behavior | R3: `hitTestGhost` (sibling of `hitTestNpc`) reads the renderer's ghost list, not engine state; a ghost tap writes zero `pendingInput` and opens a view-only `GhostProfileCard` (name/class icon/tier — no social actions) |
| 6 | The publisher only ever **reads** my own hero (pos/facing/pose) from the state closure — it sends a snapshot, not a command; nothing round-trips | any echo/loopback confusion | publish path is one-way: sample → encode → send; there is no "apply" branch for your own messages |

Test-shaped guard for #1–#3: a lockstep-harness regression that runs 2 clients over N
turns **with a fake presence feed injecting garbage snapshots the whole time** and
asserts final hashes identical to the no-presence run. Structurally it must pass;
keeping it in CI makes the invariant survive future refactors.

## 3. Architecture

```
[my GameClient rAF loop]
   └─ every ~330ms: sample MY hero (x, facing, pose, zoneKey) ──► PresencePublisher ──► relay p:<zoneKey>
[relay]  presence rooms: no slots, no seq, no grace — pub/sub + last-value cache per member
   └─ fan snapshot to everyone else in p:<zoneKey>
[peer GameClient]
   └─ GhostStore (ui-layer Map<charId, GhostSnapshot+history>) ── interpolate ──► renderer.setGhosts(list)
[render] GhostLayer: pooled hero rigs (reuse P6 multi-hero views) + nameplates, EXCLUDED from hitTest
```

### 3.1 Relay (scripts/party-relay/server.js — additive)

- New message types on the same process: `pjoin {ticket, zoneKey}`, `p {payload}`,
  `pleave`. Presence rooms live in a **separate Map** from party rooms
  (`presenceRooms: zoneKey -> Set<conn>`), with **none of** the slot/seq/grace/shadow
  machinery — a presence member that dies is just dropped after heartbeat miss.
- Zone changes = `pleave` + `pjoin` with the new zoneKey (client-driven).
- **Last-value cache**: room keeps each member's latest snapshot; a joiner receives all
  cached snapshots immediately (no "empty zone then people pop in" beat).
- Caps (free-tier friendly): max `PRESENCE_FAN = 12` members fanned per room — beyond
  that, joiners still publish but receive only the first 12 (deterministic by join
  order); payload cap ~256 bytes; rate limit reuses `maxMsgPerSec`.
- One connection per client for presence, SEPARATE from the party socket. A party
  socket must never carry `p` frames and vice versa (invariant #2). Presence connects
  lazily on entering a zone with the feature on.
- Version field `v: 1` in every message — unknown versions dropped silently (the
  "4 shows 3" stale-relay-deploy lesson: old/new clients must coexist).

### 3.2 Auth ticket

Reuse the HMAC pipeline: `POST /api/presence/ticket` signs
`{userId, charId, displayName, classId, tier}` (server-derived — names and class are
**not** client-claimable, so no impersonation). Cosmetic bits (aura level, title id,
champion flag) ride the snapshot client-trust in v1 — display-only, same trust level as
today's friends poll. Guests included (they have characters).

### 3.3 Snapshot payload (~120 bytes JSON)

```
{ v:1, cid, name, cls, tier, x, face, pose, aura, title?, champ?, t }
```
`pose ∈ idle|walk` — owner cut attack/dash; walking derives naturally from lerped
x-deltas in the receiver's rig, so v1 receivers may ignore `pose` entirely.
No hp, no damage numbers, no skill ids, no mob references: nothing a receiver could
even try to simulate.

**SUPERSEDED 2026-07-10 (R3, §7):** this snapshot payload (`p`) is unchanged — it still
carries only `idle|walk`. Richer poses (`basic`, `skill1-4`, `dash`) ride a **separate**
opcode (`pa`, ~8Hz, see §7) so `p`'s liveness/snapshot-on-join semantics stay untouched.

### 3.4 Client receive path

- `GhostStore` (new `src/ui/presence/` or `src/app/(game)/presence/` — ui side of the
  boundary): ring buffer of last 2 snapshots per ghost → positional lerp over ~350ms,
  pose plays the rig's existing walk/attack cycles locally (real-dt, like fx modules).
- Despawn on 10s silence or explicit leave, with a short fade-out; fade-in on appear.
- **Dedupe vs cohort:** party members in my cohort are already fully simulated — the
  ghost layer drops any snapshot whose `cid` matches a cohort member.
- Hidden tab: publisher stops, presence socket closes clean (mirrors the party
  visibilitychange pattern).

### 3.5 Render

- `GhostLayer` in render/: pooled full hero rigs keyed by `cid` (build-once,
  transform-only — the P6 pattern), nameplate via the existing display-name seam,
  gear-aura / champion-halo reuse the existing pooled fx **bounded per-ghost**.
- Attack pose plays the weapon swing WITHOUT projectiles, hit sparks, damage numbers,
  or sfx (their mobs aren't in my world; a swing toward their facing reads fine).
  **SUPERSEDED 2026-07-10 (R3):** shipped as an edge-triggered `GhostPose` pulse (arm
  pose only, via `heroView.playHeroPosePulse`), not a full weapon-swing animation —
  narrower than this original plan, same "no fx/sparks/sfx" constraint.
- Draw beneath my own hero & party (z-order), never dimming or tinting my entities.
- Perf valve: if fps dips below threshold, ghost cap steps down 12 → 6 → 0
  (render-only decision, per-client).

## 4. What could still go wrong (named honestly)

- **Ghost fights invisible air** — their mobs are instanced. Accepted; posture reads as
  "hunting". If it feels wrong in town-first rollout we keep zones walk/idle-only.
- **Snapshot spoofing of cosmetic bits** — same client-trust level as today's save
  blob; worst case a fake aura. Identity itself is HMAC-signed.
- **Free-tier fan-out** — presence is O(members²) per zone per tick at 3Hz. With the
  cap 12 and ~256B payloads that's ≤ ~110KB/s per hot zone worst-case; fine for the
  current population, and the cap is a relay env knob.
- **Two sockets per client** (party + presence). Acceptable; presence socket is
  optional and feature-flagged (`PRESENCE_ENABLED` + per-player settings toggle
  "แสดงผู้เล่นคนอื่น", default ON, auto-OFF on low fps).

## 5. Rollout waves

1. **Protocol + relay** — presence rooms in server.js (additive, zero-dep held),
   ticket endpoint, codec unit tests, hash-equality guard test. Relay redeploy (owner).
2. **Town first** — publisher + GhostStore + GhostLayer live ONLY in town (walk/idle
   poses; town is the social space: llama, plaques, NPCs). Settings toggle. Owner
   playtests the feel with a friend.
3. **All zones + polish** — attack/dash poses in hunt zones, champion halo/titles on
   ghosts, tap-ghost → view-only profile card (UI-only, still no command intent),
   fps-valve tuning.

## 6. Global chat (owner add, 2026-07-08)

Text-only server-wide chat riding the SAME world socket and relay process:
- One global room: `cjoin {ticket}` (history delivered on join), `c {text}`.
- History = in-memory ring buffer pruned at **30 minutes** (owner: "30 min พอ"); relay
  restart wipes it — accepted, no persistence layer.
- Sanitization: plain string only, trimmed, ≤120 chars, empty rejected. Sender name
  comes from the HMAC-verified ticket (displayName is server-derived — not spoofable).
- Rate limit 1 msg/2s per connection; breach = soft reject to sender only (not a kill —
  chat spam is not protocol abuse). No moderation in v1 (flagged; revisit if abused).
- UI: floating 💬 button + slide-in panel (ModalPortal), unread badge, 120-char input
  with cooldown feedback. Chat messages never touch the engine or input queue — same
  One Rule as presence.

## 7. Decision log

1. Ghost visuals: **full color + white nameplate** (party members keep their plate style). _(2026-07-08)_
2. Ghost cap per zone: **12** (tune after feel test; fps valve steps 12 → 6 → 0). _(2026-07-08)_
3. Rollout: **all zones at once** (walk/idle-only made the town-first hedge unnecessary). _(2026-07-08)_
4. Poses: **walk/idle only** — attack/dash cut by owner. _(2026-07-08, SUPERSEDED 2026-07-10 — see #6)_
5. Tap-ghost profile card: deferred (taps pass through to the ground in v1). _(2026-07-08, RESOLVED 2026-07-10 — see #6)_
6. **R3 action stream — `pa` opcode (2026-07-10, issue #50):** ghosts gain edge-triggered
   `basic`/`skill1-4`/`dash` poses and a tappable view-only profile card, closing
   decisions #4 and #5 above.
   - **Separate opcode vs extending `p`:** chosen **separate** (`pa`, additive, `v:1`,
     silently dropped if malformed/wrong version) — keeps `p`'s liveness/snapshot-on-join
     cache semantics untouched; `pa` is fan-capped (`PRESENCE_FAN` 12), NOT cached, never
     touches liveness, and requires an active `pjoin`.
   - **Beat + fps valve:** publish ~8Hz (`PRESENCE_ACTION_BEAT_MS = 125`), sharing the
     same fps valve as ghost render density (`GHOST_VALVE_HEAVY_MS`/`LIGHT_MS`, single
     source) — degrades 8→4→0Hz alongside the existing ghost cap 12→6→0 step-down, so a
     busy zone loses action fidelity before it loses ghosts entirely.
   - **Edge-triggered `at` counter:** the pose id only advances on a real state edge
     (basic-attack cooldown reset, a `skillCast` event, `heroDashed`) — an idle hero stays
     silent, so `pa` traffic is bursty/sparse, not a fixed-rate stream of no-op frames.
   - **Tap profile = view-only, no intent:** ghost hit-testing lives in the renderer
     (reads the pooled ghost list, not engine state) and a tap writes **zero**
     `pendingInput` — it only opens a read-only `GhostProfileCard`. This keeps invariant
     #5 (§2) true under the new tap-target, not just under the old "taps pass through"
     behavior.
   - Determinism: `ghostGuard.test.ts` extended to inject `pa` traffic (in addition to
     the existing garbage `p` feed) and prove hash-equality unchanged — the One Rule
     (§2) survives the action stream exactly as it survived the walk/idle-only version.
