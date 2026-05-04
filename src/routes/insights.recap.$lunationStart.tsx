/**
 * EN-3 — Lunation Recap story (Spotify-Wrapped style).
 * Free tier = 5 slides. Slides 6–12 are deferred until the
 * premium subscription system ships (EO+).
 *
 * URL param: lunationStart = ISO datetime of the New Moon that opens
 * this lunation.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { X, Lock } from "lucide-react";
import { getLunationRecap } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { useActiveDeckImage } from "@/lib/active-deck";
import { getCardImagePath } from "@/lib/tarot";
import { formatLunationRange } from "@/lib/lunation";

export const Route = createFileRoute("/insights/recap/$lunationStart")({
  head: () => ({
    meta: [{ title: "Lunation Recap — Moonseed" }],
  }),
  component: LunationRecapRoute,
});

const TOTAL_SLIDES = 5; // Free tier. Premium slides 6–12 deferred (EO).

type RecapData = Awaited<ReturnType<typeof getLunationRecap>>;

function LunationRecapRoute() {
  const { lunationStart } = Route.useParams();
  const navigate = useNavigate();
  const fn = useServerFn(getLunationRecap);
  const [data, setData] = useState<RecapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({ data: { lunationStart }, headers });
        if (!cancelled) {
          setData(r);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lunationStart, fn]);

  const close = () => navigate({ to: "/insights" });
  const next = () => setSlide((s) => Math.min(s + 1, TOTAL_SLIDES - 1));
  const prev = () => setSlide((s) => Math.max(s - 1, 0));

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        background:
          "radial-gradient(ellipse at top, color-mix(in oklab, var(--gold) 8%, var(--background)) 0%, var(--background) 70%)",
      }}
    >
      {/* Top progress bar */}
      <div className="flex gap-1 px-3 pt-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
        {Array.from({ length: TOTAL_SLIDES }).map((_, i) => (
          <div
            key={i}
            className="flex-1"
            style={{
              height: 3,
              borderRadius: 2,
              background:
                i < slide
                  ? "var(--gold)"
                  : i === slide
                  ? "color-mix(in oklab, var(--gold) 80%, transparent)"
                  : "color-mix(in oklab, var(--color-foreground) 18%, transparent)",
              transition: "background 200ms ease",
            }}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={close}
        aria-label="Close recap"
        className="absolute z-10 rounded-full p-2"
        style={{
          top: "calc(env(safe-area-inset-top, 0px) + 24px)",
          right: 12,
          background: "color-mix(in oklab, var(--cosmos, #0a0a14) 35%, transparent)",
          color: "var(--color-foreground)",
        }}
      >
        <X size={18} />
      </button>

      {/* Tap zones */}
      <button
        type="button"
        aria-label="Previous slide"
        onClick={prev}
        className="absolute inset-y-0 left-0 z-0 w-1/3"
        style={{ background: "transparent" }}
      />
      <button
        type="button"
        aria-label="Next slide"
        onClick={next}
        className="absolute inset-y-0 right-0 z-0 w-1/3"
        style={{ background: "transparent" }}
      />

      <div className="pointer-events-none relative z-[1] flex flex-1 items-center justify-center px-6">
        {loading && (
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              opacity: 0.6,
            }}
          >
            Reading the moon…
          </div>
        )}
        {!loading && data && (
          <SlideContent data={data} slide={slide} onPremium={() => {
            window.dispatchEvent(
              new CustomEvent("moonseed:open-premium", {
                detail: { feature: "Full Lunation Recap", featureName: "Full Lunation Recap" },
              }),
            );
          }} />
        )}
      </div>
    </div>
  );
}

function SlideContent({
  data,
  slide,
  onPremium,
}: {
  data: RecapData;
  slide: number;
  onPremium: () => void;
}) {
  const range = formatLunationRange({
    start: new Date(data.lunationStart),
    end: new Date(data.lunationEnd),
  });

  if (slide === 0) {
    return (
      <SlideShell>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "clamp(2rem, 8vw, 3.5rem)",
            color: "var(--gold)",
            lineHeight: 1.1,
          }}
        >
          Your Lunation
        </div>
        <Caption>{range}</Caption>
        <BigNumber>{data.readingCount}</BigNumber>
        <Caption>reading{data.readingCount === 1 ? "" : "s"} in this cycle</Caption>
      </SlideShell>
    );
  }

  if (slide === 1) {
    return (
      <SlideShell>
        <Eyebrow>Top stalker</Eyebrow>
        {data.topStalker ? (
          <>
            <StalkerImage cardId={data.topStalker.cardId} />
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "clamp(1.6rem, 6vw, 2.4rem)",
                color: "var(--color-foreground)",
                marginTop: 16,
              }}
            >
              {data.topStalker.cardName}
            </div>
            <Caption>kept arriving — {data.topStalker.count} times.</Caption>
          </>
        ) : (
          <Caption>No card stood out this cycle.</Caption>
        )}
      </SlideShell>
    );
  }

  if (slide === 2) {
    const sb = data.suitBalance;
    const suits: Array<{ name: string; v: number; color: string }> = [
      { name: "Wands", v: sb.wands, color: "var(--suit-wands, #C75D2E)" },
      { name: "Cups", v: sb.cups, color: "var(--suit-cups, #2E73C7)" },
      { name: "Swords", v: sb.swords, color: "var(--suit-swords, #B8B8C4)" },
      { name: "Pentacles", v: sb.pentacles, color: "var(--suit-pentacles, #6B8E4E)" },
    ];
    const top = suits.sort((a, b) => b.v - a.v)[0];
    return (
      <SlideShell>
        <Eyebrow>Suit balance</Eyebrow>
        <BigNumber>{Math.round(top.v)}%</BigNumber>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "clamp(1.4rem, 5vw, 2rem)",
            color: top.color,
          }}
        >
          {top.name}
        </div>
        <Caption>led the cycle's elemental weather.</Caption>
      </SlideShell>
    );
  }

  if (slide === 3) {
    return (
      <SlideShell>
        <Eyebrow>Top guide</Eyebrow>
        {data.topGuide ? (
          <>
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "clamp(2rem, 7vw, 3rem)",
                color: "var(--gold)",
                marginTop: 8,
              }}
            >
              {data.topGuide.name}
            </div>
            <Caption>walked with you {data.topGuide.count} time{data.topGuide.count === 1 ? "" : "s"}.</Caption>
          </>
        ) : (
          <Caption>No guide chosen this cycle.</Caption>
        )}
      </SlideShell>
    );
  }

  // Slide 4 — premium teaser closer.
  return (
    <SlideShell>
      <Lock size={28} style={{ color: "var(--gold)", opacity: 0.85 }} />
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "clamp(1.6rem, 6vw, 2.4rem)",
          color: "var(--gold)",
          marginTop: 8,
          lineHeight: 1.2,
        }}
      >
        There&rsquo;s more to this lunation.
      </div>
      <Caption>
        Major / minor balance, reversal patterns, moon phases, card pairs, themes,
        and a written reflection — all wait inside Premium.
      </Caption>
      <button
        type="button"
        onClick={onPremium}
        className="pointer-events-auto mt-4 rounded-full px-6 py-2"
        style={{
          background: "var(--gold)",
          color: "var(--cosmos, #0a0a14)",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body)",
        }}
      >
        Unlock the full recap
      </button>
    </SlideShell>
  );
}

function SlideShell({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="pointer-events-none flex flex-col items-center justify-center gap-3 text-center"
      style={{ animation: "fade-in 280ms ease-out" }}
    >
      {children}
    </div>
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontSize: "var(--text-caption, 0.75rem)",
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        opacity: 0.55,
      }}
    >
      {children}
    </div>
  );
}

function BigNumber({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontSize: "clamp(3.5rem, 14vw, 6rem)",
        color: "var(--gold)",
        lineHeight: 1,
      }}
    >
      {children}
    </div>
  );
}

function Caption({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontSize: "var(--text-body)",
        opacity: 0.75,
        maxWidth: 360,
      }}
    >
      {children}
    </div>
  );
}

function StalkerImage({ cardId }: { cardId: number }) {
  const resolveImage = useActiveDeckImage();
  const url = resolveImage(cardId, "thumbnail") ?? getCardImagePath(cardId);
  return (
    <img
      src={url}
      alt=""
      style={{
        width: 140,
        height: 240,
        objectFit: "cover",
        borderRadius: 10,
        boxShadow: "0 8px 32px color-mix(in oklab, var(--gold) 25%, transparent)",
      }}
    />
  );
}