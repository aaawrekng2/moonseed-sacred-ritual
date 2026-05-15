/**
 * Q52a — Numerology / Today sub-tab.
 * Renders Today's Numbers (Day/Month/Year), the Moon synthesis, and
 * a 7-day Personal Day strip.
 */
import { useMemo } from "react";
import {
  numberToMajorArcana,
  personalDay,
  personalMonth,
  personalYear,
  type Numerogram,
} from "@/lib/numerology";
import {
  MOON_NUMEROLOGY_SYNTHESIS,
  NUMBER_MEANINGS,
} from "@/lib/numerology-copy";
import { CardImage } from "@/components/card/CardImage";
import { getCurrentMoonPhase } from "@/lib/moon";

const sectionHeaderStyle: React.CSSProperties = {
  fontFamily: "var(--font-display)",
  fontStyle: "italic",
  fontSize: "var(--text-heading-md)",
  margin: 0,
};

export function NumerologyTodayTab({
  birthDate,
}: {
  birthDate: string;
  birthName: string | null;
}) {
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

  const next7Days = useMemo(() => {
    const arr: { date: Date; pd: Numerogram }[] = [];
    const start = new Date();
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      arr.push({
        date: d,
        pd: personalDay(birthDate, d.getFullYear(), d.getMonth() + 1, d.getDate()),
      });
    }
    return arr;
  }, [birthDate]);

  return (
    <div className="flex flex-col gap-10 pb-12">
      <h2
        style={{
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: "var(--text-heading-md)",
          color: "var(--color-foreground)",
          margin: "0 0 var(--space-3, 12px) 0",
        }}
      >
        Today
      </h2>
      {/* Today's Numbers */}
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

      {/* Moon synthesis */}
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
              {moon.phase} &middot; Personal Day {pd.digit}
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

      {/* 7-day strip */}
      <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 style={sectionHeaderStyle}>The Week Ahead</h3>
        <div
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            paddingBottom: 4,
          }}
        >
          {next7Days.map(({ date, pd: dayPd }, i) => (
            <div
              key={i}
              style={{
                flexShrink: 0,
                background: "var(--surface-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md, 10px)",
                padding: 12,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                minWidth: 64,
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-caption)",
                  opacity: 0.6,
                  textTransform: "uppercase",
                  letterSpacing: "0.1em",
                }}
              >
                {date.toLocaleDateString(undefined, { weekday: "short" })}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-display)",
                  fontSize: 28,
                  color: i === 0 ? "var(--gold)" : "var(--color-foreground)",
                  fontStyle: "italic",
                  lineHeight: 1,
                }}
              >
                {dayPd.digit}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: "var(--text-caption)",
                  opacity: 0.5,
                }}
              >
                {date.getDate()}
              </span>
            </div>
          ))}
        </div>
      </section>
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