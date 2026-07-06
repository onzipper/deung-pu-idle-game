# Persistence — M7 Gear & Drops (DB layer)

Additive-only DB foundation for the item-instance model (GDD: *ของดรอปและ Gear* —
server-authoritative from the FIRST item; **item dupe = existential threat**).
APPLIED live to Hostinger MySQL via `prisma db push` (2026-07-05, "in sync",
zero drift). Prisma 6 pinned; no migration history (shared host, no shadow DB).

## What is APPLIED now (live, additive, non-breaking)

Two NEW tables, two NEW FKs — no ALTER/DROP on existing tables (verified via
`migrate diff`). No errno-121 this time (new-table FKs get fresh names; the m5
ALTER-recreate hazard did not apply).

### `ItemInstance` — the authoritative item ledger

`id` (cuid, opaque, NEVER reused) · `ownerId` → **Character.id** (per-character,
NOT User — "ของดรอปจอใครจอมัน") FK ON DELETE CASCADE · `templateId` VARCHAR(64)
(engine-config template key; stats live in pure-TS config, NOT the DB) · `origin`
VARCHAR(16) (`drop|boss|trade|admin`) · `sourceDetail?` VARCHAR(64) (audit: zone/
boss id, admin note) · `equippedSlot?` VARCHAR(16) (`weapon|armor|`NULL) ·
`claimKey?` UNIQUE (idempotency) · `acquiredAt` · `deletedAt?` (soft delete).
Indexes: `@@unique([ownerId, equippedSlot])`, `@@index([templateId])`,
`@@unique(claimKey)`.

- **Authoritative, NOT a cache**: unlike `Character.level/power`, an ItemInstance
  is NOT re-derivable from the save blob. It is the source of truth for what a
  character owns. Never hard-delete — `deletedAt` keeps destroyed/consumed items
  for audit.
- **`templateId` decoupling**: DB stores instances only; item templates/stats are
  engine config (pure TS). Balance tweaks never migrate the DB.

### `ItemEvent` — append-only anti-dupe audit trail

`id` · `itemId` → ItemInstance FK ON DELETE CASCADE · `type` VARCHAR(16)
(`minted|equipped|unequipped|traded|destroyed`) · `fromCharacterId?` /
`toCharacterId?` (RAW cuid strings, **deliberately NOT FKs** — an audit ledger
must be immutable and reference-independent) · `meta?` TEXT (serialized JSON,
opaque, never SQL-queried — TEXT not JSON to stay light on this high-write table) ·
`createdAt`. Index: `@@index([itemId])`.

## Design decisions

- **equippedSlot enforcement → DB-level, not app-only.** MySQL lacks partial
  unique indexes, BUT its UNIQUE indexes treat NULLs as DISTINCT. So
  `@@unique([ownerId, equippedSlot])` permits UNLIMITED unequipped rows (slot NULL)
  yet AT MOST ONE non-null value per (owner, slot) → one weapon + one armor per
  character, enforced by the DB. This composite also covers `ownerId`-prefix
  inventory reads, so no separate `[ownerId]` index is needed.
  **INVARIANT**: `deletedAt` set ⇒ `equippedSlot` MUST be NULL (unequip in the same
  tx as destroy), else a dead row occupies a live slot in the unique index.
- **claimKey → INCLUDED (verdict: yes).** UNIQUE + NULLABLE. The drop-claim
  endpoint sets a deterministic key per claim (e.g. `${characterId}:${dropRollId}`);
  a retried/duplicated claim collides on the unique index → CANNOT double-mint.
  Mints without a client claim (boss/admin/trade) leave it NULL (NULLs distinct →
  many allowed).
- **ItemEvent is append-only by CONVENTION** (code review, not DB-enforced): no
  code path may UPDATE or DELETE a row. Inserts only. Rows purge only via CASCADE
  on User account hard-delete (GDPR).

## Transaction recipes (for the backend/drop task)

All mutations are ONE `prisma.$transaction`, writing the instance change + its
ItemEvent atomically.

- **Mint (drop claim)**:
  `create ItemInstance{ ownerId, templateId, origin:"drop", sourceDetail:zoneId,
  claimKey:"<char>:<rollId>" }` + `create ItemEvent{ itemId, type:"minted",
  toCharacterId:ownerId, meta }`. A unique-violation on `claimKey` = already
  claimed → return the existing item, do NOT mint. (Boss/admin mint: same, origin
  `boss|admin`, claimKey NULL.)
- **Equip**: `update ItemInstance{ where:{id, ownerId} } set equippedSlot=slot` +
  `ItemEvent{ type:"equipped", fromCharacterId:ownerId, meta:{slot} }`. A
  unique-violation on `[ownerId, equippedSlot]` = slot already occupied → unequip
  the incumbent (set NULL + `unequipped` event) FIRST, in the same tx.
- **Unequip**: set `equippedSlot=NULL` + `ItemEvent{ type:"unequipped" }`.
- **Destroy/consume**: set `deletedAt=now()` AND `equippedSlot=NULL` (invariant) +
  `ItemEvent{ type:"destroyed", fromCharacterId:ownerId }`. Never hard-delete.
- **Transfer (M9 trade)**: single tx — `update ItemInstance set ownerId=buyer,
  equippedSlot=NULL` + TWO ItemEvents (`traded` from=seller / `traded` to=buyer, or
  one `traded` row carrying both from+to). Ownership moves atomically with the
  ledger.

## Anti-dupe invariants (the load-bearing list)

1. Every mint = ONE tx writing ItemInstance + ItemEvent(minted). No orphan of either.
2. `id` is a cuid, opaque, NEVER reused — even after soft-delete.
3. Items are NEVER hard-deleted (soft `deletedAt` only); audit survives.
4. `claimKey` UNIQUE makes drop-claim idempotent — a retry can never double-mint.
5. `deletedAt` set ⇒ `equippedSlot` NULL (keeps the slot unique index truthful).
6. `@@unique([ownerId, equippedSlot])` ⇒ ≤1 equipped item per slot per character.
7. ItemEvent is append-only — no UPDATE/DELETE ever; it is the immutable ledger.
8. Ownership transfer moves `ownerId` + writes trade events in a SINGLE tx.
9. Every ownership/equip/destroy change has a corresponding ItemEvent row.

## Marketplace-readiness (M9 — notes only, NO tables now)

Nothing here blocks M9. Escrow = a future `Listing` table referencing the item;
transfer already flows through the single-tx `ownerId`-swap + trade-event pattern.
Price/tax/fee columns land on that future `Listing`/`Trade` table (tax is backoffice-
tunable, built LAST per GDD). `ItemEvent(type:"traded")` already captures the audit
side. Character ids (never reused) remain safe escrow/counterparty keys.
