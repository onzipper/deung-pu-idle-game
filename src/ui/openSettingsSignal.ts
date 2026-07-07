/**
 * Tiny cross-component "please open Settings" signal (M8 Phase 1, Friends
 * guest-state CTA). `SettingsPanel`/`SettingsButton.tsx` already gate their
 * open state behind a purely-local `useState` (same idiom as every other HUD
 * modal trigger) — there's no shared store field for "modal open" and adding
 * one would be a bigger footprint than this feature needs. A plain
 * `window` CustomEvent lets an unrelated component (the Friends panel's guest
 * pitch) request the settings drawer open without lifting state up through
 * `GameHud.tsx` or introducing a Zustand field for a purely-UI navigation
 * intent.
 */

const EVENT_NAME = "ddp:open-account-settings";

/** Ask the settings drawer to open (Friends guest-state "go to My Account"). */
export function requestOpenAccountSettings(): void {
  window.dispatchEvent(new Event(EVENT_NAME));
}

/** Subscribe to open-settings requests; returns an unsubscribe function. */
export function onOpenAccountSettingsRequest(handler: () => void): () => void {
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
