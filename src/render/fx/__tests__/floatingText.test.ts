/**
 * Guard for issue #55 Wave A item 2: pooled floating-text `Text` objects get
 * a black outline stroke (bright-biome readability) set once at construction
 * and never touched per-spawn.
 */

import { Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { FloatingTextPool } from "@/render/fx/floatingText";

describe("FloatingTextPool", () => {
  it("gives every pooled Text a black outline stroke at construction", () => {
    const container = new Container();
    const pool = new FloatingTextPool(container, 4);

    for (const child of container.children) {
      const style = (child as unknown as { style: { stroke: unknown } }).style;
      expect(style.stroke).toBeTruthy();
    }

    pool.spawn({ x: 0, y: 0, label: "99", color: 0xffffff, fontSize: 14 });
    const spawned = container.children[0] as unknown as {
      style: { stroke: { color: number; width: number } };
    };
    expect(spawned.style.stroke.color).toBe(0x000000);
    expect(spawned.style.stroke.width).toBe(3);

    pool.destroy();
  });
});
