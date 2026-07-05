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

## CUTOVER sequence (owned by the backend/save task — later, deliberate push)

1. **Backfill**: for each existing `User`, create one `Character` (name default
   e.g. from cookie/id, `baseClass` from the save's primary unlocked class, `level`
   /`power` from `SaveState.data`).
2. **Link**: set `SaveState.characterId` to that new `Character.id`.
3. **Flip constraints** (separate push): add `@unique` to `SaveState.characterId`
   (tighten `Character.saves` -> `save SaveState?`); switch `persistSave` to upsert
   by `characterId`; **DROP `SaveState.userId @unique`** (a user may then hold up to
   3 saves) — keep a plain `@@index([userId])` for account queries + cascade.
   NOTE: adding the `@unique` will trigger `prisma db push`'s destructive-change
   prompt (`--accept-data-loss`) — run it knowingly after 1–2 verify the backfill
   left every `characterId` distinct and non-null.

Engine `SAVE_VERSION` (currently 3) will bump to v4 for the single-character
payload — keep `SaveState.version` in lockstep; migrate/read paths target rows by
stored `version`. That engine payload zod is owned by the engine/save task.

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
