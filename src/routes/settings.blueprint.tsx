import { createFileRoute } from "@tanstack/react-router";
import { BlueprintPanel } from "@/components/settings/legacy-panels";

export const Route = createFileRoute("/settings/blueprint")({
  head: () => ({
    meta: [{ title: "Blueprint — Settings — Moonseed" }],
  }),
  component: BlueprintPanel,
});