/**
 * FU-5 — Canonical Class B (Detail Modal) component.
 *
 * - Centered, theme-aware scrim (`modal-scrim`)
 * - Theme-aware border + surface
 * - X + tap-outside + escape close affordances
 * - Optional subtitle slot
 * - Renders via createPortal to document.body
 */
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type ModalSize = "sm" | "md" | "lg";

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  subtitle?: string;
  /** Default 'md' = max-w-2xl. */
  size?: ModalSize;
  closeOnEscape?: boolean;
  closeOnOutsideClick?: boolean;
  /** When true, nests above another modal (uses --z-modal-nested). */
  nested?: boolean;
  /** Optional class on the modal panel. */
  className?: string;
  children: React.ReactNode;
};

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  size = "md",
  closeOnEscape = true,
  closeOnOutsideClick = true,
  nested = false,
  className,
  children,
}: ModalProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, closeOnEscape, onClose]);

  // Restore focus on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    // Focus the panel so escape works without a manual click.
    panelRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  const sizeClass =
    size === "sm" ? "max-w-md" : size === "lg" ? "max-w-4xl" : "max-w-2xl";

  const zIndex = nested ? "var(--z-modal-nested)" : "var(--z-modal)";

  return createPortal(
    <div
      className="modal-scrim fixed inset-0 flex items-center justify-center p-4 fu5-animate-fade-in"
      style={{ zIndex }}
      onMouseDown={(e) => {
        if (closeOnOutsideClick && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        tabIndex={-1}
        className={`fu5-animate-scale-in relative w-full ${sizeClass} max-h-[90dvh] overflow-hidden rounded-lg shadow-2xl outline-none ${className ?? ""}`}
        style={{
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          color: "var(--color-foreground)",
        }}
      >
        {(title || subtitle) && (
          <header className="flex items-start justify-between gap-4 p-5 pb-3">
            <div className="min-w-0 flex-1">
              {title && (
                <h2
                  id={titleId}
                  className="font-display italic text-lg leading-tight"
                  style={{ color: "var(--color-foreground)", opacity: 0.9 }}
                >
                  {title}
                </h2>
              )}
              {subtitle && (
                <div
                  className="mt-1 text-xs"
                  style={{ color: "var(--color-foreground)", opacity: 0.7 }}
                >
                  {subtitle}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded-full p-1.5 transition-opacity hover:opacity-100"
              style={{ color: "var(--color-foreground)", opacity: 0.6 }}
            >
              <X size={18} strokeWidth={1.5} />
            </button>
          </header>
        )}
        <div className="max-h-[calc(90dvh-3.5rem)] overflow-y-auto">
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}