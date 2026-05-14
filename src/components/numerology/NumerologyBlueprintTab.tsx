/**
 * Q52b — Numerology / Blueprint sub-tab.
 * Static personal chart: Birth Cards (hero), Core 5, Karmic Debt,
 * Karmic Lessons, Hidden Passion, Cornerstone/Capstone, Maturity.
 * All math is pure. No AI, no DB, no premium gating.
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import {
  birthCards,
  birthdayNumber,
  capstone,
  cornerstone,
  detectKarmicDebt,
  expressionNumber,
  hiddenPassion,
  karmicLessons,
  lifePath,
  maturityNumber,
  numberToMajorArcana,
  personalityNumber,
  soulUrgeNumber,
  type KarmicDebt,
  type Numerogram,
} from "@/lib/numerology";
import {
  KARMIC_DEBT_MEANINGS,
  KARMIC_LESSON_MEANINGS,
  LETTER_ENERGY_MEANINGS,
  NUMBER_MEANINGS,
} from "@/lib/numerology-copy";
import { CardImage } from "@/components/card/CardImage";

const MAJOR_ARCANA_NAMES: Record<number, string> = {
  0: "The Fool",
  1: "The Magician",
  2: "The High Priestess",
  3: "The Empress",
  4: "The Emperor",
  5: "The Hierophant",
  6: "The Lovers",
  7: "The Chariot",
  8: "Strength",
  9: "The Hermit",
  10: "Wheel of Fortune",
  11: "Justice",
  12: "The Hanged Man",
  13: "Death",
  14: "Temperance",
  15: "The Devil",
  16: "The Tower",
  17: "The Star",
  18: "The Moon",
  19: "The Sun",
  20: "Judgement",
  21: "The World",
};

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

const labelStyle: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-caption)",
  opacity: 0.7,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
};

const keywordStyle: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: "var(--text-body-sm)",
  textAlign: "center",
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

function ExpandableCard({
  children,
  fullText,
}: {
  children: ReactNode;
  fullText?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      onClick={() => fullText && setOpen((o) => !o)}
      style={{
        ...cardStyle,
        cursor: fullText ? "pointer" : "default",
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      {children}
      {open && fullText && <p style={fullTextStyle}>{fullText}</p>}
    </div>
  );
}

export function NumerologyBlueprintTab({
  birthDate,
  birthName,
}: {
  birthDate: string;
  birthName: string | null;
}) {
  const hasName = !!(birthName && birthName.trim().length > 0);
  const cards = birthCards(birthDate);

  return (
    <div className="flex flex-col gap-10 pb-12">
      {/* Hero: Birth Cards */}
      <Section
        header="Birth Cards"
        subtitle={
          cards.secondary === null
            ? "Your singular birth archetype."
            : "The archetypes that shape your lifetime journey."
        }
      >
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            alignItems: "flex-end",
            gap: 16,
            flexWrap: "wrap",
          }}
        >
          <BirthCardItem n={cards.primary} primary />
          {cards.secondary !== null && <BirthCardItem n={cards.secondary} />}
          {cards.third !== null && <BirthCardItem n={cards.third} />}
        </div>
      </Section>

      {/* Core 5 */}
      <CoreNumbers
        birthDate={birthDate}
        birthName={birthName}
        hasName={hasName}
      />

      {/* Karmic Debt */}
      <KarmicDebtSection birthDate={birthDate} birthName={birthName} />

      {/* Name-based sections */}
      {hasName ? (
        <>
          <KarmicLessonsSection birthName={birthName!} />
          <HiddenPassionSection birthName={birthName!} />
          <CornerCapSection birthName={birthName!} />
          <MaturitySection birthDate={birthDate} birthName={birthName!} />
        </>
      ) : (
        <div style={cardStyle}>
          <p style={{ ...fullTextStyle, margin: 0 }}>
            Add your birth name in Settings → Blueprint for Expression, Soul
            Urge, Personality, Karmic Lessons, Hidden Passion, Cornerstone,
            and Maturity.
          </p>
        </div>
      )}
    </div>
  );
}

function BirthCardItem({ n, primary }: { n: number; primary?: boolean }) {
  const arcana = numberToMajorArcana(n);
  const width = primary ? 160 : 110;
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 6,
      }}
    >
      {arcana !== null && (
        <CardImage cardId={arcana} size="custom" widthPx={width} />
      )}
      <span style={keywordStyle}>
        {arcana !== null ? MAJOR_ARCANA_NAMES[arcana] : `#${n}`}
      </span>
    </div>
  );
}

// ===== Core 5 =====

function CoreNumbers({
  birthDate,
  birthName,
  hasName,
}: {
  birthDate: string;
  birthName: string | null;
  hasName: boolean;
}) {
  const lp = lifePath(birthDate);
  const bday = birthdayNumber(birthDate);
  const exp = hasName ? expressionNumber(birthName!) : null;
  const su = hasName ? soulUrgeNumber(birthName!) : null;
  const pers = hasName ? personalityNumber(birthName!) : null;

  const cells: Array<{ value: Numerogram; label: string; subtitle: string }> = [
    { value: lp, label: "Life Path", subtitle: "Your soul's curriculum" },
  ];
  if (exp) cells.push({ value: exp, label: "Expression", subtitle: "What you came here to do" });
  if (su) cells.push({ value: su, label: "Soul Urge", subtitle: "What your soul desires" });
  if (pers) cells.push({ value: pers, label: "Personality", subtitle: "How others perceive you" });
  cells.push({ value: bday, label: "Birthday", subtitle: "The gift you brought" });

  return (
    <Section
      header="Core Numbers"
      subtitle="The five threads that weave your chart."
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: hasName
            ? "repeat(auto-fit, minmax(140px, 1fr))"
            : "repeat(2, 1fr)",
          gap: 12,
        }}
      >
        {cells.map((c, i) => (
          <CoreNumberCard key={i} {...c} />
        ))}
      </div>
      {!hasName && (
        <p style={{ ...subtitleStyle, marginTop: 4 }}>
          Add your birth name to see Expression, Soul Urge, and Personality.
        </p>
      )}
    </Section>
  );
}

function CoreNumberCard({
  value,
  label,
  subtitle,
}: {
  value: Numerogram;
  label: string;
  subtitle: string;
}) {
  const meaning = NUMBER_MEANINGS[value.digit] ?? NUMBER_MEANINGS[1];
  const arcana = numberToMajorArcana(value.digit);
  return (
    <ExpandableCard fullText={`${subtitle}. ${meaning.full}`}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <span style={goldDigitStyle}>{value.digit}</span>
        <span style={labelStyle}>{label}</span>
        <span style={keywordStyle}>{meaning.keyword}</span>
        {arcana !== null && (
          <CardImage cardId={arcana} size="custom" widthPx={44} />
        )}
      </div>
    </ExpandableCard>
  );
}

// ===== Karmic Debt =====

function KarmicDebtSection({
  birthDate,
  birthName,
}: {
  birthDate: string;
  birthName: string | null;
}) {
  const debts = detectKarmicDebt(birthDate, birthName);
  if (debts.length === 0) return null;

  const sourceLabel: Record<KarmicDebt["source"], string> = {
    lifePath: "from your Life Path",
    expression: "from your Expression",
    soulUrge: "from your Soul Urge",
    personality: "from your Personality",
    birthday: "from your Birthday",
  };

  return (
    <Section
      header="Karmic Debt"
      subtitle="Patterns the soul carried in. Met with awareness, they become wisdom."
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {debts.map((d, i) => {
          const m = KARMIC_DEBT_MEANINGS[d.number];
          return (
            <ExpandableCard key={i} fullText={m.full}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 14,
                }}
              >
                <span style={{ ...goldDigitStyle, fontSize: 32 }}>{d.number}</span>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  <span style={labelStyle}>{sourceLabel[d.source]}</span>
                  <span
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontSize: "var(--text-body-md)",
                    }}
                  >
                    {m.keyword}
                  </span>
                  <span style={{ ...subtitleStyle, opacity: 0.6 }}>{m.short}</span>
                </div>
              </div>
            </ExpandableCard>
          );
        })}
      </div>
    </Section>
  );
}

// ===== Karmic Lessons =====

function KarmicLessonsSection({ birthName }: { birthName: string }) {
  const lessons = karmicLessons(birthName);
  return (
    <Section
      header="Karmic Lessons"
      subtitle="Energies missing from your name. Areas the soul came to develop."
    >
      {lessons.length === 0 ? (
        <div style={cardStyle}>
          <p style={{ ...fullTextStyle, margin: 0 }}>
            Your name contains every digit — a rare completeness.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {lessons.map((digit) => {
            const m = KARMIC_LESSON_MEANINGS[digit];
            return (
              <ExpandableCard key={digit} fullText={m.full}>
                <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                  <span style={{ ...goldDigitStyle, fontSize: 28 }}>{digit}</span>
                  <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    <span
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontSize: "var(--text-body-md)",
                      }}
                    >
                      {m.keyword}
                    </span>
                    <span style={{ ...subtitleStyle, opacity: 0.6 }}>{m.short}</span>
                  </div>
                </div>
              </ExpandableCard>
            );
          })}
        </div>
      )}
    </Section>
  );
}

// ===== Hidden Passion =====

function HiddenPassionSection({ birthName }: { birthName: string }) {
  const hp = hiddenPassion(birthName);
  const m = NUMBER_MEANINGS[hp.digit] ?? NUMBER_MEANINGS[1];
  return (
    <Section
      header="Hidden Passion"
      subtitle="The number that appears most often in your name. Where your inner drive lives."
    >
      <ExpandableCard fullText={m.full}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={goldDigitStyle}>{hp.digit}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body-md)",
              }}
            >
              {m.keyword}
            </span>
            <span style={{ ...subtitleStyle, opacity: 0.6 }}>{m.short}</span>
          </div>
        </div>
      </ExpandableCard>
    </Section>
  );
}

// ===== Cornerstone & Capstone =====

function CornerCapSection({ birthName }: { birthName: string }) {
  const cs = cornerstone(birthName);
  const cap = capstone(birthName);
  if (!cs && !cap) return null;
  return (
    <Section
      header="Cornerstone & Capstone"
      subtitle="How you approach the start and the end of any cycle."
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 12,
        }}
      >
        {cs && (
          <LetterCard
            letter={cs.letter}
            digit={cs.value.digit}
            label="Cornerstone"
            note="How you approach beginnings"
          />
        )}
        {cap && (
          <LetterCard
            letter={cap.letter}
            digit={cap.value.digit}
            label="Capstone"
            note="How you complete things"
          />
        )}
      </div>
    </Section>
  );
}

function LetterCard({
  letter,
  digit,
  label,
  note,
}: {
  letter: string;
  digit: number;
  label: string;
  note: string;
}) {
  const energy = LETTER_ENERGY_MEANINGS[digit];
  return (
    <ExpandableCard fullText={energy}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ ...goldDigitStyle, fontSize: 44 }}>{letter}</span>
        <span style={labelStyle}>{label}</span>
        <span style={keywordStyle}>
          {digit} · {note}
        </span>
      </div>
    </ExpandableCard>
  );
}

// ===== Maturity =====

function MaturitySection({
  birthDate,
  birthName,
}: {
  birthDate: string;
  birthName: string;
}) {
  const mat = maturityNumber(birthDate, birthName);
  const m = NUMBER_MEANINGS[mat.digit] ?? NUMBER_MEANINGS[1];
  const arcana = numberToMajorArcana(mat.digit);
  return (
    <Section
      header="Maturity Number"
      subtitle="What you grow into in the second half of life (~35 onward)."
    >
      <ExpandableCard fullText={m.full}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <span style={goldDigitStyle}>{mat.digit}</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 2, flex: 1 }}>
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body-md)",
              }}
            >
              {m.keyword}
            </span>
            <span style={{ ...subtitleStyle, opacity: 0.6 }}>{m.short}</span>
          </div>
          {arcana !== null && (
            <CardImage cardId={arcana} size="custom" widthPx={48} />
          )}
        </div>
      </ExpandableCard>
    </Section>
  );
}