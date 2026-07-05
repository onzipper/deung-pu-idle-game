/**
 * Client-side mirror of the server's character-name rules
 * (`nameSchema` in `@/server/characters`, docs/persistence-m5.md).
 *
 * Deliberately NOT imported from `@/server/characters`: that module pulls in
 * `@/lib/db` (Prisma) at module scope, which is server-only and must never
 * land in a client bundle. This is a small, dependency-free duplicate kept
 * in sync by hand — the two are unlikely to drift since the rule itself
 * (2-24 chars, Thai/EN letters + digits, no punctuation/spaces) is stable
 * product policy, and the server is the actual source of truth: this only
 * powers the live "would this be accepted" hint + reduces round-trip 400s,
 * it never replaces the server's own validation.
 *
 * Pure, framework-free — safe to unit test headlessly (see
 * `__tests__/validateName.test.ts`).
 */

export const NAME_MIN_LENGTH = 2;
export const NAME_MAX_LENGTH = 24;

/** Same Thai block (U+0E00-U+0E7F) + ASCII alphanumerics as the server regex. */
const NAME_RE = /^[A-Za-z0-9฀-๿]+$/;

export type NameValidationError = "empty" | "tooShort" | "tooLong" | "invalidChars";

export interface NameValidationResult {
  ok: boolean;
  /** Trimmed value the server would actually see (also what should be submitted). */
  trimmed: string;
  error?: NameValidationError;
}

/** Validates a candidate character name the same way the server will. */
export function validateCharacterName(raw: string): NameValidationResult {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return { ok: false, trimmed, error: "empty" };
  if (trimmed.length < NAME_MIN_LENGTH) return { ok: false, trimmed, error: "tooShort" };
  if (trimmed.length > NAME_MAX_LENGTH) return { ok: false, trimmed, error: "tooLong" };
  if (!NAME_RE.test(trimmed)) return { ok: false, trimmed, error: "invalidChars" };
  return { ok: true, trimmed };
}
