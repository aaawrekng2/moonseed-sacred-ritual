/**
 * Q100 — Mobile shows 1 month with a twirl-down to reveal up to 4.
 * Desktop always shows 3 months.
 */
import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { DrawCalendar } from "./DrawCalendar";
import { useTimezone } from "@/lib/use-timezone";

export function StalkerCalendar({
  appearances,
}: {
  appearances: Array<{ readingId: string; date: string }>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const { effectiveTz } = useTimezone();

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  if (isDesktop) {
    return <DrawCalendar appearances={appearances} monthsBack={3} tz={effectiveTz} />;
  }

  return (
    <div className="flex flex-col gap-2">
      <DrawCalendar
        appearances={appearances}
        monthsBack={expanded ? 4 : 1}
        tz={effectiveTz}
      />
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          background: "none",
          border: "none",
          padding: "6px 0",
          cursor: "pointer",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          fontSize: "var(--text-caption)",
          color: "var(--color-foreground)",
          opacity: 0.55,
        }}
      >
        <ChevronDown
          size={12}
          strokeWidth={1.5}
          style={{
            transform: expanded ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 200ms ease",
          }}
        />
        {expanded ? "Show less" : "Show more months"}
      </button>
    </div>
  );
}