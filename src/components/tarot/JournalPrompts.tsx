import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Lightbulb, Eye, EyeOff, Loader2, Sparkles } from "lucide-react";
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
    onPromptUsed?.();
  };

  if (hidden) {
    return (
      <div className={cn("flex justify-end", className)}>
        <button
          type="button"
          onClick={() => setHidden(false)}
          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground hover:text-gold transition-colors"
        >
          <Eye className="h-3 w-3" />
          Show prompts
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-xl border border-gold/30 bg-gold/5 p-4 md:p-5 backdrop-blur-sm",
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-gold">
          {isPlaceholder ? (
            <Sparkles className="h-3.5 w-3.5" />
          ) : (
            <Lightbulb className="h-3.5 w-3.5" />
          )}
          <span>{isPlaceholder ? "Tailored Prompt" : "Journaling Prompt"}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[11px] text-muted-foreground tabular-nums mr-1">
            {index + 1} of {total}
          </span>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous prompt"
            disabled={total <= 1}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background/40 text-muted-foreground transition-colors hover:border-gold/50 hover:text-gold disabled:opacity-40 disabled:pointer-events-none"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next prompt"
            disabled={total <= 1}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background/40 text-muted-foreground transition-colors hover:border-gold/50 hover:text-gold disabled:opacity-40 disabled:pointer-events-none"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="min-h-[56px] overflow-hidden">
        <p
          key={animKeyRef.current}
          className={cn(
            "font-display italic text-base md:text-lg leading-relaxed text-gold animate-in fade-in duration-300",
            isPlaceholder && "opacity-70",
            direction === "right" ? "slide-in-from-right-4" : "slide-in-from-left-4",
          )}
        >
          "{current}"
        </p>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => void insertPrompt()}
          disabled={!!loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-3 py-1.5 text-xs uppercase tracking-widest text-gold transition-colors hover:bg-gold/20 min-h-9 disabled:opacity-60 disabled:pointer-events-none"
        >
          {loading && <Loader2 className="h-3 w-3 animate-spin" />}
          Tap to use this prompt
        </button>
        <button
          type="button"
          onClick={() => setHidden(true)}
          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted-foreground hover:text-gold transition-colors"
        >
          <EyeOff className="h-3 w-3" />
          Hide prompts
        </button>
      </div>
    </div>
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
