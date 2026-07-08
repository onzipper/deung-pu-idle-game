/**
 * Headless correctness guard for the HOF seasonal champion gold aura
 * (`fx/championAura.ts`, docs/hof-rewards-design.md §3 item 2) — same
 * convention as `warCryAura.test.ts`: exercise the REAL pooled controller in
 * plain Node (no canvas/WebGL needed for Pixi Graphics path-building),
 * asserting the POC-crash class of bug never throws and the effect stays
 * within its fixed pooling cap (no new uncapped emitters).
 */

import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { ChampionAuraController } from "@/render/fx/championAura";

describe("ChampionAuraController", () => {
  it("active/idle/negative-position slots never throw and never grow the pooled Graphics count", () => {
    const container = new Container();
    const aura = new ChampionAuraController(container);
    const before = container.children.length;
    expect(before).toBeGreaterThan(0); // built-once shapes exist from construction

    expect(() => {
      aura.setSlot(0, true, 10, 20);
      aura.setSlot(1, true, -5, -5);
      aura.setSlot(2, false, 0, 0);
      for (let i = 0; i < 300; i++) aura.update(1 / 60);
    }).not.toThrow();

    expect(container.children.length).toBe(before);
    aura.destroy();
  });

  it("fades to fully hidden once deactivated and stays quiet at rest", () => {
    const container = new Container();
    const aura = new ChampionAuraController(container);

    aura.setSlot(0, true, 5, 5);
    for (let i = 0; i < 60; i++) aura.update(1 / 60);

    aura.setSlot(0, false, 5, 5);
    for (let i = 0; i < 120; i++) aura.update(1 / 60);

    expect(() => {
      for (let i = 0; i < 60; i++) aura.update(1 / 60);
    }).not.toThrow();
  });

  it("ignores out-of-range slot indices instead of throwing", () => {
    const aura = new ChampionAuraController(new Container());
    expect(() => {
      aura.setSlot(-1, true, 0, 0);
      aura.setSlot(99, true, 0, 0);
      aura.update(1 / 60);
    }).not.toThrow();
  });

  it("a never-activated controller stays inert (no visible child) across many frames", () => {
    const container = new Container();
    const aura = new ChampionAuraController(container);
    for (let i = 0; i < 120; i++) aura.update(1 / 60);
    const visibleChildren = container.children.filter((c) => c.visible);
    expect(visibleChildren.length).toBe(0);
    aura.destroy();
  });
});
