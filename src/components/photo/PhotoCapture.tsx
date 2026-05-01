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
  /**
   * BN Fix 1 — when set, skip the camera step and land directly on the
   * 4-corner refine view using this blob as the source image. Used by
   * the deck-import wizard's "Edit" action so existing imported images
   * can be re-cropped without re-photographing.
   */
  initialBlob?: Blob | null;
  onCapture: (
    blob: Blob,
    dimensions: { width: number; height: number },
  ) => void;
  onCancel: () => void;
};

type Step = "camera" | "refine" | "saving";
type Corner = { x: number; y: number }; // BP Fix 5 — normalized image coords (0..1)

// ---------- Canvas helpers ----------

export function applyRoundedCorners(
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
 * BP Fix 5 — corners are stored in normalized image coordinates (0..1).
 * Crop is just the bounding box of those normalized corners mapped into
 * source-pixel space; pan/zoom/rotation no longer affect the output.
 */
function cropFromCorners(
  source: HTMLImageElement,
  corners: Corner[],
): HTMLCanvasElement {
  const sw = source.naturalWidth;
  const sh = source.naturalHeight;
  const minX = Math.max(0, Math.min(...corners.map((c) => c.x)));
  const minY = Math.max(0, Math.min(...corners.map((c) => c.y)));
  const maxX = Math.min(1, Math.max(...corners.map((c) => c.x)));
  const maxY = Math.min(1, Math.max(...corners.map((c) => c.y)));
  // BQ Fix 4C — defensive logging + degenerate guard.
  const cropWf = (maxX - minX) * sw;
  const cropHf = (maxY - minY) * sh;
  console.log("[cropFromCorners]", {
    naturalWidth: sw,
    naturalHeight: sh,
    corners,
    bbox: { minX, minY, maxX, maxY },
    cropPx: { x: minX * sw, y: minY * sh, w: cropWf, h: cropHf },
  });
  if (cropWf < 1 || cropHf < 1 || !isFinite(cropWf) || !isFinite(cropHf)) {
    throw new Error(`cropFromCorners: degenerate crop box ${cropWf}×${cropHf}`);
  }
  const sx = Math.round(minX * sw);
  const sy = Math.round(minY * sh);
  const sWidth = Math.max(1, Math.round((maxX - minX) * sw));
  const sHeight = Math.max(1, Math.round((maxY - minY) * sh));
  const out = document.createElement("canvas");
  out.width = sWidth;
  out.height = sHeight;
  const ctx = out.getContext("2d");
  if (!ctx) return out;
  ctx.drawImage(source, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
  return out;
}

// BP Fix 5 — image ↔ screen coordinate transforms.
// Image is rendered fitting viewport by HEIGHT (height:100%, width:auto)
// then a CSS transform of translate(-pan, -pan) rotate(rot) scale(zoom)
// is applied around the viewport center. baseScale = viewport.h / img.h.
function imageToScreen(
  imgPt: { x: number; y: number },
  imgDims: { w: number; h: number },
  viewport: { w: number; h: number },
  pan: { x: number; y: number },
  zoom: number,
  rotationDeg: number,
): { x: number; y: number } {
  const cx = viewport.w / 2;
  const cy = viewport.h / 2;
  const ix = (imgPt.x - 0.5) * imgDims.w;
  const iy = (imgPt.y - 0.5) * imgDims.h;
  // BQ Fix 1B — image is rendered with object-fit: contain, so baseScale
  // is the smaller of the two fit ratios.
  const baseScale = Math.min(
    viewport.w / Math.max(1, imgDims.w),
    viewport.h / Math.max(1, imgDims.h),
  );
  const totalScale = baseScale * zoom;
  const r = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const rx = ix * cos - iy * sin;
  const ry = ix * sin + iy * cos;
  return {
    x: cx - pan.x + rx * totalScale,
    y: cy - pan.y + ry * totalScale,
  };
}

function screenToImage(
  scrPt: { x: number; y: number },
  imgDims: { w: number; h: number },
  viewport: { w: number; h: number },
  pan: { x: number; y: number },
  zoom: number,
  rotationDeg: number,
): { x: number; y: number } {
  const cx = viewport.w / 2;
  const cy = viewport.h / 2;
  const baseScale = Math.min(
    viewport.w / Math.max(1, imgDims.w),
    viewport.h / Math.max(1, imgDims.h),
  );
  const totalScale = baseScale * zoom;
  const sx = scrPt.x - cx + pan.x;
  const sy = scrPt.y - cy + pan.y;
  const rx = sx / totalScale;
  const ry = sy / totalScale;
  const r = (-rotationDeg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const ix = rx * cos - ry * sin;
  const iy = rx * sin + ry * cos;
  return {
    x: ix / Math.max(1, imgDims.w) + 0.5,
    y: iy / Math.max(1, imgDims.h) + 0.5,
  };
}

// ---------- Component ----------

export function PhotoCapture({
  shape,
  cornerRadiusPercent = 0,
  outputMaxDimension,
  outputQuality = 0.85,
  guideText,
  initialBlob,
  onCapture,
  onCancel,
}: PhotoCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [step, setStep] = useState<Step>(initialBlob ? "refine" : "camera");
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<HTMLImageElement | null>(null);

  // Refine state.
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [rotation, setRotation] = useState(0);
  // BP Fix 5 — corners in normalized image coordinates (0..1).
  // Independent of pan/zoom/rotation.
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

  // BN Fix 1 — when an initialBlob is provided, decode it into the
  // `captured` image once so RefineView can render it. We deliberately
  // never start the camera in this mode.
  useEffect(() => {
    if (!initialBlob) return;
    let cancelled = false;
    const url = URL.createObjectURL(initialBlob);
    const img = new Image();
    img.onload = () => {
      if (cancelled) return;
      setCaptured(img);
      setZoom(1);
      setPan({ x: 0, y: 0 });
      setRotation(0);
      setCorners([]);
    };
    img.src = url;
    return () => {
      cancelled = true;
      URL.revokeObjectURL(url);
    };
  }, [initialBlob]);

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
    } else if (pointersRef.current.size === 1) {
      // BW2 — 1-finger drag = pan. Capture start position + current pan.
      dragRef.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y };
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
    if (pointersRef.current.size === 1 && dragRef.current) {
      // BW2 — 1-finger drag = pan. Forward transform applies
      // translate(-pan.x, -pan.y), so dragging right increases pan.x.
      const dx = e.clientX - dragRef.current.x;
      const dy = e.clientY - dragRef.current.y;
      setPan({ x: dragRef.current.px + dx, y: dragRef.current.py + dy });
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) gestureRef.current = null;
    if (pointersRef.current.size === 1) {
      // BW2 — re-arm 1-finger pan from surviving pointer when
      // transitioning down from a 2-finger zoom/rotate gesture.
      const [p] = Array.from(pointersRef.current.values());
      dragRef.current = { x: p.x, y: p.y, px: pan.x, py: pan.y };
    }
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
    const rect = viewportRectRef.current;
    if (!rect || !captured) return;
    const imgDims = { w: captured.naturalWidth, h: captured.naturalHeight };
    const imgPt = screenToImage(
      { x: e.clientX - rect.left, y: e.clientY - rect.top },
      imgDims,
      vp,
      pan,
      zoom,
      rotation,
    );
    const x = Math.max(0, Math.min(1, imgPt.x));
    const y = Math.max(0, Math.min(1, imgPt.y));
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
      let canvas = cropFromCorners(captured, corners);
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
  }, [captured, corners, shape, outputMaxDimension, outputQuality, cornerRadiusPercent, onCapture]);

  // ---- Render ----

  return (
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-black text-white"
      style={{ touchAction: "none", overscrollBehavior: "contain" }}
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
                // BP Fix 5 — initial 10% inset in IMAGE space.
                setCorners([
                  { x: 0.1, y: 0.1 },
                  { x: 0.9, y: 0.1 },
                  { x: 0.9, y: 0.9 },
                  { x: 0.1, y: 0.9 },
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
            {!initialBlob && <button
              onClick={() => {
                setCaptured(null);
                setStep("camera");
              }}
              className="rounded-full bg-white/10 px-4 py-2 text-sm hover:bg-white/20"
            >
              Retake
            </button>}
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
                setCorners([
                  { x: 0.1, y: 0.1 },
                  { x: 0.9, y: 0.1 },
                  { x: 0.9, y: 0.9 },
                  { x: 0.1, y: 0.9 },
                ]);
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
  const [vp, setVp] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      setVp({ w: r.width, h: r.height });
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

  // BP Fix 5 — corners are in image space; project to screen for render.
  const imgDims = { w: image.naturalWidth, h: image.naturalHeight };
  const screenCorners =
    corners.length === 4 && vp.w > 0 && vp.h > 0
      ? corners.map((c) =>
          imageToScreen(c, imgDims, vp, pan, zoom, rotation),
        )
      : [];
  const polyPoints =
    screenCorners.length === 4
      ? screenCorners.map((c) => `${c.x},${c.y}`).join(" ")
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
          maxWidth: "100%",
          maxHeight: "100%",
          width: "auto",
          height: "auto",
          objectFit: "contain",
          transform: `translate(-50%, -50%) translate(${-pan.x}px, ${-pan.y}px) rotate(${rotation}deg) scale(${zoom})`,
          transformOrigin: "center center",
        }}
      />

      {/* Dim outside the polygon + draw the crop boundary. */}
      {screenCorners.length === 4 && (
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
          {screenCorners.map((c, i) => (
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
