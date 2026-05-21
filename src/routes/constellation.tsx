/**
 * Phase 17 — /constellation
 *
 * Standalone exploration page for the seeker's card co-occurrence web.
 * QuickLog at /draw is intentionally left untouched apart from a small
 * "explore the constellation" link.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ConstellationPage } from "@/components/constellation/ConstellationPage";

export const Route = createFileRoute("/constellation")({
  component: ConstellationRouteShell,
});

function ConstellationRouteShell() {
  // Phase 19 Fix 5 — page is fixed-height; inner panels scroll.
  return (
    <div
      style={{
        width: "100%",
        height: "100vh",
        overflow: "hidden",
        background: "var(--background, transparent)",
      }}
    >
      <ConstellationPage />
    </div>
  );
}