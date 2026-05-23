/**
 * EJ31 — Admin-side deck inspection modal.
 *
 * Opens when an admin clicks a row in the Decks panel on a user's
 * detail page. Loads via getDeckDetail and renders:
 *   - Header: deck name + type pill (Tarot / Oracle)
 *   - Card-back thumbnail
 *   - Grid of card thumbnails (~6 cols)
 *   - Footer actions: Download, Copy to user, Close
 *
 * Download for first pass is a stub action (admins can use the
 * existing per-user export route until we wire a per-deck zip
 * endpoint). Copy opens the DeckCopyModal.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { getDeckDetail } from "@/lib/admin.functions";
import { getCardName } from "@/lib/tarot";

type DeckDetail = Awaited<ReturnType<typeof getDeckDetail>>;

export function DeckInspectModal({
  open,
  deckId,
  onClose,
  onCopyClick,
  onDownloadClick,
  authHeaders,
}: {
  open: boolean;
  deckId: string | null;
  onClose: () => void;
  onCopyClick: () => void;
  onDownloadClick: () => void;
  /** Caller-provided async helper that returns Authorization headers
   *  for the admin server-fn calls. The admin route owns this helper
   *  (refreshes the Supabase session as needed). */
  authHeaders: () => Promise<Record<string, string>>;
}) {
  const [data, setData] = useState<DeckDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !deckId) {
      setData(null);
      setErr(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const headers = await authHeaders();
        const res = await getDeckDetail({ data: { deckId }, headers });
        if (!cancelled) setData(res);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load deck");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, deckId]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const deck = data?.deck ?? null;
  const cards = data?.cards ?? [];
  const cardBack = data?.card_back_signed_url ?? null;

  const node = (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="modal-scrim"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-modal)" as unknown as number,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 720,
          maxHeight: "85vh",
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: 12,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <p
              style={{
                margin: 0,
                fontFamily: "var(--font-display)",
                fontSize: "var(--text-heading-md, 1.2rem)",
                color: "var(--color-foreground)",
              }}
            >
              {deck?.name ?? "Deck"}
            </p>
            {deck?.deck_type && (
              <span
                style={{
                  display: "inline-block",
                  width: "fit-content",
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 10,
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  background: "color-mix(in oklab, var(--accent, var(--gold)) 14%, transparent)",
                  color: "var(--accent, var(--gold))",
                  border: "1px solid var(--border-subtle)",
                }}
              >
                {deck.deck_type}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 4,
              color: "var(--color-foreground)",
            }}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {/* Body */}
        <div
          style={{
            flex: 1,
            overflow: "auto",
            padding: "16px 18px",
            display: "flex",
            flexDirection: "column",
            gap: 16,
          }}
        >
          {loading && (
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                color: "var(--color-foreground)",
                opacity: 0.7,
              }}
            >
              Loading…
            </div>
          )}
          {err && (
            <div
              style={{
                fontFamily: "var(--font-serif)",
                color: "var(--color-foreground)",
                opacity: 0.85,
              }}
            >
              {err}
            </div>
          )}
          {!loading && !err && deck && (
            <>
              {/* Card back */}
              {cardBack && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span
                    style={{
                      fontSize: 10,
                      letterSpacing: "0.2em",
                      textTransform: "uppercase",
                      fontFamily: "var(--font-serif)",
                      color: "var(--color-foreground-muted, var(--color-foreground))",
                      opacity: 0.75,
                    }}
                  >
                    Card back
                  </span>
                  <img
                    src={cardBack}
                    alt="Card back"
                    style={{
                      width: 120,
                      height: "auto",
                      borderRadius: 8,
                      border: "1px solid var(--border-subtle)",
                    }}
                  />
                </div>
              )}
              {/* Cards grid */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span
                  style={{
                    fontSize: 10,
                    letterSpacing: "0.2em",
                    textTransform: "uppercase",
                    fontFamily: "var(--font-serif)",
                    color: "var(--color-foreground-muted, var(--color-foreground))",
                    opacity: 0.75,
                  }}
                >
                  {cards.length} card{cards.length === 1 ? "" : "s"}
                </span>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fill, minmax(80px, 1fr))",
                    gap: 10,
                  }}
                >
                  {cards.map((c) => {
                    const displayName =
                      c.card_name ??
                      (c.card_id < 78 ? getCardName(c.card_id) : `Card ${c.card_id}`);
                    return (
                      <div
                        key={c.id}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          gap: 4,
                          alignItems: "center",
                        }}
                      >
                        {c.thumbnail_signed_url ? (
                          <img
                            src={c.thumbnail_signed_url}
                            alt={displayName}
                            style={{
                              width: "100%",
                              height: "auto",
                              borderRadius: 6,
                              border: "1px solid var(--border-subtle)",
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: "100%",
                              aspectRatio: "1 / 1.6",
                              borderRadius: 6,
                              border: "1px dashed var(--border-subtle)",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: 10,
                              color: "var(--color-foreground)",
                              opacity: 0.4,
                            }}
                          >
                            no image
                          </div>
                        )}
                        <span
                          style={{
                            fontSize: 10,
                            fontFamily: "var(--font-serif)",
                            color: "var(--color-foreground)",
                            textAlign: "center",
                            lineHeight: 1.3,
                            wordBreak: "break-word",
                          }}
                        >
                          {displayName}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </>
          )}
        </div>
        {/* Footer */}
        <div
          style={{
            display: "flex",
            gap: 8,
            padding: "12px 18px",
            borderTop: "1px solid var(--border-subtle)",
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onDownloadClick}
            disabled={!deck}
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-body-sm)",
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--border-subtle)",
              background: "transparent",
              color: "var(--color-foreground)",
              cursor: deck ? "pointer" : "not-allowed",
              opacity: deck ? 1 : 0.5,
            }}
          >
            Download
          </button>
          <button
            type="button"
            onClick={onCopyClick}
            disabled={!deck}
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-body-sm)",
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--accent, var(--gold))",
              background: "color-mix(in oklab, var(--accent, var(--gold)) 14%, transparent)",
              color: "var(--accent, var(--gold))",
              cursor: deck ? "pointer" : "not-allowed",
              opacity: deck ? 1 : 0.5,
            }}
          >
            Copy to user
          </button>
          <button
            type="button"
            onClick={onClose}
            style={{
              fontFamily: "var(--font-serif)",
              fontSize: "var(--text-body-sm)",
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid var(--border-subtle)",
              background: "transparent",
              color: "var(--color-foreground)",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(node, document.body);
}
