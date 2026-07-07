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

    expect(actor.view.children.length).toBe(1);
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
