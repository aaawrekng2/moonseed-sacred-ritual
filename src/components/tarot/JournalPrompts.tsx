import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Lightbulb, Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export type JournalPromptsProps = {
  prompts: string[] | null | undefined;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
  value: string;
  onChange: (next: string) => void;
  className?: string;
  /**
   * 26-05-08-Q12 — When provided, called with the active prompt text
   * before insertion. Returning null cancels the insert (e.g. opens an
   * upsell or shows a toast). Returning a string replaces the active
   * prompt with that returned value (used when the placeholder slot
   * resolves to an AI-generated prompt).
   */
  beforeInsert?: (active: string) => Promise<string | null> | string | null;
  /** Show a small loading spinner on the "Tap to use" button. */
  loading?: boolean;
  /**
   * Q14 — When true, the panel starts collapsed under "Show prompts".
   * Used after the seeker has previously inserted a prompt for this
   * reading so the prompt panel doesn't dominate the journal next time.
   */
  defaultHidden?: boolean;
  /** Called once a prompt was successfully inserted into the textarea. */
  onPromptUsed?: () => void;
};

/**
 * Personalized journaling prompts shown above the journal textarea.
 * - Cycles one prompt at a time with left/right arrows
 * - "Use this prompt" inserts the prompt at the cursor (new line if non-empty)
 *   followed by a line break so the user types their answer below
 * - Collapsible via a Hide prompts link
 */
export function JournalPrompts({
  prompts,
  textareaRef,
  value,
  onChange,
  className,
  beforeInsert,
  loading,
  defaultHidden,
  onPromptUsed,
}: JournalPromptsProps) {
  const [index, setIndex] = useState(0);
  const [hidden, setHidden] = useState(!!defaultHidden);
  const [direction, setDirection] = useState<"left" | "right">("right");
  // Q16 Fix 1 — sync internal hidden state when the prop transitions
  // to true. The parent loads `journal_prompt_used` asynchronously
  // from the DB; without this effect the panel stays expanded on
  // reload even when the flag is true. Conservative: only collapse
  // when the prop arrives true; never auto-expand.
  useEffect(() => {
    if (defaultHidden) setHidden(true);
  }, [defaultHidden]);
  // Re-mount key so the animation re-triggers on each change
  const animKeyRef = useRef(0);

  if (!prompts || prompts.length === 0) return null;

  const total = prompts.length;
  const current = prompts[Math.max(0, Math.min(index, total - 1))];
  const TAILORED_PLACEHOLDER_LITERAL = "Get a tailored prompt for this reading";
  const isPlaceholder = current === TAILORED_PLACEHOLDER_LITERAL;

  const go = (delta: number) => {
    setDirection(delta > 0 ? "right" : "left");
    animKeyRef.current += 1;
    setIndex((i) => (i + delta + total) % total);
  };

  const insertPrompt = async () => {
    let promptText = current;
    if (beforeInsert) {
      const resolved = await beforeInsert(promptText);
      if (resolved == null) return;
      promptText = resolved;
    }
    const ta = textareaRef.current;
    const hasText = value.trim().length > 0;
    const prefix = hasText ? "\n\n" : "";
    const toInsert = `${prefix}${promptText}\n`;

    let nextValue: string;
    let cursor: number;
    if (ta) {
      const start = ta.selectionStart ?? value.length;
      const end = ta.selectionEnd ?? value.length;
      // If the textarea is empty or user is at the end, append; otherwise insert at cursor.
      if (!hasText) {
        nextValue = `${promptText}\n`;
        cursor = nextValue.length;
      } else {
        nextValue = value.slice(0, start) + toInsert + value.slice(end);
        cursor = start + toInsert.length;
      }
    } else {
      nextValue = hasText ? `${value}${toInsert}` : `${promptText}\n`;
      cursor = nextValue.length;
    }

    onChange(nextValue);

    // Restore focus + caret after the controlled value updates
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        try {
          el.setSelectionRange(cursor, cursor);
        } catch {
          /* noop */
        }
      }
    });
    // Q15 Fix 4 — auto-collapse the prompt panel after insertion
    // (Q14 Fix 5 added the callback but forgot the local hide).
    setHidden(true);
    onPromptUsed?.();
  };

  if (hidden) {
    return (
      <div className={cn("flex justify-end", className)}>
        <button
          type="button"
          onClick={() => setHidden(false)}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
            opacity: 0.55,
          }}
        >
          show prompts
        </button>
      </div>
    );
  }

  return (
    // Q29 Fix 9 — redesign per moonseed_styling_doc.docx:
    //  - no pill button (Section 2.1 — pills only for EmptyHero CTA)
    //  - no uppercase tracking on the section header (Section 5)
    //  - all values via design tokens (Section 4)
    //  - editorial italic display font for actions and label
    <section
      className={className}
      style={{
        background: "var(--surface-card)",
        border: "0.5px solid var(--border-subtle)",
        borderRadius: "var(--radius-lg, 12px)",
        padding: "var(--space-5, 20px)",
        marginBottom: "var(--space-4, 16px)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {isPlaceholder ? (
            <Sparkles size={14} style={{ color: "var(--accent, var(--gold))", opacity: 0.7 }} />
          ) : (
            <Lightbulb size={14} style={{ color: "var(--accent, var(--gold))", opacity: 0.7 }} />
          )}
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm)",
              color: "var(--color-foreground)",
              opacity: 0.55,
            }}
          >
            {isPlaceholder ? "a tailored prompt" : "a journaling prompt"}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous prompt"
            disabled={total <= 1}
            style={{
              background: "none",
              border: "none",
              color: "var(--color-foreground)",
              opacity: total <= 1 ? 0.2 : 0.5,
              cursor: total <= 1 ? "not-allowed" : "pointer",
              padding: 6,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ChevronLeft size={16} />
          </button>
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-caption)",
              color: "var(--color-foreground)",
              opacity: 0.5,
            }}
          >
            {index + 1} of {total}
          </span>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next prompt"
            disabled={total <= 1}
            style={{
              background: "none",
              border: "none",
              color: "var(--color-foreground)",
              opacity: total <= 1 ? 0.2 : 0.5,
              cursor: total <= 1 ? "not-allowed" : "pointer",
              padding: 6,
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <ChevronRight size={16} />
          </button>
        </div>
      </div>

      <p
        key={animKeyRef.current}
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-body-lg, 1.05rem)",
          lineHeight: 1.5,
          color: "var(--color-foreground)",
          opacity: isPlaceholder ? 0.6 : 0.9,
          margin: 0,
        }}
        className={cn(
          "animate-in fade-in duration-300",
          direction === "right" ? "slide-in-from-right-4" : "slide-in-from-left-4",
        )}
      >
        "{current}"
      </p>

      <div
        style={{
          marginTop: 16,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <button
          type="button"
          onClick={() => void insertPrompt()}
          disabled={!!loading}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: loading ? "wait" : "pointer",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body)",
            color: "var(--accent, var(--gold))",
            opacity: loading ? 0.5 : 0.85,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}
          use this prompt
        </button>
        <button
          type="button"
          onClick={() => setHidden(true)}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground)",
            opacity: 0.4,
          }}
        >
          hide prompts
        </button>
      </div>
    </section>
  );
}

/**
 * Read-only prompt list for the reading detail view's "Reflection Prompts"
 * section. Collapsible-friendly; renders nothing if no prompts exist.
 */
export function JournalPromptsReadOnly({
  prompts,
  className,
}: {
  prompts: string[] | null | undefined;
  className?: string;
}) {
  if (!prompts || prompts.length === 0) return null;
  return (
    <ul className={cn("space-y-2", className)}>
      {prompts.map((p, i) => (
        <li
          key={`${i}-${p.slice(0, 12)}`}
          className="flex gap-3 text-sm leading-relaxed text-muted-foreground"
        >
          <span className="mt-0.5 text-gold">•</span>
          <span className="italic">"{p}"</span>
        </li>
      ))}
    </ul>
  );
}
