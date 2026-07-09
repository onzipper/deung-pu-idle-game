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
 * R2.6 Wave 1 additions: the whole-card collapse is now driven by the
 * persisted `questTrackerCollapsed` store field rather than a mobile-only
 * `compact` prop — anchors nested inside the (now viewport-independent)
 * collapsible body must keep resolving even while collapsed, and the FTUE
 * must force BOTH the card open AND the `เควส` tab active (never `ปาร์ตี้`).
 *
 * R2.6 Wave 2 additions: the bottom-center skill/bot/potion dock
 * (`SkillDock.tsx`) gets the SAME persisted whole-card collapse via
 * `skillDockCollapsed`, EXCEPT the bot MASTER switch (`bot-master` anchor)
 * must stay VISIBLE (never `hidden`-classed) even while collapsed — it's the
 * one control the collapsed thin strip keeps tappable by design.
 *
 * `window.matchMedia` is polyfilled (jsdom doesn't implement it — needed by
 * `useMediaQuery.ts`, always reporting `matches: false` = mobile-first
 * default, matching the SSR/first-paint value the real app also starts
 * from). `fetch` is stubbed to reject so `FriendsButton`'s always-on poll
 * hook never attempts a real network call during the test.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { GameHud } from "@/ui/components/GameHud";
import { ONBOARDING_STEPS, type OnboardingAnchor } from "@/ui/onboarding/steps";
import { useGameStore } from "@/ui/store/gameStore";
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
  useGameStore.setState({
    questTrackerCollapsed: false,
    skillDockCollapsed: false,
    onboardingStepIndex: -1,
  });
});

beforeEach(() => {
  useGameStore.setState({
    questTrackerCollapsed: false,
    skillDockCollapsed: false,
    onboardingStepIndex: -1,
  });
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
    renderHud();
    const goalLadder = document.querySelector('[data-onboarding-anchor="goal-ladder"]');
    expect(goalLadder).not.toBeNull();
  });

  it("R2.6: goal-ladder/boss-panel/kill-progress anchors still resolve while questTrackerCollapsed=true", () => {
    useGameStore.setState({ questTrackerCollapsed: true });
    renderHud();
    for (const anchor of ["goal-ladder", "boss-panel", "kill-progress"] as const) {
      expect(
        document.querySelector(`[data-onboarding-anchor="${anchor}"]`),
        `anchor "${anchor}" should still resolve while collapsed`,
      ).not.toBeNull();
    }
  });

  it("R2.6: FTUE force-expands the collapsed tracker and force-selects the เควส tab", () => {
    useGameStore.setState({ questTrackerCollapsed: true, onboardingStepIndex: 0 });
    renderHud();
    // FTUE-forced expansion means the body isn't `hidden` — the boss-panel
    // anchor (inside the [รอง] tag, quest tab) must resolve to a VISIBLE
    // element, not just be present with a `hidden` ancestor class.
    const bossPanel = document.querySelector('[data-onboarding-anchor="boss-panel"]');
    expect(bossPanel).not.toBeNull();
    const hiddenAncestor = bossPanel?.closest(".hidden");
    expect(hiddenAncestor).toBeNull();
  });

  it("R2.6 W2: skill-bar/bot-master/consumables anchors still resolve while skillDockCollapsed=true", () => {
    useGameStore.setState({ skillDockCollapsed: true });
    renderHud();
    for (const anchor of ["skill-bar", "bot-master", "consumables"] as const) {
      expect(
        document.querySelector(`[data-onboarding-anchor="${anchor}"]`),
        `anchor "${anchor}" should still resolve while the dock is collapsed`,
      ).not.toBeNull();
    }
  });

  it("R2.6 W2: bot-master stays VISIBLE (not hidden-classed) while the dock is collapsed", () => {
    useGameStore.setState({ skillDockCollapsed: true });
    renderHud();
    const botMaster = document.querySelector('[data-onboarding-anchor="bot-master"]');
    expect(botMaster).not.toBeNull();
    expect(botMaster?.closest(".hidden")).toBeNull();
  });

  it("R2.6 W2: FTUE force-expands the collapsed skill dock", () => {
    useGameStore.setState({ skillDockCollapsed: true, onboardingStepIndex: 0 });
    renderHud();
    const skillBar = document.querySelector('[data-onboarding-anchor="skill-bar"]');
    expect(skillBar).not.toBeNull();
    expect(skillBar?.closest(".hidden")).toBeNull();
    const consumables = document.querySelector('[data-onboarding-anchor="consumables"]');
    expect(consumables).not.toBeNull();
    expect(consumables?.closest(".hidden")).toBeNull();
  });
});
