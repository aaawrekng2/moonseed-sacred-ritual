import type { CardBackId } from "@/lib/card-backs";
import { cn } from "@/lib/utils";

interface Props {
  id?: CardBackId;
  width?: number;
  className?: string;
  ariaLabel?: string;
}

const RATIO = 1.75;

// Scale helpers — keep card-back ornaments proportional at any size so the
// design doesn't look chunky on small (~42px) cards or thin on big ones.
function scaleMetrics(width: number) {
  return {
    border: Math.max(0.5, width * 0.015),
    innerInset: Math.max(2, width * 0.08),
    cornerSize: Math.max(6, width * 0.18),
    starDot: Math.max(1, width * 0.025),
    radius: Math.max(3, width * 0.06),
  };
}

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

/**
 * Celestial back — luminosity pass.
 * Stars are absolutely positioned in CSS pixels (assumes width=180).
 * SVG motif fills the card and contains crescent + rings + cardinal accents.
 */
function CelestialBack({ width }: { width: number }) {
  // Star coordinates given for a 180px wide card. Scale proportionally.
  const scale = width / 180;
  const STARS: { size: number; top: number; left: number; opacity: number }[] = [
    { size: 2.5, top: 26, left: 20, opacity: 0.95 },
    { size: 2, top: 38, left: 72, opacity: 0.8 },
    { size: 1.5, top: 52, left: 32, opacity: 0.6 },
    { size: 2.5, top: 20, left: 82, opacity: 0.9 },
    { size: 1.5, top: 148, left: 22, opacity: 0.7 },
    { size: 2, top: 158, left: 80, opacity: 0.8 },
    { size: 1, top: 135, left: 55, opacity: 0.5 },
    { size: 1.5, top: 65, left: 88, opacity: 0.55 },
  ];
  return (
    <>
      {/* Soft inner radial glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse at 50% 45%, rgba(161,130,220,0.10), transparent 60%)",
        }}
      />
      {/* Double inner border */}
      <div
        className="pointer-events-none absolute"
        style={{
          inset: 8,
          borderRadius: 6,
          border: "1px solid rgba(200,170,255,0.45)",
        }}
      />
      <div
        className="pointer-events-none absolute"
        style={{
          inset: 14,
          borderRadius: 4,
          border: "1px solid rgba(200,170,255,0.20)",
        }}
      />
      {/* Stars */}
      {STARS.map((s, i) => (
        <span
          key={i}
          className="pointer-events-none absolute rounded-full bg-white"
          style={{
            top: s.top * scale,
            left: s.left * scale,
            width: s.size * scale,
            height: s.size * scale,
            opacity: s.opacity,
            boxShadow: `0 0 ${s.size * 2 * scale}px rgba(220,195,255,${s.opacity * 0.6})`,
          }}
        />
      ))}
      {/* Central motif */}
      <svg
        viewBox="0 0 74 74"
        preserveAspectRatio="xMidYMid meet"
        className="pointer-events-none absolute left-1/2 top-1/2 h-[44%] w-[44%] -translate-x-1/2 -translate-y-1/2"
      >
        <g transform="translate(37 37)" fill="none">
          {/* concentric rings */}
          <circle r="22" stroke="rgba(200,170,255,0.25)" strokeWidth="0.8" />
          <circle r="16" stroke="rgba(200,170,255,0.35)" strokeWidth="0.8" />
          {/* crescent moon */}
          <path
            d="M -4 -9 A 10 10 0 1 0 -4 9 A 7.5 7.5 0 1 1 -4 -9 Z"
            fill="rgba(230,215,255,0.92)"
            stroke="rgba(220,195,255,0.95)"
            strokeWidth="0.6"
          />
          {/* cardinal tick lines */}
          <line x1="0" y1="-22" x2="0" y2="-19" stroke="rgba(220,195,255,0.7)" strokeWidth="0.8" />
          <line x1="0" y1="19" x2="0" y2="22" stroke="rgba(220,195,255,0.7)" strokeWidth="0.8" />
          <line x1="-22" y1="0" x2="-19" y2="0" stroke="rgba(220,195,255,0.7)" strokeWidth="0.8" />
          <line x1="19" y1="0" x2="22" y2="0" stroke="rgba(220,195,255,0.7)" strokeWidth="0.8" />
          {/* cardinal dot accents */}
          <circle cx="0" cy="-22" r="1.4" fill="rgba(220,195,255,0.75)" />
          <circle cx="0" cy="22" r="1.4" fill="rgba(220,195,255,0.75)" />
          <circle cx="-22" cy="0" r="1.4" fill="rgba(220,195,255,0.75)" />
          <circle cx="22" cy="0" r="1.4" fill="rgba(220,195,255,0.75)" />
        </g>
      </svg>
      {/* Corner ornaments */}
      <svg
        viewBox="0 0 80 80"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 h-full w-full"
      >
        <g stroke="rgba(210,185,255,0.7)" strokeWidth="0.8" fill="none">
          {/* top-left */}
          <line x1="6" y1="6" x2="14" y2="6" />
          <line x1="6" y1="6" x2="6" y2="14" />
          <circle cx="6" cy="6" r="1.2" fill="rgba(220,195,255,0.9)" stroke="none" />
          {/* top-right */}
          <line x1="74" y1="6" x2="66" y2="6" />
          <line x1="74" y1="6" x2="74" y2="14" />
          <circle cx="74" cy="6" r="1.2" fill="rgba(220,195,255,0.9)" stroke="none" />
          {/* bottom-left */}
          <line x1="6" y1="74" x2="14" y2="74" />
          <line x1="6" y1="74" x2="6" y2="66" />
          <circle cx="6" cy="74" r="1.2" fill="rgba(220,195,255,0.9)" stroke="none" />
          {/* bottom-right */}
          <line x1="74" y1="74" x2="66" y2="74" />
          <line x1="74" y1="74" x2="74" y2="66" />
          <circle cx="74" cy="74" r="1.2" fill="rgba(220,195,255,0.9)" stroke="none" />
        </g>
      </svg>
    </>
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
  { bg: string; borderColor: string; innerOuter: string; innerInner: string }
> = {
  celestial: {
    bg: "radial-gradient(ellipse at 40% 25%, #3d2575 0%, #251555 45%, #130d38 100%)",
    borderColor: "rgba(200,170,255,0.5)",
    innerOuter: "rgba(200,170,255,0.45)",
    innerInner: "rgba(200,170,255,0.2)",
  },
  void: {
    bg: "radial-gradient(ellipse at 50% 35%, #1e1c2e 0%, #111020 55%, #080710 100%)",
    borderColor: "rgba(255,255,255,0.2)",
    innerOuter: "rgba(255,255,255,0.18)",
    innerInner: "rgba(255,255,255,0.10)",
  },
  ember: {
    bg: "radial-gradient(ellipse at 45% 30%, #3d1e06 0%, #241008 50%, #110602 100%)",
    borderColor: "rgba(251,191,36,0.55)",
    innerOuter: "rgba(251,191,36,0.5)",
    innerInner: "rgba(251,191,36,0.25)",
  },
  ocean: {
    bg: "radial-gradient(ellipse at 45% 28%, #0a2540 0%, #061528 55%, #020a14 100%)",
    borderColor: "rgba(56,189,248,0.45)",
    innerOuter: "rgba(56,189,248,0.4)",
    innerInner: "rgba(56,189,248,0.2)",
  },
  verdant: {
    bg: "radial-gradient(ellipse at 45% 30%, #0a2210 0%, #061508 55%, #020a03 100%)",
    borderColor: "rgba(74,222,128,0.45)",
    innerOuter: "rgba(74,222,128,0.4)",
    innerInner: "rgba(74,222,128,0.2)",
  },
};

export function CardBack({ id = "celestial", width = 160, className, ariaLabel }: Props) {
  const height = Math.round(width * RATIO);
  const style = STYLES[id];
  const m = scaleMetrics(width);
  return (
    <div
      role="img"
      aria-label={ariaLabel ?? "Tarot card back"}
      className={cn("relative overflow-hidden", className)}
      style={{
        width,
        height,
        borderRadius: m.radius,
        background: style.bg,
        border: `${m.border}px solid ${style.borderColor}`,
        // Inner double-ring scales with card size for a proportional look.
        boxShadow: `inset 0 0 0 ${m.innerInset}px ${style.innerOuter}, inset 0 0 0 ${Math.round(m.innerInset * 1.7)}px ${style.innerInner}`,
      }}
    >
      {id === "celestial" && <CelestialBack width={width} />}
      {id === "void" && <VoidBack />}
      {id === "ember" && <EmberBack />}
      {id === "ocean" && <OceanBack />}
      {id === "verdant" && <VerdantBack />}
    </div>
  );
}