import { useEffect, useState } from "react";

type LoadingSkeletonProps = {
  /** Heights of the skeleton blocks in pixels. */
  heights: number[];
  className?: string;
  /** Override the default 250ms show-delay. */
  delayMs?: number;
};

/**
 * FU-15 — Canonical skeleton placeholder for large-content loading.
 * Built-in 250ms show-delay so fast loads don't flash an empty skeleton.
 */
export function LoadingSkeleton({
  heights,
  className = "",
  delayMs = 250,
}: LoadingSkeletonProps) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(t);
  }, [delayMs]);
  if (!show) return null;
  return (
    <div className={`space-y-3 ${className}`}>
      {heights.map((h, i) => (
        <div
          key={i}
          className="animate-pulse"
          style={{
            height: h,
            background: "var(--surface-card)",
            borderRadius: 18,
            opacity: 0.5,
          }}
        />
      ))}
    </div>
  );
}
