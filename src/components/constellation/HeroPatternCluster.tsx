import { useMemo, useState } from "react";
import { CardImage } from "@/components/card/CardImage";
import { getCardName } from "@/lib/tarot";
import { getCardMeta } from "@/lib/card-astrology";
import { TAROT_MEANINGS } from "@/lib/tarot-meanings";
import { formatTimeAgo, formatDateShort } from "@/lib/dates";
import { hourInTz } from "@/lib/time";
import type { QuickLogCardStats, CardDrawCounts } from "@/lib/quicklog.functions";

// ── State A hero pattern cluster ─────────────────────────────────────
// Single-card lens for the Insights › Patterns left block. Every value
// computes from data already in hand (getQuickLogCardStats + drawCounts
// + static card metadata). Hover-first: a calm value on the face, a hint
// + example on hover (native title for this first pass). Thin history
// shows "still gathering" instead of a fabricated number.

type Props = {
  heroCardId: number;
  heroDeckId?: string | null;
  timeRangeLabel: string;
  stats: QuickLogCardStats;
  drawCounts: CardDrawCounts | null;
  tz: string;
};

const STILL = "still gathering";

const DAY = 86400000;
function daysAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));
}
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
function pluralCard(name: string): string {
  return /s$/i.test(name) ? name : name + "s";
}

type ChipModel = {
  label: string;
  value: React.ReactNode;
  hint: string;
};

export function HeroPatternCluster({
  heroCardId,
  heroDeckId,
  timeRangeLabel,
  stats,
  drawCounts,
  tz,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const heroName = getCardName(heroCardId);
  const meta = getCardMeta(heroCardId);
  const meaning = TAROT_MEANINGS[heroCardId] ?? null;
  const count = stats.count;
  const enough = count >= 2;

  // Sorted ascending timestamps for this card's appearances.
  const tsAsc = useMemo(
    () =>
      [...stats.journal]
        .map((r) => new Date(r.createdAt).getTime())
        .filter((t) => Number.isFinite(t))
        .sort((a, b) => a - b),
    [stats.journal],
  );

  const { flag, chips, sparkPoints } = useMemo(() => {
    // ── derived temporal values ──
    let cadenceDays: number | null = null;
    if (tsAsc.length >= 2) {
      const span = (tsAsc[tsAsc.length - 1] - tsAsc[0]) / DAY;
      cadenceDays = span > 0 ? Math.round(span / (tsAsc.length - 1)) : null;
    }
    let longestGap: number | null = null;
    let lastGap: number | null = null;
    for (let i = 1; i < tsAsc.length; i++) {
      const g = Math.round((tsAsc[i] - tsAsc[i - 1]) / DAY);
      if (longestGap === null || g > longestGap) longestGap = g;
      if (i === tsAsc.length - 1) lastGap = g;
    }
    const firstIso = stats.journal.length
      ? stats.journal[stats.journal.length - 1].createdAt
      : null;

    // ── trend (older half vs newer half) + monthly sparkline ──
    let trendWord = STILL;
    const points: number[] = [];
    if (tsAsc.length >= 2) {
      const start = tsAsc[0];
      const end = Date.now();
      const span = end - start || 1;
      const buckets = Math.min(12, Math.max(4, tsAsc.length));
      const counts = new Array(buckets).fill(0);
      for (const t of tsAsc) {
        let b = Math.floor(((t - start) / span) * buckets);
        if (b >= buckets) b = buckets - 1;
        if (b < 0) b = 0;
        counts[b]++;
      }
      points.push(...counts);
      const half = Math.floor(buckets / 2);
      const older = counts.slice(0, half).reduce((a, b) => a + b, 0);
      const newer = counts.slice(half).reduce((a, b) => a + b, 0);
      if (newer > older * 1.25) trendWord = "rising";
      else if (newer < older * 0.8) trendWord = "fading";
      else trendWord = "steady";
    }

    // ── time of day ──
    const tod = { morning: 0, afternoon: 0, evening: 0, night: 0 };
    for (const t of tsAsc) {
      const h = hourInTz(new Date(t), tz);
      if (h >= 5 && h <= 11) tod.morning++;
      else if (h >= 12 && h <= 16) tod.afternoon++;
      else if (h >= 17 && h <= 21) tod.evening++;
      else tod.night++;
    }
    const todTop = (Object.entries(tod) as Array<[string, number]>).sort(
      (a, b) => b[1] - a[1],
    )[0];
    const todLabel: Record<string, string> = {
      morning: "Mornings",
      afternoon: "Afternoons",
      evening: "Evenings",
      night: "Late night",
    };

    // ── tag signature ──
    const tagFreq = new Map<string, number>();
    for (const r of stats.journal)
      for (const tg of r.tags ?? []) tagFreq.set(tg, (tagFreq.get(tg) ?? 0) + 1);
    const topTag = [...tagFreq.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

    // ── position pattern ──
    const posFreq = new Map<number, number>();
    for (const r of stats.journal) {
      const idx = (r.cardIds ?? []).indexOf(heroCardId);
      if (idx >= 0) posFreq.set(idx, (posFreq.get(idx) ?? 0) + 1);
    }
    const topPos = [...posFreq.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

    // ── deep-read rate ──
    const deepCount = stats.journal.filter((r) => r.isDeepReading).length;

    // ── numerology / astrology window neighbours ──
    let sameNumber = 0;
    let sameElement = 0;
    if (drawCounts?.perCard) {
      for (const [idStr, c] of Object.entries(drawCounts.perCard)) {
        const id = Number(idStr);
        if (c <= 0 || id === heroCardId) continue;
        const m = getCardMeta(id);
        if (!m) continue;
        if (meta?.root != null && m.root === meta.root) sameNumber++;
        if (meta?.element && m.element === meta.element) sameElement++;
      }
    }

    // ── flag (one, by priority) ──
    let flagModel: { label: string; value: string } | null = null;
    if (count === 0) {
      flagModel = { label: "Ghost", value: "Not drawn in this window" };
    } else if (
      firstIso &&
      daysAgo(firstIso) <= 30 &&
      count <= 2
    ) {
      flagModel = { label: "New", value: "New to your records" };
    } else if (
      enough &&
      cadenceDays != null &&
      lastGap != null &&
      lastGap >= Math.max(21, cadenceDays * 2.5) &&
      stats.lastSeenAt != null &&
      daysAgo(stats.lastSeenAt) <= 30
    ) {
      flagModel = {
        label: "Comeback",
        value: `Returned after ${lastGap} days away`,
      };
    } else if (
      (stats.frequencyRank != null && stats.frequencyRank <= 5) ||
      count >= 10
    ) {
      flagModel = { label: "Lesson card", value: "Keeps returning to you" };
    }

    // ── chips ──
    const c: ChipModel[] = [];

    c.push({
      label: "Frequency",
      value:
        count === 0
          ? STILL
          : `${count} ${count === 1 ? "pull" : "pulls"}${
              stats.frequencyRank
                ? ` · #${stats.frequencyRank} of ${stats.totalDistinctCards}`
                : ""
            }`,
      hint: `How often you've drawn this card, and its rank among the cards you draw. ${count} ${
        count === 1 ? "pull" : "pulls"
      } this window.`,
    });

    c.push({
      label: "Last seen",
      value: stats.lastSeenAt
        ? `${formatTimeAgo(stats.lastSeenAt)}${
            cadenceDays ? ` · ≈ every ${cadenceDays}d` : ""
          }`
        : STILL,
      hint: stats.lastSeenAt
        ? `When you last drew it${
            cadenceDays ? `, and roughly how often it visits — about every ${cadenceDays} days.` : "."
          }`
        : "Draw it again to start a cadence.",
    });

    c.push({
      label: "First seen",
      value: firstIso
        ? `${formatDateShort(firstIso)} · ${daysAgo(firstIso)}d ago`
        : STILL,
      hint: firstIso
        ? `The earliest this card appears in your records — ${daysAgo(
            firstIso,
          )} days ago.`
        : "No appearances yet in this window.",
    });

    c.push({
      label: "Weekday",
      value: stats.topDayOfWeek
        ? `${stats.topDayOfWeek.day}s · ${stats.topDayOfWeek.count} of ${stats.topDayOfWeek.total}`
        : STILL,
      hint: stats.topDayOfWeek
        ? `The day of the week it tends to land on — ${stats.topDayOfWeek.day}s, ${stats.topDayOfWeek.count} of ${stats.topDayOfWeek.total} pulls.`
        : "Not enough pulls to see a weekday pattern.",
    });

    c.push({
      label: "Moon phase",
      value: stats.topMoonPhase
        ? `${stats.topMoonPhase.phase} · ${stats.topMoonPhase.count} of ${stats.topMoonPhase.total}`
        : STILL,
      hint: stats.topMoonPhase
        ? `The lunar phase you most often draw it under — a ${stats.topMoonPhase.phase} moon, ${stats.topMoonPhase.count} of ${stats.topMoonPhase.total}.`
        : "Not enough pulls to see a moon pattern.",
    });

    c.push({
      label: "Time of day",
      value:
        todTop && todTop[1] > 0
          ? `${todLabel[todTop[0]]} · ${todTop[1]} of ${count}`
          : STILL,
      hint:
        todTop && todTop[1] > 0
          ? `The hours you tend to pull it — ${todLabel[
              todTop[0]
            ].toLowerCase()}, ${todTop[1]} of ${count}.`
          : "Not enough pulls to see a time-of-day pattern.",
    });

    c.push({
      label: "Reversal",
      value:
        count === 0
          ? STILL
          : `${Math.round((stats.reversedCount / count) * 100)}% · ${
              stats.reversedCount / count > stats.seekerReversedRate
                ? "above"
                : stats.reversedCount / count < stats.seekerReversedRate
                ? "below"
                : "at"
            } your ${Math.round(stats.seekerReversedRate * 100)}%`,
      hint:
        count === 0
          ? "No pulls yet to measure reversals."
          : `How often it arrives reversed (${Math.round(
              (stats.reversedCount / count) * 100,
            )}%), against your overall ${Math.round(
              stats.seekerReversedRate * 100,
            )}% rate.`,
    });

    c.push({
      label: "Numerology",
      value:
        meta?.cardNumber != null && meta?.root != null
          ? `${meta.cardNumber} → ${meta.root}${
              sameNumber > 0 ? ` · ${sameNumber} more ${meta.root}s` : ""
            }`
          : meta?.rankLabel ?? STILL,
      hint:
        meta?.root != null
          ? `Its number reduces to ${meta.root}${
              sameNumber > 0
                ? ` — and ${sameNumber} other ${meta.root}-cards drawn this window.`
                : "."
            }`
          : "A court card — no numeric reduction.",
    });

    c.push({
      label: "Astrology",
      value: meta
        ? `${meta.planetOrSign ?? meta.element}${
            sameElement > 0 ? ` · ${sameElement} ${meta.element.toLowerCase()}` : ""
          }`
        : STILL,
      hint: meta
        ? `${meta.planetOrSign ? `${meta.planetOrSign}-ruled` : meta.element}${
            sameElement > 0
              ? ` — ${sameElement} other ${meta.element.toLowerCase()}-element cards this window.`
              : "."
          }`
        : "No astrological mapping for this card.",
    });

    {
      const top = stats.companions[0] ?? null;
      c.push({
        label: "Top companion",
        value: top ? `${getCardName(top.cardId)} · ${top.count}×` : STILL,
        hint: top
          ? `The card it co-draws with most — ${getCardName(top.cardId)}, ${top.count} times.`
          : "No co-draws yet in this window.",
      });
    }

    {
      const yn = meaning?.yesNo ?? "maybe";
      c.push({
        label: "Yes / No",
        value:
          yn === "yes" ? "Leans Yes" : yn === "no" ? "Leans No" : "Either way",
        hint:
          yn === "yes"
            ? `${heroName} leans Yes in a yes/no question.`
            : yn === "no"
            ? `${heroName} leans No in a yes/no question.`
            : `${heroName} could go either way — read the surrounding cards.`,
      });
    }

    c.push({
      label: "Trend",
      value: enough ? trendWord : STILL,
      hint: enough
        ? `Whether it's rising or fading over time — currently ${trendWord}.`
        : "Draw it a few more times to see a trend.",
    });

    c.push({
      label: "Longest silence",
      value: longestGap != null ? `${longestGap} days` : STILL,
      hint:
        longestGap != null
          ? `The longest it's gone unseen between pulls — ${longestGap} days.`
          : "Not enough pulls to measure a silence.",
    });

    c.push({
      label: "Tag signature",
      value: topTag ? `"${topTag[0]}" · ${topTag[1]}×` : STILL,
      hint: topTag
        ? `The tag you most attach when this card shows — "${topTag[0]}", ${topTag[1]} times.`
        : "No tags on its readings yet.",
    });

    c.push({
      label: "Position",
      value: topPos
        ? `Often ${ordinal(topPos[0] + 1)} · ${topPos[1]} of ${count}`
        : STILL,
      hint: topPos
        ? `Which spread slot it tends to land in — the ${ordinal(
            topPos[0] + 1,
          )} card, ${topPos[1]} of ${count}.`
        : "Not enough pulls to see a position pattern.",
    });

    c.push({
      label: "Deep-read rate",
      value: count === 0 ? STILL : `${deepCount} of ${count}`,
      hint:
        count === 0
          ? "No pulls yet to measure."
          : `How often you took it into a deep reading — ${deepCount} of ${count}.`,
    });

    return { flag: flagModel, chips: c, sparkPoints: points };
  }, [
    tsAsc,
    stats,
    drawCounts,
    heroCardId,
    heroName,
    meta,
    meaning,
    count,
    enough,
    tz,
  ]);

  const upright = meaning?.uprightKeywords ?? [];
  const reversed = meaning?.reversedKeywords ?? [];

  return (
    <div style={{ width: "100%" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 12,
        }}
      >
        <CardImage
          variant="face"
          cardId={heroCardId}
          deckId={heroDeckId ?? undefined}
          size="custom"
          widthPx={34}
        />
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: "var(--text-heading-md)",
            color: "var(--color-foreground)",
          }}
        >
          {timeRangeLabel} of data on{" "}
          <span style={{ color: "var(--accent, var(--gold))" }}>{heroName}</span>
        </div>
      </div>

      {/* Flag chip (conditional) */}
      {flag && (
        <div
          title={flag.value}
          style={{
            border: "1px solid color-mix(in oklab, var(--accent, var(--gold)) 50%, transparent)",
            background:
              "color-mix(in oklab, var(--accent, var(--gold)) 10%, transparent)",
            borderRadius: 6,
            padding: "7px 11px",
            marginBottom: 12,
            display: "flex",
            flexDirection: "column",
            gap: 1,
            cursor: "help",
          }}
        >
          <span
            style={{
              fontSize: 9,
              letterSpacing: "0.14em",
              fontStyle: "italic",
              fontFamily: "var(--font-serif)",
              color: "var(--accent, var(--gold))",
              textTransform: "uppercase",
              opacity: 0.85,
            }}
          >
            {flag.label}
          </span>
          <span
            style={{
              fontSize: 13,
              fontStyle: "italic",
              fontFamily: "var(--font-serif)",
              color: "var(--color-foreground)",
            }}
          >
            {flag.value}
          </span>
        </div>
      )}

      {/* Chip grid (responsive ~4 cols) */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
          gap: 9,
        }}
      >
        {chips.map((chip) => (
          <div
            key={chip.label}
            title={chip.hint}
            style={{
              border: "1px solid var(--border-subtle)",
              background: "var(--surface-elevated, var(--surface-card))",
              borderRadius: 6,
              padding: "6px 10px",
              minHeight: 40,
              boxSizing: "border-box",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              cursor: "help",
            }}
          >
            <span
              style={{
                fontSize: 9,
                lineHeight: 1.1,
                letterSpacing: "0.14em",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                color: "var(--accent, var(--gold))",
                opacity: 0.8,
                textTransform: "uppercase",
              }}
            >
              {chip.label}
            </span>
            <span
              style={{
                fontSize: 13,
                lineHeight: 1.2,
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                color: "var(--color-foreground)",
                display: "flex",
                alignItems: "center",
                gap: 5,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {chip.label === "Trend" && sparkPoints.length >= 2 && (
                <Sparkline points={sparkPoints} />
              )}
              {chip.value}
            </span>
          </div>
        ))}
      </div>

      {/* Keyword strip */}
      {(upright.length > 0 || reversed.length > 0) && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px solid var(--border-subtle)",
          }}
        >
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 6,
              alignItems: "center",
            }}
          >
            <span
              style={{
                fontSize: 9,
                letterSpacing: "0.14em",
                fontStyle: "italic",
                fontFamily: "var(--font-serif)",
                color: "var(--color-foreground-muted)",
                textTransform: "uppercase",
                marginRight: 4,
              }}
            >
              Keywords
            </span>
            {upright.map((k) => (
              <span
                key={`u-${k}`}
                style={{
                  fontSize: 12,
                  fontStyle: "italic",
                  fontFamily: "var(--font-serif)",
                  color: "var(--background)",
                  background: "var(--accent, var(--gold))",
                  borderRadius: 4,
                  padding: "2px 9px",
                }}
              >
                {k}
              </span>
            ))}
            {reversed.map((k) => (
              <span
                key={`r-${k}`}
                style={{
                  fontSize: 12,
                  fontStyle: "italic",
                  fontFamily: "var(--font-serif)",
                  color: "var(--color-foreground-muted)",
                  background: "var(--surface-elevated, var(--surface-card))",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 4,
                  padding: "2px 9px",
                }}
              >
                {k}
              </span>
            ))}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              style={{
                fontSize: 11,
                fontStyle: "italic",
                fontFamily: "var(--font-serif)",
                color: "var(--color-foreground-muted)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                marginLeft: 2,
              }}
            >
              {expanded ? "tap to collapse ‹" : "tap to expand ›"}
            </button>
          </div>
          {expanded && meaning && (
            <div
              style={{
                marginTop: 10,
                display: "flex",
                flexDirection: "column",
                gap: 8,
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: "var(--text-body-sm)",
                  fontFamily: "var(--font-serif)",
                  color: "var(--color-foreground)",
                  lineHeight: 1.5,
                }}
              >
                <span style={{ color: "var(--accent, var(--gold))" }}>Upright · </span>
                {meaning.uprightMeaning}
              </p>
              <p
                style={{
                  margin: 0,
                  fontSize: "var(--text-body-sm)",
                  fontFamily: "var(--font-serif)",
                  color: "var(--color-foreground-muted)",
                  lineHeight: 1.5,
                }}
              >
                <span style={{ fontStyle: "italic" }}>Reversed · </span>
                {meaning.reversedMeaning}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Sparkline({ points }: { points: number[] }) {
  const w = 34;
  const h = 12;
  const max = Math.max(...points, 1);
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const path = points
    .map((p, i) => `${(i * step).toFixed(1)},${(h - (p / max) * h).toFixed(1)}`)
    .join(" ");
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      style={{ flexShrink: 0, overflow: "visible" }}
      aria-hidden="true"
    >
      <polyline
        points={path}
        fill="none"
        stroke="var(--accent, var(--gold))"
        strokeWidth={1.5}
      />
    </svg>
  );
}
