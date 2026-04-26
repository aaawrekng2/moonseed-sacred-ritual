/**
 * Global tap-to-peek behavior. When a user is in Glimpse (labels off whisper)
 * or Veiled (labels off + low opacity) and taps an *empty* area of any
 * screen, briefly reveal everything: labels on, resting opacity at 100%.
 * After 2000ms, fade both back to the user's saved values over 600ms.
 *
 * "Empty space" = a tap whose target is not an interactive element
 * (button, link, input, textarea, select, [role=button|link], [data-no-peek]).
 *
 * Implementation notes:
 *  - Mounted once at the root; listens at document level with capture=true
 *    so it sees the tap before any per-component handler.
 *  - Override is *transient* — neither localStorage nor user_preferences is
 *    written. Restore re-broadcasts the saved values to all subscribers.
 *  - Only re-arms a peek if a previous peek has fully restored, to avoid
 *    flickering during rapid taps.
 */
import { useEffect } from "react";
import { peekRestingOpacity } from "@/lib/use-resting-opacity";
import { peekShowLabels } from "@/lib/use-show-labels";

const PEEK_HOLD_MS = 2000;
const PEEK_FADE_MS = 600;

const INTERACTIVE_SELECTOR =
  'button, a, input, textarea, select, [role="button"], [role="link"], ' +
  '[role="menuitem"], [role="checkbox"], [role="switch"], [role="tab"], ' +
  '[contenteditable="true"], [data-no-peek], label';

let active = false;
let holdTimer: ReturnType<typeof setTimeout> | null = null;
let restoreOpacityFn: ((fadeMs: number) => void) | null = null;
let restoreLabelsFn: (() => void) | null = null;

function isInteractive(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest(INTERACTIVE_SELECTOR) !== null;
}

/**
 * Trigger a transient peek — brightens everything to 100% opacity,
 * holds for `holdMs`, then fades back to the user's saved resting value.
 *
 * Used by both the global tap-to-peek handler (2000ms hold) and
 * top-bar icon taps (1500ms hold) so both share the exact same
 * fade-back animation and never conflict.
 */
export function triggerPeek(holdMs: number = PEEK_HOLD_MS) {
  if (holdTimer) {
    clearTimeout(holdTimer);
    holdTimer = null;
  }
  if (!active) {
    active = true;
    restoreOpacityFn = peekRestingOpacity(100);
    restoreLabelsFn = peekShowLabels();
  }
  // Notify the global FloatingMenu (and any other listeners) that a
  // peek just fired so they can drop down in sync.
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("moonseed:peek"));
  }
  holdTimer = setTimeout(() => {
    holdTimer = null;
    restoreOpacityFn?.(PEEK_FADE_MS);
    restoreLabelsFn?.();
    restoreOpacityFn = null;
    restoreLabelsFn = null;
    setTimeout(() => {
      active = false;
    }, PEEK_FADE_MS + 40);
  }, holdMs);
}

export function useTapToPeek() {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = (e: PointerEvent) => {
      if (e.button !== undefined && e.button !== 0) return;
      if (isInteractive(e.target)) return;
      triggerPeek(PEEK_HOLD_MS);
    };
    document.addEventListener("pointerdown", handler, { capture: true });
    return () => {
      document.removeEventListener("pointerdown", handler, { capture: true });
      if (holdTimer) {
        clearTimeout(holdTimer);
        holdTimer = null;
      }
    };
  }, []);
}
