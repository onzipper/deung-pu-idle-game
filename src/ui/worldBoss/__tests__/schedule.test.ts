import { describe, expect, it } from "vitest";
import { worldBossLocationFor, type WorldBossPhase } from "@/engine";
import {
  deriveWorldBossStatus,
  formatCountdown,
  sameWorldBossStatus,
  shouldQueueWorldBossSpawn,
} from "../schedule";

function idle(windowId: number, msToSpawn: number): WorldBossPhase {
  return { phase: "idle", windowId, msToSpawn, msRemaining: 0 };
}
function pre(windowId: number, msToSpawn: number): WorldBossPhase {
  return { phase: "pre", windowId, msToSpawn, msRemaining: 900_000 };
}
function active(windowId: number, msRemaining: number): WorldBossPhase {
  return { phase: "active", windowId, msToSpawn: 0, msRemaining };
}

describe("formatCountdown", () => {
  it("formats mm:ss, zero-padding seconds", () => {
    expect(formatCountdown(0)).toBe("0:00");
    expect(formatCountdown(5)).toBe("0:05");
    expect(formatCountdown(65)).toBe("1:05");
    expect(formatCountdown(600)).toBe("10:00");
  });

  it("never goes negative and rounds to the nearest second", () => {
    expect(formatCountdown(-5)).toBe("0:00");
    expect(formatCountdown(59.6)).toBe("1:00");
  });
});

describe("deriveWorldBossStatus", () => {
  const somewhereElse = { mapId: "map2", zoneIdx: 1 };

  it("idle phase -> idle status regardless of location", () => {
    expect(deriveWorldBossStatus(idle(10, 200_000), somewhereElse)).toEqual({ kind: "idle" });
  });

  it("pre phase -> pre status with ceil-second countdown", () => {
    expect(deriveWorldBossStatus(pre(11, 90_500), somewhereElse)).toEqual({
      kind: "pre",
      secondsLeft: 91,
    });
  });

  it("active phase away from the boss zone -> active status", () => {
    const windowId = 42;
    const loc = worldBossLocationFor(windowId);
    expect(loc).not.toBeNull();
    // Deliberately a different zoneIdx than the resolved boss location.
    const elsewhere = { mapId: loc!.mapId, zoneIdx: loc!.zoneIdx + 1000 };
    expect(deriveWorldBossStatus(active(windowId, 61_000), elsewhere)).toEqual({
      kind: "active",
      secondsLeft: 61,
    });
  });

  it("active phase standing in the window's boss zone -> activeHere status", () => {
    const windowId = 42;
    const loc = worldBossLocationFor(windowId);
    expect(loc).not.toBeNull();
    expect(deriveWorldBossStatus(active(windowId, 30_000), loc!)).toEqual({
      kind: "activeHere",
      secondsLeft: 30,
    });
  });
});

describe("sameWorldBossStatus", () => {
  it("idle always equals idle", () => {
    expect(sameWorldBossStatus({ kind: "idle" }, { kind: "idle" })).toBe(true);
  });

  it("different kinds are never equal", () => {
    expect(
      sameWorldBossStatus({ kind: "pre", secondsLeft: 10 }, { kind: "active", secondsLeft: 10 }),
    ).toBe(false);
  });

  it("same kind compares secondsLeft (gates the ~1Hz store push)", () => {
    expect(
      sameWorldBossStatus({ kind: "active", secondsLeft: 10 }, { kind: "active", secondsLeft: 10 }),
    ).toBe(true);
    expect(
      sameWorldBossStatus({ kind: "active", secondsLeft: 10 }, { kind: "active", secondsLeft: 9 }),
    ).toBe(false);
  });
});

describe("shouldQueueWorldBossSpawn", () => {
  const windowId = 7;
  const here = { kind: "activeHere", secondsLeft: 10 } as const;

  it("true only when active + activeHere + not already recorded live", () => {
    expect(shouldQueueWorldBossSpawn(active(windowId, 10_000), here, null)).toBe(true);
  });

  it("false when merely active (not standing in the zone)", () => {
    expect(
      shouldQueueWorldBossSpawn(active(windowId, 10_000), { kind: "active", secondsLeft: 10 }, null),
    ).toBe(false);
  });

  it("false during pre/idle even if status were (incorrectly) activeHere", () => {
    expect(shouldQueueWorldBossSpawn(pre(windowId, 10_000), here, null)).toBe(false);
  });

  it("false while a boss for this window is currently active", () => {
    expect(
      shouldQueueWorldBossSpawn(active(windowId, 10_000), here, {
        windowId,
        active: true,
        defeated: false,
      }),
    ).toBe(false);
  });

  it("false once this window was defeated (window is over)", () => {
    expect(
      shouldQueueWorldBossSpawn(active(windowId, 10_000), here, {
        windowId,
        active: false,
        defeated: true,
      }),
    ).toBe(false);
  });

  it("true again after a NON-defeated despawn (fled the zone, re-entered) — re-queues", () => {
    // Live slice is the retired-but-not-defeated record for this window: re-entry must re-queue.
    expect(
      shouldQueueWorldBossSpawn(active(windowId, 10_000), here, {
        windowId,
        active: false,
        defeated: false,
      }),
    ).toBe(true);
  });

  it("true when the live record is for a DIFFERENT window", () => {
    expect(
      shouldQueueWorldBossSpawn(active(windowId, 10_000), here, {
        windowId: windowId - 1,
        active: true,
        defeated: true,
      }),
    ).toBe(true);
  });
});
