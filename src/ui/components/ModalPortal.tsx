"use client";

/**
 * Escapes a modal shell to `document.body` via a React portal.
 *
 * WHY: iOS Safari treats an ancestor's `backdrop-filter` as a containing
 * block for `position: fixed` descendants (unlike other browsers). The HUD's
 * console dock (`GameHud.tsx`, the `backdrop-blur-sm` div) sits ABOVE every
 * modal in the tree, so on iOS Safari a `fixed inset-0` modal shell rendered
 * underneath it gets trapped inside the dock's box instead of anchoring to
 * the viewport — HUD skill buttons and the goal card then paint over/through
 * the modal. Portaling the modal shell to `document.body` sidesteps the
 * containing-block trap entirely. Every new modal should render through this.
 */

import { useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";

const noopSubscribe = () => () => {};

/** Hydration-safe "are we mounted on the client" flag — `useSyncExternalStore`
 * with a no-op subscription returns the server snapshot (`false`) on the
 * initial/SSR render and the client snapshot (`true`) once mounted, without
 * the cascading-render lint issue a `useState`+`useEffect(setState)` pair
 * would trigger. */
function useIsMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function ModalPortal({ children }: { children: ReactNode }) {
  const mounted = useIsMounted();

  if (!mounted) return null;

  return createPortal(children, document.body);
}
