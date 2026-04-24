import type { CardBackId } from "@/lib/card-backs";
import { cn } from "@/lib/utils";

interface Props {
  id?: CardBackId;
  width?: number;
  className?: string;
  ariaLabel?: string;
}

const RATIO = 1.75;

function Stars({ dots }: { dots: { x: number; y: number; r: number; o: number; c?: string }[] }) {
  return (
    <>
      {dots.map((d, i) => (
        <circle key={i} cx={d.x} cy={d.y} r={d.r} fill={d.c ?? "#ffffff"} opacity={d.o} />
      ))}
    </>
  );
}

function Corners({ color, dotColor }: { color: string; dotColor: string }) {
  // Four L-shaped corner ornaments inside an 80x80 viewBox container.
  const arms = [
    { x: 6, y: 6, h: [6, 18, 6, 6], v: [6, 6, 6, 18], dx: 6, dy: 6 },
    { x: 74, y: 6, h: [62, 74, 74, 74], v: [74, 6, 74, 18], dx: 74, dy: 6 },
    { x: 6, y: 74, h: [6, 74, 18, 74], v: [6, 62, 6, 74], dx: 6, dy: 74 },
    { x: 74, y: 74, h: [62, 74, 74, 74], v: [74, 62, 74, 74], dx: 74, dy: 74 },
  ];
  return (
    <>
      {arms.map((a, i) => (
        <g key={i} stroke={color} strokeWidth="0.7" fill="none">
          <line x1={a.h[0]} y1={a.h[1]} x2={a.h[2]} y2={a.h[3]} />
          <line x1={a.v[0]} y1={a.v[1]} x2={a.v[2]} y2={a.v[3]} />
          <circle cx={a.dx} cy={a.dy} r="0.9" fill={dotColor} stroke="none" />
        </g>
      ))}
    </>
  );
}

function CelestialBack() {
  const stars = [
    { x: 18, y: 14, r: 1.4, o: 0.85 },
    { x: 62, y: 18, r: 1, o: 0.7 },
    { x: 12, y: 50, r: 1.2, o: 0.75 },
    { x: 70, y: 60, r: 1.6, o: 0.9 },
    { x: 24, y: 72, r: 1, o: 0.6 },
    { x: 56, y: 78, r: 1.3, o: 0.8 },
    { x: 40, y: 6, r: 0.8, o: 0.65 },
    { x: 8, y: 30, r: 0.9, o: 0.7 },
  ];
  return (
    <svg viewBox="0 0 80 80" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      <Stars dots={stars} />
      {/* central crescent + rings */}
      <g
        transform="translate(40 42)"
        stroke="rgba(220,195,255,0.9)"
        strokeWidth="0.6"
        fill="none"
      >
        <circle r="14" opacity="0.55" />
        <circle r="10" opacity="0.75" />
        <path
          d="M -5 -7 A 8 8 0 1 0 -5 7 A 6 6 0 1 1 -5 -7 Z"
          fill="rgba(220,195,255,0.85)"
          stroke="none"
        />
        {/* cardinal dots */}
        <circle cx="0" cy="-14" r="0.9" fill="rgba(220,195,255,0.7)" stroke="none" />
        <circle cx="0" cy="14" r="0.9" fill="rgba(220,195,255,0.7)" stroke="none" />
        <circle cx="-14" cy="0" r="0.9" fill="rgba(220,195,255,0.7)" stroke="none" />
        <circle cx="14" cy="0" r="0.9" fill="rgba(220,195,255,0.7)" stroke="none" />
      </g>
      <Corners color="rgba(210,185,255,0.7)" dotColor="rgba(210,185,255,0.85)" />
    </svg>
  );
}

function VoidBack() {
  const stars = [
    { x: 14, y: 14, r: 1.5, o: 0.95 },
    { x: 66, y: 16, r: 1.2, o: 0.85 },
    { x: 22, y: 60, r: 1.4, o: 0.9 },
    { x: 60, y: 64, r: 1.3, o: 0.85 },
    { x: 8, y: 38, r: 1, o: 0.75 },
    { x: 72, y: 44, r: 1, o: 0.75 },
    { x: 40, y: 8, r: 0.9, o: 0.7 },
    { x: 40, y: 74, r: 0.9, o: 0.7 },
  ];
  return (
    <svg viewBox="0 0 80 80" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      <Stars dots={stars} />
      <g transform="translate(40 40)" stroke="rgba(255,255,255,0.4)" strokeWidth="0.5" fill="none">
        <circle r="14" opacity="0.7" />
        <circle r="10" opacity="0.6" />
        <circle r="6" opacity="0.5" />
        <line x1="-14" y1="0" x2="14" y2="0" />
        <line x1="0" y1="-14" x2="0" y2="14" />
        <line x1="-10" y1="-10" x2="10" y2="10" opacity="0.5" />
        <line x1="-10" y1="10" x2="10" y2="-10" opacity="0.5" />
        <circle cx="0" cy="-14" r="0.9" fill="rgba(255,255,255,0.7)" stroke="none" />
        <circle cx="0" cy="14" r="0.9" fill="rgba(255,255,255,0.7)" stroke="none" />
        <circle cx="-14" cy="0" r="0.9" fill="rgba(255,255,255,0.7)" stroke="none" />
        <circle cx="14" cy="0" r="0.9" fill="rgba(255,255,255,0.7)" stroke="none" />
        <circle cx="0" cy="0" r="1.1" fill="rgba(255,255,255,0.85)" stroke="none" />
      </g>
      <Corners color="rgba(255,255,255,0.35)" dotColor="rgba(255,255,255,0.5)" />
    </svg>
  );
}

function EmberBack() {
  const stars = [
    { x: 16, y: 12, r: 1.2, o: 0.9, c: "rgb(251,191,36)" },
    { x: 64, y: 18, r: 1, o: 0.75, c: "rgb(251,191,36)" },
    { x: 12, y: 64, r: 1.3, o: 0.85, c: "rgb(251,191,36)" },
    { x: 70, y: 60, r: 1.1, o: 0.8, c: "rgb(251,191,36)" },
    { x: 40, y: 8, r: 0.9, o: 0.7, c: "rgb(251,191,36)" },
  ];
  return (
    <svg viewBox="0 0 80 80" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      <Stars dots={stars} />
      <g transform="translate(40 42)" stroke="rgba(251,191,36,0.85)" strokeWidth="0.6" fill="none">
        <polygon points="0,-14 12,8 -12,8" />
        <polygon points="0,-10 8.5,5.5 -8.5,5.5" opacity="0.85" />
        <polygon points="0,-6 5,3.5 -5,3.5" opacity="0.7" />
        <circle r="2" />
        <circle r="0.8" fill="rgba(251,191,36,0.9)" stroke="none" />
        {/* vertex accents */}
        <circle cx="0" cy="-14" r="0.9" fill="rgba(251,191,36,0.9)" stroke="none" />
        <circle cx="12" cy="8" r="0.9" fill="rgba(251,191,36,0.7)" stroke="none" />
        <circle cx="-12" cy="8" r="0.9" fill="rgba(251,191,36,0.7)" stroke="none" />
      </g>
      <Corners color="rgba(251,191,36,0.7)" dotColor="rgba(251,191,36,0.9)" />
    </svg>
  );
}

function OceanBack() {
  const stars = [
    { x: 14, y: 12, r: 1.4, o: 0.9, c: "rgb(186,230,253)" },
    { x: 66, y: 16, r: 1, o: 0.75, c: "rgb(186,230,253)" },
    { x: 12, y: 60, r: 1.2, o: 0.8, c: "rgb(186,230,253)" },
    { x: 70, y: 64, r: 1.6, o: 0.95, c: "rgb(186,230,253)" },
    { x: 40, y: 6, r: 0.9, o: 0.7, c: "rgb(186,230,253)" },
    { x: 8, y: 36, r: 0.9, o: 0.7, c: "rgb(186,230,253)" },
    { x: 72, y: 40, r: 0.9, o: 0.7, c: "rgb(186,230,253)" },
  ];
  return (
    <svg viewBox="0 0 80 80" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      <Stars dots={stars} />
      <g transform="translate(40 42)" fill="none">
        <circle r="14" stroke="rgba(56,189,248,0.5)" strokeWidth="0.5" />
        <path
          d="M -12 0 Q -6 -5 0 0 T 12 0"
          stroke="rgba(56,189,248,0.85)"
          strokeWidth="0.9"
        />
        <path
          d="M -12 0 Q -6 5 0 0 T 12 0"
          stroke="rgba(56,189,248,0.85)"
          strokeWidth="0.9"
        />
        <path
          d="M -10 -5 Q -5 -8 0 -5 T 10 -5"
          stroke="rgba(56,189,248,0.45)"
          strokeWidth="0.6"
        />
        <path
          d="M -10 5 Q -5 8 0 5 T 10 5"
          stroke="rgba(56,189,248,0.45)"
          strokeWidth="0.6"
        />
        <circle r="1.5" stroke="rgba(186,230,253,0.95)" strokeWidth="0.4" />
        <circle r="0.6" fill="rgba(186,230,253,0.95)" />
      </g>
      <Corners color="rgba(56,189,248,0.6)" dotColor="rgba(186,230,253,0.85)" />
    </svg>
  );
}

function VerdantBack() {
  const stars = [
    { x: 14, y: 12, r: 1.3, o: 0.85, c: "rgb(134,239,172)" },
    { x: 66, y: 16, r: 1, o: 0.7, c: "rgb(134,239,172)" },
    { x: 12, y: 60, r: 1.5, o: 0.95, c: "rgb(134,239,172)" },
    { x: 70, y: 64, r: 1.1, o: 0.8, c: "rgb(134,239,172)" },
    { x: 40, y: 6, r: 0.9, o: 0.7, c: "rgb(134,239,172)" },
    { x: 8, y: 38, r: 0.9, o: 0.7, c: "rgb(134,239,172)" },
  ];
  return (
    <svg viewBox="0 0 80 80" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
      <Stars dots={stars} />
      <g transform="translate(40 42)" fill="none">
        {/* teardrop right (bold) */}
        <path
          d="M 0 -14 C 8 -8 8 8 0 14 C 0 8 0 -8 0 -14 Z"
          fill="rgba(74,222,128,0.55)"
          stroke="rgba(74,222,128,0.9)"
          strokeWidth="0.6"
        />
        {/* teardrop left (lighter) */}
        <path
          d="M 0 -14 C -8 -8 -8 8 0 14 C 0 8 0 -8 0 -14 Z"
          fill="rgba(74,222,128,0.25)"
          stroke="rgba(74,222,128,0.6)"
          strokeWidth="0.5"
        />
        {/* echo arcs */}
        <path d="M -12 0 Q 0 -3 12 0" stroke="rgba(74,222,128,0.4)" strokeWidth="0.5" />
        <path d="M -12 0 Q 0 3 12 0" stroke="rgba(74,222,128,0.4)" strokeWidth="0.5" />
        <circle r="1.4" stroke="rgba(134,239,172,0.95)" strokeWidth="0.4" />
        <circle r="0.6" fill="rgba(134,239,172,0.95)" />
        <circle cx="0" cy="-14" r="0.9" fill="rgba(134,239,172,0.95)" />
      </g>
      <Corners color="rgba(74,222,128,0.6)" dotColor="rgba(134,239,172,0.85)" />
    </svg>
  );
}

const STYLES: Record<
  CardBackId,
  { bg: string; border: string; insets: string }
> = {
  celestial: {
    bg: "radial-gradient(ellipse at 40% 25%, #3d2575 0%, #251555 45%, #130d38 100%)",
    border: "1px solid rgba(200,170,255,0.5)",
    insets:
      "inset 0 0 0 8px rgba(200,170,255,0.45), inset 0 0 0 14px rgba(200,170,255,0.2)",
  },
  void: {
    bg: "radial-gradient(ellipse at 50% 35%, #1e1c2e 0%, #111020 55%, #080710 100%)",
    border: "1px solid rgba(255,255,255,0.2)",
    insets: "inset 0 0 0 8px rgba(255,255,255,0.18)",
  },
  ember: {
    bg: "radial-gradient(ellipse at 45% 30%, #3d1e06 0%, #241008 50%, #110602 100%)",
    border: "1px solid rgba(251,191,36,0.55)",
    insets:
      "inset 0 0 0 8px rgba(251,191,36,0.5), inset 0 0 0 14px rgba(251,191,36,0.25)",
  },
  ocean: {
    bg: "radial-gradient(ellipse at 45% 28%, #0a2540 0%, #061528 55%, #020a14 100%)",
    border: "1px solid rgba(56,189,248,0.45)",
    insets:
      "inset 0 0 0 8px rgba(56,189,248,0.4), inset 0 0 0 14px rgba(56,189,248,0.2)",
  },
  verdant: {
    bg: "radial-gradient(ellipse at 45% 30%, #0a2210 0%, #061508 55%, #020a03 100%)",
    border: "1px solid rgba(74,222,128,0.45)",
    insets:
      "inset 0 0 0 8px rgba(74,222,128,0.4), inset 0 0 0 14px rgba(74,222,128,0.2)",
  },
};

export function CardBack({ id = "celestial", width = 160, className, ariaLabel }: Props) {
  const height = Math.round(width * RATIO);
  const style = STYLES[id];
  return (
    <div
      role="img"
      aria-label={ariaLabel ?? "Tarot card back"}
      className={cn("relative overflow-hidden", className)}
      style={{
        width,
        height,
        borderRadius: 10,
        background: style.bg,
        border: style.border,
        boxShadow: style.insets,
      }}
    >
      {id === "celestial" && <CelestialBack />}
      {id === "void" && <VoidBack />}
      {id === "ember" && <EmberBack />}
      {id === "ocean" && <OceanBack />}
      {id === "verdant" && <VerdantBack />}
    </div>
  );
}