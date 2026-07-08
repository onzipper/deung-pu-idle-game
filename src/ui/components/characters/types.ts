/**
 * Client-side mirror of the `Character` DTO returned by `/api/characters*`
 * (see docs/persistence-m5.md — "Character DTO everywhere"). Kept local to
 * the UI layer (rather than importing `CharacterDTO` from `@/server/characters`)
 * so this module never pulls server-only code (Prisma) into a client bundle —
 * `baseClass` reuses the engine's own `HeroClass` union via a type-only import
 * (erased at compile time, so it stays a pure type dependency).
 */

import type { HeroClass } from "@/engine";

export interface CharacterDTO {
  id: string;
  name: string;
  baseClass: HeroClass;
  level: number;
  power: number;
  createdAt: string;
}

/** Shape of the `409`/`403` error bodies `POST /api/characters` can return.
 * Ninja wave: `ninja_locked` (403 — unmet tier-3 gate) and `ninja_only_slot`
 * (409 — the 4th slot only accepts ninja) mirror `@/server/characters`'s
 * `CreateErrorCode`. */
export type CreateCharacterErrorCode =
  | "limit"
  | "duplicate"
  | "ninja_locked"
  | "ninja_only_slot";

/** Client-side mirror of `@/server/characters`'s `NinjaUnlock` — the roster
 * endpoint's `ninjaUnlock` field (never re-derived client-side; server is the
 * sole authority). `BaseClass` here is intentionally just the 3 base
 * strings, not the full `HeroClass` union (a ninja itself never appears in
 * `baseTier3`/`maxTier` — see docs/ninja-design.md §5). */
export type NinjaBaseClass = "swordsman" | "archer" | "mage";

export interface NinjaUnlockDTO {
  unlocked: boolean;
  requiredTier: number;
  baseTier3: Record<NinjaBaseClass, boolean>;
  maxTier: Record<NinjaBaseClass, number>;
  cleared: number;
  needed: number;
}
