/**
 * Headless coverage for the pure/testable slice of `@/lab/frames` — the
 * "/lab never animates" bug fix (owner report, mid-task addendum): grouping
 * helpers, the virtual "combine everything" group, and the degenerate-stem
 * upload-rename helpers. Network/IndexedDB-backed functions (`loadLibrary`,
 * `ingestFile`, ...) aren't exercised here — no browser environment in plain
 * Node Vitest — only the pure logic these depend on.
 */

import { describe, expect, it } from "vitest";
import {
  ALL_FRAMES_GROUP_KEY,
  groupKeyOf,
  isDegenerateStem,
  nextDegenerateFrameName,
  prepareFriendlyUpload,
  previewSanitizedStem,
  shouldAutoSelectAllFramesGroup,
} from "@/lab/frames";

describe("groupKeyOf — baseline grouping (unchanged)", () => {
  it("shares a group across a numbered sequence", () => {
    expect(groupKeyOf("llama_walk_01")).toBe("llama_walk");
    expect(groupKeyOf("llama_walk_02")).toBe("llama_walk");
  });

  it("a name with no numeric suffix is its own group", () => {
    expect(groupKeyOf("standalone")).toBe("standalone");
  });
});

describe("previewSanitizedStem / isDegenerateStem — the owner bug's root cause", () => {
  it("an all-Thai/symbol name sanitizes down to a bare digit — degenerate", () => {
    const stem = previewSanitizedStem("ลามะ (1).png");
    expect(stem).toBe("1");
    expect(isDegenerateStem(stem)).toBe(true);
  });

  it("a fully-stripped (empty) stem is degenerate", () => {
    expect(isDegenerateStem(previewSanitizedStem("ลามะ.png"))).toBe(true);
  });

  it("a normal ASCII stem with letters is NOT degenerate", () => {
    const stem = previewSanitizedStem("llama_walk_01.png");
    expect(stem).toBe("llama_walk_01");
    expect(isDegenerateStem(stem)).toBe(false);
  });
});

describe("nextDegenerateFrameName / prepareFriendlyUpload", () => {
  it("assigns frame_01 when nothing exists yet, then continues the sequence", () => {
    expect(nextDegenerateFrameName([], "png")).toBe("frame_01.png");
    expect(nextDegenerateFrameName(["frame_01.png"], "png")).toBe("frame_02.png");
    expect(nextDegenerateFrameName(["frame_01.png", "frame_03.png"], "png")).toBe("frame_02.png");
  });

  it("renames a degenerate-name upload, never colliding with existing frame_NN names", () => {
    const file = new File([new Uint8Array([1, 2, 3])], "ลามะ (1).png", { type: "image/png" });
    const result = prepareFriendlyUpload(file, ["frame_01.png"]);
    expect(result.renamed).toBe(true);
    expect(result.originalName).toBe("ลามะ (1).png");
    expect(result.file.name).toBe("frame_02.png");
  });

  it("leaves a well-named upload untouched", () => {
    const file = new File([new Uint8Array([1])], "llama_walk_01.png", { type: "image/png" });
    const result = prepareFriendlyUpload(file, []);
    expect(result.renamed).toBe(false);
    expect(result.file).toBe(file);
  });
});

describe("shouldAutoSelectAllFramesGroup — auto-pick the animating fallback", () => {
  it("true when every real group is a singleton but multiple frames exist", () => {
    const groups = {
      "1": ["1.png"],
      "2": ["2.png"],
      "3": ["3.png"],
      [ALL_FRAMES_GROUP_KEY]: ["1.png", "2.png", "3.png"],
    };
    expect(shouldAutoSelectAllFramesGroup(groups)).toBe(true);
  });

  it("false when a real multi-frame group already exists", () => {
    const groups = {
      llama_walk: ["llama_walk_01.png", "llama_walk_02.png"],
      [ALL_FRAMES_GROUP_KEY]: ["llama_walk_01.png", "llama_walk_02.png"],
    };
    expect(shouldAutoSelectAllFramesGroup(groups)).toBe(false);
  });

  it("false for a single lone frame (nothing to animate either way)", () => {
    expect(shouldAutoSelectAllFramesGroup({ solo: ["solo.png"] })).toBe(false);
  });

  it("false for an empty library", () => {
    expect(shouldAutoSelectAllFramesGroup({})).toBe(false);
  });
});
