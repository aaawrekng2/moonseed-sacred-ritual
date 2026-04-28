/**
 * Run a layout-changing mutation while preserving the seeker's
 * proportional scroll position.
 *
 * Used by font-size sliders so releasing the slider doesn't make the
 * page visibly jump as the document reflows. We snapshot the current
 * scrollY + total document height BEFORE the mutation, run the
 * mutation, then in the next animation frame restore scroll to the
 * same proportional position relative to the new document height.
 *
 * Falls back gracefully on the server (no-op).
 */
export function withPreservedScroll(mutate: () => void) {
  if (typeof window === "undefined") {
    mutate();
    return;
  }
  const oldHeight = Math.max(
    document.body.scrollHeight,
    document.documentElement.scrollHeight,
  );
  const oldScroll = window.scrollY;
  // Avoid divide-by-zero — if the page has no scroll yet there's
  // nothing meaningful to preserve.
  const ratio = oldHeight > 0 ? oldScroll / oldHeight : 0;
  mutate();
  requestAnimationFrame(() => {
    const newHeight = Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
    );
    const target = Math.round(ratio * newHeight);
    window.scrollTo({ top: target, behavior: "auto" });
  });
}
