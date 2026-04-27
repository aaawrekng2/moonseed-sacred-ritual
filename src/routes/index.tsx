import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
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

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setValue(e.target.value);
    onQuestionChange(e.target.value);
  };

  return (
    <div className="w-full max-w-sm relative">
      <textarea
        value={value}
        onChange={handleChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        rows={3}
        className="w-full resize-none bg-transparent focus:outline-none text-center"
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: 15,
          lineHeight: 1.7,
          color: "var(--foreground)",
          opacity: focused || value ? "var(--ro-plus-40)" : "var(--ro-plus-20)",
          border: "none",
          padding: "12px 0",
          minHeight: 72,
          transition: "opacity 250ms ease",
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
    </div>
  );
}
