/**
 * DC-5.2 — Global "?" entry in the top header.
 *
 * Mounted once in __root.tsx so every route shows it at the leftmost
 * position. Tapping navigates to the /help hub. Theme-aware (uses
 * var(--accent)) and respects the user's resting-opacity tokens.
 *
 * Distinct from:
 *  - the Celtic Cross "?" legend icon
 *  - the context-sensitive Stories "?" icon
 *  - the FloatingMenu / TopRightControls help affordances
 */
import { Link } from "@tanstack/react-router";
import { HelpCircle } from "lucide-react";

export function GlobalHelpButton() {
  return (
    <Link
      to="/help"
      aria-label="Help"
      title="Help"
      className="fixed flex h-11 w-11 items-center justify-center rounded-full focus:outline-none"
      style={{
        top: "calc(env(safe-area-inset-top, 0px) + 6px)",
        left: "calc(env(safe-area-inset-left, 0px) + 12px)",
        zIndex: 50,
        color: "var(--accent)",
        opacity: "var(--ro-plus-30, 0.7)",
        background: "transparent",
        border: "none",
      }}
    >
      <HelpCircle size={16} strokeWidth={1.5} />
    </Link>
  );
}