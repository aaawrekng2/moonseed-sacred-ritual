import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Flame } from "lucide-react";
import { MoonCarousel } from "@/components/moon/MoonCarousel";
import { CardBack } from "@/components/cards/CardBack";
import { SpreadIconsRow } from "@/components/spreads/SpreadIconsRow";
import { useBgGradient } from "@/lib/use-bg-gradient";
import { getStoredCardBack, type CardBackId } from "@/lib/card-backs";
import { useStreak } from "@/lib/use-streak";
import { useRegisterRefresh } from "@/lib/floating-menu-context";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { supabase } from "@/lib/supabase";
import {
  useAutoRememberQuestion,
  useRememberScope,
  type RememberScope,
} from "@/lib/use-auto-remember-question";
import { useAuth } from "@/lib/auth";
import { updateUserPreferences } from "@/lib/user-preferences-write";
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
      typeof s.question === "string" && s.question.trim().length > 0
        ? s.question
        : undefined,
  }),
  component: Index,
});

function Index() {
  // Initialize gradient + opacity systems on first mount.
  useBgGradient();
  const [cardBack, setCardBack] = useState<CardBackId>("celestial");
  const [todayCard, setTodayCard] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const navigate = useNavigate();
  const search = Route.useSearch();
  const initialQuestion = search.question;
  const { currentStreak } = useStreak();
  // Home is the only screen that exposes the Refresh icon in the
  // floating menu. Registered via context so the menu itself stays
  // route-agnostic.
  useRegisterRefresh(true);

  useEffect(() => {
    setCardBack(getStoredCardBack());
  }, []);

  // If the user already pulled a single-card draw today, surface that
  // card face on the gateway instead of the card back.
  useEffect(() => {
    void (async () => {
      const { data: sessionData } = await supabase.auth.getSession();
      const uid = sessionData.session?.user?.id;
      if (!uid) return;
      const today = new Date().toISOString().split("T")[0];
      const { data } = await supabase
        .from("readings")
        .select("card_ids")
        .eq("user_id", uid)
        .eq("spread_type", "single")
        .gte("created_at", `${today}T00:00:00`)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const first = (data as { card_ids?: number[] } | null)?.card_ids?.[0];
      if (typeof first === "number") setTodayCard(first);
    })();
  }, []);

  return (
    <main
      className="relative flex h-[100dvh] flex-col overflow-hidden bg-cosmos pb-24"
      style={{
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 8px)",
      }}
    >
      {/* Moon strip — close to top */}
      <header className="px-2 pt-1">
        <MoonCarousel />
      </header>

      {/* Gateway card — smaller, below moon */}
      <section className="flex flex-col items-center pt-4 px-6">
        <div style={{ position: "relative", display: "inline-block" }}>
          <button
            type="button"
            aria-label="Begin today's draw"
            className="gateway-card-frame animate-breathe-glow overflow-hidden rounded-[12px] transition-transform active:scale-[0.98]"
            onClick={() =>
              navigate({
                to: "/draw",
                search: { spread: "single", question: question || undefined },
              })
            }
          >
            {todayCard !== null ? (
              <img
                src={getCardImagePath(todayCard)}
                alt={getCardName(todayCard)}
                style={{
                  width: 140,
                  height: Math.round(140 * 1.75),
                  objectFit: "cover",
                }}
                loading="eager"
              />
            ) : (
              <CardBack id={cardBack} width={140} />
            )}
          </button>
          <div
            style={{
              position: "absolute",
              bottom: "12px",
              left: "-40px",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
            title="Your practice streak"
            aria-label={`Practice streak: ${currentStreak} day${currentStreak === 1 ? "" : "s"}`}
          >
            <Flame
              size={16}
              style={{ color: "var(--gold)", opacity: "var(--ro-plus-20)" }}
            />
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
        </div>
      </section>

      {/* Question text box */}
      <section className="flex-1 flex flex-col items-center justify-center px-6 pt-4 pb-2">
        <QuestionBox
          onQuestionChange={setQuestion}
          initialQuestion={initialQuestion}
        />
      </section>

      {/* Spread icons — sit just above bottom nav */}
      <section>
        <SpreadIconsRow
          onSelect={(spread) =>
            navigate({
              to: "/draw",
              search: { spread, question: question || undefined },
            })
          }
        />
      </section>
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

  // Hydrate from localStorage on client only (avoid SSR mismatch).
  // An `initialQuestion` (passed via the ?question= search param,
  // e.g. when the seeker taps "Edit question" from a reading) takes
  // precedence over any stored value.
  useEffect(() => {
    try {
      const storedRemember = localStorage.getItem("question-remember") === "1";
      setRemember(storedRemember);
      if (initialQuestion && initialQuestion.trim().length > 0) {
        const clamped = initialQuestion.slice(0, QUESTION_MAX_LENGTH);
        setValue(clamped);
        onQuestionChange(clamped);
      } else if (storedRemember) {
        const storedValue = (
          localStorage.getItem("question-value") ?? ""
        ).slice(0, QUESTION_MAX_LENGTH);
        if (storedValue) {
          setValue(storedValue);
          onQuestionChange(storedValue);
        }
      }
    } catch {
      // ignore storage errors
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist whenever value or remember toggles after hydration.
  useEffect(() => {
    if (!hydrated) return;
    try {
      if (remember) {
        localStorage.setItem("question-value", value);
      } else {
        localStorage.removeItem("question-value");
      }
    } catch {
      // ignore
    }
  }, [value, remember, hydrated]);

  const handleRememberToggle = () => {
    const next = !remember;
    setRemember(next);
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
  };

  const handleClear = () => {
    setValue("");
    onQuestionChange("");
    try {
      localStorage.removeItem("question-value");
    } catch {
      // ignore
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    // Hard-cap input at QUESTION_MAX_LENGTH so the question stays
    // a comfortable reading size in the reading view's pinned panel.
    const next = e.target.value.slice(0, QUESTION_MAX_LENGTH);
    setValue(next);
    onQuestionChange(next);
    // Auto-flip "Remember my question" on as soon as the seeker
    // begins typing, when the corresponding setting is enabled —
    // but never if the seeker has manually turned the toggle off in
    // this session.
    if (
      autoRemember &&
      !remember &&
      !userDisabledRememberRef.current &&
      next.trim().length > 0
    ) {
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
          fontSize: 11,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "var(--gold)",
          background: "var(--background)",
          opacity: focused || value ? "var(--ro-plus-40)" : 0,
          transform: `translateY(${focused || value ? "0" : "4px"})`,
          transition:
            "opacity 250ms ease, transform 250ms ease, color 200ms ease",
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
          fontSize: 15,
          lineHeight: 1.7,
          color: "var(--foreground)",
          opacity: focused || value ? "var(--ro-plus-40)" : "var(--ro-plus-20)",
          border: "1px solid",
          borderColor: focused
            ? "color-mix(in oklab, var(--gold) 60%, transparent)"
            : "color-mix(in oklab, var(--gold) 18%, transparent)",
          borderRadius: 12,
          padding: "12px 14px",
          boxShadow: focused
            ? "0 0 0 3px color-mix(in oklab, var(--gold) 18%, transparent), 0 0 18px -6px color-mix(in oklab, var(--gold) 35%, transparent)"
            : "none",
          minHeight: 72,
          transition:
            "opacity 250ms ease, border-color 200ms ease, box-shadow 200ms ease",
        }}
      />
      {!value && !focused && (
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 15,
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
            fontSize: 11,
            letterSpacing: "0.05em",
            color:
              value.length >= QUESTION_MAX_LENGTH
                ? "var(--gold)"
                : value.length >= QUESTION_MAX_LENGTH * 0.9
                  ? "color-mix(in oklab, var(--gold) 75%, var(--foreground))"
                  : "var(--foreground)",
            opacity:
              value.length >= QUESTION_MAX_LENGTH * 0.9
                ? "var(--ro-plus-40)"
                : "var(--ro-plus-20)",
            transition: "color 200ms ease, opacity 200ms ease",
          }}
        >
          {value.length} / {QUESTION_MAX_LENGTH}
        </div>
      )}
      <div
        className="flex items-center justify-center gap-3 pt-2"
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 12,
          color: "var(--foreground)",
          opacity: "var(--ro-plus-20)",
        }}
      >
        <span
          role="status"
          aria-live="polite"
          aria-label={
            remember
              ? "Your question will be remembered"
              : "Your question will not be remembered"
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
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            border: "1px solid",
            borderColor: remember
              ? "color-mix(in oklab, var(--gold) 60%, transparent)"
              : "color-mix(in oklab, var(--foreground) 25%, transparent)",
            background: remember
              ? "color-mix(in oklab, var(--gold) 18%, transparent)"
              : "transparent",
            color: remember
              ? "var(--gold)"
              : "var(--foreground)",
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
      </div>
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
    </div>
  );
}
