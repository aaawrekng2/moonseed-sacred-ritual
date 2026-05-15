/**
 * EQ-B — Lunation Recap export utilities.
 *
 * - `exportRecapPdf`: builds a styled multi-page PDF directly with jsPDF
 *   (no DOM rasterization, so layout is reliable on every device).
 * - `shareRecapImage`: rasterizes a target DOM node with html2canvas-pro
 *   (handles oklch/color-mix), then either invokes the Web Share API or
 *   triggers a PNG download.
 */
import jsPDF from "jspdf";

type RecapData = {
  lunationStart: string;
  lunationEnd: string;
  readingCount: number;
  topStalker: { cardId: number; count: number; cardName: string } | null;
  suitBalance: { wands: number; cups: number; swords: number; pentacles: number };
  topGuide: { name: string; count: number } | null;
  majorMinor: { major: number; minor: number };
  reversalRate: number;
  topMoonPhase: { phase: string; count: number } | null;
  topPairs: Array<{ cardAName: string; cardBName: string; count: number }>;
  topTags: Array<{ tagName: string; count: number }>;
};

function fmtRange(startIso: string, endIso: string) {
  const s = new Date(startIso);
  const e = new Date(endIso);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  return `${s.toLocaleDateString(undefined, opts)} – ${e.toLocaleDateString(undefined, opts)}`;
}

/**
 * Build a clean multi-page A5 PDF from the recap data and trigger a download.
 * Uses jsPDF directly so we don't depend on DOM rasterization.
 */
export async function exportRecapPdf(data: RecapData, reflection: string | null) {
  const doc = new jsPDF({ unit: "pt", format: "a5", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;

  const drawBg = () => {
    doc.setFillColor(10, 10, 20);
    doc.rect(0, 0, pageW, pageH, "F");
  };
  const setGold = () => doc.setTextColor(206, 168, 92);
  const setText = () => doc.setTextColor(232, 226, 212);
  const setMuted = () => doc.setTextColor(170, 165, 150);

  const heading = (text: string, y: number) => {
    setGold();
    doc.setFont("times", "italic");
    doc.setFontSize(22);
    doc.text(text, pageW / 2, y, { align: "center" });
  };
  const eyebrow = (text: string, y: number) => {
    setMuted();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(text.toUpperCase(), pageW / 2, y, { align: "center", charSpace: 2 });
  };
  const big = (text: string, y: number) => {
    setGold();
    doc.setFont("times", "italic");
    doc.setFontSize(48);
    doc.text(text, pageW / 2, y, { align: "center" });
  };
  const body = (text: string, y: number, opts: { align?: "left" | "center"; size?: number } = {}) => {
    setText();
    doc.setFont("times", "italic");
    doc.setFontSize(opts.size ?? 11);
    const align = opts.align ?? "center";
    const x = align === "center" ? pageW / 2 : margin;
    const width = pageW - margin * 2;
    const lines = doc.splitTextToSize(text, width);
    doc.text(lines, x, y, { align });
    return y + lines.length * (opts.size ?? 11) * 1.4;
  };

  // Cover
  drawBg();
  eyebrow("Tarot Seed", 60);
  heading("Your Lunation", 110);
  body(fmtRange(data.lunationStart, data.lunationEnd), 138, { size: 10 });
  big(String(data.readingCount), pageH / 2);
  body(`reading${data.readingCount === 1 ? "" : "s"} in this cycle`, pageH / 2 + 28);

  // Page 2 — Top stalker / Major Minor / Reversal
  doc.addPage(); drawBg();
  eyebrow("Top stalker", 60);
  if (data.topStalker) {
    heading(data.topStalker.cardName, 100);
    body(`Arrived ${data.topStalker.count} time${data.topStalker.count === 1 ? "" : "s"}.`, 130);
  } else {
    body("No card stood out.", 110);
  }

  eyebrow("Major / Minor", 200);
  big(`${Math.round(Math.max(data.majorMinor.major, data.majorMinor.minor))}%`, 260);
  body(
    data.majorMinor.major >= data.majorMinor.minor ? "Major Arcana led" : "Minor Arcana led",
    285,
  );

  eyebrow("Reversals", 360);
  big(`${Math.round(data.reversalRate * 100)}%`, 410);
  body("of cards arrived reversed", 432);

  // Page 3 — Suit balance / Top moon phase / Top guide
  doc.addPage(); drawBg();
  eyebrow("Suit balance", 60);
  const suits = [
    { name: "Wands", v: data.suitBalance.wands },
    { name: "Cups", v: data.suitBalance.cups },
    { name: "Swords", v: data.suitBalance.swords },
    { name: "Pentacles", v: data.suitBalance.pentacles },
  ].sort((a, b) => b.v - a.v);
  let y = 90;
  suits.forEach((s) => {
    setText();
    doc.setFont("times", "italic");
    doc.setFontSize(12);
    doc.text(s.name, margin, y);
    doc.text(`${Math.round(s.v)}%`, pageW - margin, y, { align: "right" });
    y += 22;
  });

  eyebrow("Top moon phase", 200);
  if (data.topMoonPhase) {
    heading(data.topMoonPhase.phase, 240);
    body(`${data.topMoonPhase.count} reading${data.topMoonPhase.count === 1 ? "" : "s"}`, 268);
  } else {
    body("No phase pattern this cycle.", 240);
  }

  eyebrow("Top guide", 340);
  if (data.topGuide) {
    heading(data.topGuide.name, 380);
    body(`Walked with you ${data.topGuide.count} time${data.topGuide.count === 1 ? "" : "s"}.`, 410);
  } else {
    body("No guide chosen this cycle.", 380);
  }

  // Page 4 — Pairs and tags
  if (data.topPairs.length || data.topTags.length) {
    doc.addPage(); drawBg();
    eyebrow("Card pairs", 60);
    let py = 90;
    if (data.topPairs.length) {
      data.topPairs.slice(0, 5).forEach((p) => {
        setText();
        doc.setFont("times", "italic");
        doc.setFontSize(11);
        doc.text(`${p.cardAName} + ${p.cardBName}`, margin, py);
        setMuted();
        doc.text(`×${p.count}`, pageW - margin, py, { align: "right" });
        py += 20;
      });
    } else {
      body("No notable pairs.", py);
      py += 24;
    }

    eyebrow("Top themes", py + 24);
    py += 50;
    if (data.topTags.length) {
      const tagLine = data.topTags.slice(0, 8).map((t) => `${t.tagName} (${t.count})`).join(" · ");
      body(tagLine, py, { size: 11 });
    } else {
      body("No tagged themes this cycle.", py);
    }
  }

  // Page 5 — Reflection (if present)
  if (reflection) {
    doc.addPage(); drawBg();
    eyebrow("Reflection", 60);
    body(reflection, 100, { align: "left", size: 11 });
  }

  const filename = `lunation-recap-${data.lunationStart.slice(0, 10)}.pdf`;
  doc.save(filename);
}

/**
 * ES-6 — Year of Lunations PDF export.
 * 4-page A5 portrait document mirroring the in-app premium story.
 */
export type YearOfLunationsPdfData = {
  startDate: string;
  endDate: string;
  totalReadings: number;
  daysRead: number;
  topCard: { cardName: string; count: number } | null;
  topMoonPhase: { phase: string; count: number } | null;
  topGuide: { name: string; count: number } | null;
  topLens: { name: string; count: number } | null;
  evolvedTag: { tag: string; older: number; recent: number } | null;
  longestStreak: number;
  topPairs: Array<{ cardAName: string; cardBName: string; count: number }>;
  reflection: string | null;
};

export async function exportYearOfLunationsPdf(data: YearOfLunationsPdfData): Promise<void> {
  const doc = new jsPDF({ unit: "pt", format: "a5", orientation: "portrait" });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 36;

  const drawBg = () => {
    doc.setFillColor(10, 10, 20);
    doc.rect(0, 0, pageW, pageH, "F");
  };
  const setGold = () => doc.setTextColor(206, 168, 92);
  const setText = () => doc.setTextColor(232, 226, 212);
  const setMuted = () => doc.setTextColor(170, 165, 150);
  const heading = (text: string, y: number) => {
    setGold();
    doc.setFont("times", "italic");
    doc.setFontSize(22);
    doc.text(text, pageW / 2, y, { align: "center" });
  };
  const eyebrow = (text: string, y: number) => {
    setMuted();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(text.toUpperCase(), pageW / 2, y, { align: "center", charSpace: 2 });
  };
  const big = (text: string, y: number) => {
    setGold();
    doc.setFont("times", "italic");
    doc.setFontSize(48);
    doc.text(text, pageW / 2, y, { align: "center" });
  };
  const body = (text: string, y: number, opts: { align?: "left" | "center"; size?: number } = {}) => {
    setText();
    doc.setFont("times", "italic");
    doc.setFontSize(opts.size ?? 11);
    const align = opts.align ?? "center";
    const x = align === "center" ? pageW / 2 : margin;
    const width = pageW - margin * 2;
    const lines = doc.splitTextToSize(text, width);
    doc.text(lines, x, y, { align });
    return y + lines.length * (opts.size ?? 11) * 1.4;
  };

  // Page 1 — Hero
  drawBg();
  eyebrow("Tarot Seed", 60);
  heading("A Year of Lunations", 110);
  body(`${data.startDate} – ${data.endDate}`, 138, { size: 10 });
  big(String(data.totalReadings), pageH / 2);
  body(`readings across ${data.daysRead} days`, pageH / 2 + 28);

  // Page 2 — Card / Moon / Streak
  doc.addPage(); drawBg();
  eyebrow("Card of the year", 60);
  if (data.topCard) {
    heading(data.topCard.cardName, 100);
    body(`Visited ${data.topCard.count} times.`, 130);
  } else {
    body("No standout card.", 110);
  }
  eyebrow("Moon phase of the year", 200);
  heading(data.topMoonPhase?.phase ?? "—", 240);
  if (data.topMoonPhase) body(`${data.topMoonPhase.count} readings`, 268);
  eyebrow("Longest streak", 360);
  big(String(data.longestStreak), 410);
  body(`day${data.longestStreak === 1 ? "" : "s"} in a row`, 432);

  // Page 3 — Guide / Lens / Theme / Pairs
  doc.addPage(); drawBg();
  eyebrow("Top guide", 60);
  heading(data.topGuide?.name ?? "—", 100);
  if (data.topGuide) body(`Walked with you ${data.topGuide.count} times.`, 130);
  eyebrow("Top lens", 200);
  heading(data.topLens?.name ?? "—", 240);
  if (data.topLens) body(`Your favored angle, ${data.topLens.count} times.`, 268);
  eyebrow("Evolved theme", 340);
  if (data.evolvedTag) {
    heading(data.evolvedTag.tag, 380);
    body(`${data.evolvedTag.recent} recent · ${data.evolvedTag.older} earlier.`, 410);
  } else {
    body("—", 380);
  }
  if (data.topPairs.length) {
    eyebrow("Recurring pairs", 460);
    let py = 485;
    data.topPairs.slice(0, 3).forEach((p) => {
      setText();
      doc.setFont("times", "italic");
      doc.setFontSize(11);
      doc.text(`${p.cardAName} + ${p.cardBName}`, margin, py);
      setMuted();
      doc.text(`×${p.count}`, pageW - margin, py, { align: "right" });
      py += 18;
    });
  }

  // Page 4 — Reflection
  if (data.reflection) {
    doc.addPage(); drawBg();
    eyebrow("Reflection", 60);
    body(data.reflection, 100, { align: "left", size: 11 });
  }

  const filename = `Year-of-Lunations-${data.endDate.slice(0, 7)}.pdf`;
  doc.save(filename);
}

/**
 * Capture a DOM node as a PNG and either share it via the Web Share API
 * or trigger a download as a fallback.
 */
export async function shareRecapImage(node: HTMLElement, filename: string) {
  // Dynamic import keeps the heavy rasterizer out of the initial bundle.
  const html2canvas = (await import("html2canvas-pro")).default;
  const canvas = await html2canvas(node, {
    backgroundColor: "#0a0a14",
    scale: 2,
    useCORS: true,
  });
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/png"));
  if (!blob) throw new Error("Could not generate image.");
  const file = new File([blob], filename, { type: "image/png" });

  // Try Web Share API with files (mobile).
  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void>;
  };
  if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) {
    try {
      await nav.share({ files: [file], title: "Tarot Seed — Lunation Recap" });
      return { shared: true };
    } catch {
      // user cancelled — fall through to download
    }
  }

  // Fallback: download.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { shared: false };
}