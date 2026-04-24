import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { buildScatter } from "@/lib/scatter";
import { Tabletop } from "@/components/tabletop/Tabletop";
import type { SpreadMode } from "@/lib/spreads";
import { SPREAD_META } from "@/lib/spreads";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/scatter-test")({
  head: () => ({
    meta: [
      { title: "Scatter clipping test — Moonseed" },
      {
        name: "description",
        content:
          "Internal test page that renders the tabletop inside the smallest supported portrait viewports and verifies no rotated card clips its container.",
      },
      { name: "robots", content: "noindex,nofollow" },
    ],
  }),
  component: ScatterTestPage,
});

// Mirrors the constants used inside Tabletop so the analytic check matches
// what actually renders. If those constants change, update them here too.
const TEST_CONSTANTS = {
  CARD_ASPECT_RATIO: 1.75,
  CARD_MAX_ROTATION: 8,
  SCATTER_PADDING: 10,
  DECK_SIZE: 78,
};

function responsiveCardWidth(viewportW: number): number {
  if (viewportW < 768) return 36;
  if (viewportW < 1024) return 40;
  return 44;
}

// Reserved vertical UI in Tabletop (header + reveal bar) — approximate.
const HEADER_PX = 56;
const REVEAL_BAR_PX = 84;

type Viewport = { label: string; w: number; h: number };

const VIEWPORTS: Viewport[] = [
  { label: "iPhone SE (320×568)", w: 320, h: 568 },
  { label: "Android small (360×800)", w: 360, h: 800 },
  { label: "iPhone X (375×812)", w: 375, h: 812 },
  { label: "iPhone 14 (390×844)", w: 390, h: 844 },
];

const SPREADS: SpreadMode[] = ["daily", "three", "celtic"];

type ClipReport = {
  total: number;
  clipped: number;
  worstOverflowPx: number;
};

/**
 * Analytic check: re-runs buildScatter with the same params Tabletop uses,
 * computes the rotated bounding box for each card, and verifies it stays
 * within [0, frameW] × [0, frameH]. We use the *card's actual rotation*
 * (not maxRotation) so this matches the real rendered geometry.
 */
function checkClipping(opts: {
  width: number;
  height: number;
  cardW: number;
  cardH: number;
  seed: number;
}): ClipReport {
  const { width, height, cardW, cardH, seed } = opts;
  const cards = buildScatter({
    width,
    height,
    count: TEST_CONSTANTS.DECK_SIZE,
    cardWidth: cardW,
    cardHeight: cardH,
    maxRotation: TEST_CONSTANTS.CARD_MAX_ROTATION,
    padding: TEST_CONSTANTS.SCATTER_PADDING,
    seed,
  });

  let clipped = 0;
  let worstOverflowPx = 0;

  for (const c of cards) {
    // CSS `transform: rotate(Xdeg)` rotates around the element center.
    const cx = c.x + cardW / 2;
    const cy = c.y + cardH / 2;
    const theta = (c.rotation * Math.PI) / 180;
    const cosT = Math.abs(Math.cos(theta));
    const sinT = Math.abs(Math.sin(theta));
    const bboxW = cardW * cosT + cardH * sinT;
    const bboxH = cardW * sinT + cardH * cosT;
    const left = cx - bboxW / 2;
    const right = cx + bboxW / 2;
    const top = cy - bboxH / 2;
    const bottom = cy + bboxH / 2;

    const overflow = Math.max(0, -left, -top, right - width, bottom - height);
    if (overflow > 0.5) {
      // 0.5px tolerance for floating-point noise.
      clipped += 1;
      if (overflow > worstOverflowPx) worstOverflowPx = overflow;
    }
  }

  return { total: cards.length, clipped, worstOverflowPx };
}

function ScatterTestPage() {
  // Fixed seeds keep results reproducible across reloads.
  const seeds = useMemo(() => [1, 42, 1337, 0xc0ffee, 0xdeadbeef], []);

  return (
    <div className="min-h-screen bg-background px-6 py-8 text-foreground">
      <header className="mx-auto mb-6 max-w-5xl">
        <h1 className="font-display text-2xl text-gold">
          Tabletop scatter clipping test
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Renders the live tabletop at minimum portrait sizes and runs an
          analytic check across {seeds.length} seeds. A viewport passes when
          every rotated card stays inside its frame.
        </p>
      </header>

      <section className="mx-auto max-w-5xl space-y-3">
        {VIEWPORTS.map((v) => {
          const cardW = responsiveCardWidth(v.w);
          const cardH = Math.round(cardW * TEST_CONSTANTS.CARD_ASPECT_RATIO);
          const scatterH = Math.max(1, v.h - HEADER_PX - REVEAL_BAR_PX);
          const reports = seeds.map((s) =>
            checkClipping({ width: v.w, height: scatterH, cardW, cardH, seed: s }),
          );
          const totalClipped = reports.reduce((a, r) => a + r.clipped, 0);
          const worst = Math.max(...reports.map((r) => r.worstOverflowPx));
          const pass = totalClipped === 0;
          return (
            <div
              key={v.label}
              className="rounded-lg border border-border/60 bg-card/40 p-4"
            >
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="font-display text-sm text-foreground">{v.label}</p>
                  <p className="text-xs text-muted-foreground">
                    scatter area: {v.w} × {scatterH}px · card{" "}
                    {cardW}×{cardH}px
                  </p>
                </div>
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-bold uppercase tracking-widest",
                    pass
                      ? "bg-mystic/30 text-mystic-foreground"
                      : "bg-destructive/30 text-destructive",
                  )}
                >
                  {pass ? "Pass" : "Clip"}
                </span>
              </div>
              <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-5">
                {reports.map((r, i) => (
                  <li key={seeds[i]} className="flex justify-between">
                    <span>seed {seeds[i].toString(16)}</span>
                    <span
                      className={
                        r.clipped === 0
                          ? "text-foreground/70"
                          : "text-destructive"
                      }
                    >
                      {r.clipped}/{r.total}
                    </span>
                  </li>
                ))}
              </ul>
              {!pass && (
                <p className="mt-2 text-xs text-destructive">
                  Worst overflow: {worst.toFixed(1)}px
                </p>
              )}
            </div>
          );
        })}
      </section>

      <section className="mx-auto mt-10 max-w-5xl">
        <h2 className="mb-3 font-display text-lg text-foreground/90">
          Live render at each minimum viewport
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Each frame mounts the real Tabletop inside a fixed-size container.
          Scroll horizontally if needed. Cards are interactive but
          confined to the frame.
        </p>
        <div className="flex flex-wrap gap-6">
          {VIEWPORTS.map((v) => (
            <ViewportFrame key={v.label} viewport={v} spread="three" />
          ))}
        </div>

        <h3 className="mt-8 mb-3 font-display text-base text-foreground/80">
          Spread variants in 320×568 (worst case)
        </h3>
        <div className="flex flex-wrap gap-6">
          {SPREADS.map((mode) => (
            <ViewportFrame
              key={mode}
              viewport={VIEWPORTS[0]}
              spread={mode}
              labelSuffix={` · ${SPREAD_META[mode].label}`}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * Embeds Tabletop inside a fixed-size frame so we can visually confirm the
 * scatter at the smallest supported portrait sizes. The frame uses
 * `position: relative` + `overflow: hidden` so any clipping is immediately
 * visible — Tabletop itself is `fixed inset-0`, so we override that via a
 * scoped wrapper that re-anchors it to the frame.
 */
function ViewportFrame({
  viewport,
  spread,
  labelSuffix = "",
}: {
  viewport: Viewport;
  spread: SpreadMode;
  labelSuffix?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    // Defer mount slightly so the surrounding layout settles first.
    const t = window.setTimeout(() => setMounted(true), 50);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <div className="flex flex-col items-start gap-2">
      <span className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        {viewport.label}
        {labelSuffix}
      </span>
      <div
        className="relative overflow-hidden rounded-xl border border-gold/30 bg-background shadow-lg"
        style={{ width: viewport.w, height: viewport.h }}
      >
        {/* scoped-fixed wrapper: pin Tabletop to this frame instead of viewport */}
        <div className="absolute inset-0 [&>div]:!fixed-none">
          {mounted && (
            <ScopedTabletop
              spread={spread}
              onExit={() => {}}
              onComplete={() => {}}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Wraps Tabletop in a containing block so its `fixed inset-0` resolves to the
 * frame, not the page viewport. Achieved by giving the parent a transform —
 * any non-`none` transform on an ancestor turns it into the containing block
 * for fixed-positioned descendants per the CSS spec.
 */
function ScopedTabletop(props: {
  spread: SpreadMode;
  onExit: () => void;
  onComplete: () => void;
}) {
  return (
    <div
      className="absolute inset-0"
      style={{ transform: "translateZ(0)" }}
    >
      <Tabletop
        spread={props.spread}
        onExit={props.onExit}
        onComplete={props.onComplete}
      />
    </div>
  );
}