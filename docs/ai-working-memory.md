# AI working memory

This file is the shared memory contract for AI agents working in this repo. It is intentionally short and stable. Use it together with `AI.md`, `docs/current-state.md`, and `docs/decision-index.md`.

## Owner-selected direction

The owner chose the R4.5 direction as:

- Projection: **C — MMO field board with subtle 2.5D depth**.
- Scale policy: **capped 0.95 → 1.06**, not the old strong shrink/grow curve.
- Depth should read from **foot-position zIndex, contact shadows, authored ground composition, and visual-only props**, not from character shrinking.
- First vertical slice: **Forest Outskirts / Dark Forest Road**, starting with `map2` farm zones.
- Props in R4.5 are **visual-only**: no collision, no gameplay reads, no tappability, no engine-state effect.
- R5 full 2D combat must wait until R4.5 map direction / owner eye-test is accepted, unless the owner explicitly overrides.

## Owner availability / async cadence

The owner is not always available to trigger small next steps. Work should therefore be organized so progress can continue in **slow, safe, reviewable batches** without requiring the owner to micromanage every prompt.

Default cadence:

- Prefer **small stacked Draft PRs** or clearly scoped issue comments over one large unreviewable drop.
- Each batch should leave an obvious next action in the PR body, issue comment, or `docs/current-state.md`.
- If a next step is already owner-approved and inside the locked direction, the agent may prepare the next Draft PR/proposal without waiting for a fresh trigger.
- Do **not** merge, deploy, change DB/relay, or change locked direction without explicit owner approval.
- For visual-feel work, static tests are not enough: stop at Draft/ready-for-eye-test and ask for owner eye-test before merge.
- When owner time is limited, present one short decision list: approve / reject / choose A-B-C / eye-test checklist.

This means AI agents should be proactive about preparing the next safe artifact, but conservative about irreversible actions.

## Token budget / visual evidence policy

The owner cares about token efficiency. Visual evidence is useful, but it must be **token-light** and should not replace concise written handoff.

Default rules:

- Do not paste large image dumps, raw screenshots as text, long logs, or repeated frame-by-frame descriptions into PR bodies or chat.
- Prefer **links or attachments** to screenshots/videos over embedding verbose descriptions.
- For a visual PR, provide a small evidence set only:
  - 1 desktop screenshot of the target state.
  - 1 mobile portrait screenshot if mobile readability is part of acceptance.
  - 1 night/dark-palette screenshot only when darkness/readability is the actual risk.
  - 1 short GIF/video only when motion/sorting/occlusion cannot be judged from stills.
- Each visual artifact should have a one-line label: what to look at, what should be true, and which owner checklist item it supports.
- If evidence would be expensive to generate or review, skip it and provide exact local reproduction steps instead.
- AI review should summarize visual evidence in **3-5 bullets maximum**, not narrate every visible detail.
- Keep source inspection targeted: use `AI.md`, `docs/ai-working-memory.md`, `docs/current-state.md`, `docs/decision-index.md`, CODEMAP, and only affected files. Do not read broad history unless current-state points there.

Preferred pattern:

```md
## Visual evidence

- Desktop / map2 farm / noon: <link> — road + props read as authored field.
- Mobile portrait / map2 farm / night: <link> — shadow still visible on far strip.
- 6s motion clip: <link> — hero walks behind/in front of trunk correctly.

Owner only needs to answer: pass / fail / which item feels wrong.
```

## Memory upkeep rule

AI agents must keep repo memory current when they perform work in this repo.

Update docs as follows:

- `docs/current-state.md`: update at the close of each completed work round or merged PR stack, especially when the current branch, suite count, blockers, or next recommended work changes.
- `docs/ai-working-memory.md`: update only when owner direction, async cadence, work order, guardrails, token/visual-evidence policy, or merge/review discipline changes. Do not turn it into a changelog.
- `docs/decision-index.md`: update when a decision is locked/rejected and should not be re-litigated.
- `docs/CODEMAP.md`: update whenever files are added, moved, or deleted.

If an agent cannot update the docs directly, it must leave an explicit TODO in the PR body or issue comment saying which doc needs the update and why.

## Immediate work order

Current order of operations:

1. Review and merge R4.5 Wave 2 stacked PRs only after owner approval:
   - `#73` Wave 2A spec/docs-only
   - `#74` Wave 2B ground composition
   - `#75` Wave 2C visual-only props
   - `#76` Wave 2D readability/mobile polish + guards
2. Merge order is bottom-up: **#73 → #74 → #75 → #76**.
3. After the stack lands, run owner eye-test on the combined Wave 2 slice.
4. Then decide the next R4.5 step:
   - Wave 3: formal prop occlusion rules / `MapProp` model, still visual-only unless owner changes scope.
   - Wave 4: far-row atmospheric tint / final polish.
5. Only after R4.5 direction pass should R5/#52 start: 2D combat metric, skill geometry, minimap y, and balance re-baseline.

## Owner eye-test focus

Before calling R4.5 Wave 2 accepted, check:

- `map2` farm zones read as an authored field, not a flat strip.
- Road / tone strips / props remain readable on desktop and mobile.
- Hero, mobs, and ghosts sort correctly in front of / behind props.
- Foreground grass covers feet/shins at most.
- Contact shadows remain visible on the darkest far strip, including night palette.
- Damage numbers, HP bars, and boss plate are never hidden by props.
- Gate/NPC taps still work; props are not tappable.
- Tap ping still lands at the tapped depth.
- No FPS regression on desktop or mid mobile.

## Hard guardrails

Do not re-open these unless the owner explicitly asks:

- No full 3D.
- No camera rotation.
- No virtual joystick.
- Code-drawn assets first; no real image/sprite asset pipeline yet.
- No DB change for R4.5.
- No relay protocol change for R4.5.
- No `SAVE_VERSION` bump unless justified and owner-approved.
- Normal farm mobs remain private.
- Presence/chat remain render/store-only and must not affect engine state.
- Combat semantics remain x-based until R5/#52.

## How AI agents should avoid getting lost

Before proposing or editing anything, answer these four questions in the plan:

1. Which issue / wave am I continuing?
2. Which files are allowed to change?
3. What is explicitly out of scope?
4. What owner eye-test or approval is required before merge?

If the answer is unclear, stop and ask instead of improvising a new direction.

## PR review / merge discipline

- Treat stacked PRs as dependent unless the PR body says otherwise.
- Do not merge Draft PRs just because static review is clean.
- Static review can say "no blocker", but owner eye-test still controls visual-feel acceptance.
- Always call out deploy impact: web / relay / DB / none.
- Never merge `develop` → `main` without owner confirmation for that specific merge.

## Current mental model

R4 made `x/y` real. R4.5 makes that movement **feel like a 2.5D world**. R5 makes combat actually use 2D metrics. Do not skip from R4 straight into R5 until the 2.5D field reads correctly.
