/**
 * Headless correctness guard for the HOF seasonal town honor board
 * (`townHonorBoard.ts`, docs/hof-rewards-design.md §3 item 3) — same
 * plain-Node Pixi Graphics/Container convention as `townLlama.test.ts` /
 * `rig.test.ts` (no canvas/WebGL required for path-building or `getBounds()`).
 */

import { describe, expect, it } from "vitest";
import { TownHonorBoard } from "@/render/environment/townHonorBoard";

describe("TownHonorBoard — never called stays pixel-identical (regression guard)", () => {
  it("stays invisible even while in town if setEntries() is never called", () => {
    const board = new TownHonorBoard();
    board.update(1 / 60, true);
    expect(board.view.visible).toBe(false);
    board.destroy();
  });
});

describe("TownHonorBoard — visibility gating", () => {
  it("becomes visible only once setEntries() has been called AND the zone is town", () => {
    const board = new TownHonorBoard();
    board.setEntries([]);

    board.update(1 / 60, false);
    expect(board.view.visible).toBe(false); // not in town yet

    board.update(1 / 60, true);
    expect(board.view.visible).toBe(true);

    board.update(1 / 60, false);
    expect(board.view.visible).toBe(false); // leaves town again
    board.destroy();
  });

  it("[] is a valid call that still flips initialized (plaque stands, per spec)", () => {
    const board = new TownHonorBoard();
    board.setEntries([]);
    board.update(0, true);
    expect(board.view.visible).toBe(true);
    board.destroy();
  });
});

describe("TownHonorBoard — bounds sanity at 0 and 4 entries", () => {
  it("0 entries: finite, non-degenerate bounds (the frame alone)", () => {
    const board = new TownHonorBoard();
    board.setEntries([]);
    board.update(0, true);

    const b = board.frame.getBounds();
    expect(Number.isFinite(b.width)).toBe(true);
    expect(Number.isFinite(b.height)).toBe(true);
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);
    expect(board.visibleLineCount).toBe(0);
    board.destroy();
  });

  it("4 entries (level/power/gold/online): finite bounds, all 4 lines rendered with text", () => {
    const board = new TownHonorBoard();
    board.setEntries([
      { board: "level", name: "ผู้เล่นเอ", title: "จ้าวยุทธภพ" },
      { board: "power", name: "ผู้เล่นบี", title: "ผู้แข็งแกร่งแห่งปฐพี" },
      { board: "gold", name: "ผู้เล่นซี", title: "เสี่ยใหญ่" },
      { board: "online", name: "ผู้เล่นดี", title: "หัวหน้ายาม" },
    ]);
    board.update(0, true);

    const b = board.frame.getBounds();
    expect(Number.isFinite(b.width)).toBe(true);
    expect(Number.isFinite(b.height)).toBe(true);
    expect(b.width).toBeGreaterThan(0);
    expect(b.height).toBeGreaterThan(0);

    expect(board.visibleLineCount).toBe(4);
    expect(board.visibleLineTexts).toEqual([
      "จ้าวยุทธภพ ผู้เล่นเอ",
      "ผู้แข็งแกร่งแห่งปฐพี ผู้เล่นบี",
      "เสี่ยใหญ่ ผู้เล่นซี",
      "หัวหน้ายาม ผู้เล่นดี",
    ]);

    board.destroy();
  });

  it("more than MAX_LINES entries is clamped, never throws", () => {
    const board = new TownHonorBoard();
    const many = Array.from({ length: 20 }, (_, i) => ({
      board: `b${i}`,
      name: `n${i}`,
      title: `t${i}`,
    }));
    expect(() => {
      board.setEntries(many);
      board.update(0, true);
    }).not.toThrow();
    board.destroy();
  });
});

describe("TownHonorBoard — re-supplying identical entries is a cheap no-op", () => {
  it("does not throw or change visibility when called repeatedly with the same list", () => {
    const board = new TownHonorBoard();
    const entries = [{ board: "level", name: "ผู้เล่นเอ", title: "จ้าวยุทธภพ" }];
    board.setEntries(entries);
    board.update(0, true);
    board.setEntries([...entries]); // new array identity, same content
    board.update(0, true);
    expect(board.view.visible).toBe(true);
    board.destroy();
  });
});
