/**
 * v3.28 — /lunations retired.
 *
 * The lunations experience now lives inside Insights → Patterns
 * (ConstellationPage rendered with insightsMode + lunationMode). This route is
 * kept only as a redirect so any old /lunations link/bookmark lands on the new
 * home. (Lovable can't delete route files, so the file stays as a redirect.)
 */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/lunations")({
  beforeLoad: () => {
    throw redirect({ to: "/insights", search: { tab: "patterns" } });
  },
  component: () => null,
});
