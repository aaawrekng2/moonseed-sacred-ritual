import { createFileRoute } from "@tanstack/react-router";
import { BlueprintSection } from "@/components/settings/sections";

// v2.71 — Blueprint is local numerology/astrology math (no AI calls), so the
// route is no longer behind AIRouteGuard: birth-data entry and numerology are
// reachable whether or not the seeker has AI enabled.
export const Route = createFileRoute("/settings/blueprint")({
  head: () => ({
    meta: [{ title: "Blueprint — Settings — Tarot Seed" }],
  }),
  component: BlueprintSection,
});
