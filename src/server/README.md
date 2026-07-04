# `server/` — server-authoritative logic

Runs on the server (Route Handlers / Server Actions), never in the browser bundle:

- `offline.ts` — capped offline idle calculation from server wall-clock.
- save/load persistence (M3) — reads/writes `save_states` via `@/lib/db`.
- economy validation (M5) — the design goal is that gold/upgrades can be **re-validated server-side** so client tampering can't grant currency. MVP may compute client-side, but the shape must allow the server to be the authority for monetization/anti-cheat.

Save payloads always pass through `migrate()` from `@/engine/state/version` on load.
