import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * M8 Quest Wave B — server calendar + claim-audit trust-boundary tests. Prisma is mocked
 * (no DB), the same unit style as the rest of `server/`. We exercise the invariants the
 * server owns: the Asia/Bangkok (UTC+7) day boundary, deterministic per-user roster
 * selection, and the anti-double-claim gate (roster membership + P2002 idempotency).
 */

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    dailyClaim: { create: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import { Prisma } from "@prisma/client";
import { CONFIG } from "@/engine/config";
import {
  serverDayFor,
  rosterFor,
  rosterSize,
  dailyRosterPayload,
  isDailyQuestId,
  recordDailyClaim,
  DAILY_TZ_OFFSET_SECONDS,
} from "@/server/dailyQuests";

function p2002(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.19.3",
    meta: { target: ["characterId", "questId", "serverDay"] },
  });
}

const CHAR = "char_1";
const USER = "user_abc";

describe("serverDayFor — Asia/Bangkok (UTC+7) boundary", () => {
  it("uses a +7h offset (7*3600 seconds)", () => {
    expect(DAILY_TZ_OFFSET_SECONDS).toBe(7 * 3600);
  });

  it("rolls the day over at 00:00 Bangkok = 17:00 UTC the prior day", () => {
    // 2026-07-07 16:59:59 UTC = 23:59:59 Bangkok (still day N)
    const before = serverDayFor(new Date("2026-07-07T16:59:59Z"));
    // 2026-07-07 17:00:00 UTC = 00:00:00 Bangkok next day (day N+1)
    const after = serverDayFor(new Date("2026-07-07T17:00:00Z"));
    expect(after).toBe(before + 1);
  });

  it("is stable across the whole Bangkok day (17:00Z .. next 16:59Z)", () => {
    const a = serverDayFor(new Date("2026-07-07T17:00:00Z"));
    const b = serverDayFor(new Date("2026-07-08T10:30:00Z"));
    const c = serverDayFor(new Date("2026-07-08T16:59:00Z"));
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("matches floor((unix + 7h) / 86400)", () => {
    const now = new Date("2026-07-07T12:00:00Z");
    const expected = Math.floor((now.getTime() / 1000 + 7 * 3600) / 86400);
    expect(serverDayFor(now)).toBe(expected);
  });
});

describe("rosterFor — deterministic per (serverDay, userId)", () => {
  const day = serverDayFor(new Date("2026-07-07T12:00:00Z"));

  it("returns exactly rosterSize distinct catalog ids", () => {
    const roster = rosterFor(day, USER);
    expect(roster).toHaveLength(rosterSize());
    expect(new Set(roster).size).toBe(roster.length); // distinct
    for (const id of roster) expect(isDailyQuestId(id)).toBe(true);
  });

  it("is identical for the same day + user (auditable / un-rerollable)", () => {
    expect(rosterFor(day, USER)).toEqual(rosterFor(day, USER));
  });

  it("differs across users on the same day (seed mixes the user in)", () => {
    // Probe enough distinct users that at least one roster diverges (5-entry catalog,
    // choose 3 → many possible rosters; a fixed roster for all users would be a bug).
    const base = rosterFor(day, "user_0");
    const others = Array.from({ length: 24 }, (_, i) => rosterFor(day, `user_${i + 1}`));
    expect(others.some((r) => JSON.stringify(r) !== JSON.stringify(base))).toBe(true);
  });

  it("rotates across days for a fixed user", () => {
    const rosters = Array.from({ length: 24 }, (_, i) => rosterFor(day + i, USER));
    const distinct = new Set(rosters.map((r) => JSON.stringify(r)));
    expect(distinct.size).toBeGreaterThan(1);
  });

  it("only ever picks real catalog ids", () => {
    const catalog = new Set(Object.keys(CONFIG.dailyQuests.catalog));
    for (let d = day; d < day + 40; d++) {
      for (const id of rosterFor(d, USER)) expect(catalog.has(id)).toBe(true);
    }
  });
});

describe("dailyRosterPayload — the save/boot piggyback", () => {
  it("carries { serverDay, questIds } computed from the instant + user", () => {
    const now = new Date("2026-07-07T12:00:00Z");
    const payload = dailyRosterPayload(USER, now);
    expect(payload.serverDay).toBe(serverDayFor(now));
    expect(payload.questIds).toEqual(rosterFor(payload.serverDay, USER));
    expect(payload.questIds).toHaveLength(rosterSize());
  });
});

describe("recordDailyClaim — the anti-double-claim gate", () => {
  beforeEach(() => {
    mockPrisma.dailyClaim.create.mockReset();
  });

  const now = new Date("2026-07-07T12:00:00Z");
  const day = serverDayFor(now);
  const inRoster = rosterFor(day, USER)[0];

  it("happy path: inserts a claim and returns ok + serverDay", async () => {
    mockPrisma.dailyClaim.create.mockResolvedValue({ id: "claim_1" });
    const res = await recordDailyClaim(CHAR, USER, inRoster, now);
    expect(res).toEqual({ ok: true, serverDay: day });
    expect(mockPrisma.dailyClaim.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { characterId: CHAR, questId: inRoster, serverDay: day },
      }),
    );
  });

  it("rejects a quest not in today's roster WITHOUT touching the DB", async () => {
    const notInRoster = Object.keys(CONFIG.dailyQuests.catalog).find(
      (id) => !rosterFor(day, USER).includes(id),
    )!;
    const res = await recordDailyClaim(CHAR, USER, notInRoster, now);
    expect(res).toEqual({ ok: false, code: "not_in_roster" });
    expect(mockPrisma.dailyClaim.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown/forged quest id (never in any roster)", async () => {
    const res = await recordDailyClaim(CHAR, USER, "daily_forged", now);
    expect(res).toEqual({ ok: false, code: "not_in_roster" });
    expect(mockPrisma.dailyClaim.create).not.toHaveBeenCalled();
  });

  it("maps a P2002 unique collision to already_claimed (double-claim)", async () => {
    mockPrisma.dailyClaim.create.mockRejectedValue(p2002());
    const res = await recordDailyClaim(CHAR, USER, inRoster, now);
    expect(res).toEqual({ ok: false, code: "already_claimed" });
  });

  it("re-throws a non-P2002 DB error (not swallowed as a claim result)", async () => {
    mockPrisma.dailyClaim.create.mockRejectedValue(new Error("connection lost"));
    await expect(recordDailyClaim(CHAR, USER, inRoster, now)).rejects.toThrow("connection lost");
  });
});
