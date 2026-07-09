// @vitest-environment jsdom
/**
 * R3 "tap profile" (issue #50 Wave 5) — presentation coverage for
 * `GhostProfileCard.tsx`: renders name/class/tier through `ModalPortal`
 * (into `document.body`, same convention as `HofProfileModal.tsx`), and the
 * close button fires `onClose` — no store, no fetch, purely presentational.
 * Same `NextIntlClientProvider` + real-messages mounting convention as
 * `botSettingsSkillPicker.test.tsx` / `questTracker.test.tsx`.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { GhostProfileCard } from "@/ui/components/GhostProfileCard";
import thMessages from "../../../../messages/th.json";

function renderCard(overrides: Partial<Parameters<typeof GhostProfileCard>[0]> = {}) {
  const onClose = vi.fn();
  render(
    <NextIntlClientProvider locale="th" messages={thMessages}>
      <GhostProfileCard
        name="เพื่อนบ้าน"
        cls="archer"
        tier={2}
        onClose={onClose}
        {...overrides}
      />
    </NextIntlClientProvider>,
  );
  return { onClose };
}

afterEach(() => {
  cleanup();
});

describe("GhostProfileCard", () => {
  it("renders the player's name and its class/tier display name", () => {
    renderCard();
    expect(screen.getByText("เพื่อนบ้าน")).not.toBeNull();
    // tier 2 archer -> content.classes.archer.evolvedName
    expect(screen.getByText("นายพราน")).not.toBeNull();
    expect(screen.getByRole("dialog")).not.toBeNull();
  });

  it("tier 1 falls back to the base class name, tier 3 to the tier3 name", () => {
    const { unmount } = render(
      <NextIntlClientProvider locale="th" messages={thMessages}>
        <GhostProfileCard name="A" cls="swordsman" tier={1} onClose={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("นักดาบ")).not.toBeNull();
    unmount();

    render(
      <NextIntlClientProvider locale="th" messages={thMessages}>
        <GhostProfileCard name="B" cls="swordsman" tier={3} onClose={() => {}} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText("จอมอัศวิน")).not.toBeNull();
  });

  it("has no add-friend/invite/whisper actions — only the close affordance", () => {
    renderCard();
    // Two elements carry the close label: the backdrop button and the header
    // ✕ button (both `aria-label`/text include t("closeButton")).
    const closeControls = screen.getAllByRole("button");
    expect(closeControls.length).toBe(2);
  });

  it("close button fires onClose", () => {
    const { onClose } = renderCard();
    // Both the backdrop and the header ✕ button share the "ปิด" label — either
    // one is a valid close affordance; assert the header button specifically.
    const closeBtn = screen.getByText("✕ ปิด");
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
