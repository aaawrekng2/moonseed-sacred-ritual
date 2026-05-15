import { createFileRoute } from "@tanstack/react-router";
import { MoonFeaturesPage } from "@/components/settings/MoonFeaturesPage";

export const Route = createFileRoute("/settings/moon")({
  head: () => ({
    meta: [{ title: "Moon — Settings — Tarot Seed" }],
  }),
  component: MoonFeaturesPage,
});