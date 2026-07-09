/**
 * Tiny cross-component "please open the Friends panel" signal (R2.6 quest-
 * tracker Wave 1). `FriendsButton.tsx` already gates its panel open state
 * behind a purely-local `useState` (same idiom as every other HUD modal
 * trigger — see `openSettingsSignal.ts`'s doc for the pattern this clones). A
 * plain `window` CustomEvent lets the new party tab in `GoalLadder.tsx`
 * (`PartyTrackerList.tsx`'s "จัดการปาร์ตี้" button) request the Friends panel
 * open without lifting state up through `GameHud.tsx` or introducing a
 * Zustand field for a purely-UI navigation intent.
 */

const EVENT_NAME = "ddp:open-friends-panel";

/** Ask the Friends panel to open (quest tracker's party-tab "manage" button). */
export function requestOpenFriendsPanel(): void {
  window.dispatchEvent(new Event(EVENT_NAME));
}

/** Subscribe to open-friends-panel requests; returns an unsubscribe function. */
export function onOpenFriendsPanelRequest(handler: () => void): () => void {
  window.addEventListener(EVENT_NAME, handler);
  return () => window.removeEventListener(EVENT_NAME, handler);
}
