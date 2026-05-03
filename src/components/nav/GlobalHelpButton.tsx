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
import { useFloatingMenu } from "@/lib/floating-menu-context";

/**
 * EE-7 — Global "?" entry.
 *
 * Position rule:
 *   - When the FloatingMenu is "active" (any per-screen handler set,
 *     or the menu wants to show its built-in toggles), the help icon
 *     hides — the FloatingMenu's own ? button surfaces help instead.
 *   - When the FloatingMenu is dormant (no handlers registered for the
 *     current screen), render at top-CENTER as a free-standing entry.
 *
 * "Active" is approximated by the presence of any registered handler
 * the screen has put on the floating-menu context. The menu ALWAYS
 * mounts globally, but only spawns a pop-down when the user opens it —
 * we still want the global ? hidden whenever a screen has its own help
 * affordance to avoid double icons.
 */
export function GlobalHelpButton() {
  const { closeHandler, helpHandler, copyText, showRefresh, shareBuilderClose } =
    useFloatingMenu();
  const floatingMenuActive =
    closeHandler != null ||
    helpHandler != null ||
    copyText != null ||
    showRefresh ||
    shareBuilderClose != null;
  if (floatingMenuActive) return null;
  return (
    <Link
      to="/help"
      aria-label="Help"
      title="Help"
      className="fixed flex h-11 w-11 items-center justify-center rounded-full focus:outline-none"
      style={{
        top: "calc(env(safe-area-inset-top, 0px) + 6px)",
        left: "50%",
        transform: "translateX(-50%)",
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