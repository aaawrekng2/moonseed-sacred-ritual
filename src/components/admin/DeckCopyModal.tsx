/**
 * EJ31 — Admin-side deck copy modal.
 *
 * Opens when an admin clicks the Copy action on a deck row (or the
 * Copy button in the inspect modal). The source deck and source user
 * are pre-filled — the admin only picks a target.
 *
 * Target picker is a combobox: type to filter the global user list
 * by email, click to pick. Confirm step before the actual copy.
 *
 * Target user is allowed to exceed their custom_decks cap — admin
 * action overrides the per-user limit.
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { copyDeckToUser, listAdminUsers } from "@/lib/admin.functions";

type AdminUser = Awaited<ReturnType<typeof listAdminUsers>>[number];

export function DeckCopyModal({
  open,
  sourceDeckId,
  sourceDeckName,
  sourceUserId,
  sourceUserEmail,
  onClose,
  onCopied,
  authHeaders,
}: {
  open: boolean;
  sourceDeckId: string | null;
  sourceDeckName: string | null;
  sourceUserId: string;
  sourceUserEmail: string | null;
  onClose: () => void;
  onCopied: (result: { newDeckId: string; cardsCopied: number; cardsTotal: number }) => void;
  /** Caller-provided async helper returning Authorization headers. */
  authHeaders: () => Promise<Record<string, string>>;
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [search, setSearch] = useState("");
  const [target, setTarget] = useState<AdminUser | null>(null);
  const [phase, setPhase] = useState<"pick" | "confirm" | "working">("pick");
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setUsers([]);
      setSearch("");
      setTarget(null);
      setPhase("pick");
      setErr(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const headers = await authHeaders();
        const list = await listAdminUsers({ headers });
        if (!cancelled) setUsers(list);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load users");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Filter users by typed query. Exclude the source user (can't copy
  // a deck to its current owner). When the admin has picked a target
  // (target !== null), suppress the filter list — they've committed.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as AdminUser[];
    return users
      .filter((u) => u.user_id !== sourceUserId)
      .filter((u) => {
        const e = (u.email ?? "").toLowerCase();
        const n = (u.display_name ?? "").toLowerCase();
        return e.includes(q) || n.includes(q);
      })
      .slice(0, 8);
  }, [users, search, sourceUserId]);

  const handleConfirm = async () => {
    if (!sourceDeckId || !target) return;
    setPhase("working");
    setErr(null);
    try {
      const headers = await authHeaders();
      const res = await copyDeckToUser({
        data: { sourceDeckId, targetUserId: target.user_id },
        headers,
      });
      onCopied({
        newDeckId: res.new_deck_id,
        cardsCopied: res.cards_copied,
        cardsTotal: res.cards_total,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Copy failed");
      setPhase("confirm");
    }
  };

  if (!open) return null;

  const node = (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget && phase !== "working") onClose();
      }}
      className="modal-scrim"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-modal-nested)" as unknown as number,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 460,
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
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            padding: "14px 18px",
            borderBottom: "1px solid var(--border-subtle)",
          }}
        >
          <p
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontSize: "var(--text-heading-md, 1.2rem)",
              color: "var(--color-foreground)",
            }}
          >
            Copy deck to another user
          </p>
          <button
            type="button"
            onClick={onClose}
            disabled={phase === "working"}
            aria-label="Close"
            style={{
              background: "transparent",
              border: "none",
              cursor: phase === "working" ? "not-allowed" : "pointer",
              padding: 4,
              color: "var(--color-foreground)",
              opacity: phase === "working" ? 0.4 : 1,
            }}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
        {/* Body */}
        <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Source summary */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 4,
              padding: "10px 12px",
              borderRadius: 8,
              background: "color-mix(in oklab, var(--color-foreground) 4%, transparent)",
              border: "1px solid var(--border-subtle)",
            }}
          >
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
              Source
            </span>
            <span
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "var(--text-body-sm)",
                color: "var(--color-foreground)",
              }}
            >
              {sourceDeckName ?? "Deck"}
              {sourceUserEmail ? ` · ${sourceUserEmail}` : ""}
            </span>
          </div>
          {/* Phase: pick target */}
          {phase === "pick" && (
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
                Target user
              </span>
              {target ? (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "8px 10px",
                    borderRadius: 6,
                    background: "color-mix(in oklab, var(--accent, var(--gold)) 10%, transparent)",
                    border: "1px solid var(--accent, var(--gold))",
                    color: "var(--color-foreground)",
                    fontFamily: "var(--font-serif)",
                    fontSize: "var(--text-body-sm)",
                  }}
                >
                  <span>{target.email ?? target.display_name ?? target.user_id.slice(0, 8)}</span>
                  <button
                    type="button"
                    onClick={() => setTarget(null)}
                    style={{
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: "var(--color-foreground)",
                      opacity: 0.7,
                      fontFamily: "var(--font-serif)",
                      fontSize: 11,
                      textDecoration: "underline",
                    }}
                  >
                    change
                  </button>
                </div>
              ) : (
                <>
                  <input
                    autoFocus
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Type an email to filter"
                    style={{
                      width: "100%",
                      padding: "8px 10px",
                      borderRadius: 6,
                      border: "1px solid var(--border-subtle)",
                      background: "var(--surface-card)",
                      color: "var(--color-foreground)",
                      fontFamily: "var(--font-serif)",
                      fontSize: "var(--text-body-sm)",
                      outline: "none",
                    }}
                  />
                  {filtered.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 2,
                        maxHeight: 220,
                        overflow: "auto",
                        borderRadius: 6,
                        border: "1px solid var(--border-subtle)",
                      }}
                    >
                      {filtered.map((u) => (
                        <button
                          key={u.user_id}
                          type="button"
                          onClick={() => setTarget(u)}
                          style={{
                            textAlign: "left",
                            padding: "8px 10px",
                            background: "transparent",
                            border: "none",
                            borderBottom: "1px solid var(--border-subtle)",
                            cursor: "pointer",
                            color: "var(--color-foreground)",
                            fontFamily: "var(--font-serif)",
                            fontSize: "var(--text-body-sm)",
                            display: "flex",
                            flexDirection: "column",
                            gap: 2,
                          }}
                        >
                          <span>{u.email ?? `— no email — (${u.user_id.slice(0, 8)})`}</span>
                          {u.display_name && (
                            <span style={{ fontSize: 11, opacity: 0.6 }}>{u.display_name}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                  {search.trim() && filtered.length === 0 && (
                    <span
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontSize: 12,
                        color: "var(--color-foreground)",
                        opacity: 0.6,
                      }}
                    >
                      No matching users.
                    </span>
                  )}
                </>
              )}
            </div>
          )}
          {/* Phase: confirm */}
          {phase === "confirm" && target && (
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: "var(--text-body-sm)",
                color: "var(--color-foreground)",
                lineHeight: 1.5,
              }}
            >
              This will add an independent copy of <em>{sourceDeckName ?? "this deck"}</em> to{" "}
              <strong>{target.email ?? target.display_name ?? target.user_id.slice(0, 8)}</strong>.
              They will see it immediately. This bypasses their personal deck cap.
            </div>
          )}
          {/* Phase: working */}
          {phase === "working" && (
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body-sm)",
                color: "var(--color-foreground)",
                opacity: 0.85,
              }}
            >
              Copying deck — this may take a moment for large decks…
            </div>
          )}
          {err && (
            <div
              style={{
                fontFamily: "var(--font-serif)",
                fontSize: 12,
                color: "var(--color-foreground)",
                background: "color-mix(in oklab, red 14%, transparent)",
                padding: "6px 10px",
                borderRadius: 6,
              }}
            >
              {err}
            </div>
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
          {phase === "pick" && (
            <>
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
                Cancel
              </button>
              <button
                type="button"
                onClick={() => setPhase("confirm")}
                disabled={!target}
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: "var(--text-body-sm)",
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid var(--accent, var(--gold))",
                  background: target
                    ? "color-mix(in oklab, var(--accent, var(--gold)) 14%, transparent)"
                    : "transparent",
                  color: target ? "var(--accent, var(--gold))" : "var(--color-foreground)",
                  cursor: target ? "pointer" : "not-allowed",
                  opacity: target ? 1 : 0.5,
                }}
              >
                Continue
              </button>
            </>
          )}
          {phase === "confirm" && (
            <>
              <button
                type="button"
                onClick={() => setPhase("pick")}
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
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                style={{
                  fontFamily: "var(--font-serif)",
                  fontSize: "var(--text-body-sm)",
                  padding: "6px 14px",
                  borderRadius: 6,
                  border: "1px solid var(--accent, var(--gold))",
                  background: "color-mix(in oklab, var(--accent, var(--gold)) 14%, transparent)",
                  color: "var(--accent, var(--gold))",
                  cursor: "pointer",
                }}
              >
                Copy deck
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
  return typeof document === "undefined" ? null : createPortal(node, document.body);
}
