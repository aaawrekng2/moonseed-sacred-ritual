/**
 * Q51b — Numerology tab.
 *
 * Four sections inside the tab:
 *   1. Your Birth Cards (hero — 2-3 Major Arcana from birth date)
 *   2. Today's Numbers (Personal Day / Month / Year row)
 *   3. Today Under the Moon (Personal Day × current moon phase synthesis)
 *   4. Your Core Numbers (collapsible — Life Path, Birthday, +Expression /
 *      Soul Urge / Personality if birth_name is set)
 *
 * Pure-calc; no AI, no premium gating, no filters. Q51c/d add those.
 */
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import {
  birthCards,
  birthdayNumber,
  expressionNumber,
  lifePath,
  numberToMajorArcana,
  personalDay,
  personalMonth,
  personalYear,
  personalityNumber,
  soulUrgeNumber,
  type Numerogram,
} from "@/lib/numerology";
import {
  MOON_NUMEROLOGY_SYNTHESIS,
  NUMBER_MEANINGS,
} from "@/lib/numerology-copy";
import { getCardName } from "@/lib/tarot";
import { CardImage } from "@/components/card/CardImage";
import { getCurrentMoonPhase } from "@/lib/moon";

const sectionHeaderStyle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontStyle: "italic",
  fontSize: "var(--text-heading-md)",
  margin: 0,
};

const subtitleStyle: React.CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-body-sm)",
  opacity: 0.7,
  margin: 0,
};

export function NumerologyTab() {
  const { user } = useAuth();
  const [birthDate, setBirthDate] = useState<string | null>(null);
  const [birthName, setBirthName] = useState<string | null>(null);
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
      </div>
    );
  }

  // ===== calculations =====
  const cards = birthCards(birthDate);

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const pd = personalDay(birthDate, year, month, day);
  const pm = personalMonth(birthDate, year, month);
  const py = personalYear(birthDate, year);

  const moon = getCurrentMoonPhase(now);
  const synthesisKey = `${pd.digit}_${moon.phase}`;
  const synthesisText =
    MOON_NUMEROLOGY_SYNTHESIS[synthesisKey] ??
    (NUMBER_MEANINGS[pd.digit] ?? NUMBER_MEANINGS[1]).short;

  return (
    <div className="flex flex-col gap-10 pb-12">
      {/* Section 1 — Birth Cards */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 style={sectionHeaderStyle}>Your Birth Cards</h3>
        <p style={subtitleStyle}>
          The archetypes that shape your lifetime journey.
        </p>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-end",
            gap: 16,
            paddingTop: 8,
          }}
        >
          <BirthCardCell cardId={cards.primary} size="primary" />
          <BirthCardCell cardId={cards.secondary} size="secondary" />
          {cards.third !== null && (
            <BirthCardCell cardId={cards.third} size="secondary" />
          )}
        </div>
      </section>

      {/* Section 2 — Today's Numbers */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 style={sectionHeaderStyle}>Today&rsquo;s Numbers</h3>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
          }}
        >
          <NumberCell value={pd} label="Day" />
          <NumberCell value={pm} label="Month" />
          <NumberCell value={py} label="Year" />
        </div>
      </section>

      {/* Section 3 — Moon + Numerology */}
      <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <h3 style={sectionHeaderStyle}>Today Under the Moon</h3>
        <div
          style={{
            background: "var(--surface-card)",
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-md, 10px)",
            padding: 16,
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          <span style={{ fontSize: 36, lineHeight: 1 }}>{moon.glyph}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body-sm)",
                opacity: 0.7,
              }}
            >
              {moon.phase} · Personal Day {pd.digit}
            </span>
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body-lg)",
              }}
            >
              {synthesisText}
            </span>
          </div>
        </div>
      </section>

      {/* Section 4 — Core Numbers (collapsible) */}
      <CoreNumbersSection birthDate={birthDate} birthName={birthName} />
    </div>
  );
}

function BirthCardCell({
  cardId,
  size,
}: {
  cardId: number;
  size: "primary" | "secondary";
}) {
  const widthPx = size === "primary" ? 120 : 88;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
      }}
    >
      <div
        style={{
          width: widthPx,
          aspectRatio: "0.6",
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "center",
        }}
      >
        <CardImage cardId={cardId} size="custom" widthPx={widthPx} />
      </div>
      <span
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize:
            size === "primary" ? "var(--text-body-sm)" : "var(--text-caption)",
          textAlign: "center",
          opacity: 0.85,
          maxWidth: widthPx + 16,
        }}
      >
        {getCardName(cardId)}
      </span>
    </div>
  );
}

function NumberCell({ value, label }: { value: Numerogram; label: string }) {
  const arcana = numberToMajorArcana(value.digit);
  const meaning = NUMBER_MEANINGS[value.digit] ?? NUMBER_MEANINGS[1];
  return (
    <div
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md, 10px)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 36,
          color: "var(--gold)",
          fontStyle: "italic",
          lineHeight: 1,
        }}
      >
        {value.digit}
      </span>
      <span
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-caption)",
          opacity: 0.7,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body-sm)",
          textAlign: "center",
        }}
      >
        {meaning.keyword}
      </span>
      {arcana !== null && (
        <CardImage cardId={arcana} size="custom" widthPx={44} />
      )}
    </div>
  );
}

function CoreNumbersSection({
  birthDate,
  birthName,
}: {
  birthDate: string;
  birthName: string | null;
}) {
  const [expanded, setExpanded] = useState(false);

  const lp = lifePath(birthDate);
  const bday = birthdayNumber(birthDate);
  const trimmedName = (birthName ?? "").trim();
  const hasName = trimmedName.length > 0;
  const exp = hasName ? expressionNumber(trimmedName) : null;
  const su = hasName ? soulUrgeNumber(trimmedName) : null;
  const pers = hasName ? personalityNumber(trimmedName) : null;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          background: "transparent",
          border: "none",
          padding: 0,
          width: "100%",
          cursor: "pointer",
        }}
        aria-expanded={expanded}
      >
        <h3 style={{ ...sectionHeaderStyle, margin: 0 }}>Your Core Numbers</h3>
        <ChevronRight
          size={16}
          style={{
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 200ms",
            opacity: 0.6,
          }}
        />
      </button>
      {expanded && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, paddingTop: 4 }}>
          <CoreNumberRow
            value={lp}
            label="Life Path"
            subtitle="Your soul&rsquo;s curriculum"
          />
          <CoreNumberRow
            value={bday}
            label="Birthday"
            subtitle="The gift you brought"
          />
          {hasName && exp && (
            <CoreNumberRow
              value={exp}
              label="Expression"
              subtitle="What you came here to do"
            />
          )}
          {hasName && su && (
            <CoreNumberRow
              value={su}
              label="Soul Urge"
              subtitle="What your soul desires"
            />
          )}
          {hasName && pers && (
            <CoreNumberRow
              value={pers}
              label="Personality"
              subtitle="How others perceive you"
            />
          )}
          {!hasName && (
            <p
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body-sm)",
                opacity: 0.7,
                margin: 0,
                paddingTop: 4,
              }}
            >
              Add your birth name in{" "}
              <Link
                to="/settings/blueprint"
                style={{ color: "var(--gold)", textDecoration: "underline" }}
              >
                Settings &rarr; Blueprint
              </Link>{" "}
              to see Expression, Soul Urge, and Personality numbers.
            </p>
          )}
        </div>
      )}
    </section>
  );
}

function CoreNumberRow({
  value,
  label,
  subtitle,
}: {
  value: Numerogram;
  label: string;
  subtitle: string;
}) {
  const [open, setOpen] = useState(false);
  const meaning = NUMBER_MEANINGS[value.digit] ?? NUMBER_MEANINGS[1];
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      style={{
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md, 10px)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 6,
        textAlign: "left",
        cursor: "pointer",
        width: "100%",
      }}
      aria-expanded={open}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            color: "var(--gold)",
            fontStyle: "italic",
            lineHeight: 1,
            minWidth: 32,
          }}
        >
          {value.digit}
        </span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body)",
            }}
          >
            {label} &middot; {meaning.keyword}
          </span>
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption)",
              opacity: 0.6,
            }}
          >
            {subtitle}
          </span>
        </div>
      </div>
      {open && (
        <p
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            opacity: 0.85,
            margin: 0,
            paddingTop: 4,
          }}
        >
          {meaning.full}
        </p>
      )}
    </button>
  );
}