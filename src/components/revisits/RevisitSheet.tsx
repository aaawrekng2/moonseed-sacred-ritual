/**
 * v2.10 — RevisitSheet (dual mode).
 *
 * Opened by the Revisit (calendar-clock) action on a reading. On open it
 * checks for an existing pending revisit:
 *   - none  -> SCHEDULE mode: presets (in a week / month / 3 months) + pick
 *              a date, plus an editable "what you're checking" line.
 *   - exists -> REFLECT mode: shows the checking prompt and a reflection
 *              field. "Add your reflection" records a dated reflection and
 *              closes the revisit; "Dismiss" closes it without one;
 *              "Reschedule" returns to schedule mode.
 *
 * Date presets are pure calendar arithmetic on the YYYY-MM-DD string keyed
 * to the seeker's tz today — no Date getters/setters (keeps the @/lib/time
 * contract; the canonical helper provides "today" in the seeker's zone).
 */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { CalendarClock, X as XIcon } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { nowYmdInTz } from "@/lib/time";
import { formatDateShort } from "@/lib/dates";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import {
  scheduleRevisit,
  getRevisitForReading,
  recordReflection,
  dismissRevisit,
} from "@/lib/revisits.functions";

const DEFAULT_PROMPT = "Did this come true?";

function isLeap(y: number): boolean {
  return y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0);
}
function daysInMonth(y: number, m1: number): number {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][
    m1 - 1
  ];
}
const pad = (n: number) => String(n).padStart(2, "0");

function addDaysYmd(ymd: string, days: number): string {
  let [y, m, d] = ymd.split("-").map(Number);
  d += days;
  while (d > daysInMonth(y, m)) {
    d -= daysInMonth(y, m);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return `${y}-${pad(m)}-${pad(d)}`;
}
function addMonthsYmd(ymd: string, months: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const mi = m - 1 + months;
  const ny = y + Math.floor(mi / 12);
  const nm = ((mi % 12) + 12) % 12;
  const nd = Math.min(d, daysInMonth(ny, nm + 1));
  return `${ny}-${pad(nm + 1)}-${pad(nd)}`;
}
function labelFor(ymd: string): string {
  return formatDateShort(`${ymd}T12:00:00`);
}

type PendingRevisit = {
  id: string;
  resurface_on: string;
  prompt: string | null;
  status: string;
};

export type RevisitSheetProps = {
  open: boolean;
  readingId: string;
  tz: string;
  onClose: () => void;
  /** Fired after schedule / reflect / dismiss so the parent can refresh. */
  onChanged?: () => void;
};

export function RevisitSheet({
  open,
  readingId,
  tz,
  onClose,
  onChanged,
}: RevisitSheetProps) {
  const schedule = useServerFn(scheduleRevisit);
  const fetchExisting = useServerFn(getRevisitForReading);
  const reflect = useServerFn(recordReflection);
  const dismiss = useServerFn(dismissRevisit);

  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState<PendingRevisit | null>(null);
  const [forceSchedule, setForceSchedule] = useState(false);
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT);
  const [reflection, setReflection] = useState("");
  const [pickOpen, setPickOpen] = useState(false);
  const [pickedDate, setPickedDate] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const today = useMemo(() => nowYmdInTz(tz), [tz]);
  const options = useMemo(
    () => [
      { key: "week", label: "In a week", date: addDaysYmd(today, 7) },
      { key: "month", label: "In a month", date: addMonthsYmd(today, 1) },
      { key: "three", label: "In 3 months", date: addMonthsYmd(today, 3) },
    ],
    [today],
  );

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setErr(null);
    setForceSchedule(false);
    setReflection("");
    (async () => {
      try {
        const headers = await getAuthHeaders();
        const row = (await fetchExisting({
          data: { readingId },
          headers,
        })) as PendingRevisit | null;
        if (cancelled) return;
        setExisting(row);
        setPrompt(row?.prompt?.trim() || DEFAULT_PROMPT);
      } catch {
        if (!cancelled) setExisting(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, readingId, fetchExisting]);

  if (!open || typeof document === "undefined") return null;

  const inReflectMode = !!existing && !forceSchedule;

  const doSchedule = async (resurfaceOn: string) => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const headers = await getAuthHeaders();
      await schedule({
        data: { readingId, resurfaceOn, prompt: prompt.trim() || null },
        headers,
      });
      onChanged?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't schedule the revisit.");
      setBusy(false);
    }
  };

  const doReflect = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const headers = await getAuthHeaders();
      await reflect({ data: { readingId, reflection: reflection.trim() }, headers });
      onChanged?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't save your reflection.");
      setBusy(false);
    }
  };

  const doDismiss = async () => {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const headers = await getAuthHeaders();
      await dismiss({ data: { readingId }, headers });
      onChanged?.();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't dismiss the revisit.");
      setBusy(false);
    }
  };

  const titleText = inReflectMode ? "Revisit" : "Revisit this reading";

  return createPortal(
    <div
      className="modal-scrim"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: "var(--z-modal, 100)" as unknown as number,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "var(--space-4, 16px)",
      }}
    >
      <div
        role="dialog"
        aria-label={titleText}
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 420,
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
          borderRadius: "var(--radius-lg, 16px)",
          padding: "20px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 8,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontFamily: "var(--font-display, var(--font-serif))",
              fontStyle: "italic",
              fontSize: "var(--text-heading-md)",
              color: "var(--color-foreground)",
            }}
          >
            <CalendarClock className="h-4 w-4" style={{ color: "var(--gold)" }} />
            {titleText}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              padding: 4,
              cursor: "pointer",
              color: "var(--color-foreground-muted)",
            }}
          >
            <XIcon className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <p
            style={{
              margin: "16px 0",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-sm)",
              color: "var(--color-foreground-muted)",
            }}
          >
            Loading…
          </p>
        ) : inReflectMode ? (
          <>
            <div
              style={{
                margin: "14px 0",
                padding: "11px 13px",
                border: "1px solid var(--border-subtle)",
                borderRadius: "var(--radius-md, 10px)",
                background: "var(--surface-elevated, var(--surface-card))",
              }}
            >
              <span
                style={{
                  fontSize: "var(--text-body-sm)",
                  color: "var(--color-foreground-muted)",
                }}
              >
                You wanted to check —{" "}
              </span>
              <span
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-body)",
                  color: "var(--gold)",
                }}
              >
                {existing?.prompt?.trim() || DEFAULT_PROMPT}
              </span>
            </div>

            <textarea
              value={reflection}
              onChange={(e) => setReflection(e.target.value)}
              placeholder="What unfolded?"
              rows={4}
              maxLength={2000}
              style={{
                width: "100%",
                background: "transparent",
                border: "1px solid var(--border-default)",
                borderRadius: "var(--radius-md, 8px)",
                padding: "10px",
                fontFamily: "var(--font-serif)",
                fontSize: "var(--text-body)",
                color: "var(--color-foreground)",
                outline: "none",
                resize: "vertical",
              }}
            />

            <button
              type="button"
              disabled={busy || reflection.trim().length === 0}
              onClick={doReflect}
              style={{
                width: "100%",
                marginTop: 12,
                padding: "12px",
                borderRadius: "var(--radius-md, 10px)",
                background: "color-mix(in oklab, var(--gold) 16%, transparent)",
                border: "1px solid color-mix(in oklab, var(--gold) 55%, transparent)",
                color: "var(--gold)",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body)",
                cursor:
                  busy || reflection.trim().length === 0 ? "default" : "pointer",
                opacity: reflection.trim().length === 0 ? 0.5 : 1,
              }}
            >
              Add your reflection
            </button>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 22,
                marginTop: 14,
              }}
            >
              <button
                type="button"
                disabled={busy}
                onClick={() => setForceSchedule(true)}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-body-sm)",
                  color: "var(--color-foreground-muted)",
                }}
              >
                Reschedule
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={doDismiss}
                style={{
                  background: "none",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "var(--text-caption)",
                  color: "var(--color-foreground-muted)",
                  opacity: 0.7,
                }}
              >
                Dismiss
              </button>
            </div>
          </>
        ) : (
          <>
            <p
              style={{
                margin: "6px 0 14px",
                fontSize: "var(--text-body-sm)",
                color: "var(--color-foreground-muted)",
              }}
            >
              Bring it back to your Today page later, to see how it landed.
            </p>

            <label
              style={{
                display: "block",
                fontSize: "var(--text-caption)",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                color: "var(--color-foreground-muted)",
                marginBottom: 6,
              }}
            >
              What you're checking
            </label>
            <input
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              maxLength={200}
              style={{
                width: "100%",
                background: "transparent",
                border: "none",
                borderBottom: "1px solid var(--border-default)",
                padding: "6px 2px",
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-body)",
                color: "var(--color-foreground)",
                outline: "none",
              }}
            />

            <div style={{ marginTop: 14 }}>
              {options.map((o) => (
                <button
                  key={o.key}
                  type="button"
                  disabled={busy}
                  onClick={() => doSchedule(o.date)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "14px 2px",
                    background: "none",
                    border: "none",
                    borderTop: "1px solid var(--border-subtle)",
                    cursor: "pointer",
                    color: "var(--color-foreground)",
                    fontSize: "var(--text-body)",
                  }}
                >
                  <span>{o.label}</span>
                  <span
                    style={{
                      fontSize: "var(--text-body-sm)",
                      color: "var(--color-foreground-muted)",
                    }}
                  >
                    {labelFor(o.date)}
                  </span>
                </button>
              ))}

              {!pickOpen ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setPickOpen(true)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    padding: "14px 2px",
                    background: "none",
                    border: "none",
                    borderTop: "1px solid var(--border-subtle)",
                    cursor: "pointer",
                    color: "var(--gold)",
                    fontSize: "var(--text-body)",
                  }}
                >
                  Pick a date…
                </button>
              ) : (
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "14px 2px",
                    borderTop: "1px solid var(--border-subtle)",
                  }}
                >
                  <input
                    type="date"
                    min={today}
                    value={pickedDate}
                    onChange={(e) => setPickedDate(e.target.value)}
                    style={{
                      flex: 1,
                      background: "transparent",
                      border: "1px solid var(--border-default)",
                      borderRadius: "var(--radius-md, 8px)",
                      padding: "8px",
                      color: "var(--color-foreground)",
                      fontSize: "var(--text-body-sm)",
                    }}
                  />
                  <button
                    type="button"
                    disabled={busy || !pickedDate}
                    onClick={() => pickedDate && doSchedule(pickedDate)}
                    style={{
                      background: "none",
                      border: "none",
                      cursor: pickedDate ? "pointer" : "default",
                      color: pickedDate
                        ? "var(--gold)"
                        : "var(--color-foreground-muted)",
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontSize: "var(--text-body)",
                    }}
                  >
                    Set
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {err && (
          <p
            style={{
              marginTop: 10,
              fontSize: "var(--text-caption)",
              color: "var(--color-foreground-muted)",
            }}
          >
            {err}
          </p>
        )}
      </div>
    </div>,
    document.body,
  );
}
