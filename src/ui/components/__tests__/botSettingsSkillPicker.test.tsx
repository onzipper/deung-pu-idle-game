// @vitest-environment jsdom
/**
 * Issue #58 item 1 (#54 audit reskin) — `BotSettingsModal.tsx`'s
 * `SkillAutoSlotPicker` rebuilt as a compact icon-tile row matching
 * `SkillBar.tsx`'s tile language (numbered ordinal badge, ring + ✓ badge for
 * the auto-enabled state). This test only covers the PRESENTATION change:
 * N skill tiles render with slot numbers, and tapping a tile still fires the
 * exact same `setAutoSlot` store action the old checklist row used (same
 * `pendingInput.setAutoSlots` queue, no new automation surface). Same
 * `NextIntlClientProvider` + real-store mounting convention as
 * `inventoryAllTab.test.tsx` (`makeHero` fixture mirrored from there).
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { BotSettingsModal } from "@/ui/components/BotSettingsModal";
import { useGameStore, type HeroSummary, type SkillSummary } from "@/ui/store/gameStore";
import thMessages from "../../../../messages/th.json";

function makeSkill(overrides: Partial<SkillSummary> = {}): SkillSummary {
  return {
    id: "sword_whirl",
    cd: 0,
    maxCd: 5,
    cost: 10,
    ready: true,
    affordable: true,
    autoSlot: null,
    ...overrides,
  };
}

function makeHero(overrides: Partial<HeroSummary> = {}): HeroSummary {
  return {
    cls: "swordsman",
    hp: 100,
    maxHp: 100,
    x: 0,
    skillCd: 0,
    atkBuffMult: 1,
    atkBuffTimer: 0,
    mana: 50,
    maxMana: 50,
    skills: [
      makeSkill({ id: "sword_whirl", autoSlot: 0 }),
      makeSkill({ id: "sword_warcry", autoSlot: null }),
    ],
    autoSlots: [null, null, null],
    unlockedSlots: 2,
    dead: false,
    level: 10,
    xpProgress: 0.2,
    atLevelCap: false,
    tier: 1,
    canEvolve: false,
    quest: null,
    statPoints: 0,
    stats: { str: 10, dex: 10, int: 10, vit: 10 },
    primaryStat: "str",
    combatPower: 0,
    equipped: { weapon: null, armor: null },
    hasCommand: false,
    ...overrides,
  };
}

beforeEach(() => {
  useGameStore.setState({
    heroes: [makeHero()],
    autoHunt: true,
    pendingInput: { ...useGameStore.getState().pendingInput, setAutoSlots: [] },
  });
});

afterEach(() => {
  cleanup();
  useGameStore.setState({ heroes: [] });
});

function renderModal() {
  return render(
    <NextIntlClientProvider locale="th" messages={thMessages}>
      <BotSettingsModal onClose={() => {}} />
    </NextIntlClientProvider>,
  );
}

describe("SkillAutoSlotPicker tile reskin (issue #58 item 1)", () => {
  it("renders one tile per learned skill, each carrying its 1-based slot number", () => {
    renderModal();
    // Two learned skills in the fixture -> ordinal badges "1" and "2".
    expect(screen.getByText("1")).not.toBeNull();
    expect(screen.getByText("2")).not.toBeNull();
  });

  it("marks the already-slotted skill as auto-enabled (aria-pressed)", () => {
    renderModal();
    const slottedTile = screen.getByRole("button", { name: /หมุนฟัน/ });
    expect(slottedTile.getAttribute("aria-pressed")).toBe("true");
    const unslottedTile = screen.getByRole("button", { name: /ตะโกนศึก/ });
    expect(unslottedTile.getAttribute("aria-pressed")).toBe("false");
  });

  it("tapping a tile fires the same setAutoSlot store action as before", () => {
    renderModal();
    const unslottedTile = screen.getByRole("button", { name: /ตะโกนศึก/ });
    fireEvent.click(unslottedTile);
    // The fixture's `autoSlots` array (independent from `skill.autoSlot`
    // display state) has slot 0 free, so the picker's "first free slot"
    // toggle lands there.
    expect(useGameStore.getState().pendingInput.setAutoSlots).toContainEqual({
      slot: 0,
      skillId: "sword_warcry",
    });
  });

  it("tapping the slotted tile clears its auto-cast slot via the same action", () => {
    renderModal();
    const slottedTile = screen.getByRole("button", { name: /หมุนฟัน/ });
    fireEvent.click(slottedTile);
    expect(useGameStore.getState().pendingInput.setAutoSlots).toContainEqual({
      slot: 0,
      skillId: null,
    });
  });
});
