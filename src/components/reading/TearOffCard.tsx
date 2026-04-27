/**
 * Tear-off reading card preview.
 *
 * Renders the current reading (question + cards + interpretation)
 * inside a portrait keepsake-shaped card, with Share / Download as
 * PNG and Download as PDF actions. The card is rendered to the DOM
 * (off-screen but in-flow so fonts/CSS variables resolve), captured
 * via html-to-image, and either copied/shared or written to PDF
 * with jsPDF.
 *
 * Designed to feel like a paper card you tear off the reading — soft
 * deckled edges, gold rules, monogram seal, perforated top stub.
 */
import { useEffect, useRef, useState } from "react";
import { Download, Image as ImageIcon, Loader2, Share2, X } from "lucide-react";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { getCurrentMoonPhase } from "@/lib/moon";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import type { InterpretationPayload } from "@/lib/interpret.functions";

/* ----------------------------------------------------------------- */
/*  Theme tokens — accent + paper background combinations             */
/* ----------------------------------------------------------------- */

type AccentKey = "gold" | "mystic" | "moonlight";
type PaperKey = "midnight" | "parchment" | "vellum";

type AccentTheme = {
  key: AccentKey;
  label: string;
  /** hex used in inline styles + html-to-image */
  color: string;
  swatch: string;
};

type PaperTheme = {
  key: PaperKey;
  label: string;
  /** card body background (gradient) */
  background: string;
  /** body text color */
  text: string;
  /** color used for the html-to-image canvas backdrop */
  canvas: string;
  swatch: string;
};

const ACCENT_THEMES: Record<AccentKey, AccentTheme> = {
  gold: { key: "gold", label: "Gold", color: "#d4af37", swatch: "#d4af37" },
  mystic: {
    key: "mystic",
    label: "Mystic",
    color: "#b497ff",
    swatch: "#b497ff",
  },
  moonlight: {
    key: "moonlight",
    label: "Moonlight",
    color: "#dfe6f5",
    swatch: "#dfe6f5",
  },
};

const PAPER_THEMES: Record<PaperKey, PaperTheme> = {
  midnight: {
    key: "midnight",
    label: "Midnight",
    background:
      "linear-gradient(180deg, #14102f 0%, #0f0c29 60%, #14102f 100%)",
    text: "#f5e9c8",
    canvas: "#0f0c29",
    swatch: "#14102f",
  },
  parchment: {
    key: "parchment",
    label: "Parchment",
    background:
      "linear-gradient(180deg, #f3e7c7 0%, #ead6a3 55%, #e2c98a 100%)",
    text: "#3a2a13",
    canvas: "#ead6a3",
    swatch: "#ead6a3",
  },
  vellum: {
    key: "vellum",
    label: "Vellum",
    background:
      "linear-gradient(180deg, #f7f3ea 0%, #ece5d3 55%, #e3dac1 100%)",
    text: "#2c2618",
    canvas: "#ece5d3",
    swatch: "#ece5d3",
  },
};

type Pick = { id: number; cardIndex: number };

export function TearOffCard({
  open,
  onOpenChange,
  question,
  spread,
  picks,
  positionLabels,
  interpretation,
  guideName,
  isOracle,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  question?: string;
  spread: SpreadMode;
  picks: Pick[];
  positionLabels: string[];
  interpretation: InterpretationPayload;
  guideName: string;
  isOracle: boolean;
}) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [busy, setBusy] = useState<null | "png" | "pdf" | "share">(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | null>(null);
  const [accentKey, setAccentKey] = useState<AccentKey>("gold");
  const [paperKey, setPaperKey] = useState<PaperKey>("midnight");
  const accent = ACCENT_THEMES[accentKey];
  const paper = PAPER_THEMES[paperKey];
  useEffect(
    () => () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
    },
    [],
  );

  const flash = (msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1800);
  };

  const meta = SPREAD_META[spread];
  const moonPhase = getCurrentMoonPhase().phase;
  const today = new Date().toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const positions = interpretation.positions.length
    ? interpretation.positions
    : picks.map((p, i) => ({
        position: positionLabels[i] ?? `Card ${i + 1}`,
        card: getCardName(p.cardIndex),
        interpretation: "",
      }));

  const renderToPng = async (): Promise<string | null> => {
    if (!cardRef.current) return null;
    // Render at 2x for a crisp share image.
    const dataUrl = await toPng(cardRef.current, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: paper.canvas,
    });
    return dataUrl;
  };

  const downloadDataUrl = (dataUrl: string, filename: string) => {
    const a = document.createElement("a");
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handlePng = async () => {
    try {
      setBusy("png");
      const dataUrl = await renderToPng();
      if (!dataUrl) return;
      downloadDataUrl(
        dataUrl,
        `moonseed-reading-${new Date().toISOString().slice(0, 10)}.png`,
      );
      flash("Card saved");
    } catch (e) {
      console.error("TearOffCard PNG failed:", e);
      flash("Couldn't save image");
    } finally {
      setBusy(null);
    }
  };

  const handlePdf = async () => {
    try {
      setBusy("pdf");
      const dataUrl = await renderToPng();
      if (!dataUrl) return;
      // Probe natural size so the PDF page matches the card aspect.
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("image load failed"));
        img.src = dataUrl;
      });
      // Convert px @ 2x → mm at 96dpi (1 in = 25.4 mm, 96 px = 1 in).
      const widthMm = (img.width / 2 / 96) * 25.4;
      const heightMm = (img.height / 2 / 96) * 25.4;
      const pdf = new jsPDF({
        orientation: heightMm >= widthMm ? "portrait" : "landscape",
        unit: "mm",
        format: [widthMm, heightMm],
        compress: true,
      });
      pdf.addImage(dataUrl, "PNG", 0, 0, widthMm, heightMm);
      pdf.save(
        `moonseed-reading-${new Date().toISOString().slice(0, 10)}.pdf`,
      );
      flash("PDF saved");
    } catch (e) {
      console.error("TearOffCard PDF failed:", e);
      flash("Couldn't save PDF");
    } finally {
      setBusy(null);
    }
  };

  const handleShare = async () => {
    try {
      setBusy("share");
      const dataUrl = await renderToPng();
      if (!dataUrl) return;
      // Convert dataURL → File for the Web Share API.
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File(
        [blob],
        `moonseed-reading-${new Date().toISOString().slice(0, 10)}.png`,
        { type: "image/png" },
      );
      const nav = navigator as Navigator & {
        canShare?: (data: ShareData) => boolean;
      };
      if (nav.canShare && nav.canShare({ files: [file] })) {
        await nav.share({
          files: [file],
          title: "Moonseed reading",
          text: question ? `“${question.trim()}”` : "A reading from Moonseed.",
        });
        flash("Shared");
      } else {
        // Fallback: download the image.
        downloadDataUrl(
          dataUrl,
          `moonseed-reading-${new Date().toISOString().slice(0, 10)}.png`,
        );
        flash("Saved (sharing not supported)");
      }
    } catch (e) {
      // User cancelling the share sheet throws AbortError — swallow it.
      if ((e as { name?: string })?.name !== "AbortError") {
        console.error("TearOffCard share failed:", e);
        flash("Couldn't share");
      }
    } finally {
      setBusy(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[420px] overflow-hidden border-gold/30 bg-cosmos p-0 sm:max-w-[460px]"
        style={{ borderRadius: 18 }}
      >
        <DialogHeader className="px-5 pt-5">
          <DialogTitle
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 18,
              color: "var(--gold)",
              letterSpacing: "0.06em",
            }}
          >
            {isOracle ? "A keepsake to carry" : "Tear-off card"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Save this reading as an image or PDF.
          </DialogDescription>
        </DialogHeader>

        {/* Scrollable preview area — the card itself is captured. */}
        <div
          className="px-5 pb-3"
          style={{ maxHeight: "60vh", overflow: "auto" }}
        >
          <CardArtwork
            ref={cardRef}
            question={question}
            spreadLabel={meta.label}
            spread={spread}
            moonPhase={moonPhase}
            today={today}
            picks={picks}
            positions={positions}
            overview={interpretation.overview}
            closing={interpretation.closing}
            guideName={guideName}
            isOracle={isOracle}
            accent={accent}
            paper={paper}
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-gold/15 bg-background/40 px-5 py-4">
          <ThemeControls
            accentKey={accentKey}
            paperKey={paperKey}
            onAccentChange={setAccentKey}
            onPaperChange={setPaperKey}
            disabled={busy !== null}
          />
          <div className="flex flex-wrap items-center justify-center gap-2">
            <ActionButton
              icon={<Share2 size={14} strokeWidth={1.5} />}
              label="Share"
              busy={busy === "share"}
              disabled={busy !== null}
              onClick={() => void handleShare()}
            />
            <ActionButton
              icon={<ImageIcon size={14} strokeWidth={1.5} />}
              label="PNG"
              busy={busy === "png"}
              disabled={busy !== null}
              onClick={() => void handlePng()}
            />
            <ActionButton
              icon={<Download size={14} strokeWidth={1.5} />}
              label="PDF"
              busy={busy === "pdf"}
              disabled={busy !== null}
              onClick={() => void handlePdf()}
            />
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close"
              className="ml-1 inline-flex items-center justify-center rounded-full p-2 text-muted-foreground transition-colors hover:bg-gold/10 hover:text-gold focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
            >
              <X size={14} strokeWidth={1.5} />
            </button>
          </div>
          {toast && (
            <div
              role="status"
              aria-live="polite"
              className="text-center text-[11px] uppercase tracking-[0.2em] text-gold/80"
            >
              {toast}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ActionButton({
  icon,
  label,
  busy,
  disabled,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  busy: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-gold/10 px-4 py-2 text-[11px] uppercase tracking-[0.22em] text-gold transition-colors hover:bg-gold/20 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
      style={{ fontFamily: "var(--font-display, var(--font-serif))" }}
    >
      {busy ? (
        <Loader2 size={14} strokeWidth={1.5} className="animate-spin" />
      ) : (
        icon
      )}
      <span>{label}</span>
    </button>
  );
}

function ThemeControls({
  accentKey,
  paperKey,
  onAccentChange,
  onPaperChange,
  disabled,
}: {
  accentKey: AccentKey;
  paperKey: PaperKey;
  onAccentChange: (k: AccentKey) => void;
  onPaperChange: (k: PaperKey) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <SwatchRow
        label="Accent"
        items={Object.values(ACCENT_THEMES)}
        activeKey={accentKey}
        onChange={(k) => onAccentChange(k as AccentKey)}
        disabled={disabled}
      />
      <SwatchRow
        label="Paper"
        items={Object.values(PAPER_THEMES)}
        activeKey={paperKey}
        onChange={(k) => onPaperChange(k as PaperKey)}
        disabled={disabled}
      />
    </div>
  );
}

function SwatchRow({
  label,
  items,
  activeKey,
  onChange,
  disabled,
}: {
  label: string;
  items: { key: string; label: string; swatch: string }[];
  activeKey: string;
  onChange: (k: string) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <span
        className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground"
        style={{ fontFamily: "var(--font-display, var(--font-serif))" }}
      >
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        {items.map((it) => {
          const active = it.key === activeKey;
          return (
            <button
              key={it.key}
              type="button"
              onClick={() => onChange(it.key)}
              disabled={disabled}
              aria-pressed={active}
              aria-label={`${label} ${it.label}`}
              title={it.label}
              className="relative h-6 w-6 rounded-full border transition-transform focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: it.swatch,
                borderColor: active
                  ? "var(--gold, #d4af37)"
                  : "color-mix(in oklab, white 25%, transparent)",
                boxShadow: active
                  ? "0 0 0 2px color-mix(in oklab, var(--gold, #d4af37) 35%, transparent)"
                  : "none",
                transform: active ? "scale(1.08)" : "scale(1)",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- */
/*  Card Artwork — the actual paper-style keepsake being captured.   */
/* ----------------------------------------------------------------- */

const CardArtwork = ({
  ref,
  question,
  spreadLabel,
  moonPhase,
  today,
  picks,
  positions,
  overview,
  closing,
  guideName,
  isOracle,
  accent,
  paper,
}: {
  ref: React.Ref<HTMLDivElement>;
  question?: string;
  spreadLabel: string;
  moonPhase: string;
  today: string;
  picks: Pick[];
  positions: { position: string; card: string; interpretation: string }[];
  overview: string;
  closing: string;
  guideName: string;
  isOracle: boolean;
  accent: AccentTheme;
  paper: PaperTheme;
}) => {
  const A = accent.color;
  const T = paper.text;
  return (
    <div
      ref={ref}
      style={{
        width: 380,
        margin: "0 auto",
        background: paper.background,
        color: T,
        fontFamily: "var(--font-serif, 'Cormorant Garamond', serif)",
        borderRadius: 14,
        boxShadow: `0 0 0 1px color-mix(in oklab, ${A} 28%, transparent), 0 18px 50px -20px color-mix(in oklab, ${A} 30%, transparent)`,
        padding: "22px 22px 26px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Inner deckled ruling */}
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 8,
          border: `1px solid color-mix(in oklab, ${A} 22%, transparent)`,
          borderRadius: 10,
          pointerEvents: "none",
        }}
      />

      {/* Stub / monogram */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 10,
          letterSpacing: "0.32em",
          textTransform: "uppercase",
          color: A,
          opacity: 0.85,
          marginBottom: 14,
        }}
      >
        <span>Moonseed</span>
        <span style={{ fontStyle: "italic", letterSpacing: "0.12em" }}>
          ✦
        </span>
        <span>{today}</span>
      </div>

      <div
        aria-hidden
        style={{
          height: 1,
          background: `linear-gradient(to right, transparent, color-mix(in oklab, ${A} 55%, transparent), transparent)`,
          marginBottom: 14,
        }}
      />

      {/* Question */}
      {question && question.trim() && (
        <div style={{ marginBottom: 14, textAlign: "center" }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: "0.28em",
              textTransform: "uppercase",
              color: A,
              opacity: 0.8,
              marginBottom: 4,
            }}
          >
            {isOracle ? "You whispered" : "Your question"}
          </div>
          <div
            style={{
              fontStyle: "italic",
              fontSize: 15,
              lineHeight: 1.55,
              color: T,
              opacity: 0.92,
              padding: "0 6px",
            }}
          >
            “{question.trim()}”
          </div>
        </div>
      )}

      {/* Cards row */}
      <div
        style={{
          display: "flex",
          gap: 8,
          justifyContent: "center",
          marginBottom: 14,
          flexWrap: "wrap",
        }}
      >
        {picks.slice(0, 5).map((p, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 4,
              maxWidth: 70,
            }}
          >
            <img
              src={getCardImagePath(p.cardIndex)}
              alt={getCardName(p.cardIndex)}
              crossOrigin="anonymous"
              style={{
                width: 60,
                height: 105,
                objectFit: "cover",
                borderRadius: 4,
                border: `1px solid color-mix(in oklab, ${A} 35%, transparent)`,
                boxShadow: `0 4px 14px -4px color-mix(in oklab, ${A} 25%, transparent)`,
              }}
            />
            <div
              style={{
                fontSize: 8,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                color: A,
                opacity: 0.75,
                textAlign: "center",
                lineHeight: 1.2,
              }}
            >
              {positions[i]?.position ?? `Card ${i + 1}`}
            </div>
            <div
              style={{
                fontSize: 10,
                fontStyle: "italic",
                color: T,
                opacity: 0.92,
                textAlign: "center",
                lineHeight: 1.25,
              }}
            >
              {getCardName(p.cardIndex)}
            </div>
          </div>
        ))}
      </div>

      {picks.length > 5 && (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 8,
            justifyContent: "center",
            marginBottom: 14,
          }}
        >
          {picks.slice(5).map((p, i) => (
            <div
              key={`extra-${i}`}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                maxWidth: 70,
              }}
            >
              <img
                src={getCardImagePath(p.cardIndex)}
                alt={getCardName(p.cardIndex)}
                crossOrigin="anonymous"
                style={{
                  width: 60,
                  height: 105,
                  objectFit: "cover",
                  borderRadius: 4,
                  border: `1px solid color-mix(in oklab, ${A} 35%, transparent)`,
                }}
              />
              <div
                style={{
                  fontSize: 8,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: A,
                  opacity: 0.75,
                  textAlign: "center",
                  lineHeight: 1.2,
                }}
              >
                {positions[i + 5]?.position ?? `Card ${i + 6}`}
              </div>
              <div
                style={{
                  fontSize: 10,
                  fontStyle: "italic",
                  color: T,
                  opacity: 0.92,
                  textAlign: "center",
                  lineHeight: 1.25,
                }}
              >
                {getCardName(p.cardIndex)}
              </div>
            </div>
          ))}
        </div>
      )}

      <div
        aria-hidden
        style={{
          height: 1,
          background: `linear-gradient(to right, transparent, color-mix(in oklab, ${A} 40%, transparent), transparent)`,
          marginBottom: 12,
        }}
      />

      {/* Overview */}
      {overview && (
        <p
          style={{
            fontStyle: "italic",
            fontSize: 12.5,
            lineHeight: 1.65,
            color: T,
            opacity: 0.94,
            margin: "0 0 12px",
            textAlign: "center",
          }}
        >
          {overview}
        </p>
      )}

      {/* Per-position */}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {positions.map((p, i) => (
          <li key={i} style={{ marginBottom: 10 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 8,
                marginBottom: 2,
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  color: A,
                  letterSpacing: "0.04em",
                  fontWeight: 600,
                }}
              >
                {p.card}
              </span>
              <span
                style={{
                  fontSize: 8,
                  color: A,
                  opacity: 0.7,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  fontStyle: "italic",
                }}
              >
                {p.position}
              </span>
            </div>
            {p.interpretation && (
              <p
                style={{
                  fontSize: 11.5,
                  lineHeight: 1.55,
                  color: T,
                  opacity: 0.88,
                  margin: 0,
                }}
              >
                {p.interpretation}
              </p>
            )}
          </li>
        ))}
      </ul>

      {closing && (
        <p
          style={{
            fontStyle: "italic",
            fontSize: 12,
            lineHeight: 1.6,
            color: T,
            opacity: 0.85,
            margin: "8px 0 0",
            textAlign: "center",
          }}
        >
          {closing}
        </p>
      )}

      <div
        aria-hidden
        style={{
          height: 1,
          background: `linear-gradient(to right, transparent, color-mix(in oklab, ${A} 40%, transparent), transparent)`,
          margin: "14px 0 10px",
        }}
      />

      {/* Footer chip */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          fontSize: 9,
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: A,
          opacity: 0.78,
        }}
      >
        <span>{spreadLabel}</span>
        <span style={{ fontStyle: "italic", letterSpacing: "0.1em" }}>
          {guideName}
        </span>
        <span>moon · {moonPhase}</span>
      </div>
    </div>
  );
};
