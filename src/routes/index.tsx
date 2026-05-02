import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Flame, X } from "lucide-react";
import { MoonCarousel } from "@/components/moon/MoonCarousel";
import { CardBack } from "@/components/cards/CardBack";
import { SpreadIconsRow } from "@/components/spreads/SpreadIconsRow";
import { useBgGradient } from "@/lib/use-bg-gradient";
import { usePortraitOnly } from "@/lib/use-portrait-only";
import { getStoredCardBack, type CardBackId } from "@/lib/card-backs";
import { useStreak } from "@/lib/use-streak";
import { useActiveCardBackUrl, useActiveDeck, useActiveDeckImage } from "@/lib/active-deck";
import { useRegisterRefresh } from "@/lib/floating-menu-context";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { supabase } from "@/lib/supabase";
import { carouselHeightForSize, useMoonPrefs } from "@/lib/use-moon-prefs";
import {
  useAutoRememberQuestion,
  useRememberScope,
  type RememberScope,
} from "@/lib/use-auto-remember-question";
import { useAuth } from "@/lib/auth";
import { updateUserPreferences } from "@/lib/user-preferences-write";
import { DAILY_RESET_EVENT, useDailyReset } from "@/lib/use-daily-reset";
import { getStartOfDayInTz, getTodayInTz, useTimezone } from "@/lib/use-timezone";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type IndexSearch = { question?: string };

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>): IndexSearch => ({
    question:
      typeof s.question === "string" && s.question.trim().length > 0 ? s.question : undefined,
  }),
  component: Index,
});

function Index() {
  // Initialize gradient + opacity systems on first mount.
  useBgGradient();
  // BX — Home / moon carousel stays portrait.
  usePortraitOnly();
  const [cardBack, setCardBack] = useState<CardBackId>("celestial");
  const [todayCard, setTodayCard] = useState<number | null>(null);
  // CE — propagate the active custom deck's photographed card back to
  // the home gateway. Hook returns null when no active deck or no back
  // photographed; CardBack falls back to the themed default.
  const customBackUrl = useActiveCardBackUrl();
  // DF-3 — Resolve today's card front through the active custom deck
  // (falls back to default Rider-Waite when no override exists).
  const getActiveDeckImage = useActiveDeckImage();
  // CL Group 5 — gate the gateway card render on active-deck loading
  // so the themed default never flashes before the photographed back.
  const { loading: deckLoading } = useActiveDeck();
  const navigate = useNavigate();
  const { currentStreak } = useStreak();
  const { user } = useAuth();
  const { effectiveTz } = useTimezone();
  const isAnonymous = !user?.email;
  // CV — Live moon prefs so the master toggle / carousel sub-toggle
  // actually control rendering on the home page.
  const moon = useMoonPrefs();
  const showMoonCarousel =
    moon.loaded && moon.moon_features_enabled && moon.moon_show_carousel;
  // CV — mobile-aware sizing for the gateway card. Uses the same
  // matchMedia pattern as MoonCarousel so the layout updates live on
  // resize/rotation rather than freezing at the mount value.
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(max-width: 639px)").matches
      : false,
  );
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia("(max-width: 639px)");
    const onChange = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    setIsMobile(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);
  // CX — track viewport width so mobile hero (90vw) re-measures on
  // rotation/resize. Default to 360 on SSR so layout is stable.
  const [viewportW, setViewportW] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 400,
  );
  const [viewportH, setViewportH] = useState(() =>
    typeof window !== "undefined" ? window.innerHeight : 800,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => {
      setViewportW(window.innerWidth);
      setViewportH(window.innerHeight);
    };
    onResize();
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
    };
  }, []);
  // DG-1 — Hero grows from remaining vertical space after reserving the
  // always-visible carousel/spread/nav bands. If even the minimum card
  // cannot fit, the page scrolls naturally instead of clipping the row.
  const carouselReserve = showMoonCarousel
    ? carouselHeightForSize(moon.moon_carousel_size, isMobile)
    : 0;
  const availableHeight =
    viewportH - carouselReserve - 90 - 64 - 64;
  const maxWidthFromHeight = availableHeight / 1.75;
  const maxWidthCap = viewportW < 768 ? viewportW * 0.9 : 360;
  const cardWidth = Math.round(
    Math.max(120, Math.min(maxWidthFromHeight, maxWidthCap)),
  );
  const cardHeight = Math.round(cardWidth * 1.75);
  // CX — Streak under-card only in mobile hero mode.
  const streakUnderCard = isMobile && !showMoonCarousel;
  const [nudgeDismissed, setNudgeDismissed] = useState(true);
  // Hydrate dismissed state on the client only to avoid SSR mismatch.
  useEffect(() => {
    try {
      const d = localStorage.getItem("auth-nudge-dismissed-date");
      const dismissed =
        d === "permanent" || d === new Date().toDateString();
      setNudgeDismissed(dismissed);
    } catch {
      setNudgeDismissed(false);
    }
  }, []);
  const dismissNudge = () => {
    try {
      localStorage.setItem(
        "auth-nudge-dismissed-date",
        new Date().toDateString(),
      );
    } catch {
      // ignore
    }
    setNudgeDismissed(true);
  };
  // Daily ritual reset — bumps `dayEpoch` whenever the local calendar
  // day flips so the gateway re-queries today's card and sibling UI
  // (the QuestionBox) can show a quiet "new day" affordance.
  // Pass the seeker's effective timezone so the daily ritual flip honors
  // their profile's tz mode (auto/device or fixed/profile) instead of
  // silently using browser local time.
  const { epoch: dayEpoch } = useDailyReset(effectiveTz);
  // Home is the only screen that exposes the Refresh icon in the
  // floating menu. Registered via context so the menu itself stays
  // route-agnostic.
  useRegisterRefresh(true);

  useEffect(() => {
    setCardBack(getStoredCardBack());
  }, []);

  // If the user already pulled a single-card draw today, surface that
  // card face on the gateway instead of the card back. Re-runs at
  // midnight (day-epoch flip) so a tab left open overnight clears the
  // stale face and falls back to the card back for the new day.
  useEffect(() => {
    let cancelled = false;
    // Optimistically clear the previous day's face the moment the
    // calendar flips — the query below will re-populate it only if
    // the seeker has already drawn for the new day.
    setTodayCard(null);
    void (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user?.id;
      if (!uid) return;
      const today = getTodayInTz(effectiveTz);
      const start = getStartOfDayInTz(today, effectiveTz);
      const end = getStartOfDayInTz(today, effectiveTz, 1);
      const { data } = await supabase
        .from("readings")
        .select("card_ids")
        .eq("user_id", uid)
        .eq("spread_type", "single")
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const first = (data as { card_ids?: number[] } | null)?.card_ids?.[0];
      if (typeof first === "number") setTodayCard(first);
    })();
    return () => {
      cancelled = true;
    };
  }, [dayEpoch, effectiveTz]);

  // DB-2.1 — Gateway padding tightens when the moon carousel is visible
  // so the spread icons aren't pushed past the bottom nav. The page also
  // scrolls (overflow-y-auto on <main>) so short viewports can reveal
  // any clipped content. Note: the section drops `flex-1` so the layout
  // is natural-height instead of viewport-stretched.
  // DD-2 — on mobile with carousel visible, anchor the gateway card just
  // under the carousel (no vertical centering), so the card hugs the
  // moon strip instead of floating in mid-page whitespace.
  return (
    <main
      className="relative grid bg-cosmos overflow-y-auto"
      style={{
        minHeight: "100dvh",
        gridTemplateRows: "auto minmax(240px, 1fr) auto auto",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 4px)",
      }}
    >
      {/* DH-1 Pane 1 — Carousel (auto-sized row). Empty when hidden. */}
      <section className="px-2 pt-1">
        {showMoonCarousel && <MoonCarousel size={moon.moon_carousel_size} />}
      </section>

      {/* DH-1 Pane 2 — Hero card centered in remaining vertical space,
          with explicit padding so it never hugs the carousel above or
          the draw icons below. */}
      <section
        className="flex flex-col items-center justify-center px-6"
        style={{ paddingTop: 24, paddingBottom: 24 }}
      >
        <div
          style={{
            position: "relative",
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <button
            type="button"
            aria-label="Begin today's draw"
            className="gateway-card-frame animate-breathe-glow overflow-hidden rounded-[12px] transition-transform active:scale-[0.98]"
            onClick={() =>
              navigate({
                to: "/draw",
                search: { spread: "single" },
              })
            }
          >
            {todayCard !== null ? (
              <div style={{ animation: "fade-in 400ms ease-out both" }}>
                <img
                  src={getActiveDeckImage(todayCard)}
                  alt={getCardName(todayCard)}
                  style={{
                    width: cardWidth,
                    height: cardHeight,
                    objectFit: "cover",
                  }}
                  loading="eager"
                />
              </div>
            ) : deckLoading ? (
              <div
                style={{
                  width: cardWidth,
                  height: cardHeight,
                  borderRadius: 12,
                  background: "color-mix(in oklab, var(--gold) 6%, transparent)",
                  border: "1px solid color-mix(in oklab, var(--gold) 18%, transparent)",
                }}
                aria-label="Loading today's card"
              />
            ) : (
              <div style={{ animation: "fade-in 400ms ease-out both" }}>
                <CardBack id={cardBack} imageUrl={customBackUrl} width={cardWidth} neutralBorder />
              </div>
            )}
          </button>
          {streakUnderCard ? (
            <div
              className="mt-3 flex items-center justify-center gap-1"
              title="Your practice streak"
              aria-label={`Practice streak: ${currentStreak} day${currentStreak === 1 ? "" : "s"}`}
            >
              <Flame size={16} style={{ color: "var(--gold)", opacity: "var(--ro-plus-20)" }} />
              <span
                style={{
                  fontSize: "13px",
                  color: "var(--gold)",
                  opacity: "var(--ro-plus-20)",
                  fontFamily: "var(--font-serif)",
                }}
              >
                {currentStreak}
              </span>
            </div>
          ) : (
            <div
              style={{
                position: "absolute",
                bottom: "12px",
                // CV — flame offset scales with the card so the hero
                // treatment doesn't pull the streak in too tight.
                left: cardWidth >= 240 ? "-56px" : "-40px",
                display: "flex",
                alignItems: "center",
                gap: "4px",
              }}
              title="Your practice streak"
              aria-label={`Practice streak: ${currentStreak} day${currentStreak === 1 ? "" : "s"}`}
            >
              <Flame size={16} style={{ color: "var(--gold)", opacity: "var(--ro-plus-20)" }} />
              <span
                style={{
                  fontSize: "13px",
                  color: "var(--gold)",
                  opacity: "var(--ro-plus-20)",
                  fontFamily: "var(--font-serif)",
                }}
              >
                {currentStreak}
              </span>
            </div>
          )}
        </div>
      </section>

      {/* DH-1 Pane 3 — Draw icons row. DH-4: generous py for breathing
          room above (from hero) and below (before bottom nav). */}
      <section className="px-6 py-6 sm:py-8">
        {isAnonymous && !nudgeDismissed && (
          <div
            className="flex items-center justify-center gap-3 px-5 py-2.5"
            style={{
              borderTop:
                "1px solid color-mix(in oklab, var(--gold) 12%, transparent)",
              boxShadow:
                "0 -4px 24px -8px color-mix(in oklab, var(--gold) 12%, transparent)",
              animation: "breathe-glow 4s ease-in-out infinite",
            }}
          >
            <button
              type="button"
              onClick={() =>
                navigate({ to: "/settings/profile" })
              }
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body-sm)",
                color: "var(--foreground)",
                opacity: 0.45,
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                textAlign: "center",
                flex: 1,
              }}
            >
              Your readings are not yet bound to an account
            </button>
            <button
              type="button"
              onClick={dismissNudge}
              aria-label="Dismiss"
              className="flex items-center justify-center flex-shrink-0"
              style={{
                color: "var(--foreground)",
                opacity: 0.2,
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            >
              <X size={13} strokeWidth={1.5} />
            </button>
          </div>
        )}
        <SpreadIconsRow
          onSelect={(spread) =>
            navigate({
              to: "/draw",
              search: { spread },
            })
          }
        />
      </section>

      {/* DH-1 Pane 4 — Spacer reserving the fixed bottom-nav height so
          Pane 3 never sits behind the nav. */}
      <div aria-hidden className="pointer-events-none" style={{ height: 80 }} />
    </main>
  );
}

function QuestionBox({
  onQuestionChange,
  initialQuestion,
}: {
  onQuestionChange: (q: string) => void;
  initialQuestion?: string;
}) {
  const QUESTION_MAX_LENGTH = 280;
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [remember, setRemember] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [autoRemember] = useAutoRememberQuestion();
  const initialFocusedRef = useRef(false);
  const [scope] = useRememberScope();
  const { user } = useAuth();
  const userId = user?.id;
  const [clearingRemembered, setClearingRemembered] = useState(false);
  const [confirmClearRememberedOpen, setConfirmClearRememberedOpen] = useState(false);
  // Tracks whether the seeker has manually turned "Remember my
  // question" OFF during this session. While true, the auto-remember
  // setting is suppressed so typing never silently re-enables the
  // toggle. Cleared if the seeker manually turns the toggle back on,
  // and reset on full page reload (this is intentionally a session-
  // only signal, not a persisted preference).
  const userDisabledRememberRef = useRef(false);
  // Confirmation gate for the Clear button so a tap doesn't
  // accidentally wipe a remembered question.
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  // "New moon day" cue: when the calendar day flips while a
  // remembered question is loaded, surface a brief pill so the seeker
  // can decide whether to keep, edit, or clear it for the new ritual.
  const [newDayCue, setNewDayCue] = useState(false);
  const valueRef = useRef("");
  useEffect(() => {
    valueRef.current = value;
  }, [value]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onReset = () => {
      // Only show the cue if there's actually a remembered question to
      // carry over — otherwise the new day starts cleanly and the
      // affordance would be noise.
      if (valueRef.current.trim().length > 0) {
        setNewDayCue(true);
      }
    };
    window.addEventListener(DAILY_RESET_EVENT, onReset);
    return () => window.removeEventListener(DAILY_RESET_EVENT, onReset);
  }, []);

  // Hydrate the remember flag (always local) and the stored question
  // value from either localStorage (device scope) or the user's
  // account row (cloud scope). Re-runs when scope or auth changes
  // so swapping scopes pulls the right value.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      let storedRemember = false;
      try {
        storedRemember = localStorage.getItem("question-remember") === "1";
      } catch {
        // ignore
      }
      if (!cancelled) setRemember(storedRemember);

      if (initialQuestion && initialQuestion.trim().length > 0) {
        const clamped = initialQuestion.slice(0, QUESTION_MAX_LENGTH);
        if (!cancelled) {
          setValue(clamped);
          onQuestionChange(clamped);
        }
      } else if (storedRemember) {
        let storedValue = "";
        if (scope === "cloud" && userId) {
          const { data } = await supabase
            .from("user_preferences")
            .select("remembered_question")
            .eq("user_id", userId)
            .maybeSingle();
          storedValue = (
            (data as { remembered_question?: string | null } | null)?.remembered_question ?? ""
          ).slice(0, QUESTION_MAX_LENGTH);
        } else {
          try {
            storedValue = (localStorage.getItem("question-value") ?? "").slice(
              0,
              QUESTION_MAX_LENGTH,
            );
          } catch {
            // ignore
          }
        }
        if (!cancelled && storedValue) {
          setValue(storedValue);
          onQuestionChange(storedValue);
        }
      }
      if (!cancelled) setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, userId]);

  // Persist whenever value or remember toggles after hydration.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (remember && scope === "device") {
        localStorage.setItem("question-value", value);
      } else {
        localStorage.removeItem("question-value");
      }
    } catch {
      // ignore
    }
    if (scope === "cloud" && userId) {
      void updateUserPreferences(userId, {
        remembered_question: remember ? value : null,
      });
    }
  }, [value, remember, hydrated, scope, userId]);

  const handleRememberToggle = () => {
    const next = !remember;
    setRemember(next);
    if (newDayCue) setNewDayCue(false);
    // Manual OFF latches the session-scoped suppression so
    // auto-remember can't quietly flip it back on while typing.
    // Manual ON releases the latch, restoring auto behavior.
    userDisabledRememberRef.current = !next;
    try {
      localStorage.setItem("question-remember", next ? "1" : "0");
      if (!next) localStorage.removeItem("question-value");
    } catch {
      // ignore
    }
    if (!next && scope === "cloud" && userId) {
      void updateUserPreferences(userId, { remembered_question: null });
    }
  };

  const handleClear = () => {
    setValue("");
    onQuestionChange("");
    if (newDayCue) setNewDayCue(false);
    try {
      localStorage.removeItem("question-value");
    } catch {
      // ignore
    }
    if (scope === "cloud" && userId) {
      void updateUserPreferences(userId, { remembered_question: null });
    }
  };

  /**
   * Wipe ONLY the remembered copy in the active scope, while leaving
   * the textarea contents alone. Useful when the seeker wants to
   * stop persisting their question without retyping it for this
   * session. The "Remember my question" toggle is also flipped off
   * since there's nothing left to remember.
   */
  const handleClearRemembered = async () => {
    setClearingRemembered(true);
    try {
      if (scope === "device") {
        try {
          localStorage.removeItem("question-value");
          localStorage.setItem("question-remember", "0");
        } catch {
          // ignore
        }
      } else if (scope === "cloud" && userId) {
        await updateUserPreferences(userId, { remembered_question: null });
        try {
          localStorage.setItem("question-remember", "0");
        } catch {
          // ignore
        }
      }
      setRemember(false);
      // Latch the session suppression so auto-remember doesn't
      // immediately turn it back on while the seeker keeps typing.
      userDisabledRememberRef.current = true;
    } finally {
      setClearingRemembered(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Hard-cap input at QUESTION_MAX_LENGTH so the question stays
    // a comfortable reading size in the reading view's pinned panel.
    const next = e.target.value.slice(0, QUESTION_MAX_LENGTH);
    setValue(next);
    onQuestionChange(next);
    // Typing on the new day acknowledges the cue — dismiss it so it
    // doesn't compete with the input.
    if (newDayCue) setNewDayCue(false);
    // Auto-flip "Remember my question" on as soon as the seeker
    // begins typing, when the corresponding setting is enabled —
    // but never if the seeker has manually turned the toggle off in
    // this session.
    if (autoRemember && !remember && !userDisabledRememberRef.current && next.trim().length > 0) {
      setRemember(true);
      try {
        localStorage.setItem("question-remember", "1");
      } catch {
        // ignore
      }
    }
  };

  return (
    <div className="w-full max-w-sm relative">
      <label htmlFor="seeker-question" className="sr-only">
        Your question for the cards
      </label>
      {/* Floating visible label — purely decorative; the sr-only
          <label> above remains the accessible name for the field.
          Sits over the top border of the textarea and fades / slides
          in only when the field is focused or has content. */}
      <span
        aria-hidden="true"
        style={{
          position: "absolute",
          top: -8,
          left: 14,
          padding: "0 6px",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-caption)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--gold)",
          opacity: focused || value ? "var(--ro-plus-40)" : 0,
          transform: `translateY(${focused || value ? "0" : "4px"})`,
          transition: "opacity 250ms ease, transform 250ms ease, color 200ms ease",
          pointerEvents: "none",
          zIndex: 1,
        }}
      >
        Your question
      </span>
      <textarea
        id="seeker-question"
        ref={(el) => {
          // Auto-focus once when arriving from "Edit question" so the
          // seeker can immediately revise their wording.
          if (el && initialQuestion && !initialFocusedRef.current) {
            initialFocusedRef.current = true;
            queueMicrotask(() => {
              try {
                el.focus();
                el.setSelectionRange(el.value.length, el.value.length);
              } catch {
                // ignore
              }
            });
          }
        }}
        value={value}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        rows={3}
        aria-label="Your question for the cards"
        maxLength={QUESTION_MAX_LENGTH}
        placeholder=""
        className="w-full resize-none bg-transparent text-center focus:outline-none"
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body)",
          lineHeight: 1.7,
          color: "var(--foreground)",
          opacity: focused || value ? "var(--ro-plus-40)" : "var(--ro-plus-20)",
          border: "1px solid",
          borderColor: focused
            ? "color-mix(in oklab, var(--gold) 40%, transparent)"
            : "color-mix(in oklab, var(--gold) 12%, transparent)",
          borderRadius: 12,
          padding: "12px 14px",
          boxShadow: focused
            ? "0 0 0 3px color-mix(in oklab, var(--gold) 18%, transparent), 0 0 18px -6px color-mix(in oklab, var(--gold) 35%, transparent)"
            : "none",
          minHeight: 72,
          transition: "opacity 250ms ease, border-color 300ms ease, box-shadow 200ms ease",
        }}
      />
      {!value && !focused && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body)",
            lineHeight: 1.7,
            color: "var(--foreground)",
            opacity: "var(--ro-plus-20)",
            textAlign: "center",
            padding: "12px 16px",
          }}
        >
          What question are you bringing to the cards?
        </div>
      )}
      {/* New-day ritual cue — appears the moment the calendar flips
          if there's a remembered question carried over from the
          previous day. Quiet, dismissible, and self-clearing once
          the seeker types or interacts with the toggle. */}
      {newDayCue && value.trim().length > 0 && (
        <button
          type="button"
          onClick={() => setNewDayCue(false)}
          aria-label="Dismiss new-day notice"
          style={{
            display: "block",
            margin: "8px auto 0",
            padding: "4px 12px",
            borderRadius: 999,
            border: "1px solid color-mix(in oklab, var(--gold) 45%, transparent)",
            background: "color-mix(in oklab, var(--gold) 12%, transparent)",
            color: "var(--gold)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption)",
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            cursor: "pointer",
            opacity: "var(--ro-plus-40)",
            transition: "opacity 200ms ease, background 200ms ease",
          }}
        >
          ✦ New moon day · question carried over
        </button>
      )}
      {/* Live character counter — only visible once the field has
          content or focus, so it doesn't add visual noise to an
          empty home screen. Warms toward gold as the seeker
          approaches the cap. */}
      {(focused || value) && (
        <div
          aria-live="polite"
          style={{
            marginTop: 4,
            textAlign: "right",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption)",
            letterSpacing: "0.05em",
            color:
              value.length >= QUESTION_MAX_LENGTH
                ? "var(--gold)"
                : value.length >= QUESTION_MAX_LENGTH * 0.9
                  ? "color-mix(in oklab, var(--gold) 75%, var(--foreground))"
                  : "var(--foreground)",
            opacity:
              value.length >= QUESTION_MAX_LENGTH * 0.9 ? "var(--ro-plus-40)" : "var(--ro-plus-20)",
            transition: "color 200ms ease, opacity 200ms ease",
          }}
        >
          {value.length} / {QUESTION_MAX_LENGTH}
        </div>
      )}
      {(focused || value.length > 0) && (
        <div
          className="flex items-center justify-center gap-3 pt-2"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-body-sm)",
            color: "var(--foreground)",
            opacity: "var(--ro-plus-20)",
          }}
        >
          <span
            role="status"
            aria-live="polite"
            aria-label={
              remember ? "Your question will be remembered" : "Your question will not be remembered"
            }
            title={
              remember
                ? "Your question will be saved for next time."
                : "Your question will be forgotten when you leave."
            }
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 8px",
              borderRadius: 999,
              fontStyle: "normal",
              fontSize: "var(--text-caption)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              border: "1px solid",
              borderColor: remember
                ? "color-mix(in oklab, var(--gold) 60%, transparent)"
                : "color-mix(in oklab, var(--foreground) 25%, transparent)",
              background: remember
                ? "color-mix(in oklab, var(--gold) 18%, transparent)"
                : "transparent",
              color: remember ? "var(--gold)" : "var(--foreground)",
              opacity: remember ? "var(--ro-plus-40)" : "var(--ro-plus-20)",
              transition:
                "background 200ms ease, border-color 200ms ease, color 200ms ease, opacity 200ms ease",
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 6,
                height: 6,
                borderRadius: 999,
                background: remember
                  ? "var(--gold)"
                  : "color-mix(in oklab, var(--foreground) 35%, transparent)",
                boxShadow: remember
                  ? "0 0 6px color-mix(in oklab, var(--gold) 60%, transparent)"
                  : "none",
                transition: "background 200ms ease, box-shadow 200ms ease",
              }}
            />
            {remember ? "Remembering" : "Not remembering"}
          </span>
          <label
            className="flex items-center gap-1.5 cursor-pointer select-none"
            style={{ fontStyle: "italic" }}
          >
            <input
              type="checkbox"
              checked={remember}
              onChange={handleRememberToggle}
              style={{
                accentColor: "var(--gold)",
                width: 12,
                height: 12,
                cursor: "pointer",
              }}
            />
            Remember my question
          </label>
          {value && (
            <button
              type="button"
              onClick={() => setConfirmClearOpen(true)}
              className="cursor-pointer underline-offset-2 hover:underline"
              style={{
                fontStyle: "italic",
                background: "none",
                border: "none",
                color: "inherit",
                padding: 0,
              }}
            >
              Clear
            </button>
          )}
          {/* Scope-aware "Clear remembered question" — visible whenever
            there's actually something remembered (the toggle is on).
            Wipes ONLY the storage location matching the seeker's
            current scope choice (device localStorage or the synced
            account row), without erasing the textarea contents. */}
          {remember && (
            <button
              type="button"
              disabled={clearingRemembered || (scope === "cloud" && !userId)}
              onClick={() => setConfirmClearRememberedOpen(true)}
              className="cursor-pointer underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
              title={
                scope === "cloud" && !userId
                  ? "Sign in to clear your synced question."
                  : scope === "cloud"
                    ? "Clear the question synced to your account."
                    : "Clear the question saved in this browser."
              }
              style={{
                fontStyle: "italic",
                background: "none",
                border: "none",
                color: "inherit",
                padding: 0,
              }}
            >
              {clearingRemembered
                ? "Clearing…"
                : scope === "cloud"
                  ? "Clear synced"
                  : "Clear remembered"}
            </button>
          )}
        </div>
      )}
      <AlertDialog open={confirmClearOpen} onOpenChange={setConfirmClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear your question?</AlertDialogTitle>
            <AlertDialogDescription>
              {remember
                ? "This will erase your question and forget the remembered version. You can't undo this."
                : "This will erase what you've typed. You can't undo this."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                handleClear();
                setConfirmClearOpen(false);
              }}
            >
              Clear question
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmClearRememberedOpen} onOpenChange={setConfirmClearRememberedOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {scope === "cloud" ? "Clear synced question?" : "Clear remembered question?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {scope === "cloud"
                ? "This will remove the question synced to your account. The text in the textarea right now will not be erased."
                : "This will remove the question saved in this browser. The text in the textarea right now will not be erased."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void (async () => {
                  await handleClearRemembered();
                  setConfirmClearRememberedOpen(false);
                })();
              }}
            >
              {scope === "cloud" ? "Clear synced" : "Clear remembered"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
