import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronDown } from "lucide-react";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import {
  interpretReading,
  type InterpretationPayload,
} from "@/lib/interpret.functions";
import { supabase } from "@/lib/supabase";
import { useActiveGuide } from "@/lib/use-active-guide";
import { useOracleMode } from "@/lib/use-oracle-mode";
import { useUIDensity } from "@/lib/use-ui-density";
import { useAuth } from "@/lib/auth";
import { TopRightControls } from "@/components/nav/TopRightControls";
import {
  BUILT_IN_GUIDES,
  getGuideById,
  type CustomGuide,
} from "@/lib/guides";
import {
  READING_FONT_DEFAULT,
  READING_FONT_MAX,
  READING_FONT_MIN,
  useReadingFontSize,
} from "@/lib/use-reading-font-size";

type Pick = { id: number; cardIndex: number };

type Props = {
  spread: SpreadMode;
  picks: Pick[];
  onExit: () => void;
};

type LoadState =
  | { kind: "idle" } // cards revealed, awaiting "Let Them Speak" tap
  | { kind: "loading" }
  | { kind: "loaded"; interpretation: InterpretationPayload }
  | { kind: "limit" }
  | { kind: "error"; message: string };

/**
 * Unified reading screen. After the cards are revealed elsewhere we
 * land here in the `idle` state with the cards already showing. The
 * user picks (or accepts) their guide via an inline dropdown, then
 * taps "Let Them Speak" to trigger the AI interpretation. Everything
 * stays on a single scrollable surface — no separate Guide Selector.
 */
export function ReadingScreen({ spread, picks, onExit }: Props) {
  const meta = SPREAD_META[spread];
  const { isOracle } = useOracleMode();
  const [state, setState] = useState<LoadState>({ kind: "idle" });
  const [retryNonce, setRetryNonce] = useState(0);
  const { guideId, lensId, facetIds } = useActiveGuide();
  const startedRef = useRef(false);
  const requestSeqRef = useRef(0);

  // Allow landscape on the Reading screen ONLY (matches prior behaviour).
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.body.setAttribute("data-allow-landscape", "true");
    return () => {
      document.body.removeAttribute("data-allow-landscape");
    };
  }, []);

  const beginReading = useCallback(() => {
    if (state.kind !== "idle" && state.kind !== "error") return;
    setState({ kind: "loading" });
  }, [state.kind]);

  // Fire the interpretation request once we leave `idle`.
  useEffect(() => {
    if (state.kind !== "loading") return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [retryNonce, state.kind]);

  const positionLabels =
    meta.positions ?? picks.map((_, i) => `Card ${i + 1}`);

  return (
    <main
      className="fixed inset-0 z-40 flex h-[100dvh] w-full flex-col overflow-y-auto bg-[radial-gradient(ellipse_at_50%_25%,rgba(60,40,90,0.35),transparent_70%)]"
      aria-label={`${meta.label} reading`}
    >
      <TopRightControls onClose={onExit} closeLabel="Close reading" />

      <div
        className="mx-auto flex w-full max-w-2xl flex-col items-center gap-6 px-5 pb-12"
        style={{
          paddingTop: "calc(env(safe-area-inset-top, 0px) + 64px)",
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

        {/* Idle / loading actions. Once interpretation has loaded, these
            collapse so the prose can breathe. */}
        {(state.kind === "idle" || state.kind === "loading") && (
          <ReadingActions
            isOracle={isOracle}
            isLoading={state.kind === "loading"}
            onSpeak={beginReading}
          />
        )}

        <section
          className="w-full"
          aria-live="polite"
          aria-busy={state.kind === "loading"}
        >
          {state.kind === "loaded" && (
            <ReadingBody
              interpretation={state.interpretation}
              picks={picks}
              positionLabels={positionLabels}
            />
          )}
          {state.kind === "limit" && (
            <LimitMessage onExit={onExit} isOracle={isOracle} />
          )}
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

/* ---------------------------------------------------------------------- */
/*  Card strip — uses Clarity to show/hide position labels under cards.   */
/* ---------------------------------------------------------------------- */

function CardStrip({
  picks,
  positionLabels,
  spread,
}: {
  picks: Pick[];
  positionLabels: string[];
  spread: SpreadMode;
}) {
  const { level } = useUIDensity();
  const showLabels = level === 1; // Glimpse + Veiled hide the labels
  const labelOpacity = level === 1 ? 0.7 : 0;
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

  let w: number;
  if (isLandscape) {
    const targetH = Math.min(vp.h * 0.55, 320);
    const targetW = Math.round(targetH / 1.75);
    const usableW = vp.w * 0.92;
    const gap = 12;
    const fitW = Math.floor(
      (usableW - gap * (picks.length - 1)) / picks.length,
    );
    w = Math.max(36, Math.min(targetW, fitW));
  } else if (picks.length >= 8) {
    w = 44;
  } else if (spread === "three") {
    w = isDesktop ? 140 : 78;
  } else if (picks.length >= 4) {
    w = 56;
  } else {
    w = 78;
  }
  const h = Math.round(w * 1.75);

  const labelFontSize = w < 60 ? 9 : 10.5;
  const labelMaxWidth = Math.max(w + 14, 70);

  return (
    <div
      className="reading-cards-shift flex flex-wrap items-end justify-center gap-x-3 gap-y-4"
      role="list"
    >
      {picks.map((pick, i) => (
        <div
          key={pick.id}
          role="listitem"
          className="flex flex-col items-center gap-1"
        >
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
              opacity: showLabels ? labelOpacity : 0,
              letterSpacing: "0.05em",
              maxWidth: labelMaxWidth,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textAlign: "center",
              transition: "opacity 250ms ease",
              minHeight: 14,
            }}
          >
            {positionLabels[i] ?? `Card ${i + 1}`}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Reading actions — guide dropdown + "Let Them Speak" button            */
/* ---------------------------------------------------------------------- */

function ReadingActions({
  isOracle,
  isLoading,
  onSpeak,
}: {
  isOracle: boolean;
  isLoading: boolean;
  onSpeak: () => void;
}) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { guideId, setGuide } = useActiveGuide();
  const [open, setOpen] = useState(false);
  const [customGuides, setCustomGuides] = useState<CustomGuide[]>([]);
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // Load the user's custom guides for the dropdown.
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await (supabase as unknown as {
        from: (t: string) => {
          select: (q: string) => {
            eq: (
              col: string,
              val: string,
            ) => {
              order: (
                col: string,
                opts: { ascending: boolean },
              ) => Promise<{ data: CustomGuide[] | null; error: unknown }>;
            };
          };
        };
      })
        .from("custom_guides")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: true });
      if (cancelled || error) return;
      setCustomGuides((data as CustomGuide[]) ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!dropdownRef.current) return;
      if (!dropdownRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const activeBuiltIn = getGuideById(guideId);
  const activeCustom = customGuides.find((cg) => cg.id === guideId);
  const activeName = activeCustom ? activeCustom.name : activeBuiltIn.name;
  const activeEmoji = activeCustom ? "✦" : activeBuiltIn.accentEmoji;

  const speakLabel = isOracle ? "Let Them Speak" : "Get Reading";

  return (
    <div className="flex w-full flex-col items-center gap-4">
      {/* Guide dropdown */}
      <div ref={dropdownRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm text-gold transition-colors hover:bg-gold/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
          style={{
            opacity: "var(--ro-plus-20)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
          }}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span aria-hidden>{activeEmoji}</span>
          <span>{activeName}</span>
          <ChevronDown
            className="h-3.5 w-3.5"
            strokeWidth={1.5}
            style={{ opacity: "var(--ro-plus-20)" }}
          />
        </button>
        {open && (
          <div
            role="listbox"
            className="absolute left-1/2 top-full z-50 mt-2 w-[240px] -translate-x-1/2 rounded-xl border border-gold/30 bg-cosmos p-1.5 shadow-2xl"
          >
            {BUILT_IN_GUIDES.map((g) => (
              <button
                key={g.id}
                type="button"
                role="option"
                aria-selected={g.id === guideId}
                onClick={() => {
                  setGuide(g.id);
                  setOpen(false);
                }}
                className={
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors " +
                  (g.id === guideId
                    ? "bg-gold/15 text-gold"
                    : "text-foreground/80 hover:bg-gold/10")
                }
              >
                <span className="text-base" aria-hidden>
                  {g.accentEmoji}
                </span>
                <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}>
                  {g.name}
                </span>
              </button>
            ))}
            {customGuides.length > 0 && (
              <div className="my-1 border-t border-border/40" />
            )}
            {customGuides.map((cg) => (
              <button
                key={cg.id}
                type="button"
                role="option"
                aria-selected={cg.id === guideId}
                onClick={() => {
                  setGuide(cg.id);
                  setOpen(false);
                }}
                className={
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors " +
                  (cg.id === guideId
                    ? "bg-gold/15 text-gold"
                    : "text-foreground/80 hover:bg-gold/10")
                }
              >
                <span className="text-base" aria-hidden>
                  ✦
                </span>
                <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}>
                  {cg.name}
                </span>
              </button>
            ))}
            <div className="my-1 border-t border-border/40" />
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                void navigate({ to: "/guides" });
              }}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-gold/10"
            >
              Edit Guides…
            </button>
          </div>
        )}
      </div>

      {/* Let Them Speak button with mist animation */}
      <button
        type="button"
        onClick={onSpeak}
        disabled={isLoading}
        className="reading-mist-button relative w-full max-w-sm overflow-hidden rounded-2xl border border-gold/40 bg-cosmos px-6 py-5 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed"
      >
        <span className="reading-mist" aria-hidden />
        <span
          className="relative z-10 block"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 22,
            color: "var(--gold)",
            letterSpacing: "0.02em",
          }}
        >
          {isLoading ? (isOracle ? "Listening…" : "Reading…") : speakLabel}
        </span>
      </button>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Interpretation body — supports long-press text-size slider            */
/* ---------------------------------------------------------------------- */

function ReadingBody({
  interpretation,
  picks,
  positionLabels,
}: {
  interpretation: InterpretationPayload;
  picks: Pick[];
  positionLabels: string[];
}) {
  const { size, setSize } = useReadingFontSize();
  const [showSlider, setShowSlider] = useState(false);
  const longPressTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);

  const positions = useMemo(
    () =>
      interpretation.positions.length
        ? interpretation.positions
        : picks.map((p, i) => ({
            position: positionLabels[i] ?? `Card ${i + 1}`,
            card: getCardName(p.cardIndex),
            interpretation: "",
          })),
    [interpretation.positions, picks, positionLabels],
  );

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => {
      setShowSlider(true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    }, 550);
  };
  const cancelLongPress = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };
  const scheduleHide = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShowSlider(false), 1000);
  };

  useEffect(
    () => () => {
      if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    },
    [],
  );

  // Body text size scales with the slider; headings stay constant for rhythm.
  const bodySize = size ?? READING_FONT_DEFAULT;

  return (
    <div
      className="reading-fade flex flex-col gap-7"
      onPointerDown={onPointerDown}
      onPointerUp={cancelLongPress}
      onPointerCancel={cancelLongPress}
      onPointerLeave={cancelLongPress}
    >
      <p
        className="text-center"
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: bodySize + 1,
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
                fontSize: bodySize,
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
          fontSize: bodySize,
          lineHeight: 1.65,
          color: "color-mix(in oklab, var(--foreground) 80%, transparent)",
        }}
      >
        {interpretation.closing}
      </p>

      {showSlider && (
        <TextSizeSlider
          value={size}
          onChange={setSize}
          onRelease={scheduleHide}
          onClose={() => setShowSlider(false)}
        />
      )}
    </div>
  );
}

function TextSizeSlider({
  value,
  onChange,
  onRelease,
  onClose,
}: {
  value: number;
  onChange: (n: number) => void;
  onRelease: () => void;
  onClose: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-label="Text size"
      className="fixed left-1/2 top-1/2 z-[60] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gold/30 bg-cosmos px-5 py-4 shadow-2xl"
      style={{ animation: "reading-fade 200ms ease forwards" }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="mb-2 flex items-center justify-between gap-4">
        <span className="text-[11px] uppercase tracking-[0.2em] text-gold/80">
          Text Size
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-muted-foreground hover:text-gold"
        >
          Done
        </button>
      </div>
      <input
        type="range"
        min={READING_FONT_MIN}
        max={READING_FONT_MAX}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onPointerUp={onRelease}
        onTouchEnd={onRelease}
        className="w-56 accent-[color:var(--gold)]"
        aria-label="Reading text size"
      />
      <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
        <span>{READING_FONT_MIN}px</span>
        <span>{value}px</span>
        <span>{READING_FONT_MAX}px</span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/*  Limit / error states                                                  */
/* ---------------------------------------------------------------------- */

function LimitMessage({
  onExit,
  isOracle,
}: {
  onExit: () => void;
  isOracle: boolean;
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
        {isOracle
          ? "You have drawn three times today. The cards rest until tomorrow."
          : "You\u2019ve completed 3 readings today. Return tomorrow for more guidance."}
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