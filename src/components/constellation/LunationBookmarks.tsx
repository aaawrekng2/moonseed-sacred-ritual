/**
 * v3.04 — /lunations saved bookmarks ("Saved views"). Signed-in only.
 *
 * A bookmark icon in the toolbar opens a modal that (a) saves the current view
 * (name required + optional note → the phase-1 encoded view_state) and (b) lists
 * the user's saved views (name, note, date) with open / rename+edit-note / delete.
 * Opening a view calls onApply(view_state), which the page decodes and applies.
 *
 * Data: direct supabase.from("lunation_bookmarks") calls (per-user via RLS; we
 * also scope by user_id like the rest of the app). The table isn't in the
 * generated types yet, so the table handle is cast (as any), same as
 * backup-restore.ts does for tables outside the generated types.
 */
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bookmark, Pencil, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";

type BookmarkRow = {
  id: string;
  name: string;
  note: string | null;
  view_state: string;
  created_at: string;
  updated_at: string;
};

type Props = {
  userId: string | null;
  /** Returns the current view encoded as a phase-1 query string. */
  getViewState: () => string;
  /** Applies a saved view_state (page decodes + hydrates + updates the URL). */
  onApply: (viewState: string) => void;
};

const table = () =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- table not in generated types yet
  supabase.from("lunation_bookmarks" as any) as any;

export function LunationBookmarks({ userId, getViewState, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<BookmarkRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editNote, setEditNote] = useState("");

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    setErr(null);
    const { data, error } = await table()
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) setErr("Couldn't load your saved views.");
    else setRows((data ?? []) as BookmarkRow[]);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (open && userId) void load();
  }, [open, userId, load]);

  const doSave = async () => {
    if (!userId || !name.trim() || saving) return;
    setSaving(true);
    setErr(null);
    const { error } = await table().insert({
      user_id: userId,
      name: name.trim(),
      note: note.trim() || null,
      view_state: getViewState(),
    });
    setSaving(false);
    if (error) {
      setErr("Couldn't save. Try again.");
      return;
    }
    setName("");
    setNote("");
    void load();
  };

  const doDelete = async (id: string) => {
    if (!userId) return;
    await table().delete().eq("id", id).eq("user_id", userId);
    void load();
  };

  const startEdit = (r: BookmarkRow) => {
    setEditingId(r.id);
    setEditName(r.name);
    setEditNote(r.note ?? "");
  };

  const saveEdit = async (id: string) => {
    if (!userId || !editName.trim()) return;
    await table()
      .update({
        name: editName.trim(),
        note: editNote.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("user_id", userId);
    setEditingId(null);
    void load();
  };

  const fmtDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return "";
    }
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    boxSizing: "border-box",
    background: "var(--surface-1, rgba(255,255,255,0.03))",
    border: "1px solid var(--border-subtle)",
    borderRadius: 8,
    color: "var(--color-foreground)",
    padding: "8px 10px",
    fontFamily: "var(--font-serif)",
    fontSize: 14,
  };
  const iconBtn: React.CSSProperties = {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--color-foreground)",
    opacity: 0.7,
    padding: 4,
    display: "inline-flex",
  };

  const modal =
    open && typeof document !== "undefined"
      ? createPortal(
          <div
            onClick={() => setOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 3000,
              background: "rgba(6,4,16,0.62)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 16,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                width: "100%",
                maxWidth: 460,
                maxHeight: "82vh",
                overflowY: "auto",
                background: "var(--surface-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 16,
                padding: 20,
                boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 14,
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-display)",
                    fontStyle: "italic",
                    fontSize: "var(--text-heading-md, 20px)",
                    color: "var(--color-foreground)",
                  }}
                >
                  Saved views
                </div>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close"
                  style={iconBtn}
                >
                  <X size={18} />
                </button>
              </div>

              {!userId ? (
                <div
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontSize: 14,
                    color: "var(--color-foreground)",
                    opacity: 0.8,
                    lineHeight: 1.5,
                  }}
                >
                  Sign in to save named views of this page. You can still bookmark
                  the URL itself to keep this exact view.
                </div>
              ) : (
                <>
                  {/* Save current view */}
                  <div style={{ display: "grid", gap: 8, marginBottom: 18 }}>
                    <input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Name this view…"
                      maxLength={80}
                      style={inputStyle}
                    />
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Optional note…"
                      rows={2}
                      maxLength={500}
                      style={{ ...inputStyle, resize: "vertical" }}
                    />
                    <button
                      type="button"
                      onClick={() => void doSave()}
                      disabled={!name.trim() || saving}
                      style={{
                        justifySelf: "start",
                        background: "var(--accent, var(--gold))",
                        color: "var(--background)",
                        border: "none",
                        borderRadius: 999,
                        padding: "7px 16px",
                        cursor: name.trim() && !saving ? "pointer" : "default",
                        opacity: name.trim() && !saving ? 1 : 0.5,
                        fontFamily: "var(--font-serif)",
                        fontStyle: "italic",
                        fontSize: 14,
                      }}
                    >
                      {saving ? "Saving…" : "Save this view"}
                    </button>
                  </div>

                  {err && (
                    <div
                      style={{
                        color: "var(--color-danger, #e5737b)",
                        fontFamily: "var(--font-serif)",
                        fontSize: 13,
                        marginBottom: 10,
                      }}
                    >
                      {err}
                    </div>
                  )}

                  {/* List */}
                  <div
                    style={{
                      borderTop: "1px solid var(--border-subtle)",
                      paddingTop: 12,
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    {loading ? (
                      <div
                        style={{
                          fontFamily: "var(--font-serif)",
                          fontSize: 13,
                          opacity: 0.6,
                          color: "var(--color-foreground)",
                        }}
                      >
                        Loading…
                      </div>
                    ) : rows.length === 0 ? (
                      <div
                        style={{
                          fontFamily: "var(--font-serif)",
                          fontSize: 13,
                          opacity: 0.6,
                          color: "var(--color-foreground)",
                        }}
                      >
                        No saved views yet.
                      </div>
                    ) : (
                      rows.map((r) => (
                        <div
                          key={r.id}
                          style={{
                            border: "1px solid var(--border-subtle)",
                            borderRadius: 10,
                            padding: 10,
                          }}
                        >
                          {editingId === r.id ? (
                            <div style={{ display: "grid", gap: 6 }}>
                              <input
                                value={editName}
                                onChange={(e) => setEditName(e.target.value)}
                                maxLength={80}
                                style={inputStyle}
                              />
                              <textarea
                                value={editNote}
                                onChange={(e) => setEditNote(e.target.value)}
                                rows={2}
                                maxLength={500}
                                style={{ ...inputStyle, resize: "vertical" }}
                              />
                              <div style={{ display: "flex", gap: 8 }}>
                                <button
                                  type="button"
                                  onClick={() => void saveEdit(r.id)}
                                  style={{ ...iconBtn, opacity: 1, color: "var(--accent, var(--gold))" }}
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingId(null)}
                                  style={iconBtn}
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          ) : (
                            <div
                              style={{
                                display: "flex",
                                alignItems: "flex-start",
                                justifyContent: "space-between",
                                gap: 8,
                              }}
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  onApply(r.view_state);
                                  setOpen(false);
                                }}
                                style={{
                                  background: "none",
                                  border: "none",
                                  textAlign: "left",
                                  cursor: "pointer",
                                  flex: 1,
                                  padding: 0,
                                }}
                              >
                                <div
                                  style={{
                                    fontFamily: "var(--font-serif)",
                                    fontStyle: "italic",
                                    fontSize: 15,
                                    color: "var(--accent, var(--gold))",
                                  }}
                                >
                                  {r.name}
                                </div>
                                {r.note && (
                                  <div
                                    style={{
                                      fontFamily: "var(--font-serif)",
                                      fontSize: 13,
                                      color: "var(--color-foreground)",
                                      opacity: 0.8,
                                      marginTop: 2,
                                      whiteSpace: "pre-line",
                                    }}
                                  >
                                    {r.note}
                                  </div>
                                )}
                                <div
                                  style={{
                                    fontFamily: "var(--font-serif)",
                                    fontSize: 11,
                                    color: "var(--color-foreground)",
                                    opacity: 0.45,
                                    marginTop: 4,
                                  }}
                                >
                                  {fmtDate(r.created_at)}
                                </div>
                              </button>
                              <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
                                <button
                                  type="button"
                                  onClick={() => startEdit(r)}
                                  aria-label="Edit"
                                  style={iconBtn}
                                >
                                  <Pencil size={15} />
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void doDelete(r.id)}
                                  aria-label="Delete"
                                  style={iconBtn}
                                >
                                  <Trash2 size={15} />
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Saved views"
        title="Saved views"
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--color-foreground)",
          opacity: 0.75,
          padding: 4,
          display: "inline-flex",
          alignItems: "center",
        }}
      >
        <Bookmark size={16} strokeWidth={1.6} />
      </button>
      {modal}
    </>
  );
}
