/**
 * EK101 — /atlas
 *
 * The full constellation: all 78 tarot cards laid out in a single clock
 * ring, the Fool at 12 o'clock running clockwise. This is the same
 * manual-entry page as /constellation — slot row, calendar, teal
 * asterism selection, badges all behave identically — with the
 * hero+companions web swapped for the 78-card Atlas layout.
 */
import { createFileRoute } from "@tanstack/react-router";
import { ConstellationPage } from "@/components/constellation/ConstellationPage";

export const Route = createFileRoute("/atlas")({
  component: AtlasRouteShell,
});

function AtlasRouteShell() {
  return (
    <div
      style={{
        width: "100%",
        minHeight: "100vh",
        background: "var(--background, transparent)",
      }}
    >
      <ConstellationPage atlasMode />
    </div>
  );
}
