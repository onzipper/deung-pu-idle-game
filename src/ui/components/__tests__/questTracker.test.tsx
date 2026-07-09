// @vitest-environment jsdom
/**
 * R2.6 Wave 1 — regression coverage for `GoalLadder.tsx`'s new tabbed/tag-
 * grouped body (see that file's module doc):
 *  1. `[รายวัน]` daily lines render off a seeded `s.dailies` roster, contain
 *     NO claim button (claiming stays Quest-Board-only), and a complete-
 *     unclaimed row surfaces the "claim at the Village Chief" hint.
 *  2. The `[ปาร์ตี้]` tab shows the empty-hint when `s.party` is null, and
 *     real member rows once seeded.
 *  3. Switching to the party tab never unmounts the `goal-ladder`/
 *     `boss-panel`/`kill-progress` FTUE anchors (the quest tab stays
 *     mounted, just `hidden`-classed).
 *
 * Renders `GoalLadder` standalone (no portal/`GameHud` needed — it's a plain
 * component) inside a `NextIntlClientProvider`, same convention as
 * `gameHudLayout.test.tsx`.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { GoalLadder } from "@/ui/components/GoalLadder";
import { useGameStore } from "@/ui/store/gameStore";
import thMessages from "../../../../messages/th.json";

function renderLadder() {
  return render(
    <NextIntlClientProvider locale="th" messages={thMessages}>
      <GoalLadder />
    </NextIntlClientProvider>,
  );
}

function resetFields() {
  return {
    questTrackerCollapsed: false,
    onboardingStepIndex: -1,
    dailies: { serverDay: 0, quests: [] },
    party: null,
  };
}

beforeEach(() => {
  useGameStore.setState(resetFields());
});

afterEach(() => {
  cleanup();
  useGameStore.setState(resetFields());
});

describe("GoalLadder [รายวัน] daily lines", () => {
  it("renders seeded dailies with progress and NO claim button", () => {
    useGameStore.setState({
      dailies: {
        serverDay: 5,
        quests: [
          {
            id: "daily_kill",
            type: "killAnywhere",
            progress: 3,
            target: 10,
            claimed: false,
            complete: false,
            reward: { gold: 100 },
          },
        ],
      },
    });
    renderLadder();
    expect(screen.getByText("ล่ามอนสะสม")).not.toBeNull();
    expect(screen.getByText("3/10")).not.toBeNull();
    expect(screen.queryByRole("button", { name: /รับรางวัล/ })).toBeNull();
  });

  it("shows the Village-Chief claim hint for a complete-but-unclaimed quest", () => {
    useGameStore.setState({
      dailies: {
        serverDay: 5,
        quests: [
          {
            id: "daily_kill",
            type: "killAnywhere",
            progress: 10,
            target: 10,
            claimed: false,
            complete: true,
            reward: { gold: 100 },
          },
        ],
      },
    });
    renderLadder();
    expect(screen.getByText("รับรางวัลที่ผู้ใหญ่บ้าน")).not.toBeNull();
  });

  it("renders nothing for the daily tag when the roster is empty", () => {
    renderLadder();
    expect(screen.queryByText("[รายวัน]")).toBeNull();
  });
});

describe("GoalLadder [ปาร์ตี้] tab", () => {
  it("shows the empty-hint when not in a party", () => {
    renderLadder();
    fireEvent.click(screen.getByRole("tab", { name: "ปาร์ตี้" }));
    expect(screen.getByText("ยังไม่มีปาร์ตี้")).not.toBeNull();
  });

  it("renders member rows once a party is seeded", () => {
    useGameStore.setState({
      party: {
        partyId: "p1",
        leaderUserId: "u1",
        members: [
          {
            userId: "u1",
            displayName: "หัวหน้า",
            online: true,
            currentCharacter: { name: "Hero1", class: "swordsman", level: 42 },
            lastZone: null,
            title: null,
            champion: false,
          },
          {
            userId: "u2",
            displayName: "ลูกทีม",
            online: false,
            currentCharacter: null,
            lastZone: null,
            title: null,
            champion: false,
          },
        ],
      },
    });
    renderLadder();
    fireEvent.click(screen.getByRole("tab", { name: "ปาร์ตี้" }));
    expect(screen.getByText("หัวหน้า")).not.toBeNull();
    expect(screen.getByText("ลูกทีม")).not.toBeNull();
  });

  it("keeps goal-ladder/boss-panel/kill-progress anchors mounted while the party tab is active", () => {
    renderLadder();
    fireEvent.click(screen.getByRole("tab", { name: "ปาร์ตี้" }));
    expect(document.querySelector('[data-onboarding-anchor="goal-ladder"]')).not.toBeNull();
    expect(document.querySelector('[data-onboarding-anchor="boss-panel"]')).not.toBeNull();
    expect(document.querySelector('[data-onboarding-anchor="kill-progress"]')).not.toBeNull();
  });
});
