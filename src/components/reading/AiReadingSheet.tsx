/**
 * v3.50 — "Get AI Reading" sheet.
 *
 * Opens from the reading action row (next to Save to journal). Lets the
 * seeker choose what to include, then copies a self-contained prompt to the
 * clipboard for pasting into their own AI program. The prompt is free to the
 * seeker (runs on their AI), so we can include the full canonical meanings.
 *
 * Selection is remembered device-locally (localStorage). Astrology +
 * numerology toggles disable gracefully when the seeker hasn't entered the
 * birth details they need (Moon/Rising require a birth time).
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { getSunSign } from "@/lib/sun-sign";
import { calculateMoonSignWithConfidence } from "@/lib/moon-sign";
import { calculateRisingSignWithConfidence } from "@/lib/rising-sign";
import { track, ACTIVITY } from "@/lib/track";
import {
  buildAiReadingPrompt,
  DEFAULT_TOGGLES,
  type PromptToggles,
  type PromptContext,
  type RecentReadingInput,
  type BigThree,
} from "@/lib/ai-prompt-builder";
import type { PatternResult } from "@/lib/pattern-detect";

const TOGGLES_KEY = "tarotseed:ai_prompt_toggles";

type Pick = { cardId: number; reversed: boolean };

type Props = {
  open: boolean;
  onClose: () => void;
  userId: string | null;
  spreadLabel: string;
  positionLabels: string[];
  picks: Pick[];
  resolveCardName: (id: number) => string;
  question: string;
  note: string;
  // v3.51 — validated pattern results from the page (already computed for
  // the pattern strip). Optional; when empty the toggle is not shown.
  patterns?: PatternResult[];
};

type Birth = {
  birthDate: string | null;
  birthTime: string | null;
  birthCity: string | null;
  latitude: number | null;
  longitude: number | null;
};

function loadToggles(): PromptToggles {
  if (typeof window === "undefined") return { ...DEFAULT_TOGGLES };
  try {
    const raw = window.localStorage.getItem(TOGGLES_KEY);
    if (!raw) return { ...DEFAULT_TOGGLES };
    const parsed = JSON.parse(raw) as Partial<PromptToggles>;
    return { ...DEFAULT_TOGGLES, ...parsed };
  } catch {
    return { ...DEFAULT_TOGGLES };
  }
}

function saveToggles(t: PromptToggles) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOGGLES_KEY, JSON.stringify(t));
  } catch {
    /* ignore quota / privacy-mode failures */
  }
}

export function AiReadingSheet({
  open,
  onClose,
  userId,
  spreadLabel,
  positionLabels,
  picks,
  resolveCardName,
  question,
  note,
  patterns,
}: Props) {
  const [toggles, setToggles] = useState<PromptToggles>(() => loadToggles());
  const [birth, setBirth] = useState<Birth | null>(null);
  const [bigThree, setBigThree] = useState<BigThree | null>(null);
  const [recent, setRecent] = useState<RecentReadingInput[]>([]);
  const [copied, setCopied] = useState(false);
  const loadedFor = useRef<string | null>(null);

  // Persist selection whenever it changes.
  useEffect(() => {
    saveToggles(toggles);
  }, [toggles]);

  // Load birth data + recent readings once per open (keyed by user).
  useEffect(() => {
    if (!open || !userId) return;
    if (loadedFor.current === userId) return;
    loadedFor.current = userId;
    let cancelled = false;

    void (async () => {
      try {
        const { data } = await supabase
          .from("user_preferences")
          .select(
            "birth_date, birth_time, birth_place, birth_latitude, birth_longitude",
          )
          .eq("user_id", userId)
          .maybeSingle();
        const row = (data ?? null) as {
          birth_date?: string | null;
          birth_time?: string | null;
          birth_place?: string | null;
          birth_latitude?: number | null;
          birth_longitude?: number | null;
        } | null;
        const b: Birth = {
          birthDate: row?.birth_date ?? null,
          birthTime: row?.birth_time ?? null,
          birthCity: row?.birth_place
            ? row.birth_place.split(",")[0].trim()
            : null,
          latitude:
            typeof row?.birth_latitude === "number" ? row.birth_latitude : null,
          longitude:
            typeof row?.birth_longitude === "number"
              ? row.birth_longitude
              : null,
        };
        if (cancelled) return;
        setBirth(b);

        const sun = b.birthDate ? getSunSign(b.birthDate) : null;
        const moon = calculateMoonSignWithConfidence(
          b.birthDate,
          b.birthTime,
          b.latitude,
          b.longitude,
        );
        const rising = calculateRisingSignWithConfidence(
          b.birthDate,
          b.birthTime,
          b.latitude,
          b.longitude,
        );
        setBigThree({
          sun,
          moon: moon?.sign ?? null,
          moonConfident: moon?.confident,
          rising: rising?.sign ?? null,
          risingConfident: rising?.confident,
        });
      } catch {
        /* non-fatal: astrology/numerology toggles simply stay unavailable */
      }

      try {
        const { data } = await supabase
          .from("readings")
          .select("created_at, spread_type, card_ids, question")
          .eq("user_id", userId)
          .is("archived_at", null)
          .order("created_at", { ascending: false })
          .limit(5);
        const rows = (data ?? []) as Array<{
          created_at: string;
          spread_type: string | null;
          card_ids: number[] | null;
          question: string | null;
        }>;
        if (cancelled) return;
        setRecent(
          rows.map((r) => ({
            date: new Date(r.created_at).toLocaleDateString(),
            spread: r.spread_type ?? "Spread",
            cards: (r.card_ids ?? []).map((id) => resolveCardName(id)).join(", "),
            question: r.question,
          })),
        );
      } catch {
        /* non-fatal */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, userId, resolveCardName]);

  // Reset the "Copied" flash whenever the sheet reopens.
  useEffect(() => {
    if (open) setCopied(false);
  }, [open]);

  const hasBirthDate = !!birth?.birthDate;
  const hasBirthTime = !!birth?.birthTime;
  const moonAvailable = !!bigThree?.moon;
  const risingAvailable = !!bigThree?.rising;

  // v3.51 — condense the strongest few detected patterns into prompt text.
  // Each PatternResult carries a ready-made human sentence (.explanation)
  // honoring the app's locked thresholds + vocabulary.
  const patternsSummary = useMemo(() => {
    const lines = (patterns ?? [])
      .filter((p) => p.explanation && p.explanation.trim())
      .slice(0, 5)
      .map((p) => `- ${p.explanation.trim()}`);
    return lines.length ? lines.join("\n") : null;
  }, [patterns]);

  const context: PromptContext = useMemo(
    () => ({
      spreadLabel,
      cards: picks.map((p, i) => ({
        cardId: p.cardId,
        reversed: p.reversed,
        position: positionLabels[i] ?? `Card ${i + 1}`,
        name: resolveCardName(p.cardId),
      })),
      question: question || null,
      note: note || null,
      bigThree,
      birthDate: birth?.birthDate ?? null,
      birthCity: birth?.birthCity ?? null,
      recentReadings: recent,
      patternsSummary,
    }),
    [
      spreadLabel,
      picks,
      positionLabels,
      resolveCardName,
      question,
      note,
      bigThree,
      birth,
      recent,
      patternsSummary,
    ],
  );

  const set = (patch: Partial<PromptToggles>) =>
    setToggles((t) => ({ ...t, ...patch }));

  const handleGenerate = async () => {
    const text = buildAiReadingPrompt(context, toggles);
    track(ACTIVITY.AI_PROMPT_COPIED, { spread: spreadLabel });
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2600);
    } catch {
      // Fallback for browsers that block the async clipboard API.
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2600);
      } catch {
        /* give up silently */
      }
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Get AI reading"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        background: "color-mix(in oklab, black 55%, transparent)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 480,
          maxHeight: "88vh",
          overflowY: "auto",
          background: "var(--surface-card)",
          borderTopLeftRadius: 18,
          borderTopRightRadius: 18,
          border: "1px solid var(--border-subtle)",
          borderBottom: "none",
          padding: "18px 18px calc(18px + env(safe-area-inset-bottom, 0px))",
          boxShadow: "0 -12px 40px color-mix(in oklab, black 35%, transparent)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 4,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontFamily: "var(--font-display, var(--font-serif))",
              fontSize: "var(--heading-sm, 1.1rem)",
              color: "var(--color-foreground)",
            }}
          >
            Get an AI reading
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              fontSize: 22,
              lineHeight: 1,
              color: "var(--color-foreground)",
              cursor: "pointer",
              opacity: 0.7,
            }}
          >
            ×
          </button>
        </div>
        <p
          style={{
            margin: "0 0 12px",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm, 0.85rem)",
            color: "var(--color-foreground-muted, var(--color-foreground))",
          }}
        >
          Choose what to include, then copy the prompt into your AI program.
        </p>

        <Group label="The reading">
          <StaticRow text={`Cards, positions & orientations · ${spreadLabel}`} />
          <StaticRow text="Your question" />
        </Group>

        <Group label="Astrology">
          <Row
            label="Sun sign"
            checked={toggles.sun}
            disabled={!bigThree?.sun}
            hint={!bigThree?.sun ? "Add your birth date in Settings" : undefined}
            onChange={(v) => set({ sun: v })}
          />
          <Row
            label="Moon sign"
            checked={toggles.moon}
            disabled={!moonAvailable}
            hint={
              !moonAvailable
                ? hasBirthTime
                  ? "Unavailable for your birth details"
                  : "Add your birth time in Settings"
                : bigThree?.moonConfident === false
                  ? "Approximate (no birth place)"
                  : undefined
            }
            onChange={(v) => set({ moon: v })}
          />
          <Row
            label="Rising sign"
            checked={toggles.rising}
            disabled={!risingAvailable}
            hint={
              !risingAvailable
                ? hasBirthTime
                  ? "Add your birth place in Settings"
                  : "Add your birth time in Settings"
                : undefined
            }
            onChange={(v) => set({ rising: v })}
          />
          <Row
            label="Cards for my signs"
            checked={toggles.correspondences}
            disabled={!bigThree?.sun && !moonAvailable && !risingAvailable}
            onChange={(v) => set({ correspondences: v })}
          />
          <Row
            label="Element / suit lean"
            checked={toggles.elementLean}
            onChange={(v) => set({ elementLean: v })}
          />
        </Group>

        <Group label="Numerology">
          <Row
            label="Life Path (+ card)"
            checked={toggles.lifePath}
            disabled={!hasBirthDate}
            hint={!hasBirthDate ? "Add your birth date in Settings" : undefined}
            onChange={(v) => set({ lifePath: v })}
          />
          <Row
            label="Personal Year (+ card)"
            checked={toggles.personalYear}
            disabled={!hasBirthDate}
            hint={!hasBirthDate ? "Add your birth date in Settings" : undefined}
            onChange={(v) => set({ personalYear: v })}
          />
        </Group>

        <Group label="Context">
          <Row
            label="My notes"
            checked={toggles.notes}
            disabled={!note.trim()}
            hint={!note.trim() ? "No notes on this spread yet" : undefined}
            onChange={(v) => set({ notes: v })}
          />
          <Row
            label="Birth details (city only)"
            checked={toggles.birthData}
            disabled={!hasBirthDate}
            hint={!hasBirthDate ? "Add your birth date in Settings" : undefined}
            onChange={(v) => set({ birthData: v })}
          />
          <Row
            label="My recent readings"
            checked={toggles.recentReadings}
            disabled={recent.length === 0}
            hint={recent.length === 0 ? "No saved readings yet" : undefined}
            onChange={(v) => set({ recentReadings: v })}
          />
          {patternsSummary && (
            <Row
              label="Detected patterns"
              checked={toggles.patterns}
              onChange={(v) => set({ patterns: v })}
            />
          )}
        </Group>

        <Group label="Delivery">
          <PillChoice
            label="Tone"
            value={toggles.tone}
            options={[
              ["gentle", "Gentle"],
              ["direct", "Direct"],
            ]}
            onChange={(v) => set({ tone: v as PromptToggles["tone"] })}
          />
          <PillChoice
            label="Length"
            value={toggles.length}
            options={[
              ["short", "Short"],
              ["medium", "Medium"],
              ["long", "Long"],
            ]}
            onChange={(v) => set({ length: v as PromptToggles["length"] })}
          />
          <Row
            label="Journaling prompts"
            checked={toggles.journalingPrompts}
            onChange={(v) => set({ journalingPrompts: v })}
          />
        </Group>

        <button
          type="button"
          onClick={() => void handleGenerate()}
          style={{
            marginTop: 16,
            width: "100%",
            height: 46,
            borderRadius: 12,
            border: "1px solid color-mix(in oklab, var(--accent, var(--gold)) 60%, transparent)",
            background: copied
              ? "color-mix(in oklab, var(--accent, var(--gold)) 30%, transparent)"
              : "color-mix(in oklab, var(--accent, var(--gold)) 16%, transparent)",
            color: "var(--color-foreground)",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "1rem",
            cursor: "pointer",
          }}
        >
          {copied ? "Copied to clipboard ✓" : "Generate & copy prompt"}
        </button>
        <p
          style={{
            margin: "8px 0 0",
            textAlign: "center",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption, 0.75rem)",
            color: "var(--color-foreground-muted, var(--color-foreground))",
            opacity: 0.75,
          }}
        >
          Paste it into ChatGPT, Claude, or any AI to receive your reading.
        </p>
      </div>
    </div>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div style={{ marginTop: 14 }}>
      <div
        style={{
          fontFamily: "var(--font-accent, var(--font-serif))",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontSize: "var(--text-caption, 0.72rem)",
          color: "var(--accent, var(--gold))",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {children}
      </div>
    </div>
  );
}

function StaticRow({ text }: { text: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 4px",
        opacity: 0.8,
      }}
    >
      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          borderRadius: 5,
          background: "color-mix(in oklab, var(--accent, var(--gold)) 45%, transparent)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          color: "var(--color-foreground)",
        }}
      >
        ✓
      </span>
      <span
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "var(--text-body-sm, 0.9rem)",
          color: "var(--color-foreground)",
        }}
      >
        {text}
        <span
          style={{
            marginLeft: 6,
            fontStyle: "italic",
            opacity: 0.6,
            fontSize: "0.8em",
          }}
        >
          always included
        </span>
      </span>
    </div>
  );
}

function Row({
  label,
  checked,
  disabled,
  hint,
  onChange,
}: {
  label: string;
  checked: boolean;
  disabled?: boolean;
  hint?: string;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 4px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <input
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 18, height: 18, accentColor: "var(--accent, var(--gold))" }}
      />
      <span style={{ display: "flex", flexDirection: "column" }}>
        <span
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-body-sm, 0.9rem)",
            color: "var(--color-foreground)",
          }}
        >
          {label}
        </span>
        {hint && (
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption, 0.72rem)",
              color: "var(--color-foreground-muted, var(--color-foreground))",
              opacity: 0.8,
            }}
          >
            {hint}
          </span>
        )}
      </span>
    </label>
  );
}

function PillChoice({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<[string, string]>;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "8px 4px",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: "var(--text-body-sm, 0.9rem)",
          color: "var(--color-foreground)",
        }}
      >
        {label}
      </span>
      <div
        role="tablist"
        style={{
          display: "inline-flex",
          height: 26,
          borderRadius: 9999,
          border: "1px solid var(--border-subtle)",
          background: "var(--surface-card)",
          overflow: "hidden",
        }}
      >
        {options.map(([v, l]) => {
          const active = v === value;
          return (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(v)}
              style={{
                padding: "0 12px",
                height: "100%",
                border: "none",
                background: active
                  ? "color-mix(in oklab, var(--accent, var(--gold)) 55%, transparent)"
                  : "transparent",
                color: "var(--color-foreground)",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {l}
            </button>
          );
        })}
      </div>
    </div>
  );
}
