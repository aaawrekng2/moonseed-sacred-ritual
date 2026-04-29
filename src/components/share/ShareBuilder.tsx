/**
 * Share Builder — Phase 9.5a.
 *
 * Replaces the old TearOffCard dialog. Single screen with a live
 * preview on top and controls below:
 *   - Five level icons (only those available for the current context
 *     are shown; per-context smart defaults set the initial level)
 *   - Color chip (collapsing row, see ColorChipSelector)
 *   - Content toggles (question / interpretation snippet, Levels 1 + 2)
 *   - Share + Save image actions (plain text, no pills)
 *
 * The preview is the SAME DOM that gets captured for the PNG. The
 * preview wrapper applies a CSS scale so the on-screen size fits the
 * dialog while the captured image is the true 1080x1920.
 *
 * Per-context Levels 3/4/5 require extra inputs that travel via the
 * `extras` prop (`positionIndex`, `lens`, `artifactText`). The builder
 * is permissive: any level whose extras are missing is auto-pruned
 * from `availableLevels` so the selector can never enter a broken state.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Eye, Layers, Quote, Sparkles, Star, X } from "lucide-react";
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
import { Level3SpreadPosition } from "./levels/Level3SpreadPosition";
import { Level4DeepLens, type DeepLensSelection } from "./levels/Level4DeepLens";
import { Level5MirrorArtifact } from "./levels/Level5MirrorArtifact";
import { SHARE_CARD_H, SHARE_CARD_W } from "./levels/share-card-shared";
import { useShareCard } from "./useShareCard";
import { useShareColor } from "./use-share-color";
import { useLastShareLevel } from "./use-last-share-level";
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
  position: { id: "position", label: "Position", icon: Quote,    captureBackground: "#07070d" },
  lens:     { id: "lens",     label: "Lens",     icon: Eye,      captureBackground: "#050509" },
  artifact: { id: "artifact", label: "Artifact", icon: Star,     captureBackground: "#0c0a08" },
};

/**
 * Per-context inputs only certain levels need. Each is optional; a level
 * whose required extra is missing is auto-pruned from the level selector.
 */
export type ShareBuilderExtras = {
  /** Level 3 — which position from the spread to feature. */
  positionIndex?: number;
  /** Level 4 — the specific lens (label + body) to feature. */
  lens?: DeepLensSelection;
  /** Level 5 — the mirror artifact text. */
  artifactText?: string;
};

export function ShareBuilder({
  open,
  onOpenChange,
  context,
  defaultLevel = "reading",
  /**
   * Caller-declared list of levels meaningful for the current screen.
   * Levels missing the required `extras` field are auto-removed.
   */
  availableLevels = ["pull", "reading"],
  extras,
  /**
   * When true, the user's persisted `last_share_level` overrides
   * `defaultLevel` (still subject to enabledLevels). Use false when
   * the caller has a specific intent (e.g. per-position share opens
   * Position; lens share opens Lens) so the click target wins.
   */
  honorLastLevel = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  context: ShareContext;
  defaultLevel?: ShareLevel;
  availableLevels?: ShareLevel[];
  extras?: ShareBuilderExtras;
  honorLastLevel?: boolean;
}) {
  const { color: colorId, setColor } = useShareColor();
  const color = getShareColor(colorId);
  const { lastLevel, remember } = useLastShareLevel();

  // Auto-prune levels whose required extras aren't supplied.
  const enabledLevels = useMemo<ShareLevel[]>(() => {
    return availableLevels.filter((id) => {
      switch (id) {
        case "position":
          // Position is available whenever the spread has >1 position.
          // The builder maintains its own selection (see localPositionIndex
          // below), so extras.positionIndex is only an initial hint.
          return context.positionLabels.length > 1 && context.picks.length > 1;
        case "lens":
          return !!extras?.lens && extras.lens.body.trim().length > 0;
        case "artifact":
          return !!extras?.artifactText && extras.artifactText.trim().length > 0;
        case "pull":
          return context.picks.length > 0;
        case "reading":
        default:
          return true;
      }
    });
    // availableLevels intentionally compared by reference identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableLevels, extras, context.picks.length, context.positionLabels.length]);

  const preferred: ShareLevel =
    honorLastLevel && lastLevel && enabledLevels.includes(lastLevel)
      ? lastLevel
      : defaultLevel;
  const initialLevel: ShareLevel = enabledLevels.includes(preferred)
    ? preferred
    : enabledLevels[0] ?? "reading";

  const [level, setLevel] = useState<ShareLevel>(initialLevel);
  // Re-sync if the host swaps to a different reading mid-flight.
  useEffect(() => {
    if (!open) return;
    setLevel(initialLevel);
    // initialLevel is derived from open + defaultLevel + enabledLevels.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultLevel, enabledLevels]);

  // Remember every explicit user level switch (not the auto-resync above).
  const handlePickLevel = (id: ShareLevel) => {
    setLevel(id);
    remember(id);
  };

  // Builder-owned position selector for Level 3 (Fix 2).
  const [localPositionIndex, setLocalPositionIndex] = useState<number>(
    extras?.positionIndex ?? 0,
  );
  useEffect(() => {
    if (typeof extras?.positionIndex === "number") {
      setLocalPositionIndex(extras.positionIndex);
    }
  }, [extras?.positionIndex, open]);

  const [includeQuestion, setIncludeQuestion] = useState<boolean>(false);
  const [includeInterpretation, setIncludeInterpretation] = useState<boolean>(true);

  // Smart toggle defaults per level.
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

  // Scale 1080x1920 down to fit the dialog preview.
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
      case "position":
        return (
          <Level3SpreadPosition
            ctx={context}
            color={color}
            positionIndex={localPositionIndex}
          />
        );
      case "lens":
        // enabledLevels guarantees extras.lens exists when level === 'lens'.
        return (
          <Level4DeepLens
            ctx={context}
            color={color}
            lens={extras!.lens!}
          />
        );
      case "artifact":
        return (
          <Level5MirrorArtifact
            ctx={context}
            color={color}
            artifactText={extras?.artifactText ?? ""}
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
          className="fixed left-[50%] top-[50%] z-50 flex w-full max-w-[440px] translate-x-[-50%] translate-y-[-50%] flex-col gap-0 overflow-hidden border duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          style={{
            background: "var(--surface-overlay)",
            borderColor: "var(--border-default)",
            borderRadius: 18,
            maxHeight: "calc(100vh - 32px)",
            overflow: "hidden",
          }}
        >
          <DialogHeader
            style={{
              padding: "var(--space-5) var(--space-5) var(--space-3)",
              display: "flex",
              flexDirection: "row",
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: "var(--space-3)",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <DialogTitle
                style={{
                  fontFamily: "var(--font-serif)",
                  fontStyle: "italic",
                  fontSize: "var(--text-heading-sm)",
                  color: "var(--accent)",
                  letterSpacing: "0.05em",
                  opacity: 1,
                }}
              >
                Share
              </DialogTitle>
              <DialogDescription
                style={{
                  fontSize: "var(--text-caption)",
                  color: "var(--color-foreground)",
                  opacity: 0.85,
                }}
              >
                Pick a style, tune what's included, then share or save.
              </DialogDescription>
            </div>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close share"
              style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                color: "var(--color-foreground)",
                opacity: 0.7,
                padding: 4,
                marginTop: 2,
                lineHeight: 0,
              }}
            >
              <X size={20} strokeWidth={1.5} />
            </button>
          </DialogHeader>

          {/* Live preview */}
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

          {/* Controls (scrollable on small screens) */}
          <div
            style={{
              padding: "var(--space-3) var(--space-5) var(--space-5)",
              borderTop: "1px solid var(--border-subtle)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-4)",
              background: "var(--surface-card)",
              overflowY: "auto",
            }}
          >
            {/* Level selector */}
            {enabledLevels.length > 1 && (
              <div
                style={{
                  display: "flex",
                  gap: "var(--space-3)",
                  justifyContent: "center",
                  flexWrap: "wrap",
                }}
              >
                {enabledLevels.map((id) => {
                  const spec = LEVEL_SPECS[id];
                  const Icon = spec.icon;
                  const active = id === level;
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => handlePickLevel(id)}
                      aria-pressed={active}
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        gap: "var(--space-1)",
                        padding: "var(--space-2) var(--space-3)",
                        background: active
                          ? "color-mix(in oklab, var(--accent) 14%, transparent)"
                          : "transparent",
                        borderRadius: 10,
                        border: "none",
                        cursor: "pointer",
                        color: active ? "var(--accent)" : "var(--color-foreground)",
                        opacity: active ? 1 : 0.7,
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
            )}

            {/* Position selector (Level 3) */}
            {level === "position" && context.positionLabels.length > 1 && (
              <div
                style={{
                  display: "flex",
                  gap: 8,
                  justifyContent: "center",
                  flexWrap: "wrap",
                }}
              >
                {context.positionLabels.map((label, idx) => {
                  const active = idx === localPositionIndex;
                  return (
                    <button
                      key={`${label}-${idx}`}
                      type="button"
                      onClick={() => setLocalPositionIndex(idx)}
                      aria-pressed={active}
                      style={{
                        padding: "6px 12px",
                        background: active
                          ? "color-mix(in oklab, var(--accent) 14%, transparent)"
                          : "transparent",
                        color: active ? "var(--accent)" : "var(--color-foreground)",
                        opacity: active ? 1 : 0.6,
                        border: "none",
                        borderRadius: 8,
                        cursor: "pointer",
                        fontFamily: "var(--font-sans)",
                        fontSize: "var(--text-caption)",
                        textTransform: "uppercase",
                        letterSpacing: "0.15em",
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* Toggles (Levels 1 + 2 only) */}
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
