/**
 * Share Builder — Phase 9.5a.
 *
 * Replaces the old TearOffCard dialog. Single screen with a live
 * preview on top and controls below:
 *   - Five level icons (only those available for the current context
 *     are shown; this slice ships Levels 1 + 2 only)
 *   - Color chip (collapsing row, see ColorChipSelector)
 *   - Content toggles (question / interpretation snippet, Level 2 only)
 *   - Share + Save image actions (plain text, no pills)
 *
 * The preview is the SAME DOM that gets captured for the PNG. The
 * preview wrapper applies a CSS scale so the on-screen size fits the
 * dialog while the captured image is the true 1080x1920.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Layers, Sparkles } from "lucide-react";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { ColorChipSelector } from "./ColorChipSelector";
import { Level1SinglePull } from "./levels/Level1SinglePull";
import { Level2FullReading } from "./levels/Level2FullReading";
import {
  SHARE_CARD_H,
  SHARE_CARD_W,
} from "./levels/share-card-shared";
import { useShareCard } from "./useShareCard";
import { useShareColor } from "./use-share-color";
import {
  getShareColor,
  type ShareContext,
  type ShareLevel,
} from "./share-types";

type LevelSpec = {
  id: ShareLevel;
  label: string;
  icon: typeof Sparkles;
  /** Background color used when capturing the PNG. */
  captureBackground: string;
};

const LEVEL_SPECS: Record<ShareLevel, LevelSpec> = {
  pull:     { id: "pull",     label: "Pull",     icon: Sparkles, captureBackground: "#06060c" },
  reading:  { id: "reading",  label: "Reading",  icon: Layers,   captureBackground: "#07070d" },
  position: { id: "position", label: "Position", icon: Layers,   captureBackground: "#07070d" },
  lens:     { id: "lens",     label: "Lens",     icon: Layers,   captureBackground: "#07070d" },
  artifact: { id: "artifact", label: "Artifact", icon: Layers,   captureBackground: "#0a0a0f" },
};

export function ShareBuilder({
  open,
  onOpenChange,
  context,
  /** Smart default level the builder opens at. User can switch from there. */
  defaultLevel = "reading",
  /**
   * Levels shown in the level selector. Defaults to the two implemented
   * in this slice (1 + 2). Future phases will widen this set.
   */
  availableLevels = ["pull", "reading"],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: ShareContext;
  defaultLevel?: ShareLevel;
  availableLevels?: ShareLevel[];
}) {
  const { color: colorId, setColor } = useShareColor();
  const color = getShareColor(colorId);

  const [level, setLevel] = useState<ShareLevel>(() =>
    availableLevels.includes(defaultLevel) ? defaultLevel : availableLevels[0],
  );
  // Re-sync if the host swaps to a different reading mid-flight.
  useEffect(() => {
    if (!open) return;
    setLevel(
      availableLevels.includes(defaultLevel) ? defaultLevel : availableLevels[0],
    );
    // availableLevels intentionally compared by identity — tightly held by callers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultLevel]);

  const [includeQuestion, setIncludeQuestion] = useState<boolean>(false);
  const [includeInterpretation, setIncludeInterpretation] = useState<boolean>(true);

  // Smart defaults per level (matches the spec).
  useEffect(() => {
    if (level === "pull") {
      setIncludeQuestion(!!context.question?.trim());
      setIncludeInterpretation(false);
    } else if (level === "reading") {
      setIncludeQuestion(false);
      setIncludeInterpretation(true);
    }
  }, [level, context.question]);

  const captureRef = useRef<HTMLDivElement | null>(null);
  const { busy, toast, share, save } = useShareCard();

  // Scale the 1080x1920 capture node down to fit the dialog preview.
  const PREVIEW_MAX_W = 280;
  const PREVIEW_MAX_H = 480;
  const scale = Math.min(PREVIEW_MAX_W / SHARE_CARD_W, PREVIEW_MAX_H / SHARE_CARD_H);
  const previewWidth = Math.round(SHARE_CARD_W * scale);
  const previewHeight = Math.round(SHARE_CARD_H * scale);

  const captureBackground = useMemo(() => LEVEL_SPECS[level].captureBackground, [level]);

  const renderLevel = () => {
    switch (level) {
      case "pull":
        return (
          <Level1SinglePull
            ctx={context}
            color={color}
            includeQuestion={includeQuestion}
          />
        );
      case "reading":
      default:
        return (
          <Level2FullReading
            ctx={context}
            color={color}
            includeQuestion={includeQuestion}
            includeInterpretation={includeInterpretation}
          />
        );
    }
  };

  const handleShare = () => {
    if (!captureRef.current) return;
    void share(captureRef.current, captureBackground);
  };
  const handleSave = () => {
    if (!captureRef.current) return;
    void save(captureRef.current, captureBackground);
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
          className="fixed left-[50%] top-[50%] z-50 flex w-full max-w-[420px] translate-x-[-50%] translate-y-[-50%] flex-col gap-0 overflow-hidden border duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          style={{
            background: "var(--surface-overlay)",
            borderColor: "var(--border-default)",
            borderRadius: 18,
          }}
        >
          <DialogHeader
            style={{
              padding: "var(--space-5) var(--space-5) var(--space-3)",
            }}
          >
            <DialogTitle
              style={{
                fontFamily: "var(--font-serif)",
                fontStyle: "italic",
                fontSize: "var(--text-heading-sm)",
                color: "var(--accent)",
                letterSpacing: "0.05em",
              }}
            >
              Share
            </DialogTitle>
            <DialogDescription
              style={{
                fontSize: "var(--text-caption)",
                color: "var(--color-foreground)",
                opacity: 0.6,
              }}
            >
              Pick a style, tune what's included, then share or save.
            </DialogDescription>
          </DialogHeader>

          {/* Live preview — same DOM that gets captured. */}
          <div
            style={{
              padding: "var(--space-3) var(--space-5)",
              display: "flex",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: previewWidth,
                height: previewHeight,
                position: "relative",
                overflow: "hidden",
                borderRadius: 12,
                border: "1px solid var(--border-default)",
              }}
            >
              <div
                style={{
                  width: SHARE_CARD_W,
                  height: SHARE_CARD_H,
                  transform: `scale(${scale})`,
                  transformOrigin: "top left",
                }}
              >
                <div ref={captureRef}>{renderLevel()}</div>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div
            style={{
              padding: "var(--space-3) var(--space-5) var(--space-5)",
              borderTop: "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
              background: "var(--surface-card)",
            }}
          >
            {/* Level selector */}
            <div style={{ display: "flex", gap: "var(--space-3)", justifyContent: "center" }}>
              {availableLevels.map((id) => {
                const spec = LEVEL_SPECS[id];
                const Icon = spec.icon;
                const active = id === level;
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setLevel(id)}
                    aria-pressed={active}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "var(--space-1)",
                      padding: "var(--space-2) var(--space-3)",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      color: active
                        ? "var(--accent)"
                        : "var(--color-foreground)",
                      opacity: active ? 1 : 0.55,
                      fontFamily: "var(--font-sans)",
                      fontSize: "var(--text-caption)",
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                    }}
                  >
                    <Icon size={18} strokeWidth={1.5} />
                    <span>{spec.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Toggles (Level 2 only for this slice) */}
            {level === "reading" && (
              <div
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "var(--space-2)",
                  justifyContent: "center",
                }}
              >
                {!!context.question?.trim() && (
                  <ToggleChip
                    active={includeQuestion}
                    onClick={() => setIncludeQuestion((v) => !v)}
                    label="Question"
                  />
                )}
                <ToggleChip
                  active={includeInterpretation}
                  onClick={() => setIncludeInterpretation((v) => !v)}
                  label="Interpretation"
                />
              </div>
            )}
            {level === "pull" && !!context.question?.trim() && (
              <div style={{ display: "flex", justifyContent: "center" }}>
                <ToggleChip
                  active={includeQuestion}
                  onClick={() => setIncludeQuestion((v) => !v)}
                  label="Question"
                />
              </div>
            )}

            {/* Color chip */}
            <div style={{ display: "flex", justifyContent: "center" }}>
              <ColorChipSelector value={colorId} onChange={setColor} />
            </div>

            {/* Actions — plain text, no pills */}
            <div
              style={{
                display: "flex",
                gap: "var(--space-5)",
                justifyContent: "center",
                paddingTop: "var(--space-1)",
              }}
            >
              <PlainAction
                label={busy === "share" ? "Sharing…" : "Share"}
                onClick={handleShare}
                disabled={busy !== null}
              />
              <PlainAction
                label={busy === "save" ? "Saving…" : "Save image"}
                onClick={handleSave}
                disabled={busy !== null}
              />
            </div>
            {toast && (
              <div
                role="status"
                aria-live="polite"
                style={{
                  textAlign: "center",
                  fontSize: "var(--text-caption)",
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: "var(--accent)",
                  opacity: 0.85,
                }}
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

function ToggleChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{
        background: "transparent",
        border: `1px solid ${active ? "var(--accent)" : "var(--border-default)"}`,
        color: active ? "var(--accent)" : "var(--color-foreground)",
        opacity: active ? 1 : 0.6,
        padding: "var(--space-1) var(--space-3)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-caption)",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function PlainAction({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        background: "transparent",
        border: "none",
        padding: "var(--space-2) var(--space-1)",
        color: "var(--accent)",
        fontFamily: "var(--font-sans)",
        fontSize: "var(--text-body-sm)",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}
