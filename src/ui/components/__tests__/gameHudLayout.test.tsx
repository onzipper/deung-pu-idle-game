// @vitest-environment jsdom
/**
 * R2-W2 "fullscreen HUD" — RTL smoke test. Mounts the REAL `GameHud` tree
 * (fresh/default zustand store, no hero yet — the same state a brand-new
 * boot sees before the first engine snapshot arrives) and asserts:
 *  1. it renders without throwing,
 *  2. every FTUE `data-onboarding-anchor` value `steps.ts` references
 *     resolves to a real DOM element (the main risk this rewrite carries —
 *     see the task brief's "FTUE anchors" section),
 *  3. the `GoalLadder` portal (`goal-ladder` anchor) mounts at a mobile
 *     viewport width too (the `md:`-only gate was removed this wave).
 *
 * `window.matchMedia` is polyfilled (jsdom doesn't implement it — needed by
 * `useMediaQuery.ts`, always reporting `matches: false` = mobile-first
 * default, matching the SSR/first-paint value the real app also starts
 * from). `fetch` is stubbed to reject so `FriendsButton`'s always-on poll
 * hook never attempts a real network call during the test.
 */

import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { GameHud } from "@/ui/components/GameHud";
import { ONBOARDING_STEPS, type OnboardingAnchor } from "@/ui/onboarding/steps";
// Same relative-import convention as `onboarding/__tests__/tips.test.ts`.
import thMessages from "../../../../messages/th.json";

beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) =>
      ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList) as typeof window.matchMedia;
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new Error("network disabled in gameHudLayout smoke test"))),
  );
});

afterEach(() => {
  cleanup();
});

function renderHud() {
  return render(
    <NextIntlClientProvider locale="th" messages={thMessages}>
      <GameHud />
    </NextIntlClientProvider>,
  );
}

describe("GameHud fullscreen layout (R2-W2 smoke test)", () => {
  it("renders the canvas mount seam + overlay regions without throwing", () => {
    const { container } = renderHud();
    expect(container.querySelector("div")).not.toBeNull();
  });

  it('every ONBOARDING_STEPS anchor resolves to a DOM element via [data-onboarding-anchor="…"]', () => {
    renderHud();
    const anchors = new Set(
      ONBOARDING_STEPS.map((s) => s.anchor).filter((a): a is OnboardingAnchor => Boolean(a)),
    );
    expect(anchors.size).toBeGreaterThan(0);
    for (const anchor of anchors) {
      const el = document.querySelector(`[data-onboarding-anchor="${anchor}"]`);
      expect(el, `anchor "${anchor}" should resolve to a DOM element`).not.toBeNull();
    }
  });

  it("mounts the GoalLadder portal (goal-ladder anchor) at a mobile viewport width", () => {
    // `matchMedia` is polyfilled to always report `matches: false` above —
    // `GoalLadderOverlaySlot`'s `isDesktop` reads false, so `GoalLadder`
    // mounts in its `compact` (mobile, collapsed-by-default) presentation.
    renderHud();
    const goalLadder = document.querySelector('[data-onboarding-anchor="goal-ladder"]');
    expect(goalLadder).not.toBeNull();
  });
});
