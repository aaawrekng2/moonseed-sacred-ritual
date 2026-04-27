import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Copy, Flame } from "lucide-react";
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
} from "@/lib/use-auto-remember-question";
import { useAuth } from "@/lib/auth";
import { updateUserPreferences } from "@/lib/user-preferences-write";

export const Route = createFileRoute("/")({
  component: Index,
});

function Index() {
  // Initialize gradient + opacity systems on first mount.
  useBgGradient();
  const [cardBack, setCardBack] = useState<CardBackId>("celestial");
  const [todayCard, setTodayCard] = useState<number | null>(null);
  const [question, setQuestion] = useState("");
  const navigate = useNavigate();
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
        <QuestionBox onQuestionChange={setQuestion} />
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
}: {
  onQuestionChange: (q: string) => void;
}) {
  const [value, setValue] = useState("");
  const [focused, setFocused] = useState(false);
  const [remember, setRemember] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [autoRemember] = useAutoRememberQuestion();
  const [scope] = useRememberScope();
  const { user } = useAuth();
  const userId = user?.id;
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const text = value.trim();
    if (!text) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for older browsers / non-secure contexts.
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Silent fail — the icon simply won't switch to the check.
    }
  };

  // Hydrate the remember flag from localStorage on the client only,
  // and the stored question value from either localStorage (device
  // scope) or the user's account row (cloud scope). Re-runs when
  // scope or auth changes so swapping scopes pulls the right value.
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

      if (storedRemember) {
        let storedValue = "";
        if (scope === "cloud" && userId) {
          const { data } = await supabase
            .from("user_preferences")
            .select("remembered_question")
            .eq("user_id", userId)
            .maybeSingle();
          storedValue =
            (data as { remembered_question?: string | null } | null)
              ?.remembered_question ?? "";
        } else {
          try {
            storedValue = localStorage.getItem("question-value") ?? "";
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
    // Always mirror to localStorage so device scope works offline.
    try {
      if (remember && scope === "device") {
        localStorage.setItem("question-value", value);
      } else {
        localStorage.removeItem("question-value");
      }
    } catch {
      // ignore
    }
    // Mirror to the user's account row when cloud scope is active.
    if (scope === "cloud" && userId) {
      void updateUserPreferences(userId, {
        remembered_question: remember ? value : null,
      });
    }
  }, [value, remember, hydrated, scope, userId]);

  const handleRememberToggle = () => {
    const next = !remember;
    setRemember(next);
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
    try {
      localStorage.removeItem("question-value");
    } catch {
      // ignore
    }
    if (scope === "cloud" && userId) {
      void updateUserPreferences(userId, { remembered_question: null });
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const next = e.target.value;
    setValue(next);
    onQuestionChange(next);
    // Auto-flip "Remember my question" on as soon as the seeker
    // begins typing, when the corresponding setting is enabled.
    if (autoRemember && !remember && next.trim().length > 0) {
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
      <textarea
        id="seeker-question"
        value={value}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        rows={3}
        aria-label="Your question for the cards"
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
          // Reserve space on the right for the copy button so long
          // text never slides under it.
          padding: "12px 40px 12px 14px",
          boxShadow: focused
            ? "0 0 0 3px color-mix(in oklab, var(--gold) 18%, transparent), 0 0 18px -6px color-mix(in oklab, var(--gold) 35%, transparent)"
            : "none",
          minHeight: 72,
          transition:
            "opacity 250ms ease, border-color 200ms ease, box-shadow 200ms ease",
        }}
      />
      {value.trim() && (
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? "Question copied" : "Copy question"}
          title={copied ? "Copied" : "Copy question"}
          className="absolute rounded-md transition-opacity focus:outline-none focus-visible:ring-2"
          style={{
            top: 8,
            right: 8,
            padding: 6,
            background: "transparent",
            border: "none",
            color: "var(--gold)",
            opacity: copied ? "var(--ro-plus-40)" : "var(--ro-plus-20)",
            cursor: "pointer",
          }}
        >
          {copied ? (
            <Check size={14} strokeWidth={1.75} />
          ) : (
            <Copy size={14} strokeWidth={1.75} />
          )}
        </button>
      )}
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
      <div
        className="flex items-center justify-center gap-3 pt-2"
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 12,
          color: "var(--foreground)",
          opacity: "var(--ro-plus-20)",
        }}
      >
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
            onClick={handleClear}
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
    </div>
  );
}
