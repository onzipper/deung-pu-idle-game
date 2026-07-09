# Known traps

Recurring bug classes and dangerous assumptions. **Each one cost a real debugging round**
— read this before touching code in the affected layer. Format: symptom → root cause →
correct pattern → test expectation.

## 1. One-shot intents through the rAF accumulator (input drop)

- **Symptom**: taps/toggles silently vanish; bot master wouldn't default OFF on 90–120Hz displays; first frame after boot swallows intents.
- **Root cause**: the solo frame path drained `pendingInput` BEFORE computing accumulator steps — 0-step frames (high-Hz displays, first rAF) discarded the drained intents.
- **Correct pattern**: drain one-shot intents **only on frames that actually step** (steps computed first, drain only when > 0) — see `src/ui/store/gameStore.ts` drain seam + GameClient frame path. Cohort path must stay zero-loss too.
- **Test expectation**: exactly-once intent delivery tests across 0-step frames.

## 2. Gear-only template lookup (`ITEM_TEMPLATES[id]`)

- **Symptom**: legendary/fortifier items rejected, invisible, or mis-handled (3 shipped bugs).
- **Root cause**: bare `ITEM_TEMPLATES[id]` misses the legendary + fortifier catalogs.
- **Correct pattern**: use the superset lookup (`lookupTemplate` / ALL-templates table). Deliberate exception: bot auto-sell absence-skip.
- **Test expectation**: any new item consumer gets a legendary/fortifier fixture case.

## 3. Pixi pivot double-subtraction

- **Symptom**: character rigs collapse toward y≈0.
- **Root cause**: Pixi applies `(local − pivot)` itself; path data that pre-subtracts the pivot subtracts twice.
- **Correct pattern**: Graphics paths inside pivoted containers use absolute GROUND_Y-relative coords.
- **Test expectation**: `src/render/views/__tests__/rig.test.ts` headless bounds stay byte-identical.

## 4. `Graphics.arc().fill()` without `moveTo`

- **Symptom**: arc fills collapse toward the stale pen position.
- **Correct pattern**: point-sampled `poly()` (see `arcFanPoints` in `src/render/views/heroView.ts`). Also: every radius goes through `safeRadius()`; no hand-built canvas gradients (layered flat alpha / Pixi filters only).

## 5. New enum member without its render-map entry

- **Symptom**: runtime crash "Unable to convert color undefined".
- **Root cause**: new `ProjectileKind`/event kind added without the matching `Record<...>` entries (`PROJECTILE_COLORS` etc.).
- **Correct pattern**: extend engine unions and their render maps **in the same change**; grep `Record<ProjectileKind`.

## 6. Engine determinism / RNG discipline

- **Symptom**: party lockstep hash divergence; desyncs that only reproduce with peers.
- **Root cause**: combat/skill code drawing from the seeded RNG stream (reserved for wave composition), Math transcendentals, or wall-clock reads inside `step()`.
- **Correct pattern**: fixed offset tables for combat variation; `dmath` LUTs; the ONE sanctioned `Date.now()` read is the day-cycle **draw** path. Transient fields are hash-excluded explicitly.
- **Test expectation**: multi-client hash-equality suites + determinism suite stay byte-identical; source-scan guard blocks Math transcendentals.

## 7. FTUE anchors vs hidden duplicates

- **Symptom**: FTUE highlight attaches to an invisible element.
- **Root cause**: `querySelector` anchor grabs a hidden duplicate when the same component is show/hidden per breakpoint.
- **Correct pattern**: **portal** the single instance to its location (GoalLadder pattern), never render two copies with show/hide. Re-anchor FTUE steps when HUD elements move.
- **Test expectation**: HUD layout tests assert single anchor instance.

## 8. Modals without ModalPortal (iOS Safari)

- **Symptom**: fixed-position modals clipped/mispositioned on iOS.
- **Root cause**: iOS Safari treats an ancestor's `backdrop-filter` as a containing block for fixed children.
- **Correct pattern**: ALL modals render through `src/ui/components/ModalPortal.tsx`.

## 9. Next.js 16: `cookies().set()` in a Server Component render

- **Symptom**: `ReadonlyRequestCookiesError` throw.
- **Correct pattern**: cookie writes only in Route Handlers / Server Actions; gate/redirect helpers in server components stay strictly read-only (see `src/app/characterGate.ts`). Next 16 has breaking changes — consult `node_modules/next/dist/docs/` first.

## 10. vitest doesn't typecheck; next build excludes tests

- **Symptom**: type drift in test fixtures ships silently.
- **Correct pattern**: after changes to shared engine types (Hero, saves), run `node node_modules/typescript/bin/tsc --noEmit` (ignore stale `.next/types` lines).

## 11. Relay changes need a deploy-order note

- **Symptom**: production party features half-broken ("4 shows 3", missing counts) with correct client code.
- **Root cause**: web deployed against a stale relay.
- **Correct pattern**: any relay protocol growth = additive/versioned opcode + an explicit "deploy relay FIRST, then web" note in the round's close-out. Presence/chat stay render/store-only (zero engine code paths — hash-guard test pins it).

## 12. Balance changes without the canonical sim

- **Symptom**: false walls or hidden regressions (e.g. default 1800s no-GEAR sim CANNOT beat the tier-3 quest boss — false-alarm history).
- **Correct pattern**: every balance change runs `pnpm sim` with the canonical config (5400s GEAR+REFINE) vs the latest `docs/balance-*.md` table; all gates must hold. Tune new knobs before touching tuned curves.

## 13. Additive-blend fx white-out

- **Symptom**: flame/glow fx wash out over bright daytime skies.
- **Correct pattern**: solid flame colors on normal blend + darker outline — never `add` over bright scenes.

## 14. Absolute-position constants rot

- **Symptom**: formation/spacing silently breaks when the anchor design deepens (POC `midCap` class).
- **Correct pattern**: anchor/spawn-relative bounds with config knobs, never absolute caps.

## 15. Windows 10 emoji

- **Symptom**: tofu boxes for 🪙🪄-era glyphs.
- **Correct pattern**: UI icons = pre-2020 emoji or CSS/SVG-drawn.
