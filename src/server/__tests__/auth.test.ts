import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Account / auth domain tests (M8 Phase 0). Prisma is mocked (no DB), the same
 * pattern as characters.test.ts / items.test.ts. These exercise the pure logic the
 * DB can't: scrypt hash/verify, the friend-code alphabet + collision-retry loop, and
 * the guest-upgrade-in-place / duplicate-email / already-registered / login gates.
 */

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

import { Prisma } from "@prisma/client";
import {
  hashPassword,
  verifyPassword,
  generateFriendCode,
  registerAccount,
  loginAccount,
  getAccountInfo,
} from "@/server/auth";

const USER = "user_guest_1";

function p2002(target: string) {
  return new Prisma.PrismaClientKnownRequestError("unique", {
    code: "P2002",
    clientVersion: "6",
    meta: { target: [target] },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("hashPassword / verifyPassword", () => {
  it("round-trips a correct password and rejects a wrong one", async () => {
    const hash = await hashPassword("hunter2");
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash.length).toBeLessThanOrEqual(255);
    expect(await verifyPassword("hunter2", hash)).toBe(true);
    expect(await verifyPassword("Hunter2", hash)).toBe(false);
    expect(await verifyPassword("", hash)).toBe(false);
  });

  it("salts each hash (equal passwords -> different strings)", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
    expect(await verifyPassword("same", a)).toBe(true);
    expect(await verifyPassword("same", b)).toBe(true);
  });

  it("returns false for a malformed/unknown stored hash (never throws)", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
    expect(await verifyPassword("x", "bcrypt$1$2$3$4$5")).toBe(false);
    expect(await verifyPassword("x", "")).toBe(false);
  });
});

describe("generateFriendCode", () => {
  it("is 8 chars from the unambiguous alphabet (no 0/1/I/L/O)", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateFriendCode();
      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[2-9A-HJ-NP-Z]+$/);
      expect(code).not.toMatch(/[01ILO]/);
    }
  });
});

describe("registerAccount — bind in place", () => {
  it("binds onto the existing guest user id and returns a friend code", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ registeredAt: null }) // current row: still a guest
      .mockResolvedValueOnce(null); // no other row owns the email
    mockPrisma.user.update.mockResolvedValue({});

    const r = await registerAccount(USER, {
      email: "me@example.com",
      password: "pw",
      displayName: "Nong",
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.userId).toBe(USER);
      expect(r.friendCode).toMatch(/^[2-9A-HJ-NP-Z]{8}$/);
      expect(r.displayName).toBe("Nong");
    }
    // Upgrade is an UPDATE on the SAME row (guest keeps characters/saves).
    const args = mockPrisma.user.update.mock.calls[0][0];
    expect(args.where).toEqual({ id: USER });
    expect(args.data.email).toBe("me@example.com");
    expect(args.data.registeredAt).toBeInstanceOf(Date);
    expect(typeof args.data.passwordHash).toBe("string");
  });

  it("retries with a fresh friend code on a P2002 friendCode collision", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ registeredAt: null })
      .mockResolvedValueOnce(null);
    mockPrisma.user.update
      .mockRejectedValueOnce(p2002("friendCode")) // first code collides
      .mockResolvedValueOnce({}); // retry succeeds

    const r = await registerAccount(USER, { email: "a@b.com", password: "pw", displayName: null });
    expect(r.ok).toBe(true);
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(2);
  });

  it("rejects a duplicate email (typed email_taken, pre-check)", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ registeredAt: null })
      .mockResolvedValueOnce({ id: "someone_else" }); // email already owned
    const r = await registerAccount(USER, { email: "taken@b.com", password: "pw", displayName: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("email_taken");
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("maps a P2002 email race to email_taken", async () => {
    mockPrisma.user.findUnique
      .mockResolvedValueOnce({ registeredAt: null })
      .mockResolvedValueOnce(null);
    mockPrisma.user.update.mockRejectedValueOnce(p2002("email"));
    const r = await registerAccount(USER, { email: "race@b.com", password: "pw", displayName: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("email_taken");
  });

  it("rejects re-registering an already-registered account", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce({ registeredAt: new Date() });
    const r = await registerAccount(USER, { email: "again@b.com", password: "pw", displayName: null });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("already_registered");
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

describe("loginAccount", () => {
  it("verifies and returns the account user id", async () => {
    const passwordHash = await hashPassword("secret");
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user_acct_9",
      passwordHash,
      registeredAt: new Date(),
    });
    const r = await loginAccount({ email: "acct@b.com", password: "secret" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.userId).toBe("user_acct_9");
  });

  it("rejects a wrong password", async () => {
    const passwordHash = await hashPassword("secret");
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user_acct_9",
      passwordHash,
      registeredAt: new Date(),
    });
    const r = await loginAccount({ email: "acct@b.com", password: "WRONG" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("bad_credentials");
  });

  it("rejects an unknown / unregistered email", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    expect((await loginAccount({ email: "nobody@b.com", password: "x" })).ok).toBe(false);
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "guest",
      passwordHash: null,
      registeredAt: null,
    });
    expect((await loginAccount({ email: "guest@b.com", password: "x" })).ok).toBe(false);
  });
});

describe("getAccountInfo", () => {
  it("reports a registered account's fields", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      email: "me@b.com",
      displayName: "Nong",
      friendCode: "ABCD2345",
      registeredAt: new Date(),
    });
    expect(await getAccountInfo(USER)).toEqual({
      registered: true,
      email: "me@b.com",
      displayName: "Nong",
      friendCode: "ABCD2345",
    });
  });

  it("reports a guest as unregistered with null fields", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      email: null,
      displayName: null,
      friendCode: null,
      registeredAt: null,
    });
    expect(await getAccountInfo(USER)).toEqual({
      registered: false,
      email: null,
      displayName: null,
      friendCode: null,
    });
  });
});
