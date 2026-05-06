import { useEffect, useState } from "react";

type LoadingTextProps = {
  children: React.ReactNode;
  className?: string;
  /** Override the default 250ms show-delay. Rarely needed. */
  delayMs?: number;
};

/**
 * FU-15 — Canonical inline loading text. Italic muted serif with a
 * built-in 250ms show-delay so fast operations don't flicker.
 */
export function LoadingText({
  children,
  className = "",
  delayMs = 250,
}: LoadingTextProps) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);
  if (!show) return null;
  return (
    <p
      className={className}
      style={{
        margin: 0,
        fontFamily: "var(--font-serif)",
        fontStyle: "italic",
        fontSize: "var(--text-body-sm)",
        opacity: 0.5,
      }}
    >
      {children}
    </p>
  );
}
