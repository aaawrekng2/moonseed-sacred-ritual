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
import { Download, Image as ImageIcon, Loader2, Share2 } from "lucide-react";
import { toPng } from "html-to-image";
import { jsPDF } from "jspdf";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { getCardImagePath, getCardName } from "@/lib/tarot";
import { getCurrentMoonPhase } from "@/lib/moon";
import { SPREAD_META, type SpreadMode } from "@/lib/spreads";
import type { InterpretationPayload } from "@/lib/interpret.functions";

/* ----------------------------------------------------------------- */
/*  Preset color schemes — 10 curated palettes that set bg/surface   */
/*  /text/accent in one tap. Replaces the accent + paper pickers.    */
/* ----------------------------------------------------------------- */

type PresetKey =
  | "midnight-oracle"
  | "golden-dawn"
  | "blood-moon"
  | "verdant-arcana"
  | "amethyst-veil"
  | "deep-tide"
  | "candlelight-ritual"
  | "rose-sigil"
  | "bone-ink"
  | "cosmic-dust";

type Preset = {
  key: PresetKey;
  label: string;
  bg: string;
  surface: string;
  text: string;
  accent: string;
};

const PRESETS: Preset[] = [
  { key: "midnight-oracle",    label: "Midnight Oracle",    bg: "#0B0B0F", surface: "#16161D", text: "#EAEAF0", accent: "#C8A96A" },
  { key: "golden-dawn",        label: "Golden Dawn",        bg: "#F6F1E9", surface: "#FFFFFF", text: "#2B2B2B", accent: "#D4AF37" },
  { key: "blood-moon",         label: "Blood Moon",         bg: "#140A0A", surface: "#1F1212", text: "#F5EAEA", accent: "#B23A3A" },
  { key: "verdant-arcana",     label: "Verdant Arcana",     bg: "#0E1A14", surface: "#16241C", text: "#E6F2EC", accent: "#5FAF8F" },
  { key: "amethyst-veil",      label: "Amethyst Veil",      bg: "#120F1A", surface: "#1D1828", text: "#EEE9F7", accent: "#9B7EDC" },
  { key: "deep-tide",          label: "Deep Tide",          bg: "#0A1620", surface: "#132330", text: "#E4F1F8", accent: "#4DA3C9" },
  { key: "candlelight-ritual", label: "Candlelight Ritual", bg: "#1A140F", surface: "#241C16", text: "#F3EDE6", accent: "#E0B36A" },
  { key: "rose-sigil",         label: "Rose Sigil",         bg: "#1A0F14", surface: "#26161D", text: "#F7E8EE", accent: "#D17A92" },
  { key: "bone-ink",           label: "Bone & Ink",         bg: "#F4F1EC", surface: "#FFFFFF", text: "#1F1F1F", accent: "#3A3A3A" },
  { key: "cosmic-dust",        label: "Cosmic Dust",        bg: "#0A0C14", surface: "#151927", text: "#E8ECF8", accent: "#7F8CEB" },
];

const PRESET_BY_KEY: Record<PresetKey, Preset> = PRESETS.reduce(
  (acc, p) => {
    acc[p.key] = p;
    return acc;
  },
  {} as Record<PresetKey, Preset>,
);

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
  const [presetKey, setPresetKey] = useState<PresetKey>("midnight-oracle");
  const preset = PRESET_BY_KEY[presetKey];
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
      backgroundColor: preset.bg,
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
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay
          className={cn(
            "fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
          )}
        />
        <DialogPrimitive.Content
          className="fixed left-[50%] top-[50%] z-50 grid w-full max-w-[420px] translate-x-[-50%] translate-y-[-50%] gap-4 overflow-hidden border border-gold/30 bg-cosmos p-0 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 sm:max-w-[460px]"
          style={{ borderRadius: 18 }}
        >
        <DialogHeader className="px-5 pt-5">
          <DialogTitle
            style={{
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: "var(--text-body-lg)",
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
            preset={preset}
          />
        </div>

        <div className="flex flex-col gap-2 border-t border-gold/15 bg-background/40 px-5 py-4">
          <PresetGrid
            activeKey={presetKey}
            onChange={setPresetKey}
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
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
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

/**
 * Preset palette picker — 10 named swatches the seeker can tap. Each
 * preset rewrites bg / surface / text / accent in one go (no granular
 * accent + paper picker any more).
 */
function PresetGrid({
  activeKey,
  onChange,
  disabled,
}: {
  activeKey: PresetKey;
  onChange: (k: PresetKey) => void;
  disabled: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span
        className="text-[10px] uppercase tracking-[0.22em] text-muted-foreground"
        style={{ fontFamily: "var(--font-display, var(--font-serif))" }}
      >
        Color scheme
      </span>
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: "repeat(5, minmax(0, 1fr))" }}
      >
        {PRESETS.map((p) => {
          const active = p.key === activeKey;
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => onChange(p.key)}
              disabled={disabled}
              aria-pressed={active}
              aria-label={p.label}
              title={p.label}
              className="group relative flex flex-col items-center gap-1 rounded-md p-1 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 disabled:cursor-not-allowed disabled:opacity-50"
              style={{
                background: active
                  ? "color-mix(in oklab, var(--gold) 10%, transparent)"
                  : "transparent",
              }}
            >
              <span
                aria-hidden
                className="block h-6 w-full rounded-md border"
                style={{
                  background: `linear-gradient(135deg, ${p.bg} 0%, ${p.surface} 60%, ${p.accent} 100%)`,
                  borderColor: active
                    ? "var(--gold, #d4af37)"
                    : "color-mix(in oklab, white 18%, transparent)",
                  boxShadow: active
                    ? "0 0 0 1px color-mix(in oklab, var(--gold, #d4af37) 45%, transparent)"
                    : "none",
                }}
              />
              <span
                className="block w-full text-center"
                style={{
                  fontSize: "var(--text-body)",
                  letterSpacing: "0.06em",
                  lineHeight: 1.15,
                  color: active ? "var(--gold)" : "var(--muted-foreground)",
                  fontFamily: "var(--font-display, var(--font-serif))",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {p.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ----------------------------------------------------------------- */
/*  Card Artwork — the actual paper-style keepsake being captured.   */
/* ----------------------------------------------------------------- */

/**
 * Celtic Cross spatial layout for the tear-off keepsake.
 *
 * The classic 10-card Celtic Cross has a central cross of 6 cards plus
 * a staff of 4 cards stacked to the right:
 *
 *           [5]
 *      [4] [1/2] [6]
 *           [3]                 [10]
 *                               [9]
 *                               [8]
 *                               [7]
 *
 * Positions in our SPREAD_META:
 *   0 The Present (center)
 *   1 The Challenge (crosses the center, rotated 90°)
 *   2 The Foundation (below center)
 *   3 The Past (left of center)
 *   4 The Goal (above center)
 *   5 Near Future (right of center)
 *   6-9 The staff (Self → Outcome, bottom-up)
 */
function CelticCrossLayout({
  picks,
  positions,
  accent,
  text,
}: {
  picks: Pick[];
  positions: { position: string; card: string; interpretation: string }[];
  accent: string;
  text: string;
}) {
  // Celtic Cross — central cross of 6 cards (positions 0–5) with a
  // vertical staff of 4 cards (6–9) running up the right side. Sized
  // up ~40% so the arrangement reads clearly on the keepsake.
  const W = 58;
  const H = Math.round(W * 1.75);
  void text;
  const card = (idx: number, opts?: { rotate?: number }) => {
    const p = picks[idx];
    if (!p) return null;
    return (
      <img
        src={getCardImagePath(p.cardIndex)}
        alt={getCardName(p.cardIndex)}
        crossOrigin="anonymous"
        style={{
          width: W,
          height: H,
          objectFit: "cover",
          borderRadius: 3,
          border: `1px solid oklch(1 0 0 / 0.10)`,
          boxShadow: `0 3px 10px -4px color-mix(in oklab, ${accent} 25%, transparent)`,
          transform: opts?.rotate ? `rotate(${opts.rotate}deg)` : undefined,
          transformOrigin: "center",
          background: "rgba(0,0,0,0.2)",
        }}
      />
    );
  };
  // Cross block: 3 columns × 3 rows. Center cell holds card 1 with
  // card 2 rotated on top of it.
  return (
    <div
      style={{
        display: "flex",
        gap: 18,
        justifyContent: "center",
        alignItems: "center",
        marginBottom: 14,
      }}
    >
      {/* Cross */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `${W}px ${W}px ${W}px`,
          gridTemplateRows: `${H}px ${H}px ${H}px`,
          rowGap: 6,
          columnGap: 6,
          alignItems: "center",
          justifyItems: "center",
        }}
      >
        {/* row 1: empty, Goal (5), empty */}
        <div />
        <div>{card(4)}</div>
        <div />
        {/* row 2: Past (4), Center (1) + Challenge (2 rotated), Future (6) */}
        <div>{card(3)}</div>
        <div style={{ position: "relative" }}>
          {card(0)}
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            {card(1, { rotate: 90 })}
          </div>
        </div>
        <div>{card(5)}</div>
        {/* row 3: empty, Foundation (3), empty */}
        <div />
        <div>{card(2)}</div>
        <div />
      </div>
      {/* Staff: 7 (bottom) → 10 (top) */}
      <div
        style={{
          display: "flex",
          flexDirection: "column-reverse",
          gap: 4,
        }}
      >
        {[6, 7, 8, 9].map((i) => (
          <div key={i}>{card(i)}</div>
        ))}
      </div>
    </div>
  );
}

const CardArtwork = ({
  ref,
  question,
  spreadLabel,
  spread,
  moonPhase,
  today,
  picks,
  positions,
  overview,
  closing,
  guideName,
  isOracle,
  preset,
}: {
  ref: React.Ref<HTMLDivElement>;
  question?: string;
  spreadLabel: string;
  spread: SpreadMode;
  moonPhase: string;
  today: string;
  picks: Pick[];
  positions: { position: string; card: string; interpretation: string }[];
  overview: string;
  closing: string;
  guideName: string;
  isOracle: boolean;
  preset: Preset;
}) => {
  const A = preset.accent;
  const T = preset.text;
  const SURFACE = preset.surface;
  void spreadLabel;
  const isThree = spread === "three";
  const isCeltic = spread === "celtic";
  // Card dimensions tuned to the keepsake card width (CARD_W = 380, with
  // ~22px side padding → ~336 inner). For 3-card we now fill the full
  // width with a small equal buffer so the cards feel substantial.
  const INNER_W = 336;
  let cardW: number;
  if (isThree) {
    // Three cards across with 10px gaps + 4px breathing buffer per side.
    const gaps = 2 * 10;
    const sideBuffer = 2 * 4;
    cardW = Math.floor((INNER_W - gaps - sideBuffer) / 3); // ≈ 102
  } else if (isCeltic) {
    cardW = 0; // unused — celtic uses its own sizing
  } else {
    cardW = 96;
  }
  const cardH = Math.round(cardW * 1.75);
  return (
    <div
      ref={ref}
      style={{
        width: 380,
        margin: "0 auto",
        background: `linear-gradient(180deg, ${preset.bg} 0%, ${SURFACE} 60%, ${preset.bg} 100%)`,
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
          border: `1px solid oklch(1 0 0 / 0.08)`,
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
          fontSize: "var(--text-body-sm)",
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
              fontSize: "var(--text-body-sm)",
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
              fontSize: "var(--text-body)",
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
      {isCeltic ? (
        <CelticCrossLayout
          picks={picks}
          positions={positions}
          accent={A}
          text={T}
        />
      ) : (
        <div
          style={{
            display: "flex",
            gap: 10,
            justifyContent: "center",
            marginBottom: 16,
            flexWrap: "nowrap",
            paddingLeft: 4,
            paddingRight: 4,
          }}
        >
          {picks.map((p, i) => (
            <div
              key={i}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                maxWidth: cardW + 12,
                flex: "0 0 auto",
              }}
            >
              <img
                src={getCardImagePath(p.cardIndex)}
                alt={getCardName(p.cardIndex)}
                crossOrigin="anonymous"
                style={{
                  width: cardW,
                  height: cardH,
                  objectFit: "cover",
                  borderRadius: 6,
                  border: `1px solid oklch(1 0 0 / 0.10)`,
                  boxShadow: `0 4px 14px -4px color-mix(in oklab, ${A} 25%, transparent)`,
                }}
              />
              <div
                style={{
                  fontSize: "var(--text-body)",
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  color: A,
                  opacity: 0.92,
                  textAlign: "center",
                  lineHeight: 1.25,
                  fontWeight: 600,
                }}
              >
                {positions[i]?.position ?? `Card ${i + 1}`}
              </div>
              <div
                style={{
                  fontSize: "var(--text-body)",
                  fontStyle: "italic",
                  color: T,
                  opacity: 0.92,
                  textAlign: "center",
                  lineHeight: 1.3,
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
            fontSize: "var(--text-body-lg)",
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
                  fontSize: "var(--text-body)",
                  color: A,
                  letterSpacing: "0.04em",
                  fontWeight: 600,
                }}
              >
                {p.card}
              </span>
              <span
                style={{
                  fontSize: "var(--text-body)",
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
                  fontSize: "var(--text-body)",
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
            fontSize: "var(--text-body)",
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

      {/* Footer chip — three centered rows so they don't collide on mobile */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 4,
          fontSize: "var(--text-body-sm)",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: A,
          opacity: 0.78,
        }}
      >
        {positions.length > 1 && (
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              textAlign: "center",
            }}
          >
            <span>{positions.map((p) => p.position).join(" · ")}</span>
          </div>
        )}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            textAlign: "center",
          }}
        >
          <span style={{ fontStyle: "italic", letterSpacing: "0.1em" }}>
            {guideName}
          </span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            textAlign: "center",
          }}
        >
          <span>moon · {moonPhase}</span>
        </div>
      </div>
    </div>
  );
};
