/**
 * EN-3 / EQ — Lunation Recap story (Spotify-Wrapped style).
 *
 * Free tier:    5 slides (0–3 content + 4 locked closer).
 * Premium tier: up to 11 slides (0–3 content + 4–9 premium content + 10 closer).
 *               Slide 8 (Top tags) is skipped if the user has zero tags
 *               this lunation, so premium total may be 10.
 *
 * URL param: lunationStart = ISO datetime of the New Moon that opens
 * this lunation.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { X, Lock } from "lucide-react";
import { getLunationRecap, getLunationReflection } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { useActiveDeckImage } from "@/lib/active-deck";
import { getCardImagePath } from "@/lib/tarot";
import { formatLunationRange } from "@/lib/lunation";
import { usePremium } from "@/lib/premium";
import { useAuth } from "@/lib/auth";
import { exportRecapPdf, shareRecapImage } from "@/lib/recap-export";
import { useTrackReversals } from "@/lib/use-track-reversals";

export const Route = createFileRoute("/insights/recap/$lunationStart")({
  head: () => ({
    meta: [{ title: "Lunation Recap — Moonseed" }],
  }),
  component: LunationRecapRoute,
});

const TOTAL_SLIDES_FREE = 5;
// EQ — Premium gets the full story: 0–3 shared, 4–9 premium content,
// 10 Save/Share/Done. Top tags (slide 8) is dropped dynamically when
// the user has no tags this lunation.
const TOTAL_SLIDES_PREMIUM_FULL = 11;

type RecapData = Awaited<ReturnType<typeof getLunationRecap>>;

/** Inline phase-glyph map (PHASE_GLYPHS in moon.ts isn't exported). */
const PHASE_GLYPHS: Record<string, string> = {
  "New Moon": "🌑",
  "Waxing Crescent": "🌒",
  "First Quarter": "🌓",
  "Waxing Gibbous": "🌔",
  "Full Moon": "🌕",
  "Waning Gibbous": "🌖",
  "Last Quarter": "🌗",
  "Waning Crescent": "🌘",
};

/**
 * EX-1 — Reverse the URL-safe encoding from LunationBanner / RecapTab.
 * Input shape: "YYYY-MM-DDTHH-MM-SS-sssZ" (or already-decoded ISO).
 * Output shape: standard ISO "YYYY-MM-DDTHH:MM:SS.sssZ".
 * If the input doesn't match the encoded shape, return as-is so an
 * already-decoded value still works.
 */
function decodeIsoLunationParam(raw: string): string {
  const m = raw.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/,
  );
  if (!m) return raw;
  return `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5]}Z`;
}

function LunationRecapRoute() {
  const { lunationStart: lunationStartRaw } = Route.useParams();
  // EX-1 — Reverse the ':'/'.' → '-' encoding applied at navigate time.
  // The ISO date portion (YYYY-MM-DD) keeps its hyphens; we only
  // rewrite the time portion after the 'T'.
  const lunationStart = decodeIsoLunationParam(lunationStartRaw);
  const navigate = useNavigate();
  const fn = useServerFn(getLunationRecap);
  const [data, setData] = useState<RecapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [slide, setSlide] = useState(0);
  const [reflection, setReflection] = useState<string | null>(null);
  const { user } = useAuth();
  const { isPremium } = usePremium(user?.id);
  // ER-8 — drop the reversal slide from the premium order when off.
  const { trackReversals } = useTrackReversals();

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

  // Compute effective premium slide count: drop the Top Tags slide (index 8)
  // when there are no tags. The closer (10) becomes 9 in that case.
  const hasTags = useMemo(
    () => Boolean(data?.topTags && data.topTags.length > 0),
    [data],
  );
  const total = isPremium
    ? TOTAL_SLIDES_PREMIUM_FULL -
      (hasTags ? 0 : 1) -
      (trackReversals ? 0 : 1)
    : TOTAL_SLIDES_FREE;

  const next = () => setSlide((s) => Math.min(s + 1, total - 1));
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
        {Array.from({ length: total }).map((_, i) => (
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
          <SlideContent
            data={data}
            slide={slide}
            isPremium={isPremium}
            hasTags={hasTags}
            trackReversals={trackReversals}
            lunationStart={lunationStart}
            reflection={reflection}
            onReflection={setReflection}
            onClose={close}
            onPremium={() => {
              window.dispatchEvent(
                new CustomEvent("moonseed:open-premium", {
                  detail: { feature: "Full Lunation Recap", featureName: "Full Lunation Recap" },
                }),
              );
            }}
          />
        )}
      </div>
    </div>
  );
}

function SlideContent({
  data,
  slide,
  isPremium,
  hasTags,
  trackReversals,
  lunationStart,
  reflection,
  onReflection,
  onClose,
  onPremium,
}: {
  data: RecapData;
  slide: number;
  isPremium: boolean;
  hasTags: boolean;
  trackReversals: boolean;
  lunationStart: string;
  reflection: string | null;
  onReflection: (r: string | null) => void;
  onClose: () => void;
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

  // Free users: locked closer at slide 4.
  if (!isPremium) {
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

  // Premium slides 4–9 / 10 (or 4–8 / 9 when topTags is empty).
  // Build the active premium-slide order so we can branch by index.
  const premiumOrder: Array<
    "majorMinor" | "reversal" | "moonPhase" | "pairs" | "tags" | "reflection" | "closer"
  > = [
    "majorMinor",
    ...((trackReversals ? (["reversal"] as const) : []) as Array<"reversal">),
    "moonPhase",
    "pairs",
    ...(hasTags ? (["tags"] as const) : []),
    "reflection",
    "closer",
  ];
  const premiumIdx = slide - 4;
  const kind = premiumOrder[premiumIdx];

  if (kind === "majorMinor") return <SlideMajorMinor data={data} />;
  if (kind === "reversal") return <SlideReversal data={data} />;
  if (kind === "moonPhase") return <SlideTopMoonPhase data={data} />;
  if (kind === "pairs") return <SlideCardPairs data={data} />;
  if (kind === "tags") return <SlideTopTags data={data} />;
  if (kind === "reflection")
    return (
      <PremiumReflectionSlide lunationStart={lunationStart} onReflection={onReflection} />
    );
  if (kind === "closer")
    return <SlideSaveShareDone onClose={onClose} reflection={reflection} data={data} />;
  return null;
}

/* ============================================================
 * EQ-2 — Major / Minor
 * ============================================================ */
function SlideMajorMinor({ data }: { data: RecapData }) {
  const { major, minor } = data.majorMinor;
  const isMajor = major >= minor;
  const top = isMajor ? major : minor;
  const label = isMajor ? "Major" : "Minor";
  const balanced = Math.abs(major - minor) <= 10;
  const descriptor = balanced
    ? "both threads woven"
    : isMajor
    ? "big-life-themes"
    : "day-to-day rhythm";
  return (
    <SlideShell>
      <Eyebrow>Major / Minor</Eyebrow>
      <BigNumber>{Math.round(top)}%</BigNumber>
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "clamp(1.4rem, 5vw, 2rem)",
          color: "var(--gold)",
        }}
      >
        {label}
      </div>
      {/* Stacked bar */}
      <div
        style={{
          width: "min(320px, 80vw)",
          height: 14,
          borderRadius: 999,
          overflow: "hidden",
          display: "flex",
          marginTop: 10,
          background: "color-mix(in oklab, var(--color-foreground) 12%, transparent)",
        }}
      >
        <div style={{ width: `${major}%`, background: "var(--gold)" }} />
        <div
          style={{
            width: `${minor}%`,
            background: "color-mix(in oklab, var(--gold) 35%, transparent)",
          }}
        />
      </div>
      <Caption>
        This lunation leaned {balanced ? "balanced" : isMajor ? "major" : "minor"} — {descriptor}.
      </Caption>
    </SlideShell>
  );
}

/* ============================================================
 * EQ-3 — Reversal pattern
 * ============================================================ */
function SlideReversal({ data }: { data: RecapData }) {
  const pct = Math.round(data.reversalRate * 100);
  const caption =
    pct >= 50
      ? "— internalized energy"
      : pct >= 25
      ? "— a balance of inner and outer"
      : "— outward, forward energy";
  return (
    <SlideShell>
      <Eyebrow>Reversal pattern</Eyebrow>
      <BigNumber>{pct}%</BigNumber>
      <Caption>of cards arrived reversed</Caption>
      <Caption>{caption}</Caption>
    </SlideShell>
  );
}

/* ============================================================
 * EQ-4 — Top moon phase
 * ============================================================ */
function SlideTopMoonPhase({ data }: { data: RecapData }) {
  if (!data.topMoonPhase) {
    return (
      <SlideShell>
        <Eyebrow>Moon phase</Eyebrow>
        <Caption>No moon-phase pattern this cycle.</Caption>
      </SlideShell>
    );
  }
  const { phase, count } = data.topMoonPhase;
  const glyph = PHASE_GLYPHS[phase] ?? "🌙";
  return (
    <SlideShell>
      <Eyebrow>Top moon phase</Eyebrow>
      <div style={{ fontSize: "clamp(4rem, 18vw, 7rem)", lineHeight: 1 }}>{glyph}</div>
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "clamp(1.6rem, 6vw, 2.4rem)",
          color: "var(--gold)",
        }}
      >
        {phase}
      </div>
      <Caption>You read most under the {phase}.</Caption>
      <Caption>
        {count} reading{count === 1 ? "" : "s"} during the {phase}.
      </Caption>
    </SlideShell>
  );
}

/* ============================================================
 * EQ-5 — Card pairs
 * ============================================================ */
function SlideCardPairs({ data }: { data: RecapData }) {
  const pairs = data.topPairs.slice(0, 3);
  if (pairs.length === 0) {
    return (
      <SlideShell>
        <Eyebrow>Card pairs</Eyebrow>
        <Caption>No notable pairs yet — try larger spreads.</Caption>
      </SlideShell>
    );
  }
  return (
    <SlideShell>
      <Eyebrow>Card pairs</Eyebrow>
      <div className="flex flex-col gap-3" style={{ marginTop: 8 }}>
        {pairs.map((p) => (
          <div
            key={`${p.cardA}:${p.cardB}`}
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "clamp(1rem, 4vw, 1.4rem)",
              color: "var(--color-foreground)",
              lineHeight: 1.3,
            }}
          >
            <span style={{ color: "var(--gold)" }}>{p.cardAName}</span>
            <span style={{ opacity: 0.6, margin: "0 0.5em" }}>+</span>
            <span style={{ color: "var(--gold)" }}>{p.cardBName}</span>
            <span style={{ opacity: 0.6, marginLeft: "0.6em" }}>×{p.count}</span>
          </div>
        ))}
      </div>
      <Caption>Cards that arrived together, again and again.</Caption>
    </SlideShell>
  );
}

/* ============================================================
 * EQ-6 — Top tags
 * ============================================================ */
function SlideTopTags({ data }: { data: RecapData }) {
  const tags = data.topTags.slice(0, 8);
  const top = tags[0];
  // Size each tag by frequency for a tag-cloud feel.
  const maxCount = Math.max(...tags.map((t) => t.count), 1);
  return (
    <SlideShell>
      <Eyebrow>Top themes</Eyebrow>
      <div
        className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1"
        style={{ maxWidth: 360 }}
      >
        {tags.map((t) => {
          const ratio = t.count / maxCount;
          const size = 0.9 + ratio * 1.4; // rem
          return (
            <span
              key={t.tagName}
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: `${size.toFixed(2)}rem`,
                color: ratio > 0.66 ? "var(--gold)" : "var(--color-foreground)",
                opacity: 0.5 + ratio * 0.5,
                lineHeight: 1.2,
              }}
            >
              {t.tagName}
            </span>
          );
        })}
      </div>
      {top && (
        <Caption>
          Your most-tagged moment: {top.tagName}. {top.count} reading
          {top.count === 1 ? "" : "s"} carried it.
        </Caption>
      )}
    </SlideShell>
  );
}

function PremiumReflectionSlide({
  lunationStart,
  onReflection,
}: {
  lunationStart: string;
  onReflection?: (r: string | null) => void;
}) {
  const fn = useServerFn(getLunationReflection);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const r = await fn({ data: { lunationStart }, headers });
        if (cancelled) return;
        if (r.ok) {
          setText(r.reflection);
          onReflection?.(r.reflection);
        } else {
          setErr(r.error);
          onReflection?.(null);
        }
      } catch {
        if (!cancelled) {
          setErr("ai_unavailable");
          onReflection?.(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lunationStart, fn, onReflection]);
  return (
    <SlideShell>
      <Eyebrow>Reflection</Eyebrow>
      {!text && !err && <Caption>Listening to the lunation…</Caption>}
      {err && <Caption>The reflection is unavailable right now.</Caption>}
      {text && (
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body)",
            lineHeight: 1.6,
            color: "var(--color-foreground)",
            maxWidth: 420,
            whiteSpace: "pre-line",
          }}
        >
          {text}
        </div>
      )}
    </SlideShell>
  );
}

/* ============================================================
 * EQ-8 — Save / Share / Done (stub buttons)
 * Full PDF export and share-image wiring lands in the next chunk.
 * For now: Save/Share toast a placeholder, Done navigates back.
 * ============================================================ */
function SlideSaveShareDone({
  onClose,
  reflection,
  data,
}: {
  onClose: () => void;
  reflection: string | null;
  data: RecapData;
}) {
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "pdf" | "share">(null);
  const flash = (text: string) => {
    setMsg(text);
    setTimeout(() => setMsg(null), 2400);
  };

  const handlePdf = async () => {
    if (busy) return;
    setBusy("pdf");
    try {
      await exportRecapPdf(data, reflection);
      flash("PDF saved.");
    } catch (e) {
      console.error(e);
      flash("Couldn't save the PDF.");
    } finally {
      setBusy(null);
    }
  };

  const handleShare = async () => {
    if (busy) return;
    setBusy("share");
    try {
      const node = document.getElementById("recap-share-card");
      if (!node) {
        flash("Nothing to share yet.");
        return;
      }
      const filename = `lunation-${data.lunationStart.slice(0, 10)}.png`;
      const result = await shareRecapImage(node as HTMLElement, filename);
      flash(result.shared ? "Shared." : "Image saved.");
    } catch (e) {
      console.error(e);
      flash("Couldn't generate the image.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <SlideShell>
      <Caption>Save this lunation, or share it.</Caption>
      {/* Off-screen share canvas — captured by html2canvas-pro. */}
      <div
        id="recap-share-card"
        aria-hidden
        style={{
          position: "fixed",
          left: -10000,
          top: 0,
          width: 540,
          height: 720,
          padding: 48,
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "radial-gradient(ellipse at top, rgba(206,168,92,0.18), #0a0a14 70%)",
          color: "#e8e2d4",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
        }}
      >
        <div style={{ textAlign: "center" }}>
          <div style={{ letterSpacing: "0.25em", fontSize: 12, opacity: 0.6, textTransform: "uppercase" }}>
            Moonseed
          </div>
          <div style={{ color: "#cea85c", fontSize: 36, marginTop: 18 }}>Your Lunation</div>
          <div style={{ opacity: 0.7, fontSize: 14, marginTop: 6 }}>
            {new Date(data.lunationStart).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}{" "}
            –{" "}
            {new Date(data.lunationEnd).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#cea85c", fontSize: 96, lineHeight: 1 }}>{data.readingCount}</div>
          <div style={{ opacity: 0.75, marginTop: 8 }}>
            reading{data.readingCount === 1 ? "" : "s"} this cycle
          </div>
          {data.topStalker && (
            <div style={{ marginTop: 28, opacity: 0.85 }}>
              Top card: <span style={{ color: "#cea85c" }}>{data.topStalker.cardName}</span>
            </div>
          )}
          {data.topMoonPhase && (
            <div style={{ marginTop: 6, opacity: 0.7 }}>under the {data.topMoonPhase.phase}</div>
          )}
        </div>
        <div style={{ textAlign: "center", opacity: 0.55, fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase" }}>
          moonseed
        </div>
      </div>
      <div
        className="pointer-events-auto flex flex-col items-center gap-5"
        style={{ marginTop: 18 }}
      >
        <button
          type="button"
          onClick={handlePdf}
          disabled={busy !== null}
          style={closerButtonStyle}
        >
          {busy === "pdf" ? "Saving…" : "Save as PDF"}
        </button>
        <button
          type="button"
          onClick={handleShare}
          disabled={busy !== null}
          style={closerButtonStyle}
        >
          {busy === "share" ? "Preparing…" : "Share image"}
        </button>
        <button
          type="button"
          onClick={onClose}
          style={{ ...closerButtonStyle, color: "var(--gold)" }}
        >
          Done
        </button>
      </div>
      {msg && (
        <div
          style={{
            marginTop: 14,
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption, 0.75rem)",
            opacity: 0.7,
          }}
        >
          {msg}
        </div>
      )}
    </SlideShell>
  );
}

const closerButtonStyle: React.CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-body)",
  color: "var(--color-foreground)",
  borderBottom: "1px solid color-mix(in oklab, var(--gold) 60%, transparent)",
  paddingBottom: 4,
  background: "transparent",
};

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