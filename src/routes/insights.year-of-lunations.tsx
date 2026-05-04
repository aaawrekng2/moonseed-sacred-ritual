/**
 * EQ-9 — Year of Lunations story (premium-only).
 *
 * 12 slides walking through the past ~13 lunations. Free / non-premium
 * users are redirected back to /insights with the premium modal opened.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { X } from "lucide-react";
import {
  getYearOfLunationsRecap,
  getYearOfLunationsReflection,
} from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { usePremium } from "@/lib/premium";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/insights/year-of-lunations")({
  head: () => ({
    meta: [{ title: "Year of Lunations — Moonseed" }],
  }),
  component: YearOfLunationsRoute,
});

type YearData = Extract<
  Awaited<ReturnType<typeof getYearOfLunationsRecap>>,
  { ok: true }
>;

const TOTAL = 12;

function YearOfLunationsRoute() {
  const navigate = useNavigate();
  const fn = useServerFn(getYearOfLunationsRecap);
  const { user } = useAuth();
  const { isPremium } = usePremium(user?.id);
  const [data, setData] = useState<YearData | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [slide, setSlide] = useState(0);

  useEffect(() => {
    if (!user) return;
    if (!isPremium) {
      window.dispatchEvent(
        new CustomEvent("moonseed:open-premium", {
          detail: { feature: "Year of Lunations", featureName: "Year of Lunations" },
        }),
      );
      void navigate({ to: "/insights" });
      return;
    }
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({ headers });
        if (cancelled) return;
        if (r.ok) setData(r);
        else setErr(r.error);
        setLoading(false);
      } catch {
        if (!cancelled) {
          setErr("ai_unavailable");
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fn, user, isPremium, navigate]);

  const close = () => navigate({ to: "/insights" });
  const next = () => setSlide((s) => Math.min(s + 1, TOTAL - 1));
  const prev = () => setSlide((s) => Math.max(s - 1, 0));

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col"
      style={{
        background:
          "radial-gradient(ellipse at top, color-mix(in oklab, var(--gold) 10%, var(--background)) 0%, var(--background) 70%)",
      }}
    >
      <div className="flex gap-1 px-3 pt-3" style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 12px)" }}>
        {Array.from({ length: TOTAL }).map((_, i) => (
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
        aria-label="Close"
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

      <button
        type="button"
        aria-label="Previous"
        onClick={prev}
        className="absolute inset-y-0 left-0 z-0 w-1/3"
      />
      <button
        type="button"
        aria-label="Next"
        onClick={next}
        className="absolute inset-y-0 right-0 z-0 w-1/3"
      />

      <div className="pointer-events-none relative z-[1] flex flex-1 items-center justify-center px-6">
        {loading && <Caption>Reading the year…</Caption>}
        {!loading && err === "not_enough_lunations" && (
          <Caption>You need at least 13 lunations of history. Keep practicing — the moon is patient.</Caption>
        )}
        {!loading && err && err !== "not_enough_lunations" && (
          <Caption>The year recap is unavailable right now.</Caption>
        )}
        {!loading && !err && data && (
          <YearSlideContent data={data} slide={slide} onClose={close} />
        )}
      </div>
    </div>
  );
}

function YearSlideContent({
  data,
  slide,
  onClose,
}: {
  data: YearData;
  slide: number;
  onClose: () => void;
}) {
  if (slide === 0) {
    return (
      <Shell>
        <Eyebrow>Your Year</Eyebrow>
        <Title>Of Lunations</Title>
        <Caption>{data.dateRange}</Caption>
        <Big>{data.totalReadings}</Big>
        <Caption>readings across {data.daysRead} days</Caption>
      </Shell>
    );
  }
  if (slide === 1) {
    const max = Math.max(...data.readingsPerLunation, 1);
    return (
      <Shell>
        <Eyebrow>Rhythm of the year</Eyebrow>
        <div className="flex items-end gap-1.5" style={{ height: 180, marginTop: 12 }}>
          {data.readingsPerLunation.map((v, i) => (
            <div
              key={i}
              style={{
                width: 16,
                height: `${(v / max) * 100}%`,
                minHeight: 4,
                background: "var(--gold)",
                opacity: 0.4 + (v / max) * 0.6,
                borderRadius: 4,
              }}
            />
          ))}
        </div>
        <Caption>13 moons, oldest to newest.</Caption>
      </Shell>
    );
  }
  if (slide === 2) {
    return (
      <Shell>
        <Eyebrow>Card of the year</Eyebrow>
        {data.topCard ? (
          <>
            <Title>{data.topCard.cardName}</Title>
            <Caption>visited {data.topCard.count} times.</Caption>
          </>
        ) : (
          <Caption>No standout card this year.</Caption>
        )}
      </Shell>
    );
  }
  if (slide === 3) {
    // Suit weather across 4 quarters (oldest -> newest order from API needs reversing).
    const quarters = data.suitByQuarter.slice().reverse();
    return (
      <Shell>
        <Eyebrow>Elemental weather</Eyebrow>
        <div className="grid grid-cols-4 gap-2" style={{ marginTop: 12, width: "min(360px, 88vw)" }}>
          {quarters.map((q, i) => {
            const total = (q.Wands ?? 0) + (q.Cups ?? 0) + (q.Swords ?? 0) + (q.Pentacles ?? 0);
            const top = ["Wands", "Cups", "Swords", "Pentacles"]
              .map((s) => ({ s, v: q[s] ?? 0 }))
              .sort((a, b) => b.v - a.v)[0];
            return (
              <div key={i} className="flex flex-col items-center gap-1" style={{ opacity: total ? 1 : 0.4 }}>
                <div style={{ fontSize: 11, opacity: 0.6 }}>Q{i + 1}</div>
                <div style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", color: "var(--gold)" }}>
                  {total ? top.s : "—"}
                </div>
              </div>
            );
          })}
        </div>
        <Caption>How each quarter felt, suit by suit.</Caption>
      </Shell>
    );
  }
  if (slide === 4) {
    return (
      <Shell>
        <Eyebrow>Top guide</Eyebrow>
        {data.topGuide ? (
          <>
            <Title>{data.topGuide.name}</Title>
            <Caption>walked with you {data.topGuide.count} times.</Caption>
          </>
        ) : (
          <Caption>No guide chosen this year.</Caption>
        )}
      </Shell>
    );
  }
  if (slide === 5) {
    return (
      <Shell>
        <Eyebrow>Top lens</Eyebrow>
        {data.topLens ? (
          <>
            <Title>{data.topLens.name}</Title>
            <Caption>your favored angle, {data.topLens.count} times.</Caption>
          </>
        ) : (
          <Caption>No lens preferred this year.</Caption>
        )}
      </Shell>
    );
  }
  if (slide === 6) {
    return (
      <Shell>
        <Eyebrow>Moon phase of the year</Eyebrow>
        <Title>{data.topMoonPhase ?? "—"}</Title>
        <Caption>The phase you returned to most.</Caption>
      </Shell>
    );
  }
  if (slide === 7) {
    return (
      <Shell>
        <Eyebrow>Recurring pairs</Eyebrow>
        {data.topPairs.length ? (
          <div className="flex flex-col gap-2" style={{ marginTop: 8 }}>
            {data.topPairs.map((p, i) => (
              <div
                key={i}
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "1.1rem",
                }}
              >
                <span style={{ color: "var(--gold)" }}>{p.cardAName}</span>
                <span style={{ opacity: 0.6, margin: "0 0.5em" }}>+</span>
                <span style={{ color: "var(--gold)" }}>{p.cardBName}</span>
                <span style={{ opacity: 0.6, marginLeft: "0.5em" }}>×{p.count}</span>
              </div>
            ))}
          </div>
        ) : (
          <Caption>No recurring pairs.</Caption>
        )}
      </Shell>
    );
  }
  if (slide === 8) {
    return (
      <Shell>
        <Eyebrow>Theme that evolved</Eyebrow>
        {data.evolvedTag ? (
          <>
            <Title>{data.evolvedTag.tag}</Title>
            <Caption>
              {data.evolvedTag.recent} recent · {data.evolvedTag.older} earlier — your relationship to it shifted.
            </Caption>
          </>
        ) : (
          <Caption>No clearly evolving theme.</Caption>
        )}
      </Shell>
    );
  }
  if (slide === 9) {
    return (
      <Shell>
        <Eyebrow>Longest streak</Eyebrow>
        <Big>{data.longestStreak}</Big>
        <Caption>day{data.longestStreak === 1 ? "" : "s"} in a row.</Caption>
      </Shell>
    );
  }
  if (slide === 10) {
    return <YearReflectionSlide />;
  }
  // slide 11 — closer
  return (
    <Shell>
      <Title>A year of moons.</Title>
      <Caption>Carry what stayed. Release what didn't.</Caption>
      <button
        type="button"
        onClick={onClose}
        className="pointer-events-auto mt-6 rounded-full px-6 py-2"
        style={{
          background: "var(--gold)",
          color: "var(--cosmos, #0a0a14)",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
        }}
      >
        Done
      </button>
    </Shell>
  );
}

function YearReflectionSlide() {
  const fn = useServerFn(getYearOfLunationsReflection);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({ data: { ack: true }, headers });
        if (cancelled) return;
        if (r.ok) setText(r.reflection);
        else setErr(r.error);
      } catch {
        if (!cancelled) setErr("ai_unavailable");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fn]);
  return (
    <Shell>
      <Eyebrow>Reflection</Eyebrow>
      {!text && !err && <Caption>Listening to the year…</Caption>}
      {err && <Caption>The reflection is unavailable right now.</Caption>}
      {text && (
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body)",
            lineHeight: 1.6,
            color: "var(--color-foreground)",
            maxWidth: 440,
            whiteSpace: "pre-line",
            textAlign: "left",
          }}
        >
          {text}
        </div>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
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
        fontSize: "0.75rem",
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        opacity: 0.55,
      }}
    >
      {children}
    </div>
  );
}
function Title({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontSize: "clamp(1.8rem, 7vw, 2.8rem)",
        color: "var(--gold)",
        lineHeight: 1.1,
      }}
    >
      {children}
    </div>
  );
}
function Big({ children }: { children: React.ReactNode }) {
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
        maxWidth: 380,
      }}
    >
      {children}
    </div>
  );
}