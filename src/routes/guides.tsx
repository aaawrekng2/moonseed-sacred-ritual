import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { GuideSelector } from "@/components/guides/GuideSelector";
import { isValidSpreadMode, type SpreadMode } from "@/lib/spreads";

type Search = { spread?: string };

export const Route = createFileRoute("/guides")({
  validateSearch: (s: Record<string, unknown>): Search => ({
    spread: typeof s.spread === "string" ? s.spread : undefined,
  }),
  component: GuidesPage,
});

function GuidesPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  const spread: SpreadMode = isValidSpreadMode(search.spread)
    ? search.spread
    : "daily";

  const goDraw = () => {
    void navigate({ to: "/draw", search: { spread } });
  };

  return <GuideSelector onContinue={goDraw} onSkip={goDraw} />;
}