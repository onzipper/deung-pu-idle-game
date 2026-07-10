import { describe, it, expect } from "vitest";
import {
  actionBeatMsForEma,
  buildActionSample,
  deriveActionFacing,
  shouldPublishAction,
  GHOST_VALVE_HEAVY_MS,
  GHOST_VALVE_LIGHT_MS,
  PRESENCE_ACTION_BEAT_MS,
  type ActionEdge,
} from "../presencePublish";

const IDENT = { charId: "char-1", displayName: "Aran" };
const NONE: ActionEdge = { kind: "none" };

describe("buildActionSample — action-kind mapping", () => {
  it("maps a basic-attack edge to 'basic'", () => {
    const s = buildActionSample({ x: 10, aimX: null }, IDENT, { kind: "basic" }, 1, null, 1, 999);
    expect(s).toMatchObject({ v: 1, cid: "char-1", x: 10, f: 1, a: "basic", at: 1, t: 999 });
  });

  it("maps each skill slot to skill1..skill4", () => {
    for (const slot of [1, 2, 3, 4] as const) {
      const s = buildActionSample(
        { x: 0, aimX: null },
        IDENT,
        { kind: "skill", slot },
        1,
        null,
        1,
        0,
      );
      expect(s.a).toBe(`skill${slot}`);
    }
  });

  it("maps a dash edge to 'dash'", () => {
    const s = buildActionSample({ x: 0, aimX: null }, IDENT, { kind: "dash" }, 1, null, 1, 0);
    expect(s.a).toBe("dash");
  });

  it("maps a 'none' edge to 'walk' when x moved since prevX, else 'idle'", () => {
    const walking = buildActionSample({ x: 20, aimX: null }, IDENT, NONE, 1, 10, 0, 0);
    expect(walking.a).toBe("walk");
    const idle = buildActionSample({ x: 10, aimX: null }, IDENT, NONE, 1, 10, 0, 0);
    expect(idle.a).toBe("idle");
  });

  it("treats a null prevX (first sample) as NOT moving -> idle", () => {
    const s = buildActionSample({ x: 10, aimX: null }, IDENT, NONE, 1, null, 0, 0);
    expect(s.a).toBe("idle");
  });

  it("rounds x, carries facing through, and OMITS y when hero.y is undefined", () => {
    const s = buildActionSample({ x: 10.6, aimX: null }, IDENT, NONE, -1, null, 0, 0);
    expect(s.x).toBe(11);
    expect(s.f).toBe(-1);
    expect(s.y).toBeUndefined();
  });

  it("includes a rounded y when the hero carries one (additive field)", () => {
    const s = buildActionSample({ x: 0, aimX: null, y: 5.2 }, IDENT, NONE, 1, null, 0, 0);
    expect(s.y).toBe(5);
  });

  it("NEVER mutates the hero it samples", () => {
    const hero = { x: 40.2, aimX: 45 };
    const before = structuredClone(hero);
    buildActionSample(hero, IDENT, { kind: "basic" }, 1, 30, 1, 1);
    expect(hero).toEqual(before);
  });
});

describe("deriveActionFacing", () => {
  it("faces the live combat aim when it's clearly off-center", () => {
    expect(deriveActionFacing({ x: 100, aimX: 120 }, null, -1)).toBe(1);
    expect(deriveActionFacing({ x: 100, aimX: 80 }, null, 1)).toBe(-1);
  });

  it("falls back to x-velocity sign when not in combat (aimX null)", () => {
    expect(deriveActionFacing({ x: 110, aimX: null }, 100, -1)).toBe(1);
    expect(deriveActionFacing({ x: 90, aimX: null }, 100, 1)).toBe(-1);
  });

  it("HOLDS the previous facing when standing still (no aim, no velocity)", () => {
    expect(deriveActionFacing({ x: 100, aimX: null }, 100, -1)).toBe(-1);
    expect(deriveActionFacing({ x: 100.1, aimX: null }, 100, 1)).toBe(1); // within deadband
  });

  it("HOLDS facing when the aim sits right on top of the hero (deadband, no jitter)", () => {
    expect(deriveActionFacing({ x: 100, aimX: 100.2 }, 100, -1)).toBe(-1);
  });
});

describe("shouldPublishAction — change detection (idle stays silent)", () => {
  const s = (x: number, f: 1 | -1, at: number) =>
    buildActionSample({ x, aimX: null }, IDENT, NONE, f, null, at, 0);

  it("always sends the first sample", () => {
    expect(shouldPublishAction(null, s(0, 1, 0))).toBe(true);
  });

  it("sends on Δx >= 1px", () => {
    expect(shouldPublishAction(s(10, 1, 0), s(11, 1, 0))).toBe(true);
    expect(shouldPublishAction(s(10, 1, 0), s(10.4, 1, 0))).toBe(false);
  });

  it("sends on a facing flip", () => {
    expect(shouldPublishAction(s(10, 1, 0), s(10, -1, 0))).toBe(true);
  });

  it("sends when the action counter advanced (a real edge fired)", () => {
    expect(shouldPublishAction(s(10, 1, 0), s(10, 1, 1))).toBe(true);
  });

  it("stays SILENT on an unchanged idle->idle beat", () => {
    expect(shouldPublishAction(s(10, 1, 0), s(10, 1, 0))).toBe(false);
  });

  it("sends on a y change only when BOTH samples carry y", () => {
    const withY = (y: number) => ({ ...s(10, 1, 0), y });
    expect(shouldPublishAction(withY(1), withY(2))).toBe(true);
    expect(shouldPublishAction(withY(1), withY(1))).toBe(false);
    // one side missing y -> not comparable, no forced send from y alone
    expect(shouldPublishAction(s(10, 1, 0), withY(2))).toBe(false);
  });
});

describe("actionBeatMsForEma — fps valve, paired with the ghost-cap thresholds", () => {
  it("runs at the full ~8Hz beat under the light threshold", () => {
    expect(actionBeatMsForEma(GHOST_VALVE_LIGHT_MS)).toBe(PRESENCE_ACTION_BEAT_MS);
    expect(actionBeatMsForEma(10)).toBe(PRESENCE_ACTION_BEAT_MS);
  });

  it("halves to ~4Hz between the light and heavy thresholds (mirrors ghost cap step to 6)", () => {
    expect(actionBeatMsForEma(GHOST_VALVE_LIGHT_MS + 1)).toBe(PRESENCE_ACTION_BEAT_MS * 2);
    expect(actionBeatMsForEma(GHOST_VALVE_HEAVY_MS)).toBe(PRESENCE_ACTION_BEAT_MS * 2);
  });

  it("suspends (0) past the heavy threshold (mirrors ghost cap step to 0)", () => {
    expect(actionBeatMsForEma(GHOST_VALVE_HEAVY_MS + 1)).toBe(0);
    expect(actionBeatMsForEma(1000)).toBe(0);
  });
});
