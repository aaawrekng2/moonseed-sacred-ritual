import { createFileRoute } from "@tanstack/react-router";
import { PreferencesTab } from "@/components/settings/sections";

export const Route = createFileRoute("/settings/preferences")({
  head: () => ({
    meta: [{ title: "Preferences — Settings — Tarot Seed" }],
  }),
  component: PreferencesTab,
});
