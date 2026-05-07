import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { MoonCarousel } from "@/components/moon/MoonCarousel";
import { MoonStreakIcon } from "@/components/streak/MoonStreakIcon";
import {
  streakPhaseState,
  STREAK_ELEMENT_COLORS,
  type StreakElement,
} from "@/lib/streak-phase";
import { Hint, isHintHardDismissed } from "@/components/hints/Hint";
import { CardImage } from "@/components/card/CardImage";
import { SpreadIconsRow } from "@/components/spreads/SpreadIconsRow";
import { usePortraitOnly } from "@/lib/use-portrait-only";
import { getStoredCardBack, type CardBackId } from "@/lib/card-backs";
import { useStreak } from "@/lib/use-streak";
import { useActiveCardBackUrl, useActiveDeck } from "@/lib/active-deck";
import { useRegisterRefresh } from "@/lib/floating-menu-context";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type IndexSearch = { question?: string };

export const Route = createFileRoute("/")({
  validateSearch: (s: Record<string, unknown>): IndexSearch => ({
    question:
      typeof s.question === "string" && s.question.trim().length > 0 ? s.question : undefined,
  }),
  component: Index,
});

function Index() {
  // DC-2.2 — Theme tokens (including --bg-gradient-left/right) are
  // written ONLY by the pre-paint boot script in __root.tsx, by
  // usePreferencesSync after auth, and by explicit user theme picks.
  // useBgGradient() used to run here and silently re-applied the
  // 'midnight' bg-preset every Home mount, clobbering the seeker's
  // active community theme. Removed.
  // BX — Home / moon carousel stays portrait.
  usePortraitOnly();
  const [cardBack, setCardBack] = useState<CardBackId>("celestial");
  const [todayCard, setTodayCard] = useState<number | null>(null);
  // EW-2 — track today's draw orientation so the gateway face rotates
  // 180° when the seeker drew a reversed card.
  const [todayReversed, setTodayReversed] = useState<boolean>(false);
  // EX-2 — tracks whether we've finished checking the today-draw query
  // at least once, so we don't flash the card-back during the async
  // resolution on warm reopen.
  const [hasCheckedTodayDraw, setHasCheckedTodayDraw] = useState(false);
  // CE — propagate the active custom deck's photographed card back to
  // the home gateway. Hook returns null when no active deck or no back
  // photographed; CardBack falls back to the themed default.
  const customBackUrl = useActiveCardBackUrl();
  // EW-2 — image / radius / loading are now handled inside CardImage.
  // CL Group 5 — gate the gateway card render on active-deck loading
  // so the themed default never flashes before the photographed back.
  const { activeDeck, loading: deckLoading } = useActiveDeck();
  // EW-2 — heroImageLoaded state lives inside CardImage now.
  const [skeletonTimedOut, setSkeletonTimedOut] = useState(false);
  // ES-1 — Watch the hero <section>'s actual content box. On warm
  // reopen, viewportH is correct but the moon carousel snaps in late
  // and shrinks the available pane after the initial layout pass.
  // No window resize event fires for that, so cardWidth was previously
  // computed against the stale (too-large) layout and bled past the
  // section's right/bottom edge. ResizeObserver triggers a recompute
  // whenever the section's content box settles to a new size.
  const heroSectionRef = useRef<HTMLElement | null>(null);
  const [sectionContentBox, setSectionContentBox] = useState<{ w: number; h: number } | null>(
    null,
  );
  useEffect(() => {
    const node = heroSectionRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setSectionContentBox((prev) => {
        if (
          prev &&
          Math.abs(prev.w - width) < 2 &&
          Math.abs(prev.h - height) < 2
        ) {
          return prev;
        }
        return { w: Math.round(width), h: Math.round(height) };
      });
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!deckLoading) {
      setSkeletonTimedOut(false);
      return;
    }
    const t = window.setTimeout(() => setSkeletonTimedOut(true), 1500);
    return () => window.clearTimeout(t);
  }, [deckLoading]);
  const navigate = useNavigate();
  const { currentStreak, longestStreak } = useStreak();
  // EG-4 — Streak glyph is locked to streak progression (NOT today's
  // sky moon phase). The MoonCarousel handles current-phase display.
  const [streakModalOpen, setStreakModalOpen] = useState(false);
  // EG-3 — first-time onboarding hint anchored to the spread icons row.
  const drawTypeRowRef = useRef<HTMLDivElement | null>(null);
  const [showDrawTypeHint, setShowDrawTypeHint] = useState(false);
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
  // DL-1 — Hero card sizes responsively from the available pane height.
  // The pane fills remaining vertical space between carousel and the
  // fixed draw-icons row; the card adopts the pane's height while
  // capping width at 90vw / 360px so it never overflows. cardWidth is
  // still computed for child elements (CardBack, flame offset).
  const carouselReserve = showMoonCarousel
    ? carouselHeightForSize(moon.moon_carousel_size, isMobile)
    : 0;
  // 64 bottom-nav + 64 fixed icons row + breathing room.
  // DN-1 — Bump reservation to 274 so tablets (where DM-2's nav grew
  // slightly taller via min-height + safe-area) keep a clean gap above
  // the fixed draw-icons row.
  const availablePaneHeight = Math.max(
    220,
    viewportH - carouselReserve - 274,
  );
  // DW — subtract the hero section's vertical padding (24 top + 24 bottom)
  // from the available pane before deriving the card's width. Without this
  // the card height (= cardWidth * 1.75) exceeds the section's content box
  // and gets clipped by `overflow: hidden`, producing the right/bottom
  // crop seen on first paint (especially in incognito / cold sessions
  // where the moon carousel snaps in late and shrinks the pane further).
  const PANE_PADDING_Y = 48;
  // ER-1 — the hero <section> uses px-6 (24px each side). The
  // previous cap of `viewportW * 0.9` ignored that, so on narrow
  // viewports (≤375px) the card width could exceed the section's
  // content box and bleed off the right edge — visible after a warm
  // reopen where the carousel snaps in late and the recompute lands
  // at the smaller pane height. Reserve the parent's horizontal
  // padding (plus a 4px breathing margin so the breathe-glow halo
  // never hugs the edge) before deriving the card width.
  const HERO_SECTION_PADDING_X = 24;
  const HERO_SAFETY_MARGIN_X = 4;
  const horizontalReserve = (HERO_SECTION_PADDING_X + HERO_SAFETY_MARGIN_X) * 2;
  const safeViewportW = Math.max(0, viewportW - horizontalReserve);
  const maxWidthCap = viewportW < 768 ? safeViewportW : Math.min(360, safeViewportW);
  const heightDerivedWidth = Math.max(0, availablePaneHeight - PANE_PADDING_Y) / 1.75;
  // ES-1 — Prefer the section's actual measured content box (from
  // ResizeObserver) over viewportH-derived availablePaneHeight, since
  // the section can shrink after the moon carousel snaps in late on
  // warm reopen.
  const measuredHeightDerivedWidth = sectionContentBox
    ? Math.max(0, sectionContentBox.h - PANE_PADDING_Y) / 1.75
    : heightDerivedWidth;
  const measuredMaxWidthCap = sectionContentBox
    ? Math.min(maxWidthCap, sectionContentBox.w - HERO_SAFETY_MARGIN_X * 2)
    : maxWidthCap;
  const computedCardWidth = Math.round(
    Math.max(120, Math.min(measuredHeightDerivedWidth, measuredMaxWidthCap)),
  );
  // ER-2 — re-measure after the hero <img> actually loads so the
  // corner-radius calc uses the final rendered width, not the stale
  // pre-load layout width. Same pattern as EI-2 fix in CardZoomModal.
  const [measuredCardWidth, setMeasuredCardWidth] = useState<number | null>(null);
  const cardWidth = measuredCardWidth ?? computedCardWidth;
  const cardHeight = Math.round(cardWidth * 1.75);
  // Reset the measured width whenever the computed (layout-derived)
  // width changes, so a viewport rotation or carousel toggle doesn't
 // freeze the card at a stale measurement.
  useEffect(() => {
    setMeasuredCardWidth(null);
  }, [computedCardWidth]);
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
    setHasCheckedTodayDraw(false); // EX-2 — reset on day flip / re-check
    void (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user?.id;
      if (!uid) {
        if (!cancelled) setHasCheckedTodayDraw(true);
        return;
      }
      const today = getTodayInTz(effectiveTz);
      const start = getStartOfDayInTz(today, effectiveTz);
      const end = getStartOfDayInTz(today, effectiveTz, 1);
      const { data } = await supabase
        .from("readings")
        .select("card_ids,card_orientations")
        .eq("user_id", uid)
        .eq("spread_type", "single")
        .is("archived_at", null)
        .gte("created_at", start.toISOString())
        .lt("created_at", end.toISOString())
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const row = data as
        | { card_ids?: number[]; card_orientations?: boolean[] }
        | null;
      const first = row?.card_ids?.[0];
      if (typeof first === "number") {
        setTodayCard(first);
        setTodayReversed(!!row?.card_orientations?.[0]);
      }
      setHasCheckedTodayDraw(true); // EX-2 — always set, even with no row
    })();
    return () => {
      cancelled = true;
    };
  }, [dayEpoch, effectiveTz]);

  // EG-3 — Mount the draw-type hint only when not hard-dismissed.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const dismissed = await isHintHardDismissed(
        "home_draw_type_select",
        user?.id ?? null,
      );
      if (!cancelled && !dismissed) setShowDrawTypeHint(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  // EW-2 — CardImage handles its own image-load shimmer. We only need
  // a shimmer here while the active deck is still resolving so the
  // CardBack fallback doesn't flash the default before we know whether
  // the seeker has a custom photographed back.
  const showSkeleton =
    (deckLoading && !skeletonTimedOut) ||
    (todayCard === null && activeDeck === null && !skeletonTimedOut && !customBackUrl);

  // DB-2.1 — Gateway padding tightens when the moon carousel is visible
  // so the spread icons aren't pushed past the bottom nav. The page also
  // scrolls (overflow-y-auto on <main>) so short viewports can reveal
  // any clipped content. Note: the section drops `flex-1` so the layout
  // is natural-height instead of viewport-stretched.
  // DD-2 — on mobile with carousel visible, anchor the gateway card just
  // under the carousel (no vertical centering), so the card hugs the
  // moon strip instead of floating in mid-page whitespace.
  return (
    <>
    <main
      className="relative grid bg-cosmos overflow-y-auto"
      style={{
        minHeight: "100dvh",
        gridTemplateRows: "auto minmax(240px, 1fr)",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 4px)",
        paddingBottom: "calc(160px + env(safe-area-inset-bottom, 0px))",
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
        ref={heroSectionRef}
        className="flex flex-col items-center justify-start px-6"
        style={{ paddingTop: 24, paddingBottom: 24, minHeight: 0, overflow: "hidden" }}
      >
        <div
          style={{
            position: "relative",
            display: "inline-flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          {/* EW-2 — Single CardImage replaces the legacy gateway button:
              face / back / loading variants are all handled internally,
              and the bordered `gateway-card-frame` wrapper is dropped so
              the scanned card art reads as its own visual edge. */}
          <CardImage
            cardId={todayCard ?? undefined}
            variant={
              // EX-2 — while the today-draw check is still pending,
              // render face+loading (shimmer) so we never flash the
              // card-back during warm reopen. After the check resolves:
              // face if drawn, back if not.
              !hasCheckedTodayDraw
                ? "face"
                : todayCard !== null
                  ? "face"
                  : "back"
            }
            loading={!hasCheckedTodayDraw || (todayCard === null && showSkeleton)}
            reversed={todayReversed}
            cardBackId={cardBack}
            size="custom"
            widthPx={cardWidth}
            className="animate-breathe-glow"
            style={{ maxWidth: "90vw", maxHeight: "100%" }}
            onClick={() =>
              navigate({
                to: "/draw",
                search: { spread: "single" },
              })
            }
            ariaLabel="Begin today's draw"
          />
          {/* EE-8 — Streak Moon glyph. Replaces the prior Flame icon
              with today's actual moon phase, tying the streak marker
              to the sky. Tappable: opens a modal with detail. */}
          <button
            type="button"
            onClick={() => setStreakModalOpen(true)}
            aria-label={`Practice streak: ${currentStreak} day${currentStreak === 1 ? "" : "s"}. Open streak detail.`}
            title="Your practice streak"
            style={
              streakUnderCard
                ? {
                    marginTop: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }
                : {
                    position: "absolute",
                    bottom: "8px",
                    left: cardWidth >= 240 ? "-60px" : "-44px",
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                    background: "none",
                    border: "none",
                    padding: 0,
                    cursor: "pointer",
                  }
            }
          >
            <MoonStreakIcon streakDays={currentStreak} size={20} />
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
          </button>
        </div>
      </section>
    </main>

    {/* DI-1 — Draw icons row, fixed-position above bottom nav (64px)
        so it's always visible regardless of carousel/hero size. */}
    <div
      className="fixed left-0 right-0 z-30 pointer-events-none"
      style={{
        bottom: "calc(64px + env(safe-area-inset-bottom, 0px))",
        paddingTop: 12,
        paddingBottom: 4,
      }}
    >
      <section className="px-6 pointer-events-auto">
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
        <div ref={drawTypeRowRef}>
          <SpreadIconsRow
            onSelect={(spread) => {
              setShowDrawTypeHint(false);
              navigate({
                to: "/draw",
                search: { spread },
              });
            }}
          />
        </div>
      </section>
    </div>
    {showDrawTypeHint && (
      <Hint
        hintId="home_draw_type_select"
        text="Tap a draw type to begin."
        anchorRef={drawTypeRowRef}
        position="top"
        pointerAlign="center"
        onDismiss={() => setShowDrawTypeHint(false)}
      />
    )}
    {/* EE-8 — Streak detail modal */}
    <Dialog open={streakModalOpen} onOpenChange={setStreakModalOpen}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              color: "var(--gold)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
            }}
          >
            <MoonStreakIcon streakDays={currentStreak} size={80} />
            Your practice
          </DialogTitle>
          <DialogDescription className="text-center">
            {(() => {
              const { element, isFull } = streakPhaseState(currentStreak);
              if (element === "none") return "Begin your practice tonight.";
              const phaseLabel =
                element.charAt(0).toUpperCase() + element.slice(1);
              return `Phase: ${phaseLabel}${isFull ? " — full" : ""}`;
            })()}
          </DialogDescription>
        </DialogHeader>
        {/* 9-6-J — full Earth → Water → Air → Fire phase ladder. */}
        {(() => {
          const phases: { element: StreakElement; label: string; range: [number, number] }[] = [
            { element: "earth", label: "Earth", range: [1, 12] },
            { element: "water", label: "Water", range: [13, 24] },
            { element: "air", label: "Air", range: [25, 36] },
            { element: "fire", label: "Fire", range: [37, 48] },
          ];
          const { element: currentElement } = streakPhaseState(currentStreak);
          return (
            <div
              className="flex flex-col items-center gap-6 py-4"
              style={{ fontFamily: "var(--font-serif)" }}
            >
              <div className="flex items-baseline gap-3">
                <span
                  style={{
                    fontSize: "var(--text-display, 48px)",
                    color: "var(--accent, var(--gold))",
                    fontStyle: "italic",
                    lineHeight: 1,
                  }}
                >
                  {currentStreak}
                </span>
                <span
                  style={{
                    fontSize: "var(--text-body-sm)",
                    color: "var(--foreground)",
                    opacity: 0.6,
                    fontStyle: "italic",
                  }}
                >
                  day{currentStreak === 1 ? "" : "s"} of practice
                </span>
              </div>
              <div className="flex w-full flex-col gap-3">
                {phases.map((phase) => {
                  const isActive = currentElement === phase.element;
                  const isComplete = currentStreak > phase.range[1];
                  const inProgress = isActive
                    ? Math.min(
                        100,
                        ((currentStreak - phase.range[0] + 1) / 12) * 100,
                      )
                    : isComplete
                      ? 100
                      : 0;
                  const elementColor = STREAK_ELEMENT_COLORS[phase.element];
                  return (
                    <div key={phase.element} className="flex flex-col gap-1">
                      <div className="flex items-baseline justify-between">
                        <span
                          style={{
                            fontStyle: "italic",
                            fontSize: "var(--text-body-sm)",
                            color: isActive
                              ? elementColor
                              : "var(--foreground)",
                            opacity: isActive ? 1 : isComplete ? 0.7 : 0.4,
                          }}
                        >
                          Phase: {phase.label}
                        </span>
                        <span
                          style={{
                            fontSize: "var(--text-caption)",
                            color: "var(--foreground)",
                            opacity: 0.5,
                          }}
                        >
                          days {phase.range[0]}–{phase.range[1]}
                        </span>
                      </div>
                      <div
                        style={{
                          height: 4,
                          width: "100%",
                          background:
                            "color-mix(in oklab, var(--foreground) 15%, transparent)",
                          borderRadius: 999,
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            height: "100%",
                            width: `${inProgress}%`,
                            background: elementColor,
                            transition: "width 200ms ease-out",
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
              {currentStreak >= 48 ? (
                <p
                  style={{
                    fontSize: "var(--text-body-sm)",
                    color: STREAK_ELEMENT_COLORS.fire,
                    fontStyle: "italic",
                    textAlign: "center",
                    opacity: 0.85,
                    margin: 0,
                  }}
                >
                  The fire holds. Practice continues.
                </p>
              ) : null}
              {longestStreak > currentStreak ? (
                <p
                  style={{
                    fontSize: "var(--text-body-sm)",
                    color: "var(--foreground)",
                    opacity: 0.5,
                    fontStyle: "italic",
                    textAlign: "center",
                    margin: 0,
                  }}
                >
                  Longest: {longestStreak} day{longestStreak === 1 ? "" : "s"}
                </p>
              ) : null}
            </div>
          );
        })()}
        <p
          className="text-center"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--foreground)",
            opacity: 0.7,
          }}
        >
          Pull a card today to keep the moon waxing.
        </p>
      </DialogContent>
    </Dialog>
    </>
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
