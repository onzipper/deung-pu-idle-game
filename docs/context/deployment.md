# Context Pack — Persistence & Deployment

## Persistence

- **MySQL (Hostinger) + Prisma 6, pinned** (Prisma 7 needs driver adapters — do not upgrade without a deliberate migration plan).
- Schema applied via **`prisma db push` only** — the shared host denies the shadow database (P3014), so there is **no migration history**; if the DB ever moves hosts, the schema must be baselined fresh.
- `pnpm db:generate` / `pnpm db:migrate` (push-equivalent here) / `pnpm db:studio` — all need `DATABASE_URL` in `.env`.
- Identity = anonymous httpOnly cookie (`src/server/identity.ts`, `dpu_uid`) — the account system (register/login/guest-upgrade) sits on top of the same cookie; a guest upgrades **in place**, never loses their save.
- One save slot per user (`SaveState.userId @unique`).

## Save flow

- `POST /api/save` (`src/app/api/save/route.ts`) zod-validates strictly (`src/engine/state/saveSchema.ts`); **the server stamps `lastSeen`** — client timestamps are always discarded.
- Offline idle is capped at `CONFIG.offlineCapHours` (currently 8), replayed client-side through `step()` under a 250ms wall-clock budget (`src/server/offline.ts` computes elapsed server-side; the client does the actual replay).
- Every save load passes through `migrate()` (`src/engine/state/version.ts`) — see [engine.md](./engine.md) for `SAVE_VERSION` rules.

## Relay (party lockstep + world presence)

- A **separate** zero-dependency Node service at `scripts/party-relay/` (own `package.json`, `server.js`), deployed independently — Render free tier, Singapore region.
- Env: `PARTY_RELAY_SECRET` / `PARTY_RELAY_URL` (game host side); HMAC-ticketed auth via `src/server/partyTicket.ts` (`POST /api/party/ticket`, `POST /api/presence/ticket`).
- Handles: party lockstep game+control stream, ghost-presence pub/sub, global chat, ping/pong. See `docs/party-relay-protocol.md` for the wire format.

## Deploy order rule

**When the relay protocol grows (new opcode/field), redeploy the RELAY FIRST, then the web app.** An older relay must degrade silently against a newer client (never hard-fail); a newer relay must stay backward-compatible with an in-flight older client during the rollout window.

`prisma db push` only when the schema actually changed in the release — **check `docs/current-state.md` for what is pending** before assuming a push is needed; as of the latest recorded status, nothing was pending.

## Read first

1. `src/server/README.md`.
2. `src/server/save.ts`, `src/server/offline.ts`, `src/server/identity.ts` for the persistence path.
3. `scripts/party-relay/server.js` + `docs/party-relay-protocol.md` for the relay.
4. `docs/current-state.md` for what is actually pending at HEAD (db push / relay redeploy / web redeploy) — this rotates every release and is NOT duplicated here.

## Tests to run

```
pnpm test src/server
pnpm test src/server/__tests__/save.test.ts src/server/__tests__/party-relay.test.ts src/server/__tests__/party-relay-world.test.ts
```

## Known risks

- A schema change without a `prisma db push` at deploy time will 500 on the affected endpoints — the app code shipping ahead of the DB push is a known, repeated failure mode; always call out the exact additive tables/columns in the PR/commit.
- Relay redeploys must not break an in-flight party session — protocol changes should be additive (new field/opcode), never a breaking rename of an existing one.
- Production deploy itself is **owner-triggered, never automatic** — do not attempt to deploy as part of agent work.

## Do not touch

- Never write a Prisma migration file — this project has no migration history by design (shared-host constraint); schema changes are `db push` only.
- Never write to cookies inside a Server Component render (`cookies().set()` throws under Next 16) — cookie writes belong in Route Handlers/Server Actions only (docs/known-traps.md #9).
- Never trust a client-submitted timestamp for `lastSeen` or offline-elapsed calculations — server wall-clock only.
