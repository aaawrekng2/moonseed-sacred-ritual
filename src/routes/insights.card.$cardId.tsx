import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, X, Lock } from "lucide-react";
import { getStalkerCardDetail } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { useActiveDeckImage, useActiveDeckCornerRadius, cornerRadiusStyle } from "@/lib/active-deck";
import { useElementWidth } from "@/lib/use-element-width";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { DEFAULT_FILTERS } from "@/lib/insights.types";
import { StalkerSparkline } from "@/components/insights/StalkerSparkline";

export const Route = createFileRoute("/insights/card/$cardId")({
  component: StalkerDetailRoute,
});

type Detail = {
  cardId: number;
  cardName: string;
  totalCount: number;
  reversedCount: number;
  firstSeen: string | null;
  lastSeen: string | null;
  appearances: Array<{
    readingId: string;
    date: string;
    spreadType: string | null;
    isReversed: boolean;
  }>;
};

function StalkerDetailRoute() {
  const { cardId } = Route.useParams();
  const cid = Number(cardId);
  const navigate = useNavigate();
  const fn = useServerFn(getStalkerCardDetail);
  const [data, setData] = useState<Detail | null>(null);
  const resolveImage = useActiveDeckImage();
  const radiusPct = useActiveDeckCornerRadius();
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const radiusStyle = cornerRadiusStyle(radiusPct, width || 200);

  useEffect(() => {
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({ data: { ...DEFAULT_FILTERS, cardId: cid }, headers });
        setData(r);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[stalker-detail] failed", e);
      }
    })();
  }, [cid, fn]);

  const close = () => navigate({ to: "/insights" });
  const url = resolveImage(cid, "display") ?? getCardImagePath(cid);
  const cardName = data?.cardName ?? getCardName(cid);

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{ background: "var(--background)" }}
    >
      <header
        className="flex items-center justify-between px-4 py-3"
        style={{ borderBottom: "1px solid var(--border-subtle)" }}
      >
        <button type="button" onClick={close} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body)",
          }}
        >
          {cardName}
        </h1>
        <button type="button" onClick={close} aria-label="Close">
          <X className="h-5 w-5" />
        </button>
      </header>

      <main className="flex-1 overflow-y-auto px-5 pb-12 pt-4">
        <div className="mx-auto flex max-w-md flex-col items-center gap-4">
          <div
            ref={ref}
            style={{
              width: 200,
              aspectRatio: "1 / 1.75",
              overflow: "hidden",
              ...radiusStyle,
            }}
          >
            <img src={url} alt={cardName} className="h-full w-full object-cover" style={radiusStyle} />
          </div>

          {data && (
            <>
              <div className="text-center">
                <div
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: "3rem",
                    color: "var(--gold)",
                    lineHeight: 1,
                  }}
                >
                  {data.totalCount}
                </div>
                <div style={{ fontStyle: "italic", opacity: 0.7 }}>
                  appearance{data.totalCount === 1 ? "" : "s"}
                </div>
                {data.reversedCount > 0 && (
                  <div
                    style={{
                      fontStyle: "italic",
                      fontSize: "var(--text-body-sm)",
                      opacity: 0.7,
                      marginTop: 4,
                    }}
                  >
                    {data.reversedCount} reversed (
                    {Math.round((data.reversedCount / Math.max(1, data.totalCount)) * 100)}%)
                  </div>
                )}
              </div>

              <StalkerSparkline
                dates={data.appearances.map((a) => a.date)}
                windowStart={
                  data.firstSeen ? new Date(data.firstSeen).getTime() : Date.now() - 90 * 86400000
                }
                windowEnd={Date.now()}
                width={280}
                height={32}
              />

              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent("moonseed:open-premium", {
                      detail: { feature: "Stalker Reflections" },
                    }),
                  )
                }
                className="flex w-full items-center justify-center gap-2 p-4"
                style={{
                  background: "color-mix(in oklch, var(--gold) 12%, transparent)",
                  borderRadius: 14,
                  color: "var(--gold)",
                  fontStyle: "italic",
                }}
              >
                <Lock className="h-4 w-4" /> Reflection — premium
              </button>

              <div className="w-full space-y-2">
                <h2
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: "var(--text-body)",
                  }}
                >
                  Appearances
                </h2>
                {data.appearances.map((a) => (
                  <button
                    key={a.readingId}
                    type="button"
                    onClick={() =>
                      navigate({ to: "/journal", search: { reading: a.readingId } as never })
                    }
                    className="flex w-full items-center justify-between p-3 text-left"
                    style={{ background: "var(--surface-card)", borderRadius: 10 }}
                  >
                    <div>
                      <div style={{ fontStyle: "italic" }}>
                        {new Date(a.date).toLocaleDateString()}
                      </div>
                      <div
                        style={{
                          fontStyle: "italic",
                          fontSize: "var(--text-caption, 0.7rem)",
                          opacity: 0.65,
                        }}
                      >
                        {a.spreadType ?? "Reading"}
                        {a.isReversed ? " · reversed" : ""}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}