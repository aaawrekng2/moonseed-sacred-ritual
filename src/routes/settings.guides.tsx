import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { GuideSelector } from "@/components/guides/GuideSelector";

/**
 * /settings/guides — manage guides directly from Settings, without
 * having to start a reading first. Reuses the existing GuideSelector
 * UI; "Begin Reading" CTA navigates to /draw, and skip/close goes
 * back to settings home.
 */
export const Route = createFileRoute("/settings/guides")({
  head: () => ({
    meta: [{ title: "Guides — Settings — Moonseed" }],
  }),
  component: SettingsGuidesPage,
});

function SettingsGuidesPage() {
  const navigate = useNavigate();
  return (
    <div className="pb-12">
      <GuideSelector
        onContinue={() => void navigate({ to: "/draw" })}
        onSkip={() => void navigate({ to: "/settings/profile" })}
        ctaLabel="Begin a Reading"
      />
    </div>
  );
}