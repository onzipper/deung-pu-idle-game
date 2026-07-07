import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * M8 Quest Wave B — the save endpoint must piggyback today's daily roster onto its
 * response (zero extra client requests; the client fires the engine `setDailies` from
 * it). We mock the identity/character/items collaborators and assert the GET response
 * carries a well-formed `dailies` block. The no-character branch is used because it
 * short-circuits before the (heavier) save/inventory load, yet still returns the roster.
 */

vi.mock("@/server/identity", () => ({ getOrCreateUserId: vi.fn(async () => "user_abc") }));
vi.mock("@/server/activeCharacter", () => ({ resolveActiveCharacterId: vi.fn(async () => null) }));
vi.mock("@/server/characters", () => ({ getOwnedLiveCharacterClass: vi.fn() }));
vi.mock("@/server/save", () => ({ loadSave: vi.fn(), persistSave: vi.fn() }));
vi.mock("@/server/items", () => ({
  loadInventory: vi.fn(),
  equippedLoadoutFrom: vi.fn(),
  loadMaterials: vi.fn(),
  recentAnnouncements: vi.fn(async () => []),
}));
vi.mock("@/server/uiConfig", () => ({ loadUiConfig: vi.fn() }));
vi.mock("@/server/buildId", () => ({ currentBuildId: vi.fn(() => "test-build") }));

import { GET } from "@/app/api/save/route";
import { rosterFor } from "@/server/dailyQuests";

describe("GET /api/save — daily roster piggyback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns a { serverDay, questIds } dailies block for the user", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dailies).toBeDefined();
    expect(typeof body.dailies.serverDay).toBe("number");
    expect(Array.isArray(body.dailies.questIds)).toBe(true);
    expect(body.dailies.questIds.length).toBeGreaterThan(0);
    // The roster must be the deterministic one for this user + the returned server day
    // (no time race: we re-derive from the serverDay the response itself carries).
    expect(body.dailies.questIds).toEqual(rosterFor(body.dailies.serverDay, "user_abc"));
  });
});
