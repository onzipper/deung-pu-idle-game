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

/** Shape of the two `409` error bodies `POST /api/characters` can return. */
export type CreateCharacterErrorCode = "limit" | "duplicate";
