/**
 * FQ-4 — Read-only reading detail modal opened from a stalker occurrence.
 * Intentionally lighter than the Journal editor; deep-linking to Journal
 * is offered at the bottom for full editing.
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { getReadingsByIds } from "@/lib/insights.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { CardImage } from "@/components/card/CardImage";

function formatFullDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function StalkerReadingModal({
  readingId,
  onClose,
}: {
  readingId: string;
  onClose: () => void;
}) {
  const fetchReadings = useServerFn(getReadingsByIds);
  const [reading, setReading] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const headers = await getAuthHeaders();
        const res = await fetchReadings({ data: { readingIds: [readingId] }, headers });
        if (cancelled) return;
        setReading(res.readings?.[0] ?? null);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn("[stalkers] reading fetch failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [readingId, fetchReadings]);

  // FQ-5 — body scroll lock + Escape-to-close.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm"
    >
      <div
        className="relative my-8 w-full max-w-2xl rounded-lg shadow-2xl"
        style={{ background: "var(--surface-elevated, var(--background))" }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="sticky top-0 z-10 ml-auto flex h-10 w-10 items-center justify-center text-muted-foreground hover:text-gold"
        >
          <X className="h-5 w-5" />
        </button>

        {loading || !reading ? (
          <div className="px-6 pb-12 text-sm italic text-muted-foreground">
            {loading ? "Loading reading…" : "Reading not found."}
          </div>
        ) : (
          <article className="px-6 pb-12">
            <header className="mb-4">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                {formatFullDate(reading.created_at)} · {reading.spread_type ?? "Reading"}
              </div>
              {reading.question ? (
                <h2 className="mt-2 font-serif italic" style={{ fontSize: "var(--text-heading-sm)" }}>
                  {reading.question}
                </h2>
              ) : null}
            </header>

            <div className="flex flex-wrap justify-center gap-3">
              {(reading.card_ids ?? []).map((cid: number, idx: number) => {
                const reversed = !!(reading.card_orientations ?? [])[idx];
                return (
                  <div key={`${cid}-${idx}`} style={{ width: 96 }}>
                    <CardImage
                      cardId={cid}
                      reversed={reversed}
                      size="custom"
                      widthPx={96}
                    />
                  </div>
                );
              })}
            </div>

            {reading.note ? (
              <section className="mt-6">
                <h3 className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                  Note
                </h3>
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{reading.note}</p>
              </section>
            ) : null}

            {Array.isArray(reading.tags) && reading.tags.length > 0 ? (
              <section className="mt-4 flex flex-wrap gap-1.5">
                {reading.tags.map((t: string) => (
                  <span
                    key={t}
                    className="rounded-full px-2 py-0.5 text-xs"
                    style={{
                      background: "color-mix(in oklch, var(--gold) 15%, transparent)",
                    }}
                  >
                    {t}
                  </span>
                ))}
              </section>
            ) : null}

            <footer className="mt-8 text-center">
              <a
                href={`/journal?openId=${reading.id}`}
                className="text-xs underline-offset-2 hover:underline"
                style={{ color: "var(--gold)" }}
              >
                Open in Journal →
              </a>
            </footer>
          </article>
        )}
      </div>
    </div>
  );
}