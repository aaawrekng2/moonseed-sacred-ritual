/**
 * Q51a — Numerology tab placeholder.
 *
 * Intentionally empty for Q51a. Q51b/c/d will fill in sections.
 * For now it shows an intro paragraph and, when birth_date is missing,
 * a CTA pointing to Settings → Profile.
 */
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { useEffect, useState } from "react";

export function NumerologyTab() {
  const { user } = useAuth();
  const [birthDate, setBirthDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("birth_date")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setBirthDate(
        (data as { birth_date?: string | null } | null)?.birth_date ?? null,
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  if (loading) return null;

  return (
    <div className="flex flex-col gap-6 pb-12">
      <p
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "var(--text-body-lg)",
          fontStyle: "italic",
          opacity: 0.85,
          margin: 0,
        }}
      >
        Numerology weaves through every tarot card. Each card carries a number, and your birth date carries the architecture of your life. We bring them together here.
      </p>
      {birthDate ? (
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            opacity: 0.6,
            margin: 0,
          }}
        >
          Your numerology readings will appear here soon.
        </p>
      ) : (
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
            to="/settings/profile"
            style={{
              alignSelf: "flex-start",
              padding: "8px 16px",
              borderRadius: "999px",
              background: "color-mix(in oklab, var(--gold) 14%, transparent)",
              border: "1px solid color-mix(in oklab, var(--gold) 35%, transparent)",
              color: "var(--gold)",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm, 13px)",
              textDecoration: "none",
            }}
          >
            Open Profile
          </Link>
        </div>
      )}
    </div>
  );
}