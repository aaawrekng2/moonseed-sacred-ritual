import { createFileRoute } from "@tanstack/react-router";
import { SecurityTab } from "@/components/settings/SecurityTab";

export const Route = createFileRoute("/settings/security")({
  head: () => ({
    meta: [{ title: "Security — Settings — Tarot Seed" }],
  }),
  component: SecurityTab,
});
