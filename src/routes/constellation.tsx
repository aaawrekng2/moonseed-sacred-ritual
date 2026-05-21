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
  // Phase 20 Fix 13 — page grows beyond viewport; THIS PULL + Get Reading
  // section reveals on scroll. Page itself is the scroll container.
  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        background: "var(--background, transparent)",
      }}
    >
      <ConstellationPage />
    </div>
  );
}