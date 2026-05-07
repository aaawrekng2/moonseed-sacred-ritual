/**
 * DY-3 — Reusable Hint component (Notion-standard three-state).
 *
 * State 1: showing.
 * State 2: X tap → soft dismiss (session only, in-memory).
 * State 3: "Don't show again" → hard dismiss (persisted in
 *          `user_preferences.dismissed_hints` for signed-in seekers,
 *          localStorage for anonymous).
 *
 * Reset Hints (Settings) clears the persisted set, so each hint
 * reappears the next time its trigger fires.
 */
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { X } from "lucide-react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

const ANON_LS_KEY = "moonseed.hardDismissedHints";
const userLsKey = (userId: string) => `moonseed:hard-dismiss:${userId}`;

function readAnonHardDismissed(): Record<string, boolean> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ANON_LS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAnonHardDismissed(map: Record<string, boolean>): void {
  try {
    window.localStorage.setItem(ANON_LS_KEY, JSON.stringify(map));
  } catch {
    /* localStorage may be blocked — silently skip */
  }
}

/**
 * Async check — does the seeker have this hint hard-dismissed?
 * Used by trigger code that decides whether to show the hint at all.
 */
export async function isHintHardDismissed(
  hintId: string,
  userId: string | null,
): Promise<boolean> {
  if (!userId) return !!readAnonHardDismissed()[hintId];
  // 9-6-I — check per-user localStorage backup first so dismissal sticks
  // even if the DB write previously failed.
  try {
    const raw = window.localStorage.getItem(userLsKey(userId));
    if (raw) {
      const cur = JSON.parse(raw) as Record<string, boolean>;
      if (cur[hintId]) return true;
    }
  } catch {
    /* ignore */
  }
  const { data } = await supabase
    .from("user_preferences")
    .select("dismissed_hints")
    .eq("user_id", userId)
    .maybeSingle();
  const map =
    ((data as { dismissed_hints?: Record<string, boolean> } | null)
      ?.dismissed_hints) ?? {};
  return !!map[hintId];
}

async function markHintHardDismissed(
  hintId: string,
  userId: string | null,
): Promise<void> {
  // 9-6-I — always write a localStorage backup keyed by userId (or anon
  // bucket). Visible toast on every DB error path so silent failures
  // become impossible.
  if (userId) {
    try {
      const k = userLsKey(userId);
      const raw = window.localStorage.getItem(k);
      const cur = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
      window.localStorage.setItem(k, JSON.stringify({ ...cur, [hintId]: true }));
    } catch {
      /* ignore */
    }
  }
  if (!userId) {
    const cur = readAnonHardDismissed();
    writeAnonHardDismissed({ ...cur, [hintId]: true });
    return;
  }
  const { data: existing, error: selErr } = await supabase
    .from("user_preferences")
    .select("user_id, dismissed_hints")
    .eq("user_id", userId)
    .maybeSingle();
  if (selErr) {
    toast.error(`Hint dismissal SELECT failed: ${selErr.message}`);
    console.error("[markHintHardDismissed] select error", selErr);
    return;
  }
  const cur =
    ((existing as { dismissed_hints?: Record<string, boolean> } | null)
      ?.dismissed_hints) ?? {};
  const next = { ...cur, [hintId]: true };
  if (existing) {
    const { error: updErr } = await supabase
      .from("user_preferences")
      .update({ dismissed_hints: next } as never)
      .eq("user_id", userId);
    if (updErr) {
      toast.error(`Hint dismissal UPDATE failed: ${updErr.message}`);
      console.error("[markHintHardDismissed] update error", updErr);
    }
  } else {
    const { error: insErr } = await supabase
      .from("user_preferences")
      .insert({ user_id: userId, dismissed_hints: next } as never);
    if (insErr) {
      toast.error(`Hint dismissal INSERT failed: ${insErr.message}`);
      console.error("[markHintHardDismissed] insert error", insErr);
    }
  }
}

export type HintPosition = "top" | "bottom" | "left" | "right";
export type HintPointerAlign = "start" | "center" | "end";

export type HintProps = {
  hintId: string;
  text: string;
  anchorRef: RefObject<HTMLElement | null>;
  position?: HintPosition;
  /** EA-4 — horizontal anchoring of the pointer arrow on top/bottom hints. */
  pointerAlign?: HintPointerAlign;
  onDismiss?: () => void;
};

/**
 * Render the Hint anchored to `anchorRef`. Caller is responsible for
 * deciding when to mount this component (i.e. honoring the trigger
 * conditions and pre-checking {@link isHintHardDismissed}).
 */
export function Hint({
  hintId,
  text,
  anchorRef,
  position = "top",
  pointerAlign = "center",
  onDismiss,
}: HintProps) {
  const { user } = useAuth();
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [closing, setClosing] = useState(false);
  const ownRef = useRef<HTMLDivElement | null>(null);

  const measure = useCallback(() => {
    const el = anchorRef.current;
    const own = ownRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const ownW = own?.offsetWidth ?? 240;
    const ownH = own?.offsetHeight ?? 80;
    const gap = 12;
    let top = r.top;
    let left = r.left;
    if (position === "top") {
      top = r.top - ownH - gap;
      left = r.left + r.width / 2 - ownW / 2;
    } else if (position === "bottom") {
      top = r.bottom + gap;
      left = r.left + r.width / 2 - ownW / 2;
    } else if (position === "left") {
      top = r.top + r.height / 2 - ownH / 2;
      left = r.left - ownW - gap;
    } else {
      top = r.top + r.height / 2 - ownH / 2;
      left = r.right + gap;
    }
    // Clamp to viewport.
    const margin = 8;
    if (typeof window !== "undefined") {
      left = Math.max(margin, Math.min(window.innerWidth - ownW - margin, left));
      top = Math.max(margin, Math.min(window.innerHeight - ownH - margin, top));
    }
    setCoords({ top, left });
  }, [anchorRef, position]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const onChange = () => measure();
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [measure]);

  const close = useCallback(() => {
    setClosing(true);
    window.setTimeout(() => {
      onDismiss?.();
    }, 200);
  }, [onDismiss]);

  const dismissSoft = () => close();
  const dismissHard = () => {
    void markHintHardDismissed(hintId, user?.id ?? null);
    close();
  };

  const arrowLeft =
    pointerAlign === "start"
      ? "20px"
      : pointerAlign === "end"
        ? "calc(100% - 20px)"
        : "50%";
  const arrowTransform =
    pointerAlign === "center"
      ? "translateX(-50%) rotate(45deg)"
      : pointerAlign === "start"
        ? "rotate(45deg)"
        : "translateX(-100%) rotate(45deg)";

  const arrow: Record<HintPosition, React.CSSProperties> = {
    top: {
      position: "absolute",
      bottom: -6,
      left: arrowLeft,
      transform: arrowTransform,
      width: 12,
      height: 12,
      background: "var(--surface-card, #15131f)",
      borderRight: "1px solid color-mix(in oklab, var(--accent, var(--gold)) 30%, transparent)",
      borderBottom: "1px solid color-mix(in oklab, var(--accent, var(--gold)) 30%, transparent)",
    },
    bottom: {
      position: "absolute",
      top: -6,
      left: arrowLeft,
      transform: arrowTransform,
      width: 12,
      height: 12,
      background: "var(--surface-card, #15131f)",
      borderLeft: "1px solid color-mix(in oklab, var(--accent, var(--gold)) 30%, transparent)",
      borderTop: "1px solid color-mix(in oklab, var(--accent, var(--gold)) 30%, transparent)",
    },
    left: { display: "none" },
    right: { display: "none" },
  };

  return (
    <div
      ref={ownRef}
      role="tooltip"
      style={{
        position: "fixed",
        top: coords?.top ?? -9999,
        left: coords?.left ?? -9999,
        // DZ-2 — sit above tabletop card surfaces, slot rail, bottom
        // bar (z-30/40/50), but below modal dialogs (z-[60+]).
        zIndex: 1000,
        maxWidth: "min(90vw, 320px)",
        background: "var(--surface-card, #15131f)",
        border: "1px solid color-mix(in oklab, var(--accent, var(--gold)) 30%, transparent)",
        borderRadius: "var(--radius-md, 12px)",
        padding: 16,
        boxShadow: "0 12px 36px -10px rgba(0,0,0,0.6)",
        opacity: closing ? 0 : coords ? 1 : 0,
        transform: closing
          ? "translateY(2px)"
          : coords
            ? "translateY(0)"
            : "translateY(4px)",
        transition:
          "opacity 300ms ease-out, transform 300ms cubic-bezier(0.22,1,0.36,1)",
      }}
    >
      <span aria-hidden style={arrow[position]} />
      <div className="flex items-start gap-3">
        <p
          style={{
            flex: 1,
            margin: 0,
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-body-sm)",
            color: "var(--color-foreground, var(--foreground))",
            lineHeight: 1.55,
          }}
        >
          {text}
        </p>
        <button
          type="button"
          onClick={dismissSoft}
          aria-label="Dismiss hint"
          style={{
            background: "none",
            border: "none",
            padding: 4,
            cursor: "pointer",
            color: "var(--foreground-muted, var(--foreground))",
            opacity: 0.6,
          }}
        >
          <X size={14} strokeWidth={1.5} />
        </button>
      </div>
      <div className="mt-2 flex">
        <button
          type="button"
          onClick={dismissHard}
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-caption, 0.7rem)",
            color: "var(--foreground-muted, var(--foreground))",
            opacity: 0.55,
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
        >
          Don't show again
        </button>
      </div>
    </div>
  );
}