// @vitest-environment jsdom
/**
 * Issue #60 — codegen game-icon registries. Guards:
 *  (a) every ITEM_ICON_COMPONENTS key resolves via `lookupTemplate` (the gear ∪
 *      fortifier ∪ legendary SUPERSET, not the gear-only `ITEM_TEMPLATES` — the
 *      recurring superset trap that hid `fort_weapon`/legendaries three times);
 *  (b) every SKILL_ICON_COMPONENTS key exists in the engine `SKILLS` map;
 *  (c) ItemIcon/SkillIcon render the caller's fallback verbatim for an unknown id;
 *  (d) all 9 icons render without crashing (SVG defs/gradients don't throw).
 */

import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { lookupTemplate } from "@/engine/config/items";
import { SKILLS } from "@/engine/config";
import {
  ITEM_ICON_COMPONENTS,
  SKILL_ICON_COMPONENTS,
  ItemIcon,
  SkillIcon,
} from "@/ui/components/icons/gameIcons";

afterEach(cleanup);

describe("item icon registry", () => {
  it("has icons for the shipped item set", () => {
    expect(Object.keys(ITEM_ICON_COMPONENTS).length).toBe(5);
  });

  it("every key resolves via lookupTemplate (superset, not gear-only)", () => {
    for (const templateId of Object.keys(ITEM_ICON_COMPONENTS)) {
      expect(lookupTemplate(templateId), templateId).toBeDefined();
    }
  });
});

describe("skill icon registry", () => {
  it("has icons for the shipped skill set", () => {
    expect(Object.keys(SKILL_ICON_COMPONENTS).length).toBe(4);
  });

  it("every key exists in the engine SKILLS map", () => {
    for (const skillId of Object.keys(SKILL_ICON_COMPONENTS)) {
      expect(SKILLS[skillId], skillId).toBeDefined();
    }
  });
});

describe("ItemIcon / SkillIcon fallback", () => {
  it("renders fallback verbatim for an unknown item id", () => {
    render(<ItemIcon templateId="__nope__" fallback={<span>ITEM_FB</span>} />);
    expect(screen.getByText("ITEM_FB")).toBeTruthy();
  });

  it("renders fallback verbatim for an unknown skill id", () => {
    render(<SkillIcon skillId="__nope__" fallback={<span>SKILL_FB</span>} />);
    expect(screen.getByText("SKILL_FB")).toBeTruthy();
  });

  it("renders the registered icon (not the fallback) for a known id", () => {
    const { container } = render(
      <ItemIcon templateId="fort_weapon" fallback={<span>ITEM_FB</span>} />,
    );
    expect(screen.queryByText("ITEM_FB")).toBeNull();
    expect(container.querySelector("svg")).toBeTruthy();
  });
});

describe("all 9 icons render without crashing", () => {
  it("renders each item icon", () => {
    for (const [id, Icon] of Object.entries(ITEM_ICON_COMPONENTS)) {
      const { container, unmount } = render(<Icon />);
      expect(container.querySelector("svg"), id).toBeTruthy();
      unmount();
    }
  });

  it("renders each skill icon", () => {
    for (const [id, Icon] of Object.entries(SKILL_ICON_COMPONENTS)) {
      const { container, unmount } = render(<Icon />);
      expect(container.querySelector("svg"), id).toBeTruthy();
      unmount();
    }
  });
});
