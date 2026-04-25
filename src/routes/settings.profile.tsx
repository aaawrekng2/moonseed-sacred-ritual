import { createFileRoute } from "@tanstack/react-router";
import { ProfilePanel } from "@/components/settings/legacy-panels";

export const Route = createFileRoute("/settings/profile")({
  head: () => ({
    meta: [{ title: "Profile — Settings — Moonseed" }],
  }),
  component: ProfilePanel,
});