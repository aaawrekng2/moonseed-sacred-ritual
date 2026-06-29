import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { GuideSelector } from "@/components/guides/GuideSelector";
import { SettingsSection } from "@/components/settings/sections";
import { AIRouteGuard } from "@/components/feature-gate/AIRouteGuard";

/**
 * /settings/guides — manage guides directly from Settings, without
 * having to start a reading first. Reuses the existing GuideSelector
 * UI; "Begin Reading" CTA navigates to /draw, and skip/close goes
 * back to settings home.
 */
export const Route = createFileRoute("/settings/guides")({
  head: () => ({
    meta: [{ title: "Guides — Settings — Tarot Seed" }],
  }),
  component: SettingsGuidesPage,
});

function SettingsGuidesPage() {
  const navigate = useNavigate();
  return (
    <AIRouteGuard>
      <SettingsSection
        title="Guides"
        description="Choose the voice that reads your cards."
      >
        <GuideSelector
          isEmbedded
          onContinue={() => void navigate({ to: "/draw" })}
          onSkip={() => void navigate({ to: "/settings/profile" })}
          ctaLabel="Begin a new spread"
        />
      </SettingsSection>
    </AIRouteGuard>
  );
}