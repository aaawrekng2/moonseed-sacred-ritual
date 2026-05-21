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
  return <ConstellationPage />;
}