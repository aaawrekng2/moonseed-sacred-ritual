/**
 * PhotoCapture — shared camera + 4-corner crop + WebP save (Stamp BA).
 *
 * Phase 9.5b Fix 2 — the fixed overlay rectangle has been replaced by a
 * 4-corner drag crop, modelled on Apple Notes / Adobe Scan / Office Lens.
 *
 *   1. Camera step: full-frame capture, no overlay constraints.
 *   2. Refine step: captured photo shown full-screen with 4 draggable
 *      corner handles (initial 10% inset). User pans/zooms/rotates the
 *      photo with one or two fingers and drags handles to the actual
 *      card corners.
 *   3. Save step: app crops to the bounding box of the 4 corners (in
 *      source-image pixel space, after replaying the on-screen
 *      transform), then applies the deck's shape mask and encodes WebP.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Loader2, RotateCcw, RotateCw, Undo2, X } from "lucide-react";

export type PhotoCaptureShape = "rectangle" | "square" | "round" | "free";

export type PhotoCaptureProps = {
  shape: PhotoCaptureShape;
  /** Aspect ratio metadata only — no longer used to constrain the crop. */
  aspectRatio?: number;
  /** Corner radius as % of shorter side, applied for rectangle/square. */
  cornerRadiusPercent?: number;
  /** Output image's longest edge in pixels. */
  outputMaxDimension: number;
  /** WebP quality, 0..1. Default 0.85. */
  outputQuality?: number;
  /** Optional helper text under the camera. */
  guideText?: string;
  onCapture: (
    blob: Blob,
    dimensions: { width: number; height: number },
  ) => void;
  onCancel: () => void;
};

type Step = "camera" | "refine" | "saving";
type Corner = { x: number; y: number }; // viewport CSS pixels

// ---------- Canvas helpers ----------

function applyRoundedCorners(
  src: HTMLCanvasElement,
  cornerRadiusPercent: number,
): HTMLCanvasElement {
  const out = document.createElement("canvas");
  out.width = src.width;
  out.height = src.height;
  const ctx = out.getContext("2d");
  if (!ctx) return src;
  const r = Math.min(out.width, out.height) * (cornerRadiusPercent / 100);
  ctx.beginPath();
  ctx.moveTo(r, 0);
  ctx.lineTo(out.width - r, 0);
  ctx.quadraticCurveTo(out.width, 0, out.width, r);
  ctx.lineTo(out.width, out.height - r);
  ctx.quadraticCurveTo(out.width, out.height, out.width - r, out.height);
  ctx.lineTo(r, out.height);
  ctx.quadraticCurveTo(0, out.height, 0, out.height - r);
  ctx.lineTo(0, r);
  ctx.quadraticCurveTo(0, 0, r, 0);
  ctx.closePath();
  ctx.clip();
  ctx.drawImage(src, 0, 0);
  return out;
}

function applyCircularMask(src: HTMLCanvasElement): HTMLCanvasElement {
  const out = document.createElement("canvas");
  const size = Math.min(src.width, src.height);
  out.width = size;
  out.height = size;
  const ctx = out.getContext("2d");
  if (!ctx) return src;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  const sx = (src.width - size) / 2;
  const sy = (src.height - size) / 2;
  ctx.drawImage(src, sx, sy, size, size, 0, 0, size, size);
  return out;
}

function canvasToWebP(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("WebP encode failed"))),
      "image/webp",
      quality,
    );
  });
}

function resizeToMaxDimension(
  src: HTMLCanvasElement,
  maxDim: number,
): HTMLCanvasElement {
  const longest = Math.max(src.width, src.height);
  if (longest <= maxDim) return src;
  const scale = maxDim / longest;
  const out = document.createElement("canvas");
  out.width = Math.round(src.width * scale);
  out.height = Math.round(src.height * scale);
  const ctx = out.getContext("2d");
  if (!ctx) return src;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, out.width, out.height);
  return out;
}

/**
 * Crop using the bounding box of 4 viewport-space corners.
 *
 * The displayed image fits the viewport by HEIGHT (CSS: height: 100%,
 * width: auto), then has a CSS transform applied:
 *   translate(-50%, -50%) translate(-pan.x, -pan.y) rotate(rot) scale(zoom)
 *
 * To save, we set the output canvas to the bounding box (in source
 * pixels), then replay the transform so the underlying image lands in
 * the same place relative to the bounding box that the user saw.
 */
function cropFromCorners(
  source: HTMLImageElement,
  viewport: { w: number; h: number },
  corners: Corner[],
  zoom: number,
  panX: number,
  panY: number,
  rotation: number,
): HTMLCanvasElement {
  const sh = source.naturalHeight;
  const cssToSrc = sh / Math.max(1, viewport.h);

  const minX = Math.min(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxX = Math.max(...corners.map((c) => c.x));
  const maxY = Math.max(...corners.map((c) => c.y));
  const cropCssW = Math.max(1, maxX - minX);
  const cropCssH = Math.max(1, maxY - minY);
  // Centre of the crop bbox relative to the viewport centre, in CSS px.
  const cropCx = (minX + maxX) / 2 - viewport.w / 2;
  const cropCy = (minY + maxY) / 2 - viewport.h / 2;

  const outW = Math.max(1, Math.round(cropCssW * cssToSrc));
  const outH = Math.max(1, Math.round(cropCssH * cssToSrc));

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext("2d");
  if (!ctx) return out;

  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, outW, outH);

  ctx.save();
  // Move origin to the crop centre, then shift it back so it ends up
  // where the viewport centre would be relative to the bbox.
  ctx.translate(outW / 2, outH / 2);
  ctx.translate(-cropCx * cssToSrc, -cropCy * cssToSrc);
  // Now origin is at the (virtual) viewport centre. Replay transform.
  ctx.translate(-panX * cssToSrc, -panY * cssToSrc);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(zoom, zoom);
  ctx.drawImage(source, -source.naturalWidth / 2, -source.naturalHeight / 2);
  ctx.restore();

  return out;
}

// ---------- Component ----------

export function PhotoCapture({
  shape,
  cornerRadiusPercent = 0,
  outputMaxDimension,
  outputQuality = 0.85,
  guideText,
  onCapture,
  onCancel,
}: PhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [step, setStep] = useState<Step>("camera");
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<HTMLImageElement | null>(null);

  // Refine state.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  // Corners in viewport CSS pixels. Initialised to ~10% inset once the
  // viewport is measured in <RefineView>.
  const [corners, setCorners] = useState<Corner[]>([]);
  const [draggingCorner, setDraggingCorner] = useState<number | null>(null);

  const dragRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{ d: number; a: number; z: number; r: number } | null>(null);
  const viewportRef = useRef<{ w: number; h: number }>({ w: 0, h: 0 });

  // ---- Camera lifecycle ----
  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error && e.name === "NotAllowedError"
          ? "Camera access was denied. Enable it in your browser settings."
          : "Couldn't open the camera on this device.",
      );
    }
  }, []);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  useEffect(() => {
    if (step === "camera") void startCamera();
    return () => {
      if (step !== "camera") stopCamera();
    };
  }, [step, startCamera, stopCamera]);

  useEffect(() => () => stopCamera(), [stopCamera]);

  // ---- Capture a still ----
  const capture = useCallback(() => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d")?.drawImage(v, 0, 0);
    const img = new Image();
    img.onload = () => {
      setCaptured(img);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setRotation(0);
      setCorners([]); // reset; <RefineView> will seed once measured
      setStep("refine");
    };
    img.src = c.toDataURL("image/png");
    stopCamera();
  }, [stopCamera]);

  // ---- Refine gestures (image pan/zoom/rotate) ----
  const onPointerDown = (e: React.PointerEvent) => {
    if (draggingCorner !== null) return; // corner drag handled separately
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 2) {
      const [p1, p2] = Array.from(pointersRef.current.values());
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      gestureRef.current = {
        d: Math.hypot(dx, dy),
        a: (Math.atan2(dy, dx) * 180) / Math.PI,
        z: zoom,
        r: rotation,
      };
      dragRef.current = null;
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (draggingCorner !== null) return;
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size >= 2 && gestureRef.current) {
      const [p1, p2] = Array.from(pointersRef.current.values());
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const d = Math.hypot(dx, dy);
      const a = (Math.atan2(dy, dx) * 180) / Math.PI;
      const g = gestureRef.current;
      const nextZoom = Math.min(5, Math.max(1, g.z * (d / Math.max(1, g.d))));
      let da = a - g.a;
      if (da > 180) da -= 360;
      if (da < -180) da += 360;
      setZoom(nextZoom);
      setRotation(((g.r + da) % 360 + 360) % 360);
      return;
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) gestureRef.current = null;
    if (pointersRef.current.size === 0) dragRef.current = null;
  };
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    setZoom((z) => Math.min(5, Math.max(1, z * (e.deltaY < 0 ? 1.1 : 1 / 1.1))));
  };

  // ---- Corner drag ----
  const onCornerPointerDown = (idx: number) => (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDraggingCorner(idx);
  };
  const onCornerPointerMove = (e: React.PointerEvent) => {
    if (draggingCorner === null) return;
    e.stopPropagation();
    const vp = viewportRef.current;
    // Translate clientX/Y into viewport-local coords. We store the
    // viewport rect's top-left in a ref via <RefineView>'s onMeasure.
    const rect = viewportRectRef.current;
    if (!rect) return;
    const x = Math.max(0, Math.min(vp.w, e.clientX - rect.left));
    const y = Math.max(0, Math.min(vp.h, e.clientY - rect.top));
    setCorners((prev) => prev.map((c, i) => (i === draggingCorner ? { x, y } : c)));
  };
  const onCornerPointerUp = (e: React.PointerEvent) => {
    e.stopPropagation();
    setDraggingCorner(null);
  };

  const viewportRectRef = useRef<{ left: number; top: number } | null>(null);

  // ---- Save ----
  const save = useCallback(async () => {
    if (!captured || corners.length !== 4) return;
    setStep("saving");
    try {
      let canvas = cropFromCorners(
        captured,
        viewportRef.current,
        corners,
        zoom,
        pan.x,
        pan.y,
        rotation,
      );
      canvas = resizeToMaxDimension(canvas, outputMaxDimension);
      if (shape === "round") {
        canvas = applyCircularMask(canvas);
      } else if ((shape === "rectangle" || shape === "square") && cornerRadiusPercent > 0) {
        canvas = applyRoundedCorners(canvas, cornerRadiusPercent);
      }
      const blob = await canvasToWebP(canvas, outputQuality);
      onCapture(blob, { width: canvas.width, height: canvas.height });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the photo.");
      setStep("refine");
    }
  }, [captured, corners, shape, zoom, pan, rotation, outputMaxDimension, outputQuality, cornerRadiusPercent, onCapture]);

  // ---- Render ----

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black text-white"
      style={{ touchAction: "none" }}
    >
      {/* Top bar */}
      <div className="flex items-center justify-between p-4">
        <button
          onClick={() => {
            stopCamera();
            onCancel();
          }}
          className="rounded-full bg-white/10 p-2 hover:bg-white/20"
          aria-label="Cancel"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="text-xs uppercase tracking-[0.3em] opacity-60">
          {step === "camera" ? "Photograph" : step === "refine" ? "Drag corners to card edges" : "Saving"}
        </div>
        <div className="w-9" />
      </div>

      {/* Body */}
      <div className="relative flex-1 overflow-hidden">
        {step === "camera" && (
          <CameraView videoRef={videoRef} error={error} />
        )}
        {step === "refine" && captured && (
          <RefineView
            image={captured}
            zoom={zoom}
            pan={pan}
            rotation={rotation}
            corners={corners}
            draggingCorner={draggingCorner}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onWheel={onWheel}
            onCornerPointerDown={onCornerPointerDown}
            onCornerPointerMove={onCornerPointerMove}
            onCornerPointerUp={onCornerPointerUp}
            onMeasure={(viewport, rect) => {
              viewportRef.current = viewport;
              viewportRectRef.current = rect;
              if (corners.length !== 4) {
                setCorners([
                  { x: viewport.w * 0.1, y: viewport.h * 0.1 },
                  { x: viewport.w * 0.9, y: viewport.h * 0.1 },
                  { x: viewport.w * 0.9, y: viewport.h * 0.9 },
                  { x: viewport.w * 0.1, y: viewport.h * 0.9 },
                ]);
              }
            }}
          />
        )}
        {step === "saving" && (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin opacity-70" />
          </div>
        )}

        {guideText && step === "camera" && !error && (
          <div className="pointer-events-none absolute inset-x-0 bottom-32 text-center text-sm opacity-80">
            {guideText ?? "Photograph your card. Try to fill the frame."}
          </div>
        )}
        {step === "camera" && !guideText && !error && (
          <div className="pointer-events-none absolute inset-x-0 bottom-32 text-center text-sm opacity-80">
            Photograph your card. Try to fill the frame.
          </div>
        )}
      </div>

      {/* Bottom controls */}
      <div className="flex items-center justify-center gap-6 p-6">
        {step === "camera" && (
          <button
            onClick={capture}
            disabled={!!error}
            className="h-20 w-20 rounded-full border-4 border-white bg-white/0 transition active:scale-95 disabled:opacity-40"
            aria-label="Capture"
          >
            <span className="block h-full w-full rounded-full bg-white" />
          </button>
        )}
        {step === "refine" && (
          <>
            <button
              onClick={() => {
                setCaptured(null);
                setStep("camera");
              }}
              className="rounded-full bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
            >
              Retake
            </button>
            <button
              onClick={() => setRotation((r) => (r - 90 + 360) % 360)}
              className="rounded-full bg-white/10 p-3 hover:bg-white/20"
              aria-label="Rotate left 90°"
            >
              <RotateCcw className="h-5 w-5" />
            </button>
            <button
              onClick={() => setRotation((r) => (r + 90) % 360)}
              className="rounded-full bg-white/10 p-3 hover:bg-white/20"
              aria-label="Rotate right 90°"
            >
              <RotateCw className="h-5 w-5" />
            </button>
            <button
              onClick={() => {
                setZoom(1);
                setPan({ x: 0, y: 0 });
                setRotation(0);
                const vp = viewportRef.current;
                if (vp.w && vp.h) {
                  setCorners([
                    { x: vp.w * 0.1, y: vp.h * 0.1 },
                    { x: vp.w * 0.9, y: vp.h * 0.1 },
                    { x: vp.w * 0.9, y: vp.h * 0.9 },
                    { x: vp.w * 0.1, y: vp.h * 0.9 },
                  ]);
                }
              }}
              className="rounded-full bg-white/10 p-3 hover:bg-white/20"
              aria-label="Reset"
            >
              <Undo2 className="h-5 w-5" />
            </button>
            <button
              onClick={save}
              className="flex items-center gap-2 rounded-full bg-white px-5 py-2 text-sm font-medium text-black hover:bg-white/90"
            >
              <Check className="h-4 w-4" /> Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function CameraView({
  videoRef,
  error,
}: {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  error: string | null;
}) {
  if (error) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center text-sm opacity-80">
        {error}
      </div>
    );
  }
  return (
    <div className="relative h-full w-full">
      <video
        ref={videoRef}
        playsInline
        muted
        className="h-full w-full object-cover"
      />
    </div>
  );
}

function RefineView({
  image,
  zoom,
  pan,
  rotation,
  corners,
  draggingCorner,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onWheel,
  onCornerPointerDown,
  onCornerPointerMove,
  onCornerPointerUp,
  onMeasure,
}: {
  image: HTMLImageElement;
  zoom: number;
  pan: { x: number; y: number };
  rotation: number;
  corners: Corner[];
  draggingCorner: number | null;
  onPointerDown: (e: React.PointerEvent) => void;
  onPointerMove: (e: React.PointerEvent) => void;
  onPointerUp: (e: React.PointerEvent) => void;
  onWheel: (e: React.WheelEvent) => void;
  onCornerPointerDown: (idx: number) => (e: React.PointerEvent) => void;
  onCornerPointerMove: (e: React.PointerEvent) => void;
  onCornerPointerUp: (e: React.PointerEvent) => void;
  onMeasure: (
    viewport: { w: number; h: number },
    rect: { left: number; top: number },
  ) => void;
}) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      onMeasure({ w: r.width, h: r.height }, { left: r.left, top: r.top });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("scroll", measure, true);
    return () => {
      ro.disconnect();
      window.removeEventListener("scroll", measure, true);
    };
  }, [onMeasure]);

  // Build SVG polygon path for the crop boundary.
  const polyPoints =
    corners.length === 4
      ? corners.map((c) => `${c.x},${c.y}`).join(" ")
      : "";

  return (
    <div
      ref={wrapRef}
      className="relative h-full w-full select-none overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={(e) => {
        onPointerMove(e);
        onCornerPointerMove(e);
      }}
      onPointerUp={(e) => {
        onPointerUp(e);
        onCornerPointerUp(e);
      }}
      onPointerCancel={(e) => {
        onPointerUp(e);
        onCornerPointerUp(e);
      }}
      onWheel={onWheel}
      style={{ touchAction: "none" }}
    >
      <img
        src={image.src}
        alt=""
        draggable={false}
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          maxWidth: "none",
          maxHeight: "none",
          width: "auto",
          height: "100%",
          transform: `translate(-50%, -50%) translate(${-pan.x}px, ${-pan.y}px) rotate(${rotation}deg) scale(${zoom})`,
          transformOrigin: "center center",
        }}
      />

      {/* Dim outside the polygon + draw the crop boundary. */}
      {corners.length === 4 && (
        <>
          <svg
            className="pointer-events-none absolute inset-0 h-full w-full"
            xmlns="http://www.w3.org/2000/svg"
          >
            <defs>
              <mask id="crop-cutout">
                <rect width="100%" height="100%" fill="white" />
                <polygon points={polyPoints} fill="black" />
              </mask>
            </defs>
            <rect
              width="100%"
              height="100%"
              fill="rgba(0,0,0,0.55)"
              mask="url(#crop-cutout)"
            />
            <polygon
              points={polyPoints}
              fill="none"
              stroke="rgba(255,255,255,0.95)"
              strokeWidth={2}
            />
          </svg>

          {/* Corner handles */}
          {corners.map((c, i) => (
            <div
              key={i}
              onPointerDown={onCornerPointerDown(i)}
              role="slider"
              aria-label={`Corner ${i + 1}`}
              style={{
                position: "absolute",
                left: c.x - 22,
                top: c.y - 22,
                width: 44,
                height: 44,
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                touchAction: "none",
                cursor: "grab",
                zIndex: 30,
              }}
            >
              <span
                style={{
                  width: draggingCorner === i ? 22 : 18,
                  height: draggingCorner === i ? 22 : 18,
                  borderRadius: "50%",
                  background: "var(--gold, #d4af37)",
                  border: "2px solid white",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.6)",
                  transition: "width 120ms, height 120ms",
                }}
              />
            </div>
          ))}
        </>
      )}
    </div>
  );
}
