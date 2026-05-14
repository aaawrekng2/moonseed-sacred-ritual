/**
 * Q52a — /numerology page shell.
 * 6 sub-tabs; only Today is wired in Q52a.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { HorizontalScroll } from "@/components/HorizontalScroll";
import { NumerologyTodayTab } from "@/components/numerology/NumerologyTodayTab";

export const Route = createFileRoute("/numerology")({
  head: () => ({
    meta: [
      { title: "Numerology — Moonseed" },
      {
        name: "description",
        content: "Your numbers, your cycles, your tarot — woven together.",
      },
    ],
  }),
  component: NumerologyPage,
});

type Tab = "today" | "blueprint" | "cycles" | "patterns" | "stalkers" | "reading";

const TABS: ReadonlyArray<{ id: Tab; label: string }> = [
  { id: "today", label: "Today" },
  { id: "blueprint", label: "Blueprint" },
  { id: "cycles", label: "Cycles" },
  { id: "patterns", label: "Patterns" },
  { id: "stalkers", label: "Stalkers" },
  { id: "reading", label: "Reading" },
];

function NumerologyPage() {
  const { user } = useAuth();
  const [birthDate, setBirthDate] = useState<string | null>(null);
  const [birthName, setBirthName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("today");

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("birth_date, birth_name")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const row = data as
        | { birth_date?: string | null; birth_name?: string | null }
        | null;
      setBirthDate(row?.birth_date ?? null);
      setBirthName(row?.birth_name ?? null);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) return null;

  if (!birthDate) {
    return (
      <main
        style={{
          maxWidth: 720,
          margin: "0 auto",
          padding: "var(--space-6, 24px)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: "var(--text-display, 32px)",
            margin: "0 0 var(--space-3, 12px) 0",
          }}
        >
          Numerology
        </h1>
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            opacity: 0.85,
            margin: "0 0 var(--space-5, 20px) 0",
          }}
        >
          Numerology weaves through every tarot card. Each card carries a
          number, and your birth date carries the architecture of your life.
          We bring them together here.
        </p>
        <div
          style={{
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md, 10px)",
            padding: "var(--space-4, 16px)",
            display: "flex",
            flexDirection: "column",
            gap: "var(--space-3, 12px)",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              margin: 0,
            }}
          >
            Add your birth date to begin.
          </p>
          <Link
            to="/settings/blueprint"
            style={{
              alignSelf: "flex-start",
              padding: "8px 16px",
              borderRadius: "999px",
              background: "color-mix(in oklab, var(--gold) 14%, transparent)",
              border:
                "1px solid color-mix(in oklab, var(--gold) 35%, transparent)",
              color: "var(--gold)",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm, 13px)",
              textDecoration: "none",
            }}
          >
            Open Blueprint
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div
      className="relative flex h-dvh flex-col"
      style={{ background: "var(--background)" }}
    >
      <div
        className="page-header-glass sticky top-0"
        style={{ zIndex: "var(--z-sticky-header)" }}
      >
        <div
          className="px-4 flex items-center"
          style={{
            paddingTop: "calc(env(safe-area-inset-top, 0px) + 6px)",
            paddingBottom: 6,
          }}
        >
          <h1
            className="font-serif italic"
            style={{
              fontSize: "var(--text-heading-sm)",
              color: "var(--color-foreground)",
              opacity: 0.9,
              margin: 0,
              lineHeight: 1,
            }}
          >
            Numerology
          </h1>
        </div>
        <HorizontalScroll
          className="py-2"
          contentClassName="items-center gap-6 px-4"
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className="whitespace-nowrap pb-1"
                style={
                  {
                    fontFamily: "var(--tab-font-family)",
                    fontStyle: "var(--tab-font-style)",
                    fontSize: "var(--tab-font-size)",
                    letterSpacing: "var(--tab-letter-spacing)",
                    textTransform: "var(--tab-text-transform)",
                    color: active
                      ? "var(--tab-active-color)"
                      : "var(--color-foreground)",
                    opacity: active
                      ? "var(--tab-active-opacity)"
                      : "var(--tab-inactive-opacity)",
                    borderBottom: active
                      ? "1px solid var(--tab-underline-color)"
                      : "1px solid transparent",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                  } as CSSProperties
                }
              >
                {t.label}
              </button>
            );
          })}
        </HorizontalScroll>
      </div>

      <main className="flex-1 overflow-y-auto px-4 pb-28 pt-4">
        <div style={{ maxWidth: 720, margin: "0 auto" }}>
          <h1
            className="font-serif italic mb-4"
            style={{
              fontSize: "var(--text-display, 32px)",
              color: "var(--color-foreground)",
              opacity: 0.9,
              lineHeight: 1.25,
            }}
          >
            Numerology
          </h1>
          {tab === "today" && (
            <NumerologyTodayTab birthDate={birthDate} birthName={birthName} />
          )}
          {tab === "blueprint" && (
            <ComingSoonStub
              label="Blueprint"
              intro="The static map of your numbers: Birth Cards, Life Path, Expression, Soul Urge, Personality, Karmic Lessons, and more."
            />
          )}
          {tab === "cycles" && (
            <ComingSoonStub
              label="Cycles"
              intro="The long rhythms of your life: Personal Year forecast, Pinnacles, Challenges, and Period Cycles."
            />
          )}
          {tab === "patterns" && (
            <ComingSoonStub
              label="Patterns"
              intro="Number frequency and synchronicities woven from your readings."
            />
          )}
          {tab === "stalkers" && (
            <ComingSoonStub
              label="Stalkers"
              intro="The numbers and cards that recur in your readings, grouped by their numerology."
            />
          )}
          {tab === "reading" && (
            <ComingSoonStub
              label="Reading"
              intro="An AI-woven numerology reading drawing your complete chart into a single narrative."
            />
          )}
        </div>
      </main>
    </div>
  );
}

function ComingSoonStub({ label, intro }: { label: string; intro: string }) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: "var(--text-heading-md)",
          margin: 0,
        }}
      >
        {label}
      </h2>
      <p
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          opacity: 0.85,
          margin: 0,
        }}
      >
        {intro}
      </p>
      <p
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          opacity: 0.5,
          margin: 0,
        }}
      >
        Coming soon.
      </p>
    </section>
  );
}