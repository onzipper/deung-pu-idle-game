// @vitest-environment jsdom
/**
 * Issue #60 (consumer wiring half) — `ItemTile`'s inner glyph now routes
 * through `ItemIcon` (`@/ui/components/icons/gameIcons`, built in parallel by
 * another agent against the same contract): a `templateId` inside the codegen
 * SVG registry renders an `<svg>` in place of `glyph`; any id outside the
 * registry (or no `templateId` at all) keeps rendering `glyph` verbatim — the
 * pre-#60 behavior every other `ItemTile` consumer still relies on.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ItemTile } from "@/ui/components/primitives/ItemTile";

describe("ItemTile glyph -> ItemIcon wiring (issue #60)", () => {
  it("renders an <svg> for a templateId inside the codegen icon registry", () => {
    const { container } = render(
      <ItemTile rarity="common" tier={1} glyph="🗡️" templateId="w_sword_t1_rusty" ariaLabel="rusty sword" />,
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("falls back to the glyph verbatim for a templateId outside the registry", () => {
    render(
      <ItemTile
        rarity="common"
        tier={1}
        glyph="🗡️"
        templateId="not_a_real_template_id"
        ariaLabel="unknown item"
      />,
    );
    expect(screen.getByText("🗡️")).not.toBeNull();
  });

  it("falls back to the glyph verbatim when no templateId is passed at all", () => {
    const { container } = render(<ItemTile rarity="common" tier={1} glyph="🛡" ariaLabel="shield" />);
    expect(screen.getByText("🛡")).not.toBeNull();
    expect(container.querySelector("svg")).toBeNull();
  });
});
