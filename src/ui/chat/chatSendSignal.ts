/**
 * Tiny cross-boundary "please send this chat message" signal — same idiom as
 * `ui/openSettingsSignal.ts`. The chat panel lives in `ui/` and has no reference to the
 * live `WorldSession` instance (it's a plain closure variable inside `GameClient.tsx`'s
 * effect, same as `partySession`); a `window` CustomEvent lets the panel ask
 * `GameClient` to actually send without lifting a socket reference through React state
 * or adding a Zustand field for a fire-once, non-engine, non-replayed action.
 */

const EVENT_NAME = "ddp:chat-send";

/** Ask `GameClient` to send this text over the world socket (`WorldSession#sendChat`). */
export function requestSendChat(text: string): void {
  window.dispatchEvent(new CustomEvent<string>(EVENT_NAME, { detail: text }));
}

/** Subscribe to send requests; returns an unsubscribe function. */
export function onSendChatRequest(handler: (text: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT_NAME, listener);
  return () => window.removeEventListener(EVENT_NAME, listener);
}
