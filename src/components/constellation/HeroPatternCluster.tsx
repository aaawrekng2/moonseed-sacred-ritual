import { useMemo } from "react";
import { getCardName } from "@/lib/tarot";
import { getCardMeta } from "@/lib/card-astrology";
import { TAROT_MEANINGS } from "@/lib/tarot-meanings";
import { formatTimeAgo, formatDateShort } from "@/lib/dates";
import { hourInTz, dayOfWeekInTz } from "@/lib/time";
import type { QuickLogCardStats, CardDrawCounts } from "@/lib/quicklog.functions";

// ── State A hero pattern cluster ─────────────────────────────────────
// Single-card lens for the Insights › Patterns left block. Every value
// computes from data already in hand (getQuickLogCardStats + drawCounts
// + static card metadata). Hover-first: a calm value on the face, an
// enriched breakdown on hover (native title). Thin history shows
// "still gathering" instead of a fabricated number.

type Props = {
  heroCardId: number;
  heroDeckId?: string | null;
  stats: QuickLogCardStats;
  drawCounts: CardDrawCounts | null;
  tz: string;
  trackReversals: boolean;
};

const STILL = "still gathering";
const DAY = 86400000;
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function daysAgo(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));
}
function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
// "a 12, b 7, c 3" from sorted [label, count] entries.
function listCounts(entries: Array<[string, number]>, n = 6): string {
  return entries
    .slice(0, n)
    .map(([k, c]) => `${k} ${c}`)
    .join(", ");
}

type ChipModel = {
  label: string;
  value: React.ReactNode;
  hint: string;
  accent?: boolean;
};

export function HeroPatternCluster({
  heroCardId,
  stats,
  drawCounts,
  tz,
  trackReversals,
}: Props) {
  const meta = getCardMeta(heroCardId);
  const meaning = TAROT_MEANINGS[heroCardId] ?? null;
  const count = stats.count;
  const enough = count >= 2;

  const tsAsc = useMemo(
    () =>
      [...stats.journal]
        .map((r) => new Date(r.createdAt).getTime())
        .filter((t) => Number.isFinite(t))
        .sort((a, b) => a - b),
    [stats.journal],
  );

  const { chips, sparkPoints } = useMemo(() => {
    // ── temporal ──
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

    // ── trend + sparkline ──
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

    // ── weekday full split (client, tz-aware) ──
    const wd = new Array(7).fill(0);
    for (const t of tsAsc) wd[dayOfWeekInTz(new Date(t), tz)]++;
    const wdList = wd
      .map((c, i) => [`${WEEKDAYS[i]}s`, c] as [string, number])
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1]);

    // ── time of day full split ──
    const tod = { Mornings: 0, Afternoons: 0, Evenings: 0, "Late night": 0 };
    for (const t of tsAsc) {
      const h = hourInTz(new Date(t), tz);
      if (h >= 5 && h <= 11) tod.Mornings++;
      else if (h >= 12 && h <= 16) tod.Afternoons++;
      else if (h >= 17 && h <= 21) tod.Evenings++;
      else tod["Late night"]++;
    }
    const todList = (Object.entries(tod) as Array<[string, number]>)
      .filter(([, c]) => c > 0)
      .sort((a, b) => b[1] - a[1]);

    // ── moon phase full split (client, from passthrough) ──
    const moonFreq = new Map<string, number>();
    for (const r of stats.journal)
      if (r.moonPhase) moonFreq.set(r.moonPhase, (moonFreq.get(r.moonPhase) ?? 0) + 1);
    const moonList = [...moonFreq.entries()].sort((a, b) => b[1] - a[1]);

    // ── tags full freq ──
    const tagFreq = new Map<string, number>();
    for (const r of stats.journal)
      for (const tg of r.tags ?? []) tagFreq.set(tg, (tagFreq.get(tg) ?? 0) + 1);
    const tagList = [...tagFreq.entries()].sort((a, b) => b[1] - a[1]);

    // ── position ──
    const posFreq = new Map<number, number>();
    for (const r of stats.journal) {
      const idx = (r.cardIds ?? []).indexOf(heroCardId);
      if (idx >= 0) posFreq.set(idx, (posFreq.get(idx) ?? 0) + 1);
    }
    const posList = [...posFreq.entries()].sort((a, b) => b[1] - a[1]);
    const topPos = posList[0] ?? null;

    // ── deep read ──
    const deepCount = stats.journal.filter((r) => r.isDeepReading).length;

    // ── numerology / astrology matching cards (by name) ──
    const sameNumberCards: Array<[string, number]> = [];
    const sameElementCards: Array<[string, number]> = [];
    if (drawCounts?.perCard) {
      for (const [idStr, c] of Object.entries(drawCounts.perCard)) {
        const id = Number(idStr);
        if (c <= 0 || id === heroCardId) continue;
        const m = getCardMeta(id);
        if (!m) continue;
        if (meta?.root != null && m.root === meta.root)
          sameNumberCards.push([getCardName(id), c]);
        if (meta?.element && m.element === meta.element)
          sameElementCards.push([getCardName(id), c]);
      }
      sameNumberCards.sort((a, b) => b[1] - a[1]);
      sameElementCards.sort((a, b) => b[1] - a[1]);
    }

    // ── flag (one, by priority) → first chip ──
    let flagChip: ChipModel | null = null;
    if (count === 0) {
      flagChip = {
        label: "Ghost",
        value: "Not drawn",
        hint: "This card hasn't appeared at all in the current window.",
        accent: true,
      };
    } else if (firstIso && daysAgo(firstIso) <= 30 && count <= 2) {
      flagChip = {
        label: "New",
        value: "New to you",
        hint: `First appears ${daysAgo(firstIso)} days ago — new to your records this window.`,
        accent: true,
      };
    } else if (
      enough &&
      cadenceDays != null &&
      lastGap != null &&
      lastGap >= Math.max(21, cadenceDays * 2.5) &&
      stats.lastSeenAt != null &&
      daysAgo(stats.lastSeenAt) <= 30
    ) {
      flagChip = {
        label: "Comeback",
        value: `Back after ${lastGap}d`,
        hint: `Returned after ${lastGap} days away — its usual rhythm is about every ${cadenceDays} days.`,
        accent: true,
      };
    } else if (
      (stats.frequencyRank != null && stats.frequencyRank <= 5) ||
      count >= 10
    ) {
      flagChip = {
        label: "Lesson card",
        value: "Keeps returning",
        hint: `One of your most-drawn cards${
          stats.frequencyRank ? ` — ranked #${stats.frequencyRank} of ${stats.totalDistinctCards}` : ""
        }. A recurring lesson.`,
        accent: true,
      };
    }

    // ── chips ──
    const c: ChipModel[] = [];
    if (flagChip) c.push(flagChip);

    c.push({
      label: "Frequency",
      value:
        count === 0
          ? STILL
          : `${count} ${count === 1 ? "pull" : "pulls"}${
              stats.frequencyRank ? ` · #${stats.frequencyRank} of ${stats.totalDistinctCards}` : ""
            }`,
      hint:
        count === 0
          ? "No pulls of this card in the window yet."
          : `Drawn ${count} times this window${
              stats.frequencyRank
                ? `, your #${stats.frequencyRank} most-drawn of ${stats.totalDistinctCards} cards.`
                : "."
            }`,
    });

    // v2.64 — over-index vs pure chance, as a signed percent. Same engine
    // formula the gauge uses: expected = windowTotalSlots / 78; over-index =
    // count / expected; shown as (overIndex - 1) * 100. Positive = drawn more
    // than chance, negative = less. Reflects the active filter window (like the
    // other tiles).
    c.push(
      (() => {
        const totalSlots = stats.windowTotalSlots ?? 0;
        const expected = totalSlots / 78;
        if (count === 0 || expected <= 0) {
          return {
            label: "Vs chance",
            value: STILL,
            hint: "Not enough pulls yet to compare against pure chance.",
          };
        }
        const overIndex = count / expected;
        const pct = Math.round((overIndex - 1) * 100);
        const absPct = Math.abs(pct);
        const value = pct === 0 ? "even" : `${pct > 0 ? "+" : "\u2212"}${absPct}%`;
        const hint =
          pct === 0
            ? `Drawn about as often as pure chance would deal it — ${count} vs ~${expected.toFixed(1)} expected across this window.`
            : `Drawn ${absPct}% ${pct > 0 ? "more" : "less"} often than pure chance would deal it — ${count} vs ~${expected.toFixed(
                1,
              )} expected across this window.`;
        return { label: "Vs chance", value, hint };
      })(),
    );

    c.push({
      label: "Last seen",
      value: stats.lastSeenAt
        ? `${formatTimeAgo(stats.lastSeenAt)}${cadenceDays ? ` · ≈ every ${cadenceDays}d` : ""}`
        : STILL,
      hint: stats.lastSeenAt
        ? `Last drawn ${daysAgo(stats.lastSeenAt)} days ago${
            cadenceDays ? `; on average it visits about every ${cadenceDays} days.` : "."
          }`
        : "Draw it again to start a cadence.",
    });

    c.push({
      label: "First seen",
      value: firstIso ? `${formatDateShort(firstIso)} · ${daysAgo(firstIso)}d ago` : STILL,
      hint: firstIso
        ? `Earliest in your records this window — ${formatDateShort(firstIso)}, ${daysAgo(firstIso)} days ago.`
        : "No appearances yet in this window.",
    });

    c.push({
      label: "Weekday",
      value: stats.topDayOfWeek
        ? `${stats.topDayOfWeek.day}s · ${stats.topDayOfWeek.count} of ${stats.topDayOfWeek.total}`
        : STILL,
      hint: wdList.length
        ? `Full split — ${listCounts(wdList)}.`
        : "Not enough pulls to see a weekday pattern.",
    });

    c.push({
      label: "Moon phase",
      value: stats.topMoonPhase
        ? `${stats.topMoonPhase.phase} · ${stats.topMoonPhase.count} of ${stats.topMoonPhase.total}`
        : STILL,
      hint: moonList.length
        ? `Full split — ${listCounts(moonList)}.`
        : "Not enough pulls to see a moon pattern.",
    });

    c.push({
      label: "Time of day",
      value: todList.length ? `${todList[0][0]} · ${todList[0][1]} of ${count}` : STILL,
      hint: todList.length
        ? `Full split — ${listCounts(todList)}.`
        : "Not enough pulls to see a time-of-day pattern.",
    });

    if (trackReversals) {
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
            : `Reversed ${stats.reversedCount} of ${count} (${Math.round(
                (stats.reversedCount / count) * 100,
              )}%), vs your ${Math.round(stats.seekerReversedRate * 100)}% overall rate.`,
      });
    }

    c.push({
      label: "Numerology",
      value:
        meta?.cardNumber != null && meta?.root != null
          ? `${meta.cardNumber} → ${meta.root}${
              sameNumberCards.length ? ` · ${sameNumberCards.length} more ${meta.root}s` : ""
            }`
          : meta?.rankLabel ?? STILL,
      hint:
        meta?.root != null
          ? `Reduces to ${meta.root}.${
              sameNumberCards.length
                ? ` Other ${meta.root}-cards you've drawn — ${listCounts(sameNumberCards)}.`
                : ""
            }`
          : "A court card — no numeric reduction.",
    });

    c.push({
      label: "Astrology",
      value: meta
        ? `${meta.planetOrSign ?? meta.element}${
            sameElementCards.length ? ` · ${sameElementCards.length} ${meta.element.toLowerCase()}` : ""
          }`
        : STILL,
      hint: meta
        ? `${meta.planetOrSign ? `${meta.planetOrSign}-ruled, ` : ""}${meta.element} element.${
            sameElementCards.length
              ? ` Other ${meta.element.toLowerCase()} cards you've drawn — ${listCounts(sameElementCards)}.`
              : ""
          }`
        : "No astrological mapping for this card.",
    });

    c.push({
      label: "Top companion",
      value: stats.companions[0]
        ? `${getCardName(stats.companions[0].cardId)} · ${stats.companions[0].count}×`
        : STILL,
      hint: stats.companions.length
        ? `Most-drawn alongside — ${listCounts(
            stats.companions.map((co) => [getCardName(co.cardId), co.count] as [string, number]),
          )}.`
        : "No co-draws yet in this window.",
    });

    {
      const yn = meaning?.yesNo ?? "maybe";
      c.push({
        label: "Yes / No",
        value: yn === "yes" ? "Leans Yes" : yn === "no" ? "Leans No" : "Either way",
        hint: trackReversals
          ? yn === "yes"
            ? "Leans Yes in a yes/no question — reversed, it flips toward No."
            : yn === "no"
            ? "Leans No in a yes/no question — reversed, it flips toward Yes."
            : "Could go either way — upright leans Yes, reversed leans No."
          : yn === "yes"
          ? "Leans Yes in a yes/no question."
          : yn === "no"
          ? "Leans No in a yes/no question."
          : "Could go either way.",
      });
    }

    c.push({
      label: "Trend",
      value: enough ? trendWord : STILL,
      hint: enough
        ? `Drawn over time it's ${trendWord} — the sparkline tracks pulls per period across the window.`
        : "Draw it a few more times to see a trend.",
    });

    c.push({
      label: "Longest silence",
      value: longestGap != null ? `${longestGap} days` : STILL,
      hint:
        longestGap != null
          ? `The longest stretch it went unseen between pulls — ${longestGap} days.`
          : "Not enough pulls to measure a silence.",
    });

    c.push({
      label: "Tag signature",
      value: tagList.length ? `"${tagList[0][0]}" · ${tagList[0][1]}×` : STILL,
      hint: tagList.length
        ? `Your tags on its readings — ${listCounts(tagList)}.`
        : "No tags on its readings yet.",
    });

    c.push({
      label: "Position",
      value: topPos ? `Often ${ordinal(topPos[0] + 1)} · ${topPos[1]} of ${count}` : STILL,
      hint: posList.length
        ? `Where it lands in the spread — ${listCounts(
            posList.map(([p, cc]) => [ordinal(p + 1), cc] as [string, number]),
          )}.`
        : "Not enough pulls to see a position pattern.",
    });

    c.push({
      label: "Deep-read rate",
      value: count === 0 ? STILL : `${deepCount} of ${count}`,
      hint:
        count === 0
          ? "No pulls yet to measure."
          : `Taken into a deep reading ${deepCount} of ${count} times.`,
    });

    // ── keywords chip ──
    const upright = meaning?.uprightKeywords ?? [];
    const reversed = trackReversals ? meaning?.reversedKeywords ?? [] : [];
    if (upright.length || reversed.length) {
      c.push({
        label: "Keywords",
        value: upright.length ? upright.join(", ") : reversed.join(", "),
        hint: `${upright.length ? `Upright — ${upright.join(", ")}.` : ""}${
          reversed.length ? ` Reversed — ${reversed.join(", ")}.` : ""
        }`,
      });
    }

    return { chips: c, sparkPoints: points };
  }, [tsAsc, stats, drawCounts, heroCardId, meta, meaning, count, enough, tz, trackReversals]);

  return (
    <div style={{ width: "100%" }}>
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
              border: chip.accent
                ? "1px solid color-mix(in oklab, var(--accent, var(--gold)) 50%, transparent)"
                : "1px solid var(--border-subtle)",
              background: chip.accent
                ? "color-mix(in oklab, var(--accent, var(--gold)) 10%, transparent)"
                : "var(--surface-elevated, var(--surface-card))",
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
                opacity: chip.accent ? 0.85 : 0.8,
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
      <polyline points={path} fill="none" stroke="var(--accent, var(--gold))" strokeWidth={1.5} />
    </svg>
  );
}
