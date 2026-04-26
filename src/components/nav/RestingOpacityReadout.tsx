import { useRestingOpacity } from "@/lib/use-resting-opacity";

/**
 * Tiny always-on indicator showing the current resting opacity value
 * as a percentage (e.g. "42"). Lives in the upper-left of every
 * screen, fixed-positioned, and stays at 80% opacity regardless of
 * the user's resting opacity setting so it remains faintly legible.
 *
 * Updates live via useRestingOpacity, which subscribes to the global
 * resting-opacity changed event.
 */
export function RestingOpacityReadout() {
  const { opacity, loaded } = useRestingOpacity();
  if (!loaded) return null;
  return (
    <div
      className="resting-opacity-readout"
      aria-hidden="true"
      title={`Interface fade: ${opacity}%`}
    >
      {opacity}
    </div>
  );
}