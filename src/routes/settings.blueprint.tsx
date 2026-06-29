import { createFileRoute } from "@tanstack/react-router";
import { BlueprintSection } from "@/components/settings/sections";
import { AIRouteGuard } from "@/components/feature-gate/AIRouteGuard";

export const Route = createFileRoute("/settings/blueprint")({
  head: () => ({
    meta: [{ title: "Blueprint — Settings — Tarot Seed" }],
  }),
  component: GuardedBlueprintSection,
});

function GuardedBlueprintSection() {
  return (
    <AIRouteGuard>
      <BlueprintSection />
    </AIRouteGuard>
  );
}
