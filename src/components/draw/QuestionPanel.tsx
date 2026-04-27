import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

/**
 * Floating question panel that sits above the draw table.
 *
 * Two states:
 * - Expanded: an opaque card centered near the top of the screen with a
 *   textarea where the seeker writes (or revises) the question they're
 *   bringing to the cards.
 * - Collapsed: a tiny pulsing quill icon in the same anchor position so
 *   the seeker can always re-open the panel without leaving the table.
 *
 * The component owns its draft buffer (`localValue`) so typing never
 * thrashes the parent's question state — we only push the trimmed
 * value upward when the seeker confirms ("Continue") or dismisses
 * the panel ("Skip" / close button).
 */
export function QuestionPanel({
  open,
  question,
  onQuestionChange,
  onClose,
  onOpen,
}: {
  open: boolean;
  question: string;
  onQuestionChange: (q: string) => void;
  onClose: () => void;
  onOpen: () => void;
}) {
  const [localValue, setLocalValue] = useState(question);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Tracks whether the panel was previously open so the collapsed
  // quill icon can animate scale-from-zero (open→close transition)
  // instead of just popping in.
  const [closing, setClosing] = useState(false);
  const prevOpenRef = useRef(open);

  useEffect(() => {
    if (prevOpenRef.current && !open) {
      // Just transitioned from open to closed — play the
      // scale-to-zero-and-back animation on the quill mount.
      setClosing(true);
      const t = window.setTimeout(() => setClosing(false), 360);
      return () => window.clearTimeout(t);
    }
    prevOpenRef.current = open;
  }, [open]);

  // Keep the local draft in sync if the parent question changes while
  // the panel is closed (e.g. arriving from the home screen with a
  // pre-existing question in the URL).
  useEffect(() => {
    setLocalValue(question);
  }, [question]);

  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
      const len = textareaRef.current.value.length;
      try {
        textareaRef.current.setSelectionRange(len, len);
      } catch {
        // ignore — some browsers reject setSelectionRange on textareas
      }
    }
  }, [open]);

  const commit = () => {
    onQuestionChange(localValue.trim());
    onClose();
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={onOpen}
        className="absolute left-1/2 -translate-x-1/2 z-50 flex items-center justify-center"
        style={{
          // Sits 2px below the top safe-area inset.
          top: "calc(env(safe-area-inset-top, 0px) + 2px)",
          background: "transparent",
          border: "none",
          padding: 4,
          cursor: "pointer",
        }}
        aria-label="Open question"
      >
        <span
          className="animate-pulse"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            // Reduced 10% from the previous 22px.
            fontSize: 19.8,
            color: "var(--gold)",
            opacity: 0.7,
            lineHeight: 1,
            display: "inline-block",
            transformOrigin: "center",
            animation: closing
              ? "quill-scale-in 320ms cubic-bezier(0.34, 1.56, 0.64, 1) both"
              : undefined,
          }}
        >
          🪶
        </span>
      </button>
    );
  }

  return (
    <div
      className="absolute inset-x-0 z-50 flex flex-col items-center"
      style={{
        top: "calc(env(safe-area-inset-top, 0px) + 48px)",
        padding: "0 20px",
      }}
    >
      <div
        className="w-full max-w-md rounded-2xl px-5 py-4 flex flex-col gap-3"
        style={{
          background: "linear-gradient(180deg, rgba(14,10,40,0.97) 0%, rgba(10,7,30,0.97) 100%)",
          border: "1px solid color-mix(in oklab, var(--gold) 25%, transparent)",
          boxShadow:
            "0 8px 32px -8px rgba(0,0,0,0.6), 0 0 0 1px color-mix(in oklab, var(--gold) 10%, transparent)",
        }}
      >
        <div className="flex items-center justify-between">
          <span
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 11,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "var(--gold)",
              opacity: 0.7,
            }}
          >
            Your question for the cards
          </span>
          <button
            type="button"
            onClick={commit}
            className="flex items-center justify-center rounded-full w-6 h-6 hover:bg-white/10 transition-colors focus:outline-none"
            aria-label="Close question"
            style={{ color: "var(--gold)", opacity: 0.6 }}
          >
            <X size={14} strokeWidth={1.5} />
          </button>
        </div>

        <div className="relative">
          <textarea
            ref={textareaRef}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            rows={3}
            className="w-full resize-none bg-transparent focus:outline-none text-center"
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 16,
              lineHeight: 1.7,
              color: "var(--foreground)",
              border: "none",
              padding: "4px 0",
              minHeight: 72,
            }}
          />
          {!localValue && (
            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: 16,
                lineHeight: 1.7,
                color: "var(--foreground)",
                opacity: 0.3,
                textAlign: "center",
                padding: "4px 16px",
              }}
            >
              What question are you bringing to the cards?
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={commit}
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 12,
              color: "var(--foreground)",
              opacity: 0.4,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
            }}
          >
            Skip
          </button>
          <button
            type="button"
            onClick={commit}
            className="text-[11px] uppercase tracking-[0.2em] transition-colors hover:opacity-100"
            style={{
              fontFamily: "var(--font-serif)",
              background: "none",
              border: "none",
              padding: 0,
              color: "var(--gold)",
              cursor: "pointer",
              opacity: 0.85,
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
