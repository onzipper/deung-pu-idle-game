/**
 * Headless guard for the owner's fun/off-theme pixel llama (`townLlama.ts`).
 * `Assets.load` hits real network/file-decode machinery that doesn't run in
 * plain Node, so every test here injects a stub `AssetLoader` instead of
 * mocking `pixi.js` itself — exactly the seam `loadLlamaFrames()`/`load()`
 * expose for this purpose.
 */

import { describe, expect, it } from "vitest";
import { Texture } from "pixi.js";
import {
  createTownLlamaActor,
  loadLlamaFrames,
  TownLlamaActor,
  type AssetLoader,
} from "@/render/environment/townLlama";

/** A loader that always rejects — simulates every file 404ing. */
const rejectingLoader: AssetLoader = () => Promise.reject(new Error("404"));

/** A loader that resolves sit frames but rejects stand frames (simulates
 * "only one of the two sets exists" — the owner may drop files one set at a
 * time). */
function partialLoader(failSit: boolean, failStand: boolean): AssetLoader {
  return (urls) => {
    if (urls.src.includes("sit") && failSit) return Promise.reject(new Error("404"));
    if (urls.src.includes("stand") && failStand) return Promise.reject(new Error("404"));
    return Promise.resolve(Texture.WHITE);
  };
}

describe("loadLlamaFrames — graceful no-op on missing/broken files", () => {
  it("both sets missing: resolves to { sit: null, stand: null }, never throws", async () => {
    const result = await loadLlamaFrames(rejectingLoader);
    expect(result.sit).toBeNull();
    expect(result.stand).toBeNull();
  });

  it("only sit exists: sit resolves, stand is null", async () => {
    const result = await loadLlamaFrames(partialLoader(false, true));
    expect(result.sit).not.toBeNull();
    expect(result.sit).toHaveLength(2);
    expect(result.stand).toBeNull();
  });

  it("only stand exists: stand resolves, sit is null", async () => {
    const result = await loadLlamaFrames(partialLoader(true, false));
    expect(result.sit).toBeNull();
    expect(result.stand).not.toBeNull();
    expect(result.stand).toHaveLength(4);
  });

  it("one frame within a set rejecting takes down only that set", async () => {
    let call = 0;
    const flakyLoader: AssetLoader = (urls) => {
      if (urls.src.includes("sit")) {
        call += 1;
        if (call === 2) return Promise.reject(new Error("decode error"));
        return Promise.resolve(Texture.WHITE);
      }
      return Promise.resolve(Texture.WHITE);
    };
    const result = await loadLlamaFrames(flakyLoader);
    expect(result.sit).toBeNull();
    expect(result.stand).not.toBeNull();
  });

  it("both sets load fine", async () => {
    const result = await loadLlamaFrames(partialLoader(false, false));
    expect(result.sit).toHaveLength(2);
    expect(result.stand).toHaveLength(4);
  });
});

describe("TownLlamaActor — disabled end to end when both sets are absent", () => {
  it("stays invisible and never builds a sprite; update() is a safe no-op", async () => {
    const actor = new TownLlamaActor();
    await actor.load(rejectingLoader);

    expect(actor.view.children.length).toBe(0);
    // Even while "in town", a disabled actor must never become visible.
    actor.update(1 / 60, true);
    expect(actor.view.visible).toBe(false);

    actor.destroy(); // must not throw on an actor that never built anything
  });

  it("createTownLlamaActor() returns synchronously and never throws even if load() rejects unexpectedly", () => {
    const throwingLoader: AssetLoader = () => {
      throw new Error("boom");
    };
    expect(() => createTownLlamaActor(throwingLoader)).not.toThrow();
  });
});

describe("TownLlamaActor — sit-only set behaves (never transitions to stand)", () => {
  it("becomes visible in town, builds only a sit sprite, and holds a sit pose forever", async () => {
    const actor = new TownLlamaActor();
    await actor.load(partialLoader(false, true));

    // sit sprite + the (always-present-once-enabled) hearts layer — see the
    // tap-reaction describe block below.
    expect(actor.view.children.length).toBe(2);
    actor.update(0, true);
    expect(actor.view.visible).toBe(true);

    // Advance well past several sit/stand cycle windows — must never crash
    // and must never wander (no shuffle target without a stand set).
    for (let i = 0; i < 600; i++) actor.update(1 / 60, true);
    expect(Number.isFinite(actor.view.position.x)).toBe(true);

    actor.destroy();
  });

  it("hides while outside town without destroying state", async () => {
    const actor = new TownLlamaActor();
    await actor.load(partialLoader(false, false));
    actor.update(1 / 60, true);
    expect(actor.view.visible).toBe(true);
    actor.update(1 / 60, false);
    expect(actor.view.visible).toBe(false);
    actor.destroy();
  });
});

describe("TownLlamaActor — tap reaction (owner request)", () => {
  it("a tap enters a hop + spawns 1-3 heart pips, both resolve back to idle", async () => {
    const actor = new TownLlamaActor();
    await actor.load(partialLoader(false, false));
    actor.update(0, true); // establish the visible/enabled baseline

    expect(actor.isHopping).toBe(false);
    expect(actor.activeHeartCount).toBe(0);

    actor.handleTap();
    expect(actor.isHopping).toBe(true);
    expect(actor.activeHeartCount).toBeGreaterThanOrEqual(1);
    expect(actor.activeHeartCount).toBeLessThanOrEqual(3);

    // Advance well past both the hop duration and the heart lifetime.
    for (let i = 0; i < 120; i++) actor.update(1 / 60, true);
    expect(actor.isHopping).toBe(false);
    expect(actor.activeHeartCount).toBe(0);
    expect(actor.view.scale.x).toBeCloseTo(1);
    expect(actor.view.scale.y).toBeCloseTo(1);

    actor.destroy();
  });

  it("cooldown blocks tap-spam: a second immediate tap doesn't restart the hop or add hearts", async () => {
    const actor = new TownLlamaActor();
    await actor.load(partialLoader(false, false));
    actor.update(0, true);

    actor.handleTap();
    actor.update(0.1, true);
    const heartsAfterFirst = actor.activeHeartCount;
    const hoppingAfterFirst = actor.isHopping;

    actor.handleTap(); // still within TAP_COOLDOWN_S — must no-op
    expect(actor.isHopping).toBe(hoppingAfterFirst);
    expect(actor.activeHeartCount).toBe(heartsAfterFirst);

    actor.destroy();
  });

  it("a tap on a disabled actor (both sets missing) is a safe no-op", async () => {
    const actor = new TownLlamaActor();
    await actor.load(rejectingLoader);

    actor.handleTap();
    expect(actor.isHopping).toBe(false);
    expect(actor.activeHeartCount).toBe(0);

    actor.destroy();
  });

  it("disabled actor never registers pointer interaction (no eventMode/hitArea wired)", async () => {
    const actor = new TownLlamaActor();
    await actor.load(rejectingLoader);

    expect(actor.view.eventMode).not.toBe("static");
    expect(actor.view.hitArea).toBeFalsy();

    actor.destroy();
  });

  it("an enabled actor DOES wire up eventMode/hitArea for interaction", async () => {
    const actor = new TownLlamaActor();
    await actor.load(partialLoader(false, false));

    expect(actor.view.eventMode).toBe("static");
    expect(actor.view.hitArea).not.toBeNull();

    actor.destroy();
  });
});
