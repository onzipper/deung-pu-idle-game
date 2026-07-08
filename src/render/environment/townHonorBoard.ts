/**
 * HOF seasonal rewards (docs/hof-rewards-design.md §3 item 3) — the town
 * "ป้ายเกียรติยศกลางเมืองหลัก" (main-town honor plaque), engraved with the
 * CURRENT season's champion name + title per rewarded board. Pure render-only
 * decor (zero engine involvement, no `GameState` read at all — the caller
 * supplies the resolved entry list via `setEntries()`), same lifecycle/
 * layering convention as `townLlama.ts`'s `TownLlamaActor`: built once by
 * `GameRenderer.create()`, added as a sibling of `Environment`'s biome scenes
 * in the SAME `background` container (so it sits behind every hero/enemy/NPC
 * for free, no z-index bookkeeping), visible only while standing in town.
 *
 * **"Never called" = pixel-identical** (the cross-wave seam contract's
 * regression guard): this plaque stays `view.visible = false` UNCONDITIONALLY
 * until `setEntries()` has been called at least once (even with an empty
 * array) — see `initialized`. Every existing solo/sim call site that never
 * touches the new `setTownChampions()` seam therefore renders byte-identical
 * output to before this module existed, exactly like `townLlama.ts`'s
 * never-resolves-its-texture-load fallback.
 *
 * Art direction: this is SCENERY (muted worked stone + soft, non-jewel gold
 * trim/text — `PALETTE.honorPlateStone*`/`honorPlateGold`), deliberately NOT
 * the vivid entity-layer gold of `fx/championAura.ts`'s halo — see
 * `render/README.md`'s desaturated-scenery-vs-jewel-tone-entities rule. Empty
 * entries still render the full frame ("the plaque still stands") — the Thai
 * "ยังไม่มีแชมป์" placeholder copy is a UI-layer concern per the task brief,
 * not rendered here; an empty plaque just shows a small centered engraved
 * emblem instead of name lines.
 *
 * Footgun compliance: every radius/size through `safeRadius()`; no hand-built
 * canvas gradients (flat-alpha fills/strokes only); no `pivot`-based rotation
 * (feet-anchored `position.set(x, GROUND_Y)`, same convention as
 * `townLlama.ts`); no tap interaction this wave (owner spec: "Tap interaction
 * NOT required this wave").
 */

import { Container, Graphics, Text } from "pixi.js";
import { GROUND_Y } from "@/render/layout";
import { PALETTE, safeRadius } from "@/render/theme";

/** World-x center of the plaque — clear of the left zone-edge gate archway
 * (`CONFIG.hunt.heroMinX = 55`, archway footprint roughly 14-96) and ป้าปุ๊'s
 * anchor (`CONFIG.townNpcs`: x=230, radius=42 -> 188-272), same
 * clear-of-anchors convention `townLlama.ts`'s `PATCH_CENTER_X` doc comment
 * uses. */
const PLAQUE_X = 150;

const PLAQUE_WIDTH = 76;
const PLAQUE_HEIGHT = 86;
const PEDESTAL_WIDTH = 92;
const PEDESTAL_HEIGHT = 10;
const CORNER_RADIUS = 4;

/** Up to this many champion lines fit the plaque's engraved face (today's 4
 * rewarded boards — level/power/gold/online — with headroom for a future
 * category; extra entries beyond this are silently clipped, never a crash). */
const MAX_LINES = 6;
const LINE_FONT_SIZE = 7;
const LINE_SPACING = 10;
/** Top padding inside the plaque face before the first name line. */
const LINES_TOP_PADDING = -PLAQUE_HEIGHT + 22;

export interface TownChampionEntry {
  board: string;
  name: string;
  title: string;
}

export class TownHonorBoard {
  readonly view = new Container();
  /** The plaque's static Graphics-only frame (pedestal + body + empty-emblem),
   * grouped apart from the Text name lines. Exposed for headless bounds-
   * sanity tests: Pixi `Text.getBounds()` needs a real `document`/canvas for
   * text-metric measurement, which plain-Node Vitest doesn't have (see
   * `render/README.md`'s Node-env note) — `frame.getBounds()` lets tests
   * assert "the plaque itself is sane" (0 or 4 entries alike) without ever
   * touching that codepath, same test-observability-hook convention as
   * `townLlama.ts`'s `isHopping`/`activeHeartCount`. */
  readonly frame = new Container();
  private readonly lines: Text[] = [];
  private readonly emptyEmblem: Graphics;
  /** Becomes `true` on the FIRST `setEntries()` call (even `[]`) — gates
   * whether this plaque is ever shown at all, see the module doc comment's
   * "never called = pixel-identical" contract. */
  private initialized = false;
  private lastKey = "";

  constructor() {
    this.view.position.set(PLAQUE_X, GROUND_Y);
    this.view.visible = false;

    // Pedestal base (wider, sits at ground level).
    const pedestal = new Graphics();
    pedestal
      .roundRect(-PEDESTAL_WIDTH / 2, -PEDESTAL_HEIGHT, PEDESTAL_WIDTH, PEDESTAL_HEIGHT, 2)
      .fill(PALETTE.honorPlateStoneShade);

    // Plaque body (stone, rounded corners) + a thin gold trim frame.
    const body = new Graphics();
    const bx = -PLAQUE_WIDTH / 2;
    const by = -PEDESTAL_HEIGHT - PLAQUE_HEIGHT;
    body
      .roundRect(bx, by, safeRadius(PLAQUE_WIDTH), safeRadius(PLAQUE_HEIGHT), CORNER_RADIUS)
      .fill(PALETTE.honorPlateStone);
    body
      .roundRect(bx, by, safeRadius(PLAQUE_WIDTH), safeRadius(PLAQUE_HEIGHT), CORNER_RADIUS)
      .stroke({ width: 1.5, color: PALETTE.honorPlateGold, alpha: 0.65 });
    // Inset engraved border — reads as "carved", still flat-alpha only.
    const inset = 6;
    body
      .roundRect(
        bx + inset,
        by + inset,
        safeRadius(PLAQUE_WIDTH - inset * 2),
        safeRadius(PLAQUE_HEIGHT - inset * 2 - 6),
        2,
      )
      .stroke({ width: 1, color: PALETTE.honorPlateStoneShade, alpha: 0.8 });
    // Small crest cap above the plaque's top edge.
    body
      .poly([-9, by, 9, by, 0, by - 10], true)
      .fill(PALETTE.honorPlateStoneShade)
      .stroke({ width: 1, color: PALETTE.honorPlateGold, alpha: 0.6 });

    // Generic "engraved but empty" emblem — a small gold diamond, shown ONLY
    // while there are zero entries (see `applyEntries()`). No text needed
    // (UI-layer copy owns the "ยังไม่มีแชมป์" read, per the task brief).
    const emptyEmblem = new Graphics();
    emptyEmblem
      .poly([0, -8, 6, 0, 0, 8, -6, 0], true)
      .stroke({ width: 1.2, color: PALETTE.honorPlateGold, alpha: 0.5 });
    emptyEmblem.position.set(0, by + PLAQUE_HEIGHT / 2 + 2);
    this.emptyEmblem = emptyEmblem;

    this.frame.addChild(pedestal, body, emptyEmblem);
    this.view.addChild(this.frame);

    for (let i = 0; i < MAX_LINES; i++) {
      const t = new Text({
        text: "",
        style: {
          fontSize: LINE_FONT_SIZE,
          fontWeight: "600",
          fill: PALETTE.honorPlateGold,
          fontFamily: "monospace",
        },
      });
      t.anchor.set(0.5, 0);
      t.position.set(0, LINES_TOP_PADDING + i * LINE_SPACING);
      t.visible = false;
      this.lines.push(t);
      this.view.addChild(t);
    }
  }

  /**
   * Registers the current season's engraved lines. Safe to call any time
   * (before/after `update()`), any number of times — a cheap dirty-check
   * (`lastKey`) skips re-touching the Text objects when the caller re-supplies
   * an identical list on a poll cadence. `[]` is a valid, meaningful call (the
   * plaque still stands, per spec) and DOES flip `initialized = true`.
   */
  setEntries(entries: readonly TownChampionEntry[]): void {
    this.initialized = true;
    const clamped = entries.slice(0, MAX_LINES);
    const key = clamped.map((e) => `${e.board}|${e.name}|${e.title}`).join(";");
    if (key === this.lastKey) return;
    this.lastKey = key;

    this.lines.forEach((line, i) => {
      const e = clamped[i];
      if (e) {
        line.text = `${e.title} ${e.name}`.trim();
        line.visible = true;
      } else {
        line.text = "";
        line.visible = false;
      }
    });
    this.emptyEmblem.visible = clamped.length === 0;
  }

  /** `inTown`: same "only while standing in the town zone" gate every other
   * town-only prop (`updateNpcView()`, `townLlama.ts`'s `update()`) uses. */
  update(dt: number, inTown: boolean): void {
    this.view.visible = this.initialized && inTown;
  }

  /** Test/observability hook (mirrors `townLlama.ts`'s `isHopping`/
   * `activeHeartCount`) — how many name lines are CURRENTLY showing text,
   * without reaching for `Text.getBounds()` (needs a real `document`/canvas,
   * unavailable in plain-Node Vitest — see `frame`'s doc comment). */
  get visibleLineCount(): number {
    return this.lines.filter((l) => l.visible).length;
  }

  /** Test/observability hook: the text content of each currently-visible line,
   * in order. */
  get visibleLineTexts(): string[] {
    return this.lines.filter((l) => l.visible).map((l) => l.text);
  }

  destroy(): void {
    this.view.destroy({ children: true });
    this.lines.length = 0;
  }
}
