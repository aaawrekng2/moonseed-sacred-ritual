import { createFileRoute } from "@tanstack/react-router";
import { BlueprintSection } from "@/components/settings/sections";

export const Route = createFileRoute("/settings/blueprint")({
  head: () => ({
    meta: [{ title: "Blueprint — Settings — Tarot Seed" }],
  }),
  component: BlueprintSection,
});