/**
 * Q52c — Numerology / Cycles sub-tab.
 * Personal Year hero + 12-month strip, Pinnacles, Challenges,
 * Period Cycles. All math pure; no AI, no DB.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import {
  challenges,
  currentAge,
  periodCycles,
  personalYearForecast,
  pinnacles,
} from "@/lib/numerology";
import {
  CHALLENGE_MEANINGS,
  NUMBER_MEANINGS,
  PERIOD_CYCLE_MEANINGS,
  PERSONAL_YEAR_MEANINGS,
  PINNACLE_MEANINGS,
} from "@/lib/numerology-copy";

const sectionHeaderStyle: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontStyle: "italic",
  fontSize: "var(--text-heading-md)",
  margin: 0,
};

const subtitleStyle: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-body-sm)",
  opacity: 0.7,
  margin: 0,
};

const cardStyle: CSSProperties = {
  background: "var(--surface-card)",
  border: "1px solid var(--border-subtle)",
  borderRadius: "var(--radius-md, 10px)",
  padding: 16,
};

const goldDigitStyle: CSSProperties = {
  fontFamily: "var(--font-display)",
  fontSize: 36,
  color: "var(--gold)",
  fontStyle: "italic",
  lineHeight: 1,
};

const captionStyle: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-caption)",
  opacity: 0.6,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
};

const fullTextStyle: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-body-sm)",
  opacity: 0.85,
  margin: 0,
};

function Section({
  header,
  subtitle,
  children,
}: {
  header: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h3 style={sectionHeaderStyle}>{header}</h3>
        {subtitle && <p style={subtitleStyle}>{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

export function NumerologyCyclesTab({ birthDate }: { birthDate: string }) {
  const now = new Date();
  const year = now.getFullYear();
  const forecast = personalYearForecast(birthDate, year);
  const pyMeaning =
    PERSONAL_YEAR_MEANINGS[forecast.personalYear.digit] ??
    PERSONAL_YEAR_MEANINGS[1];

  const age = currentAge(birthDate);
  const pins = pinnacles(birthDate);
  const chals = challenges(birthDate);
  const cycles = periodCycles(birthDate);

  const currentPinIdx = pins.findIndex(
    (p) => age >= p.startAge && (p.endAge === null || age <= p.endAge),
  );
  const currentCycleIdx = cycles.findIndex(
    (c) => age >= c.startAge && (c.endAge === null || age <= c.endAge),
  );

  const [openPY, setOpenPY] = useState(false);
  const [expandedMonth, setExpandedMonth] = useState<number | null>(
    now.getMonth() + 1,
  );

  const monthMeaning =
    expandedMonth !== null
      ? NUMBER_MEANINGS[
          forecast.months.find((mm) => mm.month === expandedMonth)?.value
            .digit ?? 1
        ] ?? NUMBER_MEANINGS[1]
      : null;

  const isMaster =
    forecast.personalYear.master !== null &&
    [11, 22, 33].includes(forecast.personalYear.digit);

  return (
    <div className="flex flex-col gap-10 pb-12">
      {/* Personal Year hero */}
      <Section header={`${year} — Your Year`} subtitle="Your year ahead.">
        <div
          onClick={() => setOpenPY((o) => !o)}
          style={{ ...cardStyle, cursor: "pointer", display: "flex", flexDirection: "column", gap: 10 }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
            <span style={goldDigitStyle}>{forecast.personalYear.digit}</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
              <span style={captionStyle}>
                {isMaster
                  ? `Master Year ${forecast.personalYear.digit}`
                  : "Personal Year"}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-body-md)",
                }}
              >
                {pyMeaning.keyword}
              </span>
              <span style={{ ...subtitleStyle, opacity: 0.6 }}>{pyMeaning.short}</span>
            </div>
          </div>
          {openPY && <p style={fullTextStyle}>{pyMeaning.full}</p>}
        </div>
      </Section>

      {/* 12-month strip */}
      <Section header="The Twelve Months" subtitle="A Personal Month for each calendar month.">
        <div
          style={{
            display: "flex",
            gap: 8,
            overflowX: "auto",
            paddingBottom: 4,
          }}
        >
          {forecast.months.map(({ month, value }) => {
            const isCurrent = month === now.getMonth() + 1;
            const isExpanded = month === expandedMonth;
            return (
              <button
                key={month}
                type="button"
                onClick={() =>
                  setExpandedMonth(isExpanded ? null : month)
                }
                style={{
                  flexShrink: 0,
                  background: isCurrent
                    ? "color-mix(in oklab, var(--gold) 12%, transparent)"
                    : isExpanded
                      ? "color-mix(in oklab, var(--gold) 6%, transparent)"
                      : "var(--surface-card)",
                  border: isCurrent
                    ? "1px solid color-mix(in oklab, var(--gold) 35%, transparent)"
                    : "1px solid var(--border-subtle)",
                  borderRadius: "var(--radius-md, 10px)",
                  padding: 12,
                  minWidth: 64,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 4,
                  cursor: "pointer",
                }}
              >
                <span style={captionStyle}>
                  {new Date(year, month - 1, 1).toLocaleDateString(undefined, {
                    month: "short",
                  })}
                </span>
                <span
                  style={{
                    fontFamily: "var(--font-display)",
                    fontSize: 28,
                    color: "var(--gold)",
                    fontStyle: "italic",
                    lineHeight: 1,
                  }}
                >
                  {value.digit}
                </span>
              </button>
            );
          })}
        </div>
        {expandedMonth !== null && monthMeaning && (
          <div style={cardStyle}>
            <p style={{ ...captionStyle, marginBottom: 6 }}>
              {new Date(year, expandedMonth - 1, 1).toLocaleDateString(undefined, {
                month: "long",
              })}{" "}
              · {monthMeaning.keyword}
            </p>
            <p style={{ ...fullTextStyle, margin: 0 }}>{monthMeaning.full}</p>
          </div>
        )}
      </Section>

      {/* Pinnacles */}
      <Section
        header="Pinnacles"
        subtitle="Four life chapters. Each asks for a different kind of growth."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {pins.map((pin, i) => {
            const isCurrent = i === currentPinIdx;
            const ageRange =
              pin.endAge === null
                ? `Age ${pin.startAge}+`
                : `Ages ${pin.startAge}–${pin.endAge}`;
            const meaning =
              PINNACLE_MEANINGS[pin.value.digit] ?? PINNACLE_MEANINGS[1];
            return (
              <ExpandableTimelineRow
                key={pin.index}
                label={`${["First", "Second", "Third", "Fourth"][i]} Pinnacle`}
                ageRange={ageRange}
                digit={pin.value.digit}
                keyword={meaning.keyword}
                fullText={meaning.full}
                isCurrent={isCurrent}
              />
            );
          })}
        </div>
      </Section>

      {/* Challenges */}
      <Section
        header="Challenges"
        subtitle="The internal obstacle of each Pinnacle. What this chapter teaches the soul."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {chals.map((c, i) => {
            const isCurrent = i === currentPinIdx;
            const ageRange =
              c.endAge === null
                ? `Age ${c.startAge}+`
                : `Ages ${c.startAge}–${c.endAge}`;
            const meaning =
              CHALLENGE_MEANINGS[c.value.digit] ?? CHALLENGE_MEANINGS[0];
            return (
              <ExpandableTimelineRow
                key={c.index}
                label={`${["First", "Second", "Third", "Fourth"][i]} Challenge`}
                ageRange={ageRange}
                digit={c.value.digit}
                keyword={meaning.keyword}
                fullText={meaning.full}
                isCurrent={isCurrent}
              />
            );
          })}
        </div>
      </Section>

      {/* Period Cycles */}
      <Section
        header="Period Cycles"
        subtitle="Three broad seasons of a life: Formative, Productive, Harvest."
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {cycles.map((cyc, i) => {
            const isCurrent = i === currentCycleIdx;
            const ageRange =
              cyc.endAge === null
                ? `Age ${cyc.startAge}+`
                : `Ages ${cyc.startAge}–${cyc.endAge}`;
            const meaning =
              PERIOD_CYCLE_MEANINGS[cyc.value.digit] ??
              PERIOD_CYCLE_MEANINGS[1];
            return (
              <ExpandableTimelineRow
                key={cyc.label}
                label={cyc.label}
                ageRange={ageRange}
                digit={cyc.value.digit}
                keyword={meaning.keyword}
                fullText={meaning.full}
                isCurrent={isCurrent}
              />
            );
          })}
        </div>
      </Section>
    </div>
  );
}

function ExpandableTimelineRow({
  label,
  ageRange,
  digit,
  keyword,
  fullText,
  isCurrent,
}: {
  label: string;
  ageRange: string;
  digit: number;
  keyword: string;
  fullText: string;
  isCurrent: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <button
      type="button"
      onClick={() => setOpen((v) => !v)}
      style={{
        background: isCurrent
          ? "color-mix(in oklab, var(--gold) 8%, transparent)"
          : "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderLeft: isCurrent
          ? "3px solid var(--gold)"
          : "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md, 10px)",
        padding: 14,
        textAlign: "left",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <span style={{ ...goldDigitStyle, fontSize: 32 }}>{digit}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
          <span style={captionStyle}>{label}</span>
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-md)",
            }}
          >
            {keyword}
          </span>
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption)",
              opacity: 0.6,
            }}
          >
            {ageRange}
            {isCurrent && " · You are here"}
          </span>
        </div>
      </div>
      {open && <p style={fullTextStyle}>{fullText}</p>}
    </button>
  );
}