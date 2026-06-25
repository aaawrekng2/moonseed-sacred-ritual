/**
 * v2.4 — TipLayer.
 *
 * One global tooltip layer mounted at the app root. Any element carrying a
 * `data-tarotseed-tip` attribute gets a hover tip rendered HERE — portaled to
 * <body> and fixed-positioned — instead of as a CSS `::before` on the element
 * itself. The old pseudo-element tip was painted inside its nearest
 * `overflow:hidden` ancestor (e.g. the scrolling card popover), so a tip on an
 * edge item got clipped. Rendering at the body level means the tip floats free
 * of any popover, flips above/below by available room, and clamps to the
 * viewport edges so it can never be cut off.
 *
 * No call sites change: every existing `data-tarotseed-tip` keeps working.
 */
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type TipState = { text: string; rect: DOMRect } | null;
type TipPos = { left: number; top: number } | null;

const MARGIN = 8;

export function TipLayer() {
  const [tip, setTip] = useState<TipState>(null);
  const [pos, setPos] = useState<TipPos>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const currentTrigger = useRef<Element | null>(null);

  // Delegate hover detection at the document level.
  useEffect(() => {
    const onOver = (e: Event) => {
      const target = e.target as Element | null;
      const trigger = target?.closest?.("[data-tarotseed-tip]") ?? null;
      if (!trigger) return;
      if (trigger === currentTrigger.current) return;
      const text = trigger.getAttribute("data-tarotseed-tip");
      if (!text) return;
      currentTrigger.current = trigger;
      setTip({ text, rect: trigger.getBoundingClientRect() });
    };
    const onOut = (e: PointerEvent) => {
      const trigger = (e.target as Element | null)?.closest?.(
        "[data-tarotseed-tip]",
      );
      if (!trigger || trigger !== currentTrigger.current) return;
      const related = e.relatedTarget as Node | null;
      if (related && trigger.contains(related)) return;
      currentTrigger.current = null;
      setTip(null);
    };
    const dismiss = () => {
      currentTrigger.current = null;
      setTip(null);
    };
    document.addEventListener("pointerover", onOver, true);
    document.addEventListener("pointerout", onOut as EventListener, true);
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("pointerover", onOver, true);
      document.removeEventListener("pointerout", onOut as EventListener, true);
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
    };
  }, []);

  // Measure the rendered tip, then place it (flip + clamp) so it never clips.
  useEffect(() => {
    if (!tip || !boxRef.current) {
      setPos(null);
      return;
    }
    const tw = boxRef.current.offsetWidth;
    const th = boxRef.current.offsetHeight;
    const vw = window.innerWidth;
    const r = tip.rect;
    let left = r.left + r.width / 2;
    left = Math.min(Math.max(left, MARGIN + tw / 2), vw - MARGIN - tw / 2);
    const above = r.top - th - 10 >= MARGIN;
    const top = above ? r.top - th - 8 : r.bottom + 8;
    setPos({ left, top });
  }, [tip]);

  if (!tip) return null;

  return createPortal(
    <div
      ref={boxRef}
      style={{
        position: "fixed",
        left: pos ? pos.left : 0,
        top: pos ? pos.top : 0,
        transform: "translateX(-50%)",
        visibility: pos ? "visible" : "hidden",
        zIndex: "var(--z-toast)",
        pointerEvents: "none",
        background: "var(--color-foreground)",
        color: "var(--background)",
        padding: "4px 8px",
        borderRadius: 4,
        fontFamily: "var(--font-serif)",
        fontSize: 11,
        fontStyle: "italic",
        lineHeight: 1.3,
        maxWidth: 220,
        whiteSpace: "normal",
        boxShadow: "0 2px 10px rgba(0,0,0,0.28)",
      }}
    >
      {tip.text}
    </div>,
    document.body,
  );
}
