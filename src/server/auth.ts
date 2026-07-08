/**
 * Account / auth domain (M8 Phase 0).
 *
 * Registration is an OPTIONAL upgrade layered on the SAME anonymous `User` row the
 * identity cookie already names (see src/server/identity.ts) — a guest keeps every
 * character/save by construction because we only UPDATE their existing row, never
 * create a new one. The product is deliberately minimal (owner-approved):
 *   - the ONLY hard validation is a UNIQUE, format-sane email (no verification mail),
 *   - passwords have no complexity rules (non-empty is enough),
 *   - `registeredAt` null vs set is the guest-vs-account discriminator.
 *
 * Trust boundary: identity (`userId`) is always resolved from the httpOnly cookie by
 * the route handler and passed in here — never from the request body. Inputs are
 * strict-zod validated. Cookie WRITES live only in the route handlers (Next 16
 * footgun #8: no cookie mutation during RSC render); this module is pure DB logic +
 * crypto so it stays unit-testable with a mocked Prisma.
 *
 * Password hashing uses Node's built-in `crypto.scrypt` (no npm dep). The stored
 * string is self-describing: `scrypt$N$r$p$saltHex$keyHex` (≤255 chars → VarChar(255)),
 * so cost params travel with the hash and verification never guesses them.
 */

import {
  scrypt as scryptCb,
  randomBytes,
  randomInt,
  timingSafeEqual,
  type ScryptOptions,
  type BinaryLike,
} from "node:crypto";
import { promisify } from "node:util";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { serverDayFor } from "@/server/dailyQuests";

// ── Password hashing (scrypt, self-describing) ───────────────────────────────

const scrypt = promisify(scryptCb) as (
  password: BinaryLike,
  salt: BinaryLike,
  keylen: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/** scrypt cost params. N must be a power of two; these fit Node's default maxmem. */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32, saltBytes: 16 } as const;

/**
 * Hash a plaintext password into a self-describing `scrypt$N$r$p$saltHex$keyHex`
 * string (≤255 chars). A fresh random salt is drawn per call, so equal passwords
 * never yield equal hashes.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT.saltBytes);
  const key = await scrypt(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/**
 * Constant-time verify of a plaintext password against a stored hash string.
 * Re-derives with the salt + cost params baked into the string and compares with
 * `timingSafeEqual`. Any malformed/unknown-format stored value verifies to false.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const [, nStr, rStr, pStr, saltHex, keyHex] = parts;
    const N = Number(nStr);
    const r = Number(rStr);
    const p = Number(pStr);
    if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;
    const key = Buffer.from(keyHex, "hex");
    if (key.length === 0) return false;
    const derived = await scrypt(password, Buffer.from(saltHex, "hex"), key.length, { N, r, p });
    if (derived.length !== key.length) return false;
    return timingSafeEqual(derived, key);
  } catch {
    return false;
  }
}

// ── Friend code minting ──────────────────────────────────────────────────────

/**
 * Unambiguous uppercase alphanumeric alphabet: digits 0/1 and letters I/L/O are
 * removed so a shared code can't be mis-typed. 31 symbols.
 */
const FRIEND_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const FRIEND_CODE_LEN = 8;
/** How many fresh codes to try before giving up (collision odds are astronomically low). */
const FRIEND_CODE_ATTEMPTS = 8;

/** Generate one crypto-random friend code (unbiased via `randomInt`). */
export function generateFriendCode(len: number = FRIEND_CODE_LEN): string {
  let out = "";
  for (let i = 0; i < len; i++) out += FRIEND_ALPHABET[randomInt(FRIEND_ALPHABET.length)];
  return out;
}

// ── Input validation ─────────────────────────────────────────────────────────

/** Trim + lowercase, then require a format-sane email (the one hard product rule). */
const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("enter a valid email").max(254));

/** No complexity rules by owner decree — non-empty is enough (upper bound is DoS sanity). */
const passwordSchema = z.string().min(1, "password required").max(200);

/**
 * Optional handle. Trimmed and CLAMPED (truncated) to 24 chars to fit VarChar(24);
 * blank/absent → null. Lenient by design (unlike the strict Character.name rule).
 */
const displayNameSchema = z
  .string()
  .max(200)
  .optional()
  .nullable()
  .transform((v) => {
    const t = (v ?? "").trim().slice(0, 24);
    return t.length > 0 ? t : null;
  });

export const registerSchema = z
  .object({ email: emailSchema, password: passwordSchema, displayName: displayNameSchema })
  .strict();

export const loginSchema = z.object({ email: emailSchema, password: passwordSchema }).strict();

/**
 * displayName RENAME body. Reuses the SAME trim + clamp-to-24 shape as the
 * registration `displayNameSchema`, but a rename must be NON-EMPTY (you cannot
 * rename yourself to blank — unlike registration, where an absent handle is a
 * valid null). VarChar(24) is utf8mb4 so Thai is safe; no charset restriction
 * (matches registration's lenient handle rule — the strict alnum rule is the
 * Character.name gate, not the account handle's).
 */
export const renameDisplayNameSchema = z
  .object({
    displayName: z
      .string()
      .max(200)
      .transform((v) => v.trim().slice(0, 24))
      .pipe(z.string().min(1, "display name required")),
  })
  .strict();

export type RenameDisplayNameInput = z.infer<typeof renameDisplayNameSchema>;

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

// ── Domain results ───────────────────────────────────────────────────────────

export type RegisterResult =
  | { ok: true; userId: string; friendCode: string; displayName: string | null; email: string }
  | { ok: false; code: "email_taken" | "already_registered" };

export type LoginResult = { ok: true; userId: string } | { ok: false; code: "bad_credentials" };

export interface AccountInfo {
  registered: boolean;
  email: string | null;
  displayName: string | null;
  friendCode: string | null;
}

/** Match a P2002 unique-violation on a specific field (MySQL may name the index, so substring). */
function isUniqueViolation(err: unknown, field: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return false;
  const target = (err.meta as { target?: string[] | string } | undefined)?.target;
  if (!target) return false;
  const list = Array.isArray(target) ? target : [target];
  return list.some((t) => t.includes(field));
}

// ── Register / Login / Me ────────────────────────────────────────────────────

/**
 * Claim the account layer on the CURRENT user row (`userId` from the cookie).
 * Guest → account IN PLACE, so saves/characters survive. A row that already has
 * `registeredAt` set is rejected (`already_registered`); a taken email is rejected
 * (`email_taken`, pre-checked AND caught as a race backstop). The friend code is
 * minted with a collision-retry loop against its unique index.
 */
export async function registerAccount(
  userId: string,
  input: RegisterInput,
): Promise<RegisterResult> {
  const current = await prisma.user.findUnique({
    where: { id: userId },
    select: { registeredAt: true },
  });
  if (current?.registeredAt) return { ok: false, code: "already_registered" };

  // Clean pre-check for a friendly 409 (the unique index is still the real guard below).
  const emailOwner = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true },
  });
  if (emailOwner && emailOwner.id !== userId) return { ok: false, code: "email_taken" };

  const passwordHash = await hashPassword(input.password);
  const displayName = input.displayName;

  for (let attempt = 0; attempt < FRIEND_CODE_ATTEMPTS; attempt++) {
    const friendCode = generateFriendCode();
    try {
      await prisma.user.update({
        where: { id: userId },
        data: { email: input.email, passwordHash, displayName, friendCode, registeredAt: new Date() },
      });
      return { ok: true, userId, friendCode, displayName, email: input.email };
    } catch (err) {
      if (isUniqueViolation(err, "friendCode")) continue; // collision → retry with a fresh code
      if (isUniqueViolation(err, "email")) return { ok: false, code: "email_taken" };
      throw err;
    }
  }
  throw new Error("failed to mint a unique friend code");
}

/**
 * Verify email + password. Returns the matching account's `userId` on success; the
 * route then repoints the identity cookie to it (and clears the active-character
 * cookie, which may name another account's character). Unregistered rows / rows
 * without a password hash verify as `bad_credentials` (never 500).
 */
export async function loginAccount(input: LoginInput): Promise<LoginResult> {
  const user = await prisma.user.findUnique({
    where: { email: input.email },
    select: { id: true, passwordHash: true, registeredAt: true },
  });
  if (!user || !user.registeredAt || !user.passwordHash) return { ok: false, code: "bad_credentials" };
  const ok = await verifyPassword(input.password, user.passwordHash);
  if (!ok) return { ok: false, code: "bad_credentials" };
  return { ok: true, userId: user.id };
}

export type RenameDisplayNameResult =
  | { ok: true; displayName: string }
  | { ok: false; code: "rename_cooldown" | "account_required" };

/**
 * Self-service displayName rename, limited to ONCE per Asia/Bangkok server-day.
 * Only registered accounts have a displayName (a guest has none), so an
 * unregistered row is rejected `account_required`. The once/day guard is an
 * ATOMIC compare-and-set: a single guarded `updateMany` writes the new name +
 * today's `renameDay` ONLY when `renameDay` is null or a prior day — a second
 * rename the same day matches zero rows (`count === 0`) → `rename_cooldown`, so
 * two concurrent requests can never both succeed. The server computes the day
 * from its own wall-clock (client clocks never trusted, like SaveState.lastSeen).
 * displayName is NOT unique in the schema (friendCode is the real handle), so no
 * collision check is needed.
 */
export async function renameDisplayName(
  userId: string,
  displayName: string,
  now: Date = new Date(),
): Promise<RenameDisplayNameResult> {
  const today = serverDayFor(now);
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { registeredAt: true },
  });
  if (!user?.registeredAt) return { ok: false, code: "account_required" };
  const res = await prisma.user.updateMany({
    where: { id: userId, OR: [{ renameDay: null }, { renameDay: { not: today } }] },
    data: { displayName, renameDay: today },
  });
  if (res.count === 0) return { ok: false, code: "rename_cooldown" };
  return { ok: true, displayName };
}

/** The Settings → My Account read model for the current identity cookie. */
export async function getAccountInfo(userId: string): Promise<AccountInfo> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, displayName: true, friendCode: true, registeredAt: true },
  });
  return {
    registered: Boolean(user?.registeredAt),
    email: user?.email ?? null,
    displayName: user?.displayName ?? null,
    friendCode: user?.friendCode ?? null,
  };
}
