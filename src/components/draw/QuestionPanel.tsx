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
  onDontAskAgain,
}: {
  open: boolean;
  question: string;
  onQuestionChange: (q: string) => void;
  onClose: () => void;
  onOpen: () => void;
  onDontAskAgain?: () => void;
}) {
  const [localValue, setLocalValue] = useState(question);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Three-phase render: when `open` flips from true → false we keep the
  // panel mounted briefly so it can animate scale-to-zero toward the
  // quill anchor (top center). Once the animation finishes we unmount
  // the panel and let the quill icon take over with its own scale-in.
  const [closing, setClosing] = useState(false);
  const [showQuillScale, setShowQuillScale] = useState(false);
  const prevOpenRef = useRef(open);

  useEffect(() => {
    if (prevOpenRef.current && !open) {
      setClosing(true);
      const t = window.setTimeout(() => {
        setClosing(false);
        setShowQuillScale(true);
        const t2 = window.setTimeout(() => setShowQuillScale(false), 360);
        return () => window.clearTimeout(t2);
      }, 320);
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

  // Q39b Fix 3 — collapsed-state trigger removed; the Tabletop header
  // strip now owns the open affordance. Render nothing when closed.
  if (!open && !closing) return null;
  // `onOpen` is preserved on the public API for parity with callers.
  void onOpen;

  return (
    <div
      className="absolute inset-x-0 z-50 flex flex-col items-center"
      style={{
        top: "calc(env(safe-area-inset-top, 0px) + 48px)",
        padding: "0 20px",
        transformOrigin: "50% -40px",
        animation: closing
          ? "qpanel-collapse 320ms cubic-bezier(0.4, 0, 0.6, 1) forwards"
          : "qpanel-open 240ms cubic-bezier(0.34, 1.56, 0.64, 1) both",
        pointerEvents: closing ? "none" : undefined,
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
              fontSize: "var(--text-caption)",
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
            className="flex items-center justify-center rounded-full w-6 h-6 hover:bg-foreground/10 transition-colors focus:outline-none"
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
              fontSize: "var(--text-body)",
              lineHeight: 1.7,
              color: "var(--foreground)",
              border: "none",
              padding: "4px 0",
              minHeight: 72,
            }}
          />
          {/* DY-2 — subhead removed; the header alone communicates the prompt. */}
        </div>

        <div className="flex items-center justify-end gap-3">
          {onDontAskAgain && (
            <button
              type="button"
              onClick={() => {
                onDontAskAgain();
                commit();
              }}
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body-sm)",
                color: "var(--foreground)",
                opacity: 0.4,
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
                marginRight: "auto",
              }}
            >
              Don't ask again
            </button>
          )}
          <button
            type="button"
            onClick={commit}
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm)",
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
