/**
 * EJ46 — Movable dev chip.
 *
 * A small draggable HUD with two toggles, visible only to admins:
 *   • Dev mode — mirrors the localStorage `tarotseed:dev_mode` flag
 *     used by DevOverlay and CardImage. Master switch.
 *   • Slot debug colors — when dev mode is on, suppress the saturated
 *     debug colors in CardImage (green wrapper, red img tint, yellow
 *     empty, magenta loading, orange back outline). Hidden when dev
 *     mode itself is off.
 *
 * Position persists to localStorage. Drag the chip by its grip to
 * move it; double-tap the grip to reset to the default corner.
 */
import { useEffect, useRef, useState } from "react";
import { GripVertical } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import { readDevSlotColors, setDevMode, setDevSlotColors } from "@/components/dev/DevOverlay";

const DEV_MODE_KEY = "tarotseed:dev_mode";
const DEV_EVENT = "tarotseed:dev-mode-changed";
const DEV_SLOT_COLORS_KEY = "tarotseed:dev_slot_colors";
const DEV_SLOT_COLORS_EVENT = "tarotseed:dev-slot-colors-changed";
const CHIP_POS_KEY = "tarotseed:dev_chip_pos";

type Pos = { x: number; y: number };

function readPos(): Pos {
  if (typeof window === "undefined") return { x: 16, y: 64 };
  try {
    const raw = window.localStorage.getItem(CHIP_POS_KEY);
    if (!raw) return { x: 16, y: 64 };
    const parsed = JSON.parse(raw) as Pos;
    if (
      typeof parsed?.x === "number" &&
      Number.isFinite(parsed.x) &&
      typeof parsed?.y === "number" &&
      Number.isFinite(parsed.y)
    ) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return { x: 16, y: 64 };
}

function writePos(p: Pos): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHIP_POS_KEY, JSON.stringify(p));
  } catch {
    // quota / private mode — ignore
  }
}

function readDevMode(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(DEV_MODE_KEY) === "true";
}

export function DevChip() {
  const { user, loading } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [devOn, setDevOn] = useState<boolean>(() => readDevMode());
  const [slotColorsOn, setSlotColorsOn] = useState<boolean>(() => readDevSlotColors());
  const [pos, setPos] = useState<Pos>(() => readPos());
  const draggingRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
  } | null>(null);

  // Resolve admin role; the chip never renders for non-admins.
  useEffect(() => {
    if (loading) return;
    if (!user) {
      setIsAdmin(false);
      return;
    }
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      const role = (data as { role?: string } | null)?.role;
      setIsAdmin(role === "admin" || role === "super_admin");
    })();
    return () => {
      cancelled = true;
    };
  }, [user, loading]);

  // Subscribe to live updates from the two flags.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onDev = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setDevOn(typeof detail === "boolean" ? detail : readDevMode());
    };
    const onSlot = (e: Event) => {
      const detail = (e as CustomEvent<boolean>).detail;
      setSlotColorsOn(typeof detail === "boolean" ? detail : readDevSlotColors());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === DEV_MODE_KEY) setDevOn(readDevMode());
      if (e.key === DEV_SLOT_COLORS_KEY) setSlotColorsOn(readDevSlotColors());
    };
    window.addEventListener(DEV_EVENT, onDev);
    window.addEventListener(DEV_SLOT_COLORS_EVENT, onSlot);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(DEV_EVENT, onDev);
      window.removeEventListener(DEV_SLOT_COLORS_EVENT, onSlot);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  // Drag wiring — pointer events on the grip handle. We attach the
  // move/up listeners on the document so the user can drag the chip
  // anywhere on screen without losing tracking when the cursor leaves
  // the chip itself.
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    draggingRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x,
      origY: pos.y,
    };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = draggingRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    // Clamp inside the viewport with a small margin so the chip is
    // always tappable. We track left/top from the top-left corner.
    const margin = 4;
    const maxX = Math.max(
      margin,
      (typeof window !== "undefined" ? window.innerWidth : 1200) - 220 - margin,
    );
    const maxY = Math.max(
      margin,
      (typeof window !== "undefined" ? window.innerHeight : 800) - 120 - margin,
    );
    const next: Pos = {
      x: Math.max(margin, Math.min(maxX, drag.origX + dx)),
      y: Math.max(margin, Math.min(maxY, drag.origY + dy)),
    };
    setPos(next);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (draggingRef.current) {
      writePos(pos);
    }
    draggingRef.current = null;
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // some browsers throw if capture was never granted
    }
  };

  const onGripDoubleClick = () => {
    // Reset position to default.
    const reset = { x: 16, y: 64 };
    setPos(reset);
    writePos(reset);
  };

  // Chip is hidden when: still loading auth, user is not admin, OR
  // dev mode itself is OFF. The chip is itself a dev tool; we don't
  // want it cluttering the screen for non-dev sessions. To re-enable
  // dev mode (and the chip), use the existing toggle in
  // Settings → Profile → Dev mode.
  if (loading || !isAdmin || !devOn) return null;

  return (
    <div
      role="region"
      aria-label="Dev chip"
      style={{
        position: "fixed",
        left: pos.x,
        top: pos.y,
        zIndex: 2147483646, // just below DevOverlay so we don't cover the version pill
        background: "rgba(0, 0, 0, 0.88)",
        color: "#ffffff",
        border: "1px solid rgba(255, 255, 255, 0.18)",
        borderRadius: 10,
        padding: "6px 8px",
        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.4)",
        fontFamily: "ui-monospace, Menlo, Monaco, Consolas, monospace",
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: "0.02em",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        width: 200,
        userSelect: "none",
      }}
    >
      {/* Drag grip */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onGripDoubleClick}
        title="Drag to move · double-tap to reset"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          opacity: 0.6,
          cursor: "grab",
          padding: "0 0 2px 0",
          borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
          touchAction: "none",
        }}
      >
        <GripVertical size={12} strokeWidth={1.5} />
        <span style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase" }}>
          Dev Chip
        </span>
      </div>

      {/* Dev mode master */}
      <ChipRow
        label="Dev mode"
        on={devOn}
        onChange={(next) => {
          setDevMode(next);
          // setDevOn will also receive the event update, but we set
          // optimistically here so the toggle visually flips instantly.
          setDevOn(next);
        }}
      />

      {/* Slot colors sub-toggle */}
      <ChipRow
        label="Slot colors"
        on={slotColorsOn}
        onChange={(next) => {
          setDevSlotColors(next);
          setSlotColorsOn(next);
        }}
      />
    </div>
  );
}

function ChipRow({
  label,
  on,
  onChange,
}: {
  label: string;
  on: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
      }}
    >
      <span>{label}</span>
      <button
        type="button"
        onClick={() => onChange(!on)}
        aria-pressed={on}
        style={{
          width: 32,
          height: 18,
          borderRadius: 999,
          padding: 0,
          border: "1px solid rgba(255, 255, 255, 0.2)",
          background: on ? "#4ade80" : "rgba(255, 255, 255, 0.12)",
          position: "relative",
          cursor: "pointer",
          transition: "background 120ms ease-out",
        }}
        aria-label={`${label} ${on ? "on" : "off"}`}
      >
        <span
          style={{
            position: "absolute",
            top: 1,
            left: on ? 15 : 1,
            width: 14,
            height: 14,
            borderRadius: 999,
            background: "#ffffff",
            transition: "left 120ms ease-out",
          }}
        />
      </button>
    </div>
  );
}
