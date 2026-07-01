/**
 * StalkerMeterRow (v2.44)
 *
 * The Overview's engine-powered header: up to three significance-ranked
 * pressure gauges for the cards most outrunning chance. Each is tappable
 * through to its Card Trace. When nothing is significant it shows the single
 * most-present card in a calm (within-normal-range) state; below 60 draws it
 * shows a quiet "still gathering" note. Pure presentational — all data comes
 * from getEngineInsights via the `data` prop.
 */
import { PressureGauge } from "@/components/insights/PressureGauge";
import type { EngineInsights } from "@/lib/insights.functions";

export function StalkerMeterRow({
  data,
  onOpenCard,
}: {
  data: EngineInsights | null;
  onOpenCard: (cardId: number) => void;
}) {
  if (!data) return null;

  if (data.status === "gathering") {
    return (
      <div style={{ textAlign: "center", padding: "6px 0" }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: "var(--text-heading-md)",
            color: "var(--color-foreground)",
            opacity: 0.9,
          }}
        >
          Your patterns are still gathering
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground-muted)",
            marginTop: 4,
          }}
        >
          {data.totalSlots} of {data.needed} draws — the gauges wake once there's
          enough to tell a pattern from chance.
        </div>
      </div>
    );
  }

  const { meters, anyStalker } = data;
  if (!meters.length) return null;

  const header = anyStalker ? "What's been following you" : "Your most-present card";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center" }}>
      <div
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: "var(--text-heading-md)",
          color: "var(--color-foreground)",
          opacity: 0.9,
          textAlign: "center",
        }}
      >
        {header}
      </div>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          gap: "18px 28px",
        }}
      >
        {meters.map((m) => (
          <div
            key={m.cardId}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              minWidth: 200,
            }}
          >
            <PressureGauge
              comparison={m.comparison}
              size="md"
              cardId={m.cardId}
              onCardClick={() => onOpenCard(m.cardId)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
