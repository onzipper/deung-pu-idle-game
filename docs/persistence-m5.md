# Persistence — M5 Character Pivot (DB layer)

Additive-only DB foundation for GDD v2 (account -> up to 3 characters, each own
class/level/save). Applied to the live Hostinger MySQL via `prisma db push`
(no migration history — shared host denies the shadow DB, P3014). Prisma 6 pinned.

## What is APPLIED now (live, non-breaking)

- **`Character`** model — `id` (cuid), `userId` (+FK, indexed), `name`
  `VARCHAR(24)` (utf8mb4, Thai-safe), `baseClass` `VARCHAR(16)` (engine
  `HeroClass` string: swordsman|archer|mage), `level` Int cache, `power` Int
  cache, `createdAt`, `updatedAt`, `deletedAt?` (soft delete). Indexes:
  `[userId]`, `[userId, deletedAt]`, `[name]`.
- **`SaveState.characterId`** — NULLABLE column + FK to `Character` +
  `@@index([characterId])`. `userId @unique` KEPT intact. All existing rows have
  `characterId = NULL`, so the current one-slot flow (`upsert where userId`) is
  untouched. Relation is 1:N for now only because `characterId` is not yet unique.

`level`/`power` are **denormalized caches** for future Hall-of-Fame reads; the
engine save (`SaveState.data` JSON) stays the source of truth and re-derives them.

## Design decisions / flags

- **Name uniqueness → global, case-insensitive, APP-enforced among live rows**
  (`deletedAt IS NULL`), backed by `@@index([name])`. NOT a DB `@@unique`: a hard
  unique would reserve soft-deleted names forever (MySQL has no partial index),
  and app-level frees the name when a slot is freed. Trade-off: TOCTOU race on
  concurrent create — wrap in a tx / catch dup. (utf8mb4 default collation is CI.)
- **`<=3` per account** — no clean DB row-count constraint; enforce at app level:
  `count(where userId, deletedAt: null) < 3` before create (inside the tx).
- **Soft delete** — `deletedAt` frees the live slot but keeps the row for audit.
  `id` is a cuid, opaque, **never reused** — safe as a stable `ownerId`.
- **`power` as Int** — re-derivable cache; widen to BigInt later (additive) if it
  can exceed 2^31.

## CUTOVER — APPLIED (live, 2026-07-05)

Executed against the live Hostinger DB in this order:

1. **Backfill** (`prisma/backfill-characters.ts`, idempotent, tsx-run): created
   one `Character` per existing `SaveState` (36 saves → 36 characters), `baseClass`
   from the migrated save's `hero.cls`, `level` from `hero.level`, `power` from the
   engine's `combatPower` (via `powerFromSave`), placeholder name
   `ดึ๋งปุ๊#<last-6-of-saveId>` (carries a `#` so the creation UI can detect + prompt
   a rename). Set `SaveState.characterId` in the same tx. Verified all distinct +
   non-null (`FLIP-SAFE: YES`) before flipping.
2. **Constraint flip**: `SaveState.characterId` → `@unique`; **`userId @unique`
   DROPPED** (a user may now hold up to 3 saves) with a plain `@@index([userId])`
   kept for account queries + cascade; `Character.saves` tightened to `save
   SaveState?` (effective 1:1). `persistSave`/`loadSave` now key off `characterId`.
   - `prisma db push --accept-data-loss` FAILED mid-apply with MySQL errno 121 on
     `AddForeignKey` (a known shared-host FK-recreate collision). It had already
     swapped the indexes but left `SaveState_userId_fkey` dropped. **Repaired
     manually**: re-added `SaveState_userId_fkey` (FK userId→User.id ON DELETE
     CASCADE) and dropped the now-redundant `SaveState_characterId_idx`. A
     subsequent `prisma db push` then reports **"already in sync"**. Final live
     indexes: `PRIMARY`, `SaveState_characterId_key` (UNIQUE), `SaveState_userId_idx`
     (plain); FKs: `SaveState_characterId_fkey`, `SaveState_userId_fkey`.
   - **If the DB is ever re-baselined**, the FK-recreate collision can recur on a
     fresh `db push`; re-run the two repair `ALTER TABLE`s (re-add the userId FK,
     drop any redundant characterId index) if it errors 121.

Backfill re-run safety: only saves with `characterId = NULL` are processed, so
re-running is a no-op on the current data.

### Payload-schema decoupling (handoff)

The incoming-save zod (`saveDataSchema`) moved from `src/server/save.ts` into
`src/engine/state/saveSchema.ts` (zod is pure TS — engine-legal), colocated with
the `SAVE_VERSION`/`migrate()` shape and re-exported from `@/engine`. **Future
`SAVE_VERSION` bumps are now a single engine edit and do NOT touch the server.**
`src/server/save.ts` only imports it; both sites carry a HANDOFF comment.

Engine `SAVE_VERSION` is at **v5** (single character + base stats); `SaveState.
version` mirrors it. `persistSave` also refreshes the `Character.level`/`power`
caches from each validated payload (power via engine `combatPower`) in the same
transaction as the save write.

## Character API contract (build the creation UI against this)

All routes are cookie-authed (anonymous `dpu_uid` identity, httpOnly) — the client
NEVER sends a userId. Active character is held in the httpOnly `activeCharacterId`
cookie. All routes are `dynamic = "force-dynamic"`. `Character` DTO everywhere:
`{ id: string, name: string, baseClass: "swordsman"|"archer"|"mage", level: number,
power: number, createdAt: string /* ISO */ }`.

- **GET `/api/characters`** → `200 { characters: Character[] }` — the account's LIVE
  characters (soft-deleted excluded), newest first.
- **POST `/api/characters`** — body `{ name: string, baseClass: "swordsman"|"archer"
  |"mage" }` (strict; unknown keys rejected).
  - Name rules: trimmed, **2–24 chars, Thai and/or EN letters + digits only** (no
    spaces/punctuation/symbols); **globally unique (case-insensitive) among live
    characters**.
  - `201 { character: Character }` on success. The FIRST character created is
    auto-selected (its cookie is set).
  - `400 { error }` invalid body/name. `409 { error, code: "limit" }` when already
    3 live. `409 { error, code: "duplicate" }` when the name is taken.
- **DELETE `/api/characters/:id`** → `200 { ok: true }` (soft delete, owner-checked;
  frees the slot + name; the save row is kept for audit). `404 { error }` if not
  owned / already deleted. If `:id` was the active character, the cookie is cleared.
- **POST `/api/characters/:id/select`** → `200 { ok: true, activeCharacterId }`
  (owner + liveness checked; sets the `activeCharacterId` cookie). `404 { error }`
  if not owned / not live.

### Save endpoints (now active-character-keyed)

- **GET `/api/save`** → `{ save: SaveData|null, offline, activeCharacterId: string|
  null }`. Resolves the active character from the cookie; **fallback**: if no valid
  cookie and the account has EXACTLY ONE live character, it auto-selects it (sets
  the cookie) — so every backfilled single-character account keeps working with no
  UI. `activeCharacterId: null` (+ `save: null`) means the client must create/select
  a character first.
- **POST `/api/save`** → `{ ok, lastSeen }`, or `409 { error, code:
  "no_active_character" }` when no character is selected/creatable. On success also
  refreshes the active character's `level`/`power` caches. `lastSeen` is
  server-stamped (client value discarded) — unchanged offline-idle anti-cheat rule.

## Forward-readiness (design notes only — NO tables added)

- **M7 gear (item-instance)**: new `Item` table keyed `ownerId = Character.id`
  (stable cuid) + append-only `ItemAudit` (dupe = existential threat). Character
  ids never reused → safe owner key. Add when gear lands.
- **M9 HOF**: query the `power`/`level`/`baseClass` caches. Add HOF indexes then,
  once categories are fixed: e.g. `@@index([deletedAt, power])`,
  `@@index([baseClass, deletedAt, power])`, `@@index([deletedAt, level])`. Deferred
  now (don't pay write cost / guess access patterns 4 milestones early). HOF
  standings should be periodic **snapshots** (separate table referencing
  `characterId`) re-derived server-side, not live cache reads, for anti-cheat.
</content>
</invoke>
