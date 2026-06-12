/**
 * EK48 — Shared JournalBlock component.
 *
 * One inline component used in three surfaces:
 *   1. Manual Entry (QuickLog journal panel)
 *   2. Post-flip reading reveal (SpreadLayout interpretation flow)
 *   3. Past journal entry view (ReadingDetailModal)
 *
 * Design (per EK47 → EK48 design discussion):
 *
 * - The PROMPT and the NOTE are visually distinct. The prompt looks
 *   like a printed page header (italic serif, small caption "The
 *   cards ask", asterism leader). The seeker's note sits below in
 *   upright serif on a slightly warmer surface.
 *
 * - There are typically 3-5 prompts available (resolved per card via
 *   `resolvePromptsForFirstCard`). The seeker pages through them
 *   with side chevrons `‹ ›` and asterism dots `✷ ✷ ✷ ✷` below.
 *
 * - A "Use this prompt →" text link copies the currently-shown
 *   prompt INTO the note area as an italic blockquote at the top,
 *   then collapses the picker into a compact "Responding to · N of
 *   M ‹ ›" reminder line. The seeker types their response below the
 *   inserted prompt.
 *
 * - The blockquote prompt and the seeker's response are stored as
 *   two separate strings in the component's state and surfaced to
 *   the parent via `onNoteChange(note, usedPrompt)`. The parent
 *   decides how to persist (combined into a single text field, or
 *   as two columns).
 *
 * Vocabulary:
 *   - "Spread" = the cards pulled (not used here directly)
 *   - "Reading" = the AI interpretation (not used here directly)
 *   - We avoid "pull" as a noun (styling doc terminology lock)
 */
import { useEffect, useId, useMemo, useState } from "react";

export type JournalBlockProps = {
  /** The full set of prompts for this surface (typically 3-5).
   *  Resolved by the parent via `resolvePromptsForFirstCard()` or
   *  similar. Empty array → no picker, just an open note area. */
  prompts: string[];
  /** The seeker's response text (excludes the used prompt). */
  note: string;
  /** The prompt the seeker chose to "Use" — quoted at the top of
   *  the note area, persisted alongside the note. Pass `null` if
   *  no prompt was used yet (picker is still shown). */
  usedPrompt: string | null;
  /** Called when the seeker edits the note OR taps "Use this
   *  prompt". Receives both the response text AND the used prompt
   *  (or null if cleared). */
  onChange: (note: string, usedPrompt: string | null) => void;
  /** Voice mode for the labels. "plain" = "The cards ask", "Leave
   *  a note for yourself…"; "oracle" = sacred phrasing. Defaults
   *  to "plain". */
  voiceMode?: "plain" | "oracle";
  /** Read-only mode for past entries. Shows the saved prompt
   *  blockquote + response without an editable textarea. Tap
   *  anywhere to enter edit mode (caller controls the flag). */
  readOnly?: boolean;
  /** If readOnly, called when the seeker taps to enter edit mode.
   *  The parent should set `readOnly=false` and re-render. */
  onRequestEdit?: () => void;
  /** Optional explicit empty-state placeholder override. */
  placeholder?: string;
};

export function JournalBlock({
  prompts,
  note,
  usedPrompt,
  onChange,
  voiceMode = "plain",
  readOnly = false,
  onRequestEdit,
  placeholder,
}: JournalBlockProps) {
  const inputId = useId();

  // Which prompt is currently shown in the picker. Initialize to
  // the prompt whose text matches `usedPrompt` if any (so reopening
  // a saved note lands on the same prompt index for the "Responding
  // to · N of M" counter); otherwise 0.
  const initialIndex = useMemo(() => {
    if (!usedPrompt) return 0;
    const i = prompts.indexOf(usedPrompt);
    return i >= 0 ? i : 0;
  }, [prompts, usedPrompt]);

  const [pickerIndex, setPickerIndex] = useState<number>(initialIndex);

  // Re-sync the picker when prompts/usedPrompt change externally
  // (e.g., a different card is selected upstream and the parent
  // hands us a new prompts array).
  useEffect(() => {
    setPickerIndex(initialIndex);
  }, [initialIndex]);

  // Labels per voice mode. Editorial copy lives here so other
  // surfaces aren't tempted to roll their own variants.
  const labels = voiceMode === "oracle"
    ? {
        caption: "The cards ask",
        usePromptLink: "Begin your note with this prompt →",
        respondingToPrefix: "Speaking to",
        emptyPlaceholder: placeholder ?? "Mark the page…",
      }
    : {
        caption: "The cards ask",
        usePromptLink: "Start your note with this prompt →",
        respondingToPrefix: "Responding to",
        emptyPlaceholder: placeholder ?? "Leave a note for yourself…",
      };

  const hasPicker = prompts.length > 0 && !usedPrompt && !readOnly;
  const hasMultiple = prompts.length > 1;

  /* ─── Picker handlers ───────────────────────────────── */
  const goPrev = () =>
    setPickerIndex((i) => (i - 1 + prompts.length) % prompts.length);
  const goNext = () =>
    setPickerIndex((i) => (i + 1) % prompts.length);

  const usePrompt = () => {
    const chosen = prompts[pickerIndex];
    if (!chosen) return;
    onChange(note, chosen);
  };

  const clearPrompt = () => onChange(note, null);
  const switchPrompt = (next: number) => {
    setPickerIndex(next);
    // If a prompt is already in use, hot-swap it for the new pick
    // so the blockquote at the top of the note updates live.
    if (usedPrompt) onChange(note, prompts[next] ?? null);
  };

  /* ─── Render ────────────────────────────────────────── */
  // The whole block sits on a faint elevated surface. No outer
  // border — the divider between prompt and note does the work.
  return (
    <div
      style={{
        background: "var(--surface-card)",
        borderRadius: 12,
        padding: "22px 20px",
        fontFamily: "var(--font-serif)",
      }}
    >
      {/* ─── Prompt header ───────────────────────────── */}
      {hasPicker && (
        <PromptPicker
          prompt={prompts[pickerIndex] ?? ""}
          caption={labels.caption}
          index={pickerIndex}
          total={prompts.length}
          hasMultiple={hasMultiple}
          onPrev={goPrev}
          onNext={goNext}
          useLinkLabel={labels.usePromptLink}
          onUse={usePrompt}
        />
      )}

      {/* When a prompt has been used, the picker collapses into a
          compact "Responding to · N of M ‹ ›" reminder. Tapping the
          chevrons hot-swaps which prompt is in the blockquote. */}
      {!hasPicker && usedPrompt && (
        <RespondingHeader
          prefix={labels.respondingToPrefix}
          index={pickerIndex}
          total={prompts.length}
          hasMultiple={hasMultiple}
          onPrev={() => {
            const next = (pickerIndex - 1 + prompts.length) % prompts.length;
            switchPrompt(next);
          }}
          onNext={() => {
            const next = (pickerIndex + 1) % prompts.length;
            switchPrompt(next);
          }}
          onClear={clearPrompt}
        />
      )}

      {/* ─── Note area ───────────────────────────────── */}
      <div
        style={{
          background: "var(--surface-elevated, transparent)",
          borderTop: "0.5px solid rgba(212, 175, 55, 0.18)",
          padding: "18px 4px 6px",
          marginTop: 4,
        }}
      >
        {usedPrompt && (
          <blockquote
            style={{
              margin: "0 0 10px",
              padding: "0 0 0 10px",
              borderLeft: "2px solid rgba(212, 175, 55, 0.4)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm, 13px)",
              color: "var(--color-foreground-muted, #b89968)",
              opacity: 0.85,
              lineHeight: 1.55,
            }}
          >
            {usedPrompt}
          </blockquote>
        )}

        {readOnly ? (
          <ReadOnlyNote
            note={note}
            placeholder={labels.emptyPlaceholder}
            onRequestEdit={onRequestEdit}
          />
        ) : (
          <textarea
            id={inputId}
            value={note}
            onChange={(e) => onChange(e.target.value, usedPrompt)}
            placeholder={labels.emptyPlaceholder}
            rows={Math.max(3, Math.min(10, note.split(/\r?\n/).length + 1))}
            style={{
              width: "100%",
              background: "transparent",
              border: "none",
              outline: "none",
              resize: "vertical",
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-body, 14px)",
              color: "var(--color-foreground)",
              lineHeight: 1.65,
              padding: 0,
              fontStyle: note ? "normal" : "italic",
            }}
          />
        )}
      </div>
    </div>
  );
}

/* ─── Sub-components ──────────────────────────────────── */

function PromptPicker({
  prompt,
  caption,
  index,
  total,
  hasMultiple,
  onPrev,
  onNext,
  useLinkLabel,
  onUse,
}: {
  prompt: string;
  caption: string;
  index: number;
  total: number;
  hasMultiple: boolean;
  onPrev: () => void;
  onNext: () => void;
  useLinkLabel: string;
  onUse: () => void;
}) {
  return (
    <>
      {/* Row 1: asterism, prompt block, chevrons */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          marginBottom: 6,
        }}
      >
        <div
          style={{
            color: "var(--accent, var(--gold))",
            fontSize: 16,
            lineHeight: 1.2,
            marginTop: 2,
            flex: "0 0 auto",
          }}
        >
          ✷
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--color-foreground-muted, #b89968)",
              opacity: 0.7,
              marginBottom: 4,
            }}
          >
            {caption}
          </div>
          <div
            style={{
              fontStyle: "italic",
              fontSize: "var(--text-body, 16px)",
              lineHeight: 1.45,
              color: "var(--color-foreground)",
              opacity: 0.92,
            }}
          >
            {prompt}
          </div>
        </div>
        {hasMultiple && (
          <ChevronButton dir="next" onClick={onNext} aria-label="Next prompt" />
        )}
      </div>

      {/* Row 2: dots + "Use this prompt →" link */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 4px",
          margin: "8px 0 14px",
        }}
      >
        {hasMultiple ? (
          <div
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
            }}
            role="tablist"
            aria-label="Prompt selection"
          >
            <ChevronButton dir="prev" onClick={onPrev} aria-label="Previous prompt" inline />
            {Array.from({ length: total }, (_, i) => (
              <span
                key={i}
                style={{
                  color: i === index
                    ? "var(--accent, var(--gold))"
                    : "var(--color-foreground-muted, #b89968)",
                  fontSize: i === index ? 9 : 7,
                  opacity: i === index ? 1 : 0.35,
                  transition: "opacity 0.2s ease, font-size 0.2s ease",
                }}
                aria-current={i === index ? "true" : undefined}
              >
                ✷
              </span>
            ))}
          </div>
        ) : (
          <div />
        )}
        <button
          type="button"
          onClick={onUse}
          style={{
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 12,
            color: "var(--accent, var(--gold))",
            opacity: 0.9,
          }}
        >
          {useLinkLabel}
        </button>
      </div>
    </>
  );
}

function RespondingHeader({
  prefix,
  index,
  total,
  hasMultiple,
  onPrev,
  onNext,
  onClear,
}: {
  prefix: string;
  index: number;
  total: number;
  hasMultiple: boolean;
  onPrev: () => void;
  onNext: () => void;
  onClear: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 14,
        opacity: 0.7,
      }}
    >
      <div style={{ color: "var(--accent, var(--gold))", fontSize: 12 }}>✷</div>
      <div
        style={{
          fontFamily: "var(--font-serif)",
          fontSize: 11,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--color-foreground-muted, #b89968)",
        }}
      >
        {prefix}
        {hasMultiple && (
          <>
            {" "}· {index + 1} of {total}{" "}
            <ChevronButton dir="prev" onClick={onPrev} inline aria-label="Previous prompt" />
            <ChevronButton dir="next" onClick={onNext} inline aria-label="Next prompt" />
          </>
        )}
      </div>
      <button
        type="button"
        onClick={onClear}
        aria-label="Remove prompt"
        title="Remove prompt"
        style={{
          marginLeft: "auto",
          background: "transparent",
          border: "none",
          padding: 0,
          cursor: "pointer",
          color: "var(--color-foreground-muted)",
          fontSize: 14,
          opacity: 0.6,
        }}
      >
        ×
      </button>
    </div>
  );
}

function ChevronButton({
  dir,
  onClick,
  inline = false,
  ...rest
}: {
  dir: "prev" | "next";
  onClick: () => void;
  inline?: boolean;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...rest}
      style={{
        background: "transparent",
        border: "none",
        padding: inline ? 0 : 4,
        cursor: "pointer",
        color: "var(--accent, var(--gold))",
        fontSize: inline ? 12 : 16,
        lineHeight: 1.2,
        marginTop: inline ? 0 : 2,
        opacity: 0.85,
      }}
    >
      {dir === "prev" ? "‹" : "›"}
    </button>
  );
}

function ReadOnlyNote({
  note,
  placeholder,
  onRequestEdit,
}: {
  note: string;
  placeholder: string;
  onRequestEdit?: () => void;
}) {
  if (!note.trim()) {
    return (
      <div
        onClick={onRequestEdit}
        style={{
          fontStyle: "italic",
          fontSize: "var(--text-body, 14px)",
          color: "var(--color-foreground-muted, #b8b0a0)",
          opacity: 0.5,
          lineHeight: 1.55,
          cursor: onRequestEdit ? "pointer" : "default",
        }}
      >
        {placeholder}
      </div>
    );
  }
  return (
    <div
      onClick={onRequestEdit}
      style={{
        fontSize: "var(--text-body, 14px)",
        color: "var(--color-foreground)",
        lineHeight: 1.65,
        whiteSpace: "pre-wrap",
        cursor: onRequestEdit ? "pointer" : "default",
      }}
    >
      {note}
    </div>
  );
}
