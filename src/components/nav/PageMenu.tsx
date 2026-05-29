/**
 * EJ65 — PageMenu (left fly-out panel).
 *
 * Per-page configuration surface. Lives on the LEFT side of the
 * viewport (mirroring the existing right-side filter flyout used
 * for data narrowing). Distinct purpose from each of the other
 * Tarot Seed UI surfaces:
 *
 *   - TopNav      → cross-page navigation
 *   - Page tabs   → section switching within the same page
 *   - PageMenu    → configure what the current page shows  (this file)
 *   - Filter bar  → filter the data the page displays      (existing)
 *
 * Each page that has page-level configuration mounts this component
 * with a list of `sections` (VIEW SWAP, HIDE/SHOW, etc.). Pages
 * without configuration don't mount it — the trigger button is
 * suppressed entirely so the seeker doesn't see a dead icon.
 *
 * Responsive behavior: on viewports ≥1024px the panel slides in from
 * the left as a side drawer (320px wide, content stays in place).
 * On narrower viewports the panel takes over the full width below
 * the TopNav (acts as a full-screen drawer like Notion mobile).
 */
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type PageMenuItem = {
  id: string;
  label: string;
  /** Optional secondary description. */
  description?: string;
  /** Icon shown to the left of the label. */
  Icon: LucideIcon;
  /** Action mode determines how the item renders + behaves. */
  mode: "navigate" | "toggle" | "cycle";
  /** For toggle items — current on/off state. */
  on?: boolean;
  /** For cycle items — the visible step label (e.g. "2 rows"). */
  cycleLabel?: string;
  /** Click handler. */
  onClick: () => void;
};

export type PageMenuSection = {
  id: string;
  title: string;
  items: PageMenuItem[];
};

export type PageMenuProps = {
  open: boolean;
  onClose: () => void;
  sections: PageMenuSection[];
  /**
   * EJ70 — Name of the current page, shown at the very top of the
   * fly-out above the Close button (e.g. "Manual Entry"). Optional;
   * when omitted only the Close button shows.
   */
  title?: string;
};

export function PageMenu({ open, onClose, sections, title }: PageMenuProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // setTimeout so the same click that opened the menu doesn't close it.
    const t = window.setTimeout(() => {
      window.addEventListener("mousedown", onDown);
    }, 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener("mousedown", onDown);
    };
  }, [open, onClose]);

  if (typeof document === "undefined") return null;

  // Empty sections are filtered so the panel doesn't render empty
  // headers. Pages that have no sections at all shouldn't be mounting
  // PageMenu in the first place — the trigger button is suppressed
  // for those pages.
  const visibleSections = sections.filter((s) => s.items.length > 0);

  return createPortal(
    <>
      {/* Scrim — soft theme-aware backdrop. Tap to close. */}
      <div
        aria-hidden
        onClick={onClose}
        className="modal-scrim fixed inset-0"
        style={{
          // EK06 — z bumped from --z-drawer (60) to a literal 600 so
          // the PageMenu drawer sits ABOVE FullScreenSheet (at --z-modal
          // 100). ManualEntryBuilder renders inside a FullScreenSheet,
          // so the previous z-60 made the drawer render BEHIND the
          // sheet and become invisible — the hamburger trigger fired
          // correctly and state updated, but the drawer was hidden, so
          // it looked like "tapping does nothing." Bumped both the
          // scrim and the panel.
          zIndex: 600,
          opacity: open ? 1 : 0,
          pointerEvents: open ? "auto" : "none",
          transition: "opacity 200ms ease-out",
        }}
      />
      {/* Panel — slides in from left. 320px wide on desktop, full-width
          on narrow viewports. Sits below the TopNav compact band
          (28px + safe-area) so the nav remains tappable. */}
      <aside
        ref={panelRef}
        aria-label="Page menu"
        className="fixed left-0 top-0 flex flex-col overflow-y-auto border-r shadow-2xl"
        style={{
          // EK06 — Matches the scrim bump above. Same rationale.
          zIndex: 601,
          height: "100dvh",
          width: "min(320px, 100vw)",
          paddingTop: "calc(env(safe-area-inset-top, 0px) + var(--topbar-height) + 16px)",
          paddingBottom: 24,
          background: "var(--surface-card)",
          borderRightColor: "var(--border-default)",
          transform: open ? "translateX(0)" : "translateX(-110%)",
          transition: "transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1)",
          willChange: "transform",
        }}
      >
        {/* EJ70 — Current page name at the very top of the fly-out,
            above the Close button. */}
        {title && (
          <div
            style={{
              padding: "0 20px 4px",
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 18,
              color: "var(--color-foreground)",
              lineHeight: 1.1,
            }}
          >
            {title}
          </div>
        )}
        {/* Close affordance — explicit X / back arrow at top-left of
            the panel content. Tapping the scrim also closes. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "0 20px 12px",
            borderBottom: "1px solid var(--border-subtle)",
            marginBottom: 16,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close page menu"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 4,
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 13,
              color: "var(--color-foreground)",
              opacity: 0.85,
            }}
          >
            <ChevronLeft size={16} aria-hidden />
            Close
          </button>
        </div>

        {visibleSections.length === 0 ? (
          <div
            style={{
              padding: "0 20px",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 13,
              color: "var(--color-foreground-muted, var(--color-foreground))",
              opacity: 0.6,
            }}
          >
            Nothing to configure on this page.
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            {visibleSections.map((section) => (
              <section key={section.id} style={{ padding: "0 20px" }}>
                <h3
                  style={{
                    margin: 0,
                    marginBottom: 10,
                    fontFamily: "var(--font-display)",
                    fontSize: 10,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: "var(--accent, var(--gold))",
                    opacity: 0.8,
                  }}
                >
                  {section.title}
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                  {section.items.map((item) => (
                    <PageMenuRow key={item.id} item={item} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </aside>
    </>,
    document.body,
  );
}

function PageMenuRow({ item }: { item: PageMenuItem }) {
  const { Icon, label, description, mode, on, cycleLabel, onClick } = item;
  // Visual state — toggles dim when off, cycles show their step label.
  const isOff = mode === "toggle" && on === false;
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        width: "100%",
        padding: "10px 8px",
        background: "transparent",
        border: "none",
        borderRadius: 6,
        cursor: "pointer",
        textAlign: "left",
        color: "var(--color-foreground)",
        opacity: isOff ? 0.5 : 1,
        transition: "opacity 160ms ease-out, background 120ms ease-out",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background =
          "color-mix(in oklab, var(--accent, var(--gold)) 8%, transparent)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      <Icon size={18} strokeWidth={1.6} aria-hidden />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 14,
            lineHeight: 1.2,
          }}
        >
          {label}
        </div>
        {description && (
          <div
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 11,
              color: "var(--color-foreground-muted, var(--color-foreground))",
              opacity: 0.7,
              marginTop: 2,
            }}
          >
            {description}
          </div>
        )}
      </div>
      {mode === "cycle" && cycleLabel && (
        <span
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: 11,
            color: "var(--accent, var(--gold))",
            opacity: 0.85,
            padding: "2px 8px",
            borderRadius: 999,
            background:
              "color-mix(in oklab, var(--accent, var(--gold)) 10%, transparent)",
          }}
        >
          {cycleLabel}
        </span>
      )}
      {mode === "toggle" && (
        <span
          aria-hidden
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: 11,
            color: on ? "var(--accent, var(--gold))" : "var(--color-foreground-muted)",
            opacity: 0.85,
          }}
        >
          {on ? "On" : "Off"}
        </span>
      )}
    </button>
  );
}
