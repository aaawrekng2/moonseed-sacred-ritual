import { createFileRoute } from "@tanstack/react-router";
import { ProfileSection } from "@/components/settings/sections";

export const Route = createFileRoute("/settings/profile")({
  head: () => ({
    meta: [{ title: "Profile — Settings — Moonseed" }],
  }),
  component: ProfileSection,
});