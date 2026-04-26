import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import {
  interpretReading,
  type InterpretationPayload,
} from "@/lib/interpret.functions";
import { supabase } from "@/lib/supabase";
import { useActiveGuide } from "@/lib/use-active-guide";
import { GuideSelector } from "@/components/guides/GuideSelector";
import { useOracleMode } from "@/lib/use-oracle-mode";

type Pick = { id: number; cardIndex: number };

type Props = {
  spread: SpreadMode;
  picks: Pick[];
  onExit: () => void;
};

type LoadState =
  | { kind: "guide" }
  | { kind: "loading" }
  | { kind: "loaded"; interpretation: InterpretationPayload }
  | { kind: "limit" }
  | { kind: "error"; message: string };

/**
 * Phase 4 reading screen — shows the revealed cards and an AI-generated
 * interpretation. The interpretation request is fired once on mount; the
 * server enforces the daily limit so we trust whatever it returns.
 */
export function ReadingScreen({ spread, picks, onExit }: Props) {
  const meta = SPREAD_META[spread];
  // Start in `guide` — the user picks their reader/lens/facets first,
  // then taps "Read for me" to fire the interpretation request.
  const [state, setState] = useState<LoadState>({ kind: "guide" });
  const [retryNonce, setRetryNonce] = useState(0);
  const { guideId, lensId, facetIds } = useActiveGuide();
  const { isOracle } = useOracleMode();
  // useServerFn is the typical hook, but interpretReading needs the user's
  // bearer token in the Authorization header for requireSupabaseAuth, and
  // the default fetch on server functions doesn't add it. We call the RPC
  // ourselves with supabase.auth.getSession() to grab the JWT.
  const startedRef = useRef(false);
  const requestSeqRef = useRef(0);

  // Allow landscape on the Reading screen ONLY. Other screens stay
  // portrait-locked via the global `body::before` rotate overlay in
  // styles.css; we whitelist this screen by tagging <body>.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.setAttribute("data-allow-landscape", "true");
    return () => {
      document.body.removeAttribute("data-allow-landscape");
    };
  }, []);

  useEffect(() => {
    // Wait for the user to confirm the guide before sending the request.
    if (state.kind === "guide") return;
    // Effect runs twice in StrictMode dev — guard so we don't spend two
    // of the user's three daily readings on the same draw. Do not cancel in
    // cleanup: StrictMode immediately runs cleanup after the first pass, and
    // that was preventing the one real response from ever updating state.
    if (startedRef.current) return;
    startedRef.current = true;
    const requestSeq = ++requestSeqRef.current;
    const isCurrentRequest = () => requestSeqRef.current === requestSeq;

    void (async () => {
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          if (isCurrentRequest()) {
            setState({
              kind: "error",
              message: "You need to be signed in to receive a reading.",
            });
          }
          return;
        }

        const result = await interpretReading({
          data: { spread, picks, guideId, lensId, facetIds },
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!isCurrentRequest()) return;

        if (result.ok) {
          setState({ kind: "loaded", interpretation: result.interpretation });
        } else if (result.error === "daily_limit_reached") {
          setState({ kind: "limit" });
        } else {
          setState({ kind: "error", message: result.message });
        }
      } catch (e) {
        if (!isCurrentRequest()) return;
        console.error("ReadingScreen interpret error:", e);
        setState({
          kind: "error",
          message: isOracle
            ? "The cards could not be heard. Please try again."
            : "The reading could not be completed. Please try again.",
        });
      }
    })();
    // retryNonce intentionally re-arms the effect for the Retry button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryNonce]);

  const positionLabels =
    meta.positions ?? picks.map((_, i) => `Card ${i + 1}`);

  // Render the Guide Selector overlay before the reading begins.
  if (state.kind === "guide") {
    return (
      <GuideSelector
        ctaLabel={isOracle ? "Read for me" : "Read for me"}
        onContinue={() => setState({ kind: "loading" })}
        onSkip={() => setState({ kind: "loading" })}
      />
    );
  }

  return (
    <main
      className="fixed inset-0 z-40 flex h-[100dvh] w-full flex-col overflow-y-auto bg-[radial-gradient(ellipse_at_50%_25%,rgba(60,40,90,0.35),transparent_70%)]"
      aria-label={`${meta.label} reading`}
    >
      <button
        type="button"
        onClick={onExit}
        aria-label="Close reading"
        className="fixed right-3 top-3 z-50 inline-flex h-11 w-11 items-center justify-center rounded-full text-gold/80 transition-opacity hover:!opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        style={{
          top: "calc(env(safe-area-inset-top, 0px) + 12px)",
          right: "calc(env(safe-area-inset-right, 0px) + 12px)",
        }}
      >
        <X className="h-5 w-5" strokeWidth={1.5} />
      </button>

      <div
        className="mx-auto flex w-full max-w-2xl flex-col items-center gap-8 px-5 pb-12"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 56px)",
        }}
      >
        <header className="flex flex-col items-center gap-1.5 text-center">
          <span className="text-[10px] uppercase tracking-[0.3em] text-gold/70">
            {meta.label}
          </span>
        </header>

        <CardStrip
          picks={picks}
          positionLabels={positionLabels}
          spread={spread}
        />

        <section
          className="w-full"
          aria-live="polite"
          aria-busy={state.kind === "loading"}
        >
          {state.kind === "loading" && <ReadingLoading />}
          {state.kind === "loaded" && (
            <ReadingBody
              interpretation={state.interpretation}
              picks={picks}
              positionLabels={positionLabels}
            />
          )}
          {state.kind === "limit" && <LimitMessage onExit={onExit} />}
          {state.kind === "error" && (
            <ErrorMessage
              message={state.message}
              onRetry={() => {
                startedRef.current = false;
                setState({ kind: "loading" });
                setRetryNonce((n) => n + 1);
              }}
              onExit={onExit}
            />
          )}
        </section>

        {state.kind === "loaded" && (
          <button
            type="button"
            onClick={onExit}
            className="mt-2 rounded-full border border-gold/40 bg-gold/10 px-7 py-3 font-display text-xs uppercase tracking-[0.3em] text-gold transition-colors hover:bg-gold/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
          >
            Done
          </button>
        )}
      </div>
    </main>
  );
}

/** Compact horizontal/wrap row of revealed card faces above the reading. */
function CardStrip({
  picks,
  positionLabels,
  spread,
}: {
  picks: Pick[];
  positionLabels: string[];
  spread: SpreadMode;
}) {
  // Track viewport size + orientation. The 3-card spread doubles on
  // desktop, and any spread in landscape uses card height tuned to the
  // viewport height so the row fills 60-70% of the visible area.
  const [vp, setVp] = useState(() =>
    typeof window !== "undefined"
      ? { w: window.innerWidth, h: window.innerHeight }
      : { w: 0, h: 0 },
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () =>
      setVp({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  const isDesktop = vp.w >= 768;
  const isLandscape = vp.w > vp.h && vp.h <= 500;

  // Tighter cards for Celtic (10 cards) so the strip stays one or two rows.
  // 3-card spread doubles on desktop only — mobile portrait sizing unchanged.
  // In landscape we size by viewport height instead so cards fill ~60-70%
  // of the available vertical space in a single row.
  let w: number;
  if (isLandscape) {
    // Target card height ≈ 65% of viewport height; derive width from the
    // card aspect ratio (1.75). Then clamp so 10-card celtic still fits.
    const targetH = Math.min(vp.h * 0.65, 360);
    const targetW = Math.round(targetH / 1.75);
    // Reserve space for gaps + label so we don't overflow horizontally.
    const usableW = vp.w * 0.92;
    const gap = 12;
    const fitW = Math.floor((usableW - gap * (picks.length - 1)) / picks.length);
    w = Math.max(36, Math.min(targetW, fitW));
  } else if (picks.length >= 8) {
    w = 44;
  } else if (spread === "three") {
    w = isDesktop ? 160 : 80;
  } else if (picks.length >= 4) {
    w = 56;
  } else {
    w = 80;
  }
  const h = Math.round(w * 1.75);

  // Celtic Cross gets larger, more prominent position labels below each card
  // so the (now full-length) names like "Hopes & Fears" read clearly.
  const isCeltic = spread === "celtic";
  const labelFontSize = isCeltic ? (isDesktop ? 12 : 10) : 9;
  const labelOpacity = isCeltic ? 0.7 : 0.65;
  // Cap the label width to the card so long names truncate cleanly.
  const labelMaxWidth = isCeltic ? Math.max(w + 16, 70) : w + 12;

  return (
    <div
      className="flex flex-wrap items-end justify-center gap-x-3 gap-y-4"
      role="list"
    >
      {picks.map((pick, i) => (
        <div key={pick.id} role="listitem" className="flex flex-col items-center gap-1">
          <div
            className="overflow-hidden rounded-[6px] border border-gold/40 bg-card"
            style={{
              width: w,
              height: h,
              boxShadow: "0 4px 14px rgba(0,0,0,0.45)",
            }}
          >
            <img
              src={getCardImagePath(pick.cardIndex)}
              alt={getCardName(pick.cardIndex)}
              className="h-full w-full object-cover"
              loading="eager"
            />
          </div>
          <span
            className="font-display italic"
            style={{
              fontSize: labelFontSize,
              color: "var(--gold)",
              opacity: labelOpacity,
              letterSpacing: "0.05em",
              maxWidth: labelMaxWidth,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textAlign: "center",
            }}
          >
            {positionLabels[i] ?? `Card ${i + 1}`}
          </span>
        </div>
      ))}
    </div>
  );
}

function ReadingLoading() {
  return (
    <div className="flex flex-col items-center gap-3 py-8">
      <span
        className="reading-breathe font-display italic"
        style={{
          fontSize: 16,
          color: "var(--gold)",
          letterSpacing: "0.25em",
          textTransform: "uppercase",
        }}
      >
        Reading…
      </span>
    </div>
  );
}

function ReadingBody({
  interpretation,
  picks,
  positionLabels,
}: {
  interpretation: InterpretationPayload;
  picks: Pick[];
  positionLabels: string[];
}) {
  // Prefer model-supplied position/card labels; fall back to deterministic
  // ones so we always render even if the model trims a section.
  const positions = interpretation.positions.length
    ? interpretation.positions
    : picks.map((p, i) => ({
        position: positionLabels[i] ?? `Card ${i + 1}`,
        card: getCardName(p.cardIndex),
        interpretation: "",
      }));

  return (
    <div className="reading-fade flex flex-col gap-7">
      <p
        className="text-center"
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 16,
          lineHeight: 1.65,
          color: "color-mix(in oklab, var(--foreground) 92%, transparent)",
        }}
      >
        {interpretation.overview}
      </p>

      <ul className="flex flex-col gap-5">
        {positions.map((p, i) => (
          <li key={i} className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
              <span
                className="font-display"
                style={{
                  fontSize: 14,
                  color: "var(--gold)",
                  letterSpacing: "0.04em",
                }}
              >
                {p.card}
              </span>
              <span
                className="font-display italic"
                style={{
                  fontSize: 10,
                  color: "var(--gold)",
                  opacity: 0.6,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                }}
              >
                {p.position}
              </span>
            </div>
            <p
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 14.5,
                lineHeight: 1.65,
                color: "color-mix(in oklab, var(--foreground) 85%, transparent)",
              }}
            >
              {p.interpretation}
            </p>
          </li>
        ))}
      </ul>

      <p
        className="text-center"
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 15,
          lineHeight: 1.65,
          color: "color-mix(in oklab, var(--foreground) 80%, transparent)",
        }}
      >
        {interpretation.closing}
      </p>
    </div>
  );
}

function LimitMessage({ onExit }: { onExit: () => void }) {
  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center">
      <p
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 15.5,
          lineHeight: 1.6,
          color: "color-mix(in oklab, var(--foreground) 85%, transparent)",
          maxWidth: 320,
        }}
      >
        You&rsquo;ve drawn three times today. Return tomorrow for more
        guidance.
      </p>
      <button
        type="button"
        onClick={onExit}
        className="rounded-full border border-gold/40 bg-gold/10 px-7 py-3 font-display text-xs uppercase tracking-[0.3em] text-gold transition-colors hover:bg-gold/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
      >
        Done
      </button>
    </div>
  );
}

function ErrorMessage({
  message,
  onRetry,
  onExit,
}: {
  message: string;
  onRetry: () => void;
  onExit: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-5 py-6 text-center">
      <p
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 15.5,
          lineHeight: 1.6,
          color: "color-mix(in oklab, var(--foreground) 85%, transparent)",
          maxWidth: 320,
        }}
      >
        {message}
      </p>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onRetry}
          className="rounded-full border border-gold/50 bg-gold/15 px-6 py-3 font-display text-xs uppercase tracking-[0.3em] text-gold transition-colors hover:bg-gold/25 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={onExit}
          className="rounded-full border border-gold/30 px-6 py-3 font-display text-xs uppercase tracking-[0.3em] text-gold/80 transition-colors hover:bg-gold/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
        >
          Done
        </button>
      </div>
    </div>
  );
}