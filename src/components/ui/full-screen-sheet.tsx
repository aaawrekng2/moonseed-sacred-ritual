/**
 * FU-5 — Canonical Class C (Full-Screen Flow) component.
 *
 * - Opaque, theme-aware background (var(--background))
 * - No border, no rounded corners (full-bleed)
 * - Optional title + close button (above safe-area-inset-top)
 * - Escape always closes
 * - Animation: fade or slide-up
 */
import { useEffect, useId } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type FullScreenSheetProps = {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Default true. */
  showCloseButton?: boolean;
  /** Animation entry style. Default 'fade'. */
  entry?: "fade" | "slide-up";
  /** Optional background override (e.g. PhotoCapture wants pure black). */
  backgroundOverride?: string;
  /** Optional class on the outer wrapper. */
  className?: string;
  children: React.ReactNode;
};

export function FullScreenSheet({
  open,
  onClose,
  title,
  showCloseButton = true,
  entry = "fade",
  backgroundOverride,
  className,
  children,
}: FullScreenSheetProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const animClass =
    entry === "slide-up" ? "fu5-animate-slide-up" : "fu5-animate-fade-in";

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      className={`fixed inset-0 flex flex-col ${animClass} ${className ?? ""}`}
      style={{
        zIndex: "var(--z-modal)",
        background: backgroundOverride ?? "var(--background)",
        color: "var(--color-foreground)",
      }}
    >
      {(title || showCloseButton) && (
        <header
          className="flex items-start justify-between gap-4 px-5 pb-3"
          style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 16px)" }}
        >
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
          </div>
          {showCloseButton && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="shrink-0 rounded-full p-1.5 transition-opacity hover:opacity-100"
              style={{ color: "var(--color-foreground)", opacity: 0.7 }}
            >
              <X size={20} strokeWidth={1.5} />
            </button>
          )}
        </header>
      )}
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>,
    document.body,
  );
}