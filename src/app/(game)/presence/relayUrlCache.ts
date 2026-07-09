/**
 * A one-slot module-level cache of the most recently minted presence-ticket `relayUrl`.
 *
 * WHY: the presence ticket route (`/api/presence/ticket`) is the ONLY place the client
 * learns the relay's ws(s):// URL. `WorldSession.mintTicket` already fetches it for the
 * world socket; this cache lets a *future* read-only consumer (e.g. a zone-population UI
 * hook) recover that same URL — convert ws(s)→http(s) and GET `/presence/counts` — WITHOUT
 * reaching into `WorldSession` internals or minting its own ticket.
 *
 * It is deliberately trivial: a single string slot, last-write-wins. It carries no auth
 * material (the ticket itself is never stored here) and reading it never triggers a fetch.
 * `null` means no ticket has been minted yet this session, or the relay is not deployed
 * (`relayUrl: null` from the route). The writer (`setCachedRelayUrl`) is additive on the
 * existing mint path — it changes no existing behavior.
 */

let cachedRelayUrl: string | null = null;

/** Record the relayUrl from the latest presence-ticket mint (null when unset/undeployed). */
export function setCachedRelayUrl(url: string | null): void {
  cachedRelayUrl = url;
}

/** The most recently minted relayUrl, or `null` if none has been seen this session. */
export function getCachedRelayUrl(): string | null {
  return cachedRelayUrl;
}
