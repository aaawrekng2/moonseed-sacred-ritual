import { Share2, Check } from "lucide-react";
import { useState, useCallback } from "react";

type Props = {
  /** Plain-text body to share. */
  text: string;
  /** Title for the native share sheet (mobile). */
  title?: string;
  /** Optional preface inserted before the text (e.g. "A reading from Moonseed:"). */
  preface?: string;
  /** Override the default 18px icon size. */
  size?: number;
  /** Optional aria-label override. */
  ariaLabel?: string;
  /** Optional className for layout positioning. */
  className?: string;
};

/**
 * Universal share affordance for AI-generated content. Uses the Web
 * Share API on mobile (native share sheet) and falls back to clipboard
 * copy on desktop with a brief "Copied" confirmation. No pill, no label
 * — sized and styled to match the app's other ghost icon actions.
 */
export function ShareButton({
  text,
  title = "A reading from Moonseed",
  preface,
  size = 18,
  ariaLabel = "Share",
  className,
}: Props) {
  const [copied, setCopied] = useState(false);

  const handleShare = useCallback(async () => {
    const body = preface ? `${preface}\n\n${text}` : text;
    try {
      if (typeof navigator !== "undefined" && "share" in navigator) {
        await navigator.share({
          title,
          text: body,
          url:
            typeof window !== "undefined"
              ? window.location.href
              : undefined,
        });
        return;
      }
    } catch {
      // User cancelled or share rejected — fall through to clipboard
      // so they always have a way to grab the text.
    }
    try {
      await navigator.clipboard.writeText(body);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (e) {
      console.warn("[ShareButton] copy failed", e);
    }
  }, [preface, text, title]);

  return (
    <button
      type="button"
      onClick={() => void handleShare()}
      aria-label={ariaLabel}
      className={
        className ??
        "inline-flex items-center justify-center rounded-full p-1.5 text-gold transition-opacity hover:opacity-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-gold/40"
      }
      style={{ opacity: "var(--ro-plus-20)" }}
      title={copied ? "Copied" : "Share"}
    >
      {copied ? (
        <Check size={size} strokeWidth={1.5} aria-hidden />
      ) : (
        <Share2 size={size} strokeWidth={1.5} aria-hidden />
      )}
    </button>
  );
}