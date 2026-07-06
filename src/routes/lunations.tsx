/**
 * v2.92 — /lunations
 *
 * Experimental standalone page: the manual-entry constellation (hero+companion
 * web, teal asterism selection, card picker) up top, with the calendar strip
 * swapped for the two-lens LunationStrip (by moon phase / by day of month) at
 * the bottom. Not wired into the draw table or Insights — a throwaway-safe
 * prototype so the idea can be tried before porting into Patterns.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ConstellationPage } from "@/components/constellation/ConstellationPage";

export const Route = createFileRoute("/lunations")({
  component: LunationsRouteShell,
});

function LunationsRouteShell() {
  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        background: "var(--background, transparent)",
      }}
    >
      <ConstellationPage lunationMode />
    </div>
  );
}
