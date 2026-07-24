/**
 * note-text.ts (v3.122)
 *
 * Shared, dependency-free helpers for note text:
 *   - fixMojibake: repair UTF-8 emoji bytes stored as Latin-1/Windows-1252.
 *   - stripEscapes: drop ChatGPT-style backslash escapes (\* \! \. ...).
 *   - cleanNoteText: fixMojibake + stripEscapes (used on display, on save,
 *     and by the one-time repair button).
 *   - htmlToMarkdown: convert pasted rich HTML (e.g. Google Docs) into clean
 *     Markdown — structure only (bold, italic, headings, bullet + numbered
 *     lists, links). No highlights/colors/fonts (Markdown can't hold them).
 */

const CP1252_TO_BYTE: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};
function contByte(ch: string): number {
  const cp = ch.codePointAt(0) ?? -1;
  if (cp >= 0x80 && cp <= 0xbf) return cp;
  const b = CP1252_TO_BYTE[cp];
  return b !== undefined && b >= 0x80 && b <= 0x9f ? b : -1;
}

/** Repair mangled UTF-8 emoji runs in place; real chars pass through. */
export function fixMojibake(input: string): string {
  const s = input ?? "";
  if (!/[Â-ô]/.test(s)) return s;
  const chars = Array.from(s);
  let out = "";
  for (let i = 0; i < chars.length; ) {
    const lead = chars[i].codePointAt(0) ?? 0;
    let need = 0;
    if (lead >= 0xc2 && lead <= 0xdf) need = 1;
    else if (lead >= 0xe0 && lead <= 0xef) need = 2;
    else if (lead >= 0xf0 && lead <= 0xf4) need = 3;
    if (need > 0 && i + need < chars.length) {
      const bytes = [lead];
      let ok = true;
      for (let j = 1; j <= need; j++) {
        const b = contByte(chars[i + j]);
        if (b < 0) {
          ok = false;
          break;
        }
        bytes.push(b);
      }
      if (ok) {
        try {
          out += new TextDecoder("utf-8", { fatal: true }).decode(
            Uint8Array.from(bytes),
          );
          i += need + 1;
          continue;
        } catch {
          // invalid UTF-8 -> emit the lead char literally below
        }
      }
    }
    out += chars[i];
    i += 1;
  }
  return out;
}

/** Drop markdown-escape backslashes: \* \! \. \- \# ... -> the literal char. */
export function stripEscapes(input: string): string {
  return (input ?? "").replace(/\\([^\w\s])/g, "$1");
}

/** Full cleanup: fix mangled emoji AND normalize escaped markdown. */
export function cleanNoteText(input: string): string {
  return stripEscapes(fixMojibake(input ?? ""));
}

function isBold(el: HTMLElement): boolean {
  const fw = el.style?.fontWeight || "";
  if (fw === "normal" || fw === "lighter") return false;
  if (fw === "bold" || fw === "bolder") return true;
  const n = parseInt(fw, 10);
  if (!Number.isNaN(n)) return n >= 600;
  const tag = el.tagName.toLowerCase();
  return tag === "b" || tag === "strong";
}
function isItalic(el: HTMLElement): boolean {
  if ((el.style?.fontStyle || "") === "italic") return true;
  const tag = el.tagName.toLowerCase();
  return tag === "i" || tag === "em";
}

/** Rich HTML (Google Docs, etc.) -> clean Markdown. Structure only. */
export function htmlToMarkdown(html: string): string {
  if (!html || typeof DOMParser === "undefined") return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  const body = doc.body;
  if (!body) return "";

  const childInline = (el: Node): string => {
    let s = "";
    el.childNodes.forEach((c) => {
      s += inline(c);
    });
    return s;
  };
  const inline = (node: Node): string => {
    if (node.nodeType === 3)
      return (node.textContent || "").replace(/\s+/g, " ");
    if (node.nodeType !== 1) return "";
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === "br") return "\n";
    if (tag === "a") {
      const href = el.getAttribute("href") || "";
      const txt = childInline(el).trim();
      return href && txt ? `[${txt}](${href})` : childInline(el);
    }
    let inner = childInline(el);
    if (!inner.trim()) return inner;
    if (isBold(el)) inner = `**${inner.trim()}**`;
    else if (isItalic(el)) inner = `*${inner.trim()}*`;
    return inner;
  };

  const blocks: string[] = [];
  const walk = (node: Node): void => {
    node.childNodes.forEach((child) => {
      if (child.nodeType === 3) {
        const t = (child.textContent || "").replace(/\s+/g, " ").trim();
        if (t) blocks.push(t);
        return;
      }
      if (child.nodeType !== 1) return;
      const el = child as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (/^h[1-6]$/.test(tag)) {
        const level = Math.min(3, parseInt(tag.slice(1), 10) || 1);
        const txt = childInline(el).trim();
        if (txt) blocks.push("#".repeat(level) + " " + txt);
      } else if (tag === "ul" || tag === "ol") {
        const ordered = tag === "ol";
        let n = 1;
        const items: string[] = [];
        Array.from(el.children)
          .filter((c) => c.tagName.toLowerCase() === "li")
          .forEach((li) => {
            const txt = childInline(li).trim();
            if (txt) items.push((ordered ? `${n++}. ` : "- ") + txt);
          });
        // one block, items on consecutive lines -> renders as a single list.
        if (items.length) blocks.push(items.join("\n"));
      } else if (tag === "p") {
        const txt = childInline(el).trim();
        if (txt) blocks.push(txt);
      } else if (tag === "li") {
        const txt = childInline(el).trim();
        if (txt) blocks.push("- " + txt);
      } else if (tag === "br") {
        // skip at block level
      } else {
        const hasBlockKids = Array.from(el.children).some((c) =>
          /^(h[1-6]|ul|ol|p|div|li|table|section|article)$/.test(
            c.tagName.toLowerCase(),
          ),
        );
        if (hasBlockKids) walk(el);
        else {
          const txt = childInline(el).trim();
          if (txt) blocks.push(txt);
        }
      }
    });
  };
  walk(body);
  return blocks.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
