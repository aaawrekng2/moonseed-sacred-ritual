/**
 * EK60/EK61 — CardRichPopover + CardHoverTip
 *
 * A reusable hover tip that reproduces the manual-entry constellation
 * card popover: a static mini-constellation on top (hovered card as hero,
 * no teal/badges/calendar interaction) and the rich card stats below.
 *
 * EK61 — filter-aware. Receives the active InsightsFilters, threads tz +
 * the filter envelope into every fetch, includes the global rank tile
 * (#N of M, from getCardDrawCounts), and shows a one-line filter indicator
 * that fades out at the right edge so the seeker can see how the numbers
 * are filtered.
 */
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { X, GripHorizontal, Settings, Pin, Eye, EyeOff } from "lucide-react";
import {
  isHoverSnoozed,
  applySnooze,
  clearSnooze,
  useHoverSnooze,
  SNOOZE_OPTIONS,
} from "@/lib/hover-snooze";
import { useServerFn } from "@tanstack/react-start";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import {
  getCardConstellation,
  getCardPopoverData,
  getCardDrawCounts,
  type CardConstellation,
  type CardPopoverData,
} from "@/lib/quicklog.functions";
import type { InsightsFilters } from "@/lib/insights.types";
import { getCardName, cardType } from "@/lib/tarot";
import { getCardMeaning } from "@/lib/tarot-meanings";
import { formatDateLong, formatTimeAgo } from "@/lib/dates";
import { ConstellationWeb } from "@/components/constellation/ConstellationWeb";
import { CardRichContent, loadHoverStage } from "@/components/card/CardRichContent";
import { useAnyDeckCardName } from "@/lib/active-deck";
import type { ManualPick } from "@/components/tabletop/ManualEntryBuilder";

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// EK61 — map the Insights filter shape onto the endpoints' envelope.
const TIME_RANGE_LABEL: Record<string, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  "180d": "Last 180 days",
  "365d": "Last 365 days",
  all: "All time",
};

function toEnvelope(f: InsightsFilters) {
  return {
    timeRange: f.timeRange,
    tags: f.tagIds,
    spreadTypes: f.spreadTypes,
    moonPhases: f.moonPhases,
    reversedOnly: f.reversedOnly,
    deepOnly: f.deepOnly,
  };
}

// One-line, priority-ordered summary of the active filters.
function filterSummary(f: InsightsFilters): string {
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const parts: string[] = [TIME_RANGE_LABEL[f.timeRange] ?? String(f.timeRange)];
  if (f.tagIds.length) parts.push(plural(f.tagIds.length, "tag"));
  if (f.spreadTypes.length) parts.push(plural(f.spreadTypes.length, "spread"));
  if (f.moonPhases.length) parts.push(plural(f.moonPhases.length, "moon phase"));
  if (f.reversedOnly) parts.push("reversed only");
  if (f.deepOnly) parts.push("deep only");
  return parts.join("  ·  ");
}

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div
      style={{
        flex: 1,
        background: "var(--surface-elevated)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-md)",
        padding: "8px 6px",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "var(--text-heading-sm)", color: "var(--color-foreground)" }}>
        {value}
      </div>
      <div
        style={{
          fontSize: "var(--text-caption)",
          color: "var(--color-foreground-muted)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          marginTop: 2,
        }}
      >
        {label}
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: "var(--text-caption)",
        color: "var(--accent)",
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        marginTop: 12,
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

export type CardRichPreload = {
  constellation?: CardConstellation | null;
  stats?: CardPopoverData | null;
  rank?: { rank: number; universe: number } | null;
};

// EK66 — all-time filters for surfaces that have no Insights filter bar
// (e.g. Journal → Readings). Gives the popup a valid envelope + tz so its
// stats reflect the seeker's whole history.
export function allTimeFilters(tz: string): InsightsFilters {
  return {
    timeRange: "all",
    moonPhases: [],
    spreadTypes: [],
    tagIds: [],
    deckIds: [],
    reversedOnly: false,
    deepOnly: false,
    tz,
  };
}

function menuItemStyle(highlight: boolean): React.CSSProperties {
  return {
    textAlign: "left",
    fontFamily: "var(--font-serif)",
    fontSize: 12,
    padding: "6px 8px",
    border: "none",
    borderRadius: "var(--radius-sm, 6px)",
    background: "transparent",
    cursor: "pointer",
    color: highlight ? "var(--accent, var(--gold))" : "var(--color-foreground)",
    whiteSpace: "nowrap",
  };
}

export function CardRichPopoverContent({
  cardId,
  filters,
  showConstellation = true,
  preload,
  variant = "rich",
  onEscalate,
  onPin,
  pinnable = false,
  initialEditing = false,
  headerInfo,
}: {
  cardId: number;
  filters: InsightsFilters;
  /** EK63 — whether to render the mini-constellation on top. Set per
   *  surface in code: ON for Insights → Cards; OFF where the host page
   *  already shows a constellation (e.g. manual entry). */
  showConstellation?: boolean;
  /** EK63 — preloaded data. When provided, the component uses it instead of
   *  fetching, so callers that already hold this in memory (manual entry)
   *  don't trigger a redundant round-trip. Omit it to let the component
   *  fetch for itself (Insights, and future surfaces). */
  preload?: CardRichPreload;
  /** EK74 — "slim" = compact first-hover peek; "rich" = full body (default). */
  variant?: "slim" | "rich";
  /** EK74 — clicking the slim peek escalates to rich. EK87 — the optional
   *  openEdit flag (true when the slim peek's gear was tapped) opens the
   *  rich popover straight into edit mode. */
  onEscalate?: (openEdit?: boolean) => void;
  /** EK75 — pin button (host-wired draggable floating copy). */
  onPin?: () => void;
  pinnable?: boolean;
  /** EK87 — seed edit mode on open (used when escalated via the slim gear). */
  initialEditing?: boolean;
  /** EK88 — optional content shown by an ⓘ next to the card name in the
   *  rich header (e.g. the constellation legend on the manual-entry surface).
   *  When omitted, no header ⓘ renders (Journal / Insights). */
  headerInfo?: React.ReactNode;
}) {
  const constFn = useServerFn(getCardConstellation);
  const dataFn = useServerFn(getCardPopoverData);
  const rankFn = useServerFn(getCardDrawCounts);
  const resolveCardName = useAnyDeckCardName();
  // EK65 — name of the constellation card currently hovered inside this
  // popup, shown as a small label near the cursor.
  const [webHover, setWebHover] = useState<{ name: string; x: number; y: number } | null>(null);
  // EK75 — widen the card + hide the mini-constellation while the gear's
  // dual-pane edit is open.
  const [editing, setEditing] = useState(initialEditing);
  const [bellOpen, setBellOpen] = useState(false);
  const { snoozed } = useHoverSnooze();
  // EK78 — diving: hovering/clicking a node in THIS popover's constellation
  // opens a nested mini/big popover for that card. Each level manages its own.
  const [nested, setNested] = useState<{
    cardId: number;
    mode: "slim" | "rich";
    x: number;
    y: number;
    editStart?: boolean;
  } | null>(null);
  const nestedCloseTimer = useRef<number>(0);
  const lastNodePos = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  const handleNodeHover = (cid: number | null, x: number, y: number) => {
    window.clearTimeout(nestedCloseTimer.current);
    // EK83 — the hero node IS this card; hovering it must NOT spawn a
    // duplicate popover of the same card. Companions still dive.
    if (cid != null && cid === cardId) {
      nestedCloseTimer.current = window.setTimeout(() => setNested(null), 160);
      return;
    }
    if (cid == null) {
      nestedCloseTimer.current = window.setTimeout(() => setNested(null), 160);
      return;
    }
    lastNodePos.current = { x, y };
    setNested((prev) =>
      prev && prev.cardId === cid && prev.mode === "rich"
        ? prev
        : { cardId: cid, mode: "slim", x, y },
    );
  };
  const handleNodeClick = (cid: number) => {
    if (cid === cardId) return; // EK83 — hero is self; no dive.
    window.clearTimeout(nestedCloseTimer.current);
    const { x, y } = lastNodePos.current;
    setNested({ cardId: cid, mode: "rich", x, y });
  };
  // When preloaded, skip the fetch entirely and never re-run it.
  const hasPreload = preload !== undefined;
  const [constellation, setConstellation] = useState<CardConstellation | null>(
    preload?.constellation ?? null,
  );
  const [stats, setStats] = useState<CardPopoverData | null>(preload?.stats ?? null);
  const [rank, setRank] = useState<{ rank: number; universe: number } | null>(
    preload?.rank ?? null,
  );

  const tz = filters.tz;
  // Re-run when the filter window changes (the envelope is the part the
  // endpoints actually filter on).
  const envKey = JSON.stringify(toEnvelope(filters));

  useEffect(() => {
    if (hasPreload) return; // caller supplied data — don't fetch
    let alive = true;
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const envelope = toEnvelope(filters);
        const [c, d, dc] = await Promise.all([
          constFn({ data: { heroCardId: cardId, tz, filters: envelope }, headers }),
          dataFn({ data: { cardIds: [cardId], tz, filters: envelope }, headers }),
          rankFn({ data: { cardIds: [cardId], tz, filters: envelope }, headers }),
        ]);
        if (!alive) return;
        setConstellation(c);
        setStats((d as Record<number, CardPopoverData>)[cardId] ?? null);
        const r = dc as { perCardRank: Record<number, number>; rankUniverseSize: number };
        const rk = r.perCardRank?.[cardId];
        setRank(typeof rk === "number" ? { rank: rk, universe: r.rankUniverseSize } : null);
      } catch {
        /* leave nulls — render what we can */
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardId, tz, envKey, hasPreload, constFn, dataFn, rankFn]);

  const name = getCardName(cardId);
  const meaning = getCardMeaning(cardId);
  const arcana = cardType(cardId) === "Major" ? "Major" : cardType(cardId);
  const subhead = [arcana, meaning?.zodiac ?? meaning?.element].filter(Boolean).join(" · ");

  const pulls = constellation ? constellation.matches.length : null;
  const dates = (constellation?.matches ?? [])
    .map((m) => m.createdAt)
    .sort();
  const firstSeen = dates.length ? dates[0] : null;
  const lastSeen = dates.length ? dates[dates.length - 1] : null;

  const heroPick: ManualPick = {
    id: cardId,
    cardIndex: cardId,
    isReversed: false,
    deckId: null,
    cardName: name,
  };

  const reversedPct =
    stats?.reversedPct != null ? `${Math.round(stats.reversedPct * 100)}%` : "—";
  const maxMonth = stats ? Math.max(1, ...stats.monthCounts) : 1;

  const count =
    stats?.monthCounts?.reduce((a, n) => a + n, 0) ??
    (constellation ? constellation.matches.length : 0);

  if (variant === "slim") {
    return (
      <div
        style={{
          position: "relative",
          maxWidth: 360,
          width: "max-content",
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg)",
          padding: "10px 12px",
          boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
        }}
      >
        {/* EK87 — gear opens the full popover straight into edit mode. */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEscalate?.(true);
          }}
          onMouseDown={(e) => e.stopPropagation()}
          aria-label="Customize which sections show"
          title="Customize sections"
          style={{
            position: "absolute",
            right: 8,
            top: 8,
            width: 20,
            height: 20,
            padding: 0,
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm, 6px)",
            background: "var(--surface-card)",
            cursor: "pointer",
            color: "var(--accent, var(--gold))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: 0.85,
            zIndex: 2,
          }}
        >
          <Settings size={12} />
        </button>
        <CardRichContent
          cardId={cardId}
          stats={stats}
          rank={rank?.rank ?? null}
          universeSize={rank?.universe ?? 0}
          count={count}
          firstSeenIso={firstSeen}
          lastSeenIso={lastSeen}
          resolveCardName={resolveCardName}
          tz={tz}
          variant="slim"
          onEscalate={onEscalate}
        />
      </div>
    );
  }

  return (
    <>
    <div
      style={{
        position: "relative",
        width: editing ? "min(580px, calc(100vw - 16px))" : "min(340px, calc(100vw - 16px))",
        maxWidth: "calc(100vw - 16px)",
        maxHeight: "calc(100vh - 16px)",
        overflowY: "auto",
        overflowX: "hidden",
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg)",
        padding: "12px 14px",
        boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      {/* EK86 — gear joins the right cluster: gear · hover-tips eye · pin
          (customize → toggle → pin), all on the right. */}
      <button
        type="button"
        onClick={() => setEditing((v) => !v)}
        aria-label={editing ? "Done editing" : "Edit which sections show"}
        title={editing ? "Done" : "Show / hide sections"}
        style={{
          position: "absolute",
          right: 62,
          top: 10,
          width: 20,
          height: 20,
          padding: 0,
          border: editing
            ? "1px solid var(--accent, var(--gold))"
            : "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-sm, 6px)",
          background: editing
            ? "color-mix(in oklab, var(--accent, var(--gold)) 14%, transparent)"
            : "var(--surface-card)",
          cursor: "pointer",
          color: "var(--accent, var(--gold))",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          opacity: editing ? 1 : 0.85,
          zIndex: 3,
        }}
      >
        <Settings size={12} />
      </button>
      {/* EK77 — pin at the box's true upper-right. */}
      {pinnable && onPin && !editing && (
        <button
          type="button"
          onClick={onPin}
          aria-label="Pin to screen"
          title="Pin to screen — compare side by side"
          style={{
            position: "absolute",
            right: 10,
            top: 10,
            width: 20,
            height: 20,
            padding: 0,
            border: "1px solid var(--border-subtle)",
            borderRadius: "var(--radius-sm, 6px)",
            background: "var(--surface-card)",
            cursor: "pointer",
            color: "var(--color-foreground-muted, var(--color-foreground))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            opacity: 0.85,
            zIndex: 3,
          }}
        >
          <Pin size={12} strokeWidth={1.5} />
        </button>
      )}
      {/* EK79 — bell: snooze the hover popups for a chosen time. */}
      {!editing && (
        <div style={{ position: "absolute", right: 36, top: 10, zIndex: 4 }}>
          <button
            type="button"
            onClick={() => setBellOpen((v) => !v)}
            aria-label="Hide hover tips for a while"
            title="Hide hover tips for a while"
            style={{
              width: 20,
              height: 20,
              padding: 0,
              border: "1px solid var(--border-subtle)",
              borderRadius: "var(--radius-sm, 6px)",
              background: "var(--surface-card)",
              cursor: "pointer",
              color: snoozed
                ? "var(--color-foreground-muted, var(--color-foreground))"
                : "#7f77dd",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: 0.85,
            }}
          >
            {snoozed ? (
              <EyeOff size={12} strokeWidth={1.5} />
            ) : (
              <Eye size={12} strokeWidth={1.5} />
            )}
          </button>
          {bellOpen && (
            <div
              style={{
                position: "absolute",
                right: 0,
                top: 24,
                minWidth: 170,
                background: "var(--surface-elevated, var(--surface-card))",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md, 8px)",
                boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
                padding: 4,
                display: "flex",
                flexDirection: "column",
                gap: 2,
              }}
            >
              <div
                style={{
                  fontSize: 10,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--color-foreground-muted, var(--color-foreground))",
                  padding: "4px 8px 2px",
                }}
              >
                Hide hover tips
              </div>
              {snoozed && (
                <button
                  type="button"
                  onClick={() => {
                    clearSnooze();
                    setBellOpen(false);
                  }}
                  style={menuItemStyle(true)}
                >
                  Turn back on
                </button>
              )}
              {SNOOZE_OPTIONS.map((opt) => (
                <button
                  key={String(opt.value)}
                  type="button"
                  onClick={() => {
                    applySnooze(opt.value);
                    setBellOpen(false);
                  }}
                  style={menuItemStyle(false)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {/* EK77 — the body now owns the constellation as a toggleable section. */}
      <CardRichContent
        cardId={cardId}
        stats={stats}
        rank={rank?.rank ?? null}
        universeSize={rank?.universe ?? 0}
        count={count}
        firstSeenIso={firstSeen}
        lastSeenIso={lastSeen}
        resolveCardName={resolveCardName}
        tz={tz}
        editing={editing}
        showConstellation={showConstellation}
        constellation={constellation}
        heroPick={heroPick}
        pulls={pulls ?? undefined}
        onNodeHover={handleNodeHover}
        onNodeClick={handleNodeClick}
        headerInfo={headerInfo}
      />
    </div>
      {/* EK78 — nested dive popover for a constellation node. Recursive: the
          nested popover keeps its own constellation, so the seeker can dive
          card → card → card. */}
      {nested &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left:
                nested.mode === "slim"
                  ? Math.max(8, Math.min(nested.x + 12, window.innerWidth - 240 - 8))
                  : Math.max(8, Math.min(nested.x - 40, window.innerWidth - 340 - 8)),
              top: nested.mode === "slim" ? Math.max(8, nested.y + 12) : 8,
              zIndex: 210,
            }}
            onMouseEnter={() => window.clearTimeout(nestedCloseTimer.current)}
            onMouseLeave={() => {
              nestedCloseTimer.current = window.setTimeout(() => setNested(null), 160);
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <CardRichPopoverContent
              cardId={nested.cardId}
              filters={filters}
              showConstellation
              variant={nested.mode}
              onEscalate={(openEdit) =>
                setNested((n) =>
                  n ? { ...n, mode: "rich", editStart: Boolean(openEdit) } : n,
                )
              }
              initialEditing={nested.mode === "rich" && Boolean(nested.editStart)}
            />
          </div>,
          document.body,
        )}
      {webHover &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: webHover.x + 12,
              top: webHover.y + 12,
              zIndex: 210,
              pointerEvents: "none",
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 13,
              color: "var(--color-foreground)",
              background: "var(--surface-elevated, var(--surface-card))",
              border: "1px solid color-mix(in oklab, var(--accent, var(--gold)) 30%, transparent)",
              borderRadius: 6,
              padding: "3px 8px",
              whiteSpace: "nowrap",
              boxShadow: "0 6px 18px rgba(0,0,0,0.4)",
            }}
          >
            {webHover.name}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Wrap any element to show the CardRichPopover on hover. Portals the
 * popover to <body> and positions it next to the trigger, flipping to the
 * left if it would overflow the right edge.
 */
/**
 * EK75 — PinnedCard: a draggable floating copy of the rich popover. A small
 * grip at top-center moves it (kept clear of the gear top-left and the close
 * top-right so both stay clickable). Self-contained — no page dependency.
 */
function PinnedCard({
  left,
  top,
  onClose,
  children,
}: {
  left: number;
  top: number;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [p, setP] = useState({ left, top });
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { dx: e.clientX - p.left, dy: e.clientY - p.top };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    setP({ left: e.clientX - drag.current.dx, top: e.clientY - drag.current.dy });
  };
  const onPointerUp = (e: React.PointerEvent) => {
    drag.current = null;
    (e.currentTarget as Element).releasePointerCapture?.(e.pointerId);
  };
  return (
    <div
      style={{ position: "fixed", left: p.left, top: p.top, zIndex: 201 }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div style={{ position: "relative" }}>
        <div
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          aria-label="Drag to move"
          style={{
            position: "absolute",
            top: -4,
            left: "50%",
            transform: "translateX(-50%)",
            width: 120,
            height: 22,
            cursor: "grab",
            zIndex: 4,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            touchAction: "none",
          }}
        >
          <GripHorizontal
            size={14}
            style={{ opacity: 0.5, color: "var(--color-foreground-muted, var(--color-foreground))" }}
          />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close pinned card"
          title="Close"
          style={{
            position: "absolute",
            top: -6,
            right: -6,
            zIndex: 5,
            width: 20,
            height: 20,
            borderRadius: 999,
            border: "1px solid var(--border-default)",
            background: "var(--surface-card)",
            color: "var(--color-foreground)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 0,
            boxShadow: "0 1px 2px rgba(0,0,0,0.25)",
          }}
        >
          <X size={12} strokeWidth={2} />
        </button>
        {children}
      </div>
    </div>
  );
}

export function CardHoverTip({
  cardId,
  filters,
  children,
  className,
  showConstellation = true,
  preload,
}: {
  cardId: number;
  filters: InsightsFilters;
  children: React.ReactNode;
  className?: string;
  showConstellation?: boolean;
  preload?: CardRichPreload;
}) {
  const [mode, setMode] = useState<"slim" | "rich" | null>(null);
  const [escalateEdit, setEscalateEdit] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [pinned, setPinned] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLSpanElement | null>(null);
  const cursor = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const openTimer = useRef<number>(0);
  const closeTimer = useRef<number>(0);

  const POP_W = 320;
  const SLIM_W = 240;
  const RICH_W = 340;

  // EK76 — the rich popover sits at the top of the screen but offset so the
  // cursor falls INSIDE its bounds (it's tall and extends down past the
  // mouse). The mouse is therefore auto-hovering it, so the close timer
  // never fires and it doesn't flash-then-disappear on escalate.
  const richPos = () => {
    const left = Math.max(8, Math.min(cursor.current.x - 40, window.innerWidth - RICH_W - 8));
    return { left, top: 8 };
  };

  const show = () => {
    if (isHoverSnoozed()) return;
    window.clearTimeout(closeTimer.current);
    openTimer.current = window.setTimeout(() => {
      if (!ref.current) return;
      // EK74/EK75 — 1-stage opens the rich at the top; 2-stage opens the slim
      // peek at the cursor.
      if (loadHoverStage() === "1") {
        setPos(richPos());
        setMode("rich");
      } else {
        // EK82 — anchor the peek to the CARD (not the cursor) so it holds
        // still and the seeker can travel onto it to read the chip hints.
        const el = ref.current;
        const r = el?.getBoundingClientRect();
        const cardLeft = r?.left ?? cursor.current.x;
        const cardBottom = r?.bottom ?? cursor.current.y;
        const cardTop = r?.top ?? cursor.current.y;
        const left = Math.max(8, Math.min(cardLeft, window.innerWidth - SLIM_W - 8));
        // Prefer below the card; if that would run off the bottom, place above.
        const belowTop = cardBottom + 6;
        const top = belowTop + 120 > window.innerHeight ? Math.max(8, cardTop - 6 - 120) : belowTop;
        setPos({ left, top });
        setMode("slim");
      }
    }, 220);
  };
  const hide = () => {
    window.clearTimeout(openTimer.current);
    closeTimer.current = window.setTimeout(() => setMode(null), 160);
  };
  // EK75 — clicking the slim peek expands to the rich body, which jumps to
  // the top of the screen.
  const escalate = (openEdit?: boolean) => {
    window.clearTimeout(closeTimer.current);
    setEscalateEdit(Boolean(openEdit));
    setPos(richPos());
    setMode("rich");
  };
  // EK75 — pin a draggable floating copy; the hover popover closes.
  const pin = () => {
    window.clearTimeout(closeTimer.current);
    setPinned({ left: 120, top: 80 });
    setMode(null);
  };

  useEffect(() => {
    return () => {
      window.clearTimeout(openTimer.current);
      window.clearTimeout(closeTimer.current);
    };
  }, []);

  return (
    <span
      ref={ref}
      className={className}
      onMouseEnter={show}
      onMouseMove={(e) => {
        cursor.current = { x: e.clientX, y: e.clientY };
      }}
      onMouseLeave={hide}
      style={{ display: "block" }}
    >
      {children}
      {mode &&
        pos &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: pos.left,
              top: pos.top,
              zIndex: 200,
            }}
            onMouseEnter={() => window.clearTimeout(closeTimer.current)}
            onMouseLeave={hide}
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <CardRichPopoverContent
              cardId={cardId}
              filters={filters}
              showConstellation={mode === "rich" && showConstellation}
              preload={preload}
              variant={mode}
              onEscalate={escalate}
              onPin={pin}
              pinnable
              initialEditing={mode === "rich" && escalateEdit}
            />
          </div>,
          document.body,
        )}
      {pinned &&
        typeof document !== "undefined" &&
        createPortal(
          <PinnedCard left={pinned.left} top={pinned.top} onClose={() => setPinned(null)}>
            <CardRichPopoverContent
              cardId={cardId}
              filters={filters}
              showConstellation={showConstellation}
              preload={preload}
              variant="rich"
            />
          </PinnedCard>,
          document.body,
        )}
    </span>
  );
}
