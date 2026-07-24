/**
 * NoteMarkdown (v3.112)
 *
 * Renders a saved reading note written in a safe subset of Markdown as React
 * elements only — never dangerouslySetInnerHTML. Any embedded HTML renders as
 * literal text (React escapes text nodes), so a note containing
 * `<img onerror=...>` is shown verbatim and never executes.
 *
 * Supports: **bold**, *italic* / _italic_, #/##/### headings (NOTE-scale, not
 * page-display), - / * bullets, 1. ordered lists, single-newline line breaks,
 * [links](url) (http/https/mailto/relative only), and native Unicode emojis.
 * Styled via design tokens (theme-aware); body stays --color-foreground
 * (never --accent — anti-pattern 21.4). Display-only.
 */
import { Fragment, type CSSProperties, type ReactNode } from "react";

// v3.118 — repair notes whose UTF-8 emoji bytes were stored as Windows-1252
// (e.g. "ðŸ™" -> "🌙"). Used on display AND at
// save time. Only fires on a clean double-encoding; otherwise text is returned
// untouched (so legitimate accented/emoji notes are never harmed).
const CP1252_TO_BYTE: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};
// A continuation char = a UTF-8 continuation byte (0x80-0xBF) read as CP1252/
// Latin-1. Returns that byte, or -1 if the char isn't a continuation.
function contByte(ch: string): number {
  const cp = ch.codePointAt(0) ?? -1;
  if (cp >= 0x80 && cp <= 0xbf) return cp;
  const b = CP1252_TO_BYTE[cp];
  return b !== undefined && b >= 0x80 && b <= 0x9f ? b : -1;
}
// v3.120 — repair ONLY the mangled byte-runs in place, so a note that mixes a
// correctly-stored emoji with a mangled one still gets the mangled one fixed.
// Real chars, ASCII, and lone accents pass through untouched.
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

const INLINE_RE =
  /(\\[^\w\s])|(\*{2,}([^*]+)\*{2,})|(_([^_]+)_)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)]+)\))/;

function safeHref(url: string): string | null {
  const u = url.trim();
  return /^(https?:\/\/|mailto:|\/)/i.test(u) ? u : null;
}

// Inline: bold / italic / links. Everything else stays plain text (React
// auto-escapes text nodes, so raw HTML in a note can never execute).
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let rest = text;
  let k = 0;
  while (rest.length > 0) {
    const m = INLINE_RE.exec(rest);
    if (!m) {
      out.push(rest);
      break;
    }
    if (m.index > 0) out.push(rest.slice(0, m.index));
    if (m[1]) {
      // v3.118 — backslash-escaped punctuation renders as its literal char.
      out.push(m[1].slice(1));
    } else if (m[2]) {
      out.push(
        <strong key={k++} style={{ fontWeight: 600 }}>
          {m[3]}
        </strong>,
      );
    } else if (m[4]) {
      out.push(
        <em key={k++} style={{ fontStyle: "italic" }}>
          {m[5]}
        </em>,
      );
    } else if (m[6]) {
      out.push(
        <em key={k++} style={{ fontStyle: "italic" }}>
          {m[7]}
        </em>,
      );
    } else if (m[8]) {
      const href = safeHref(m[10]);
      if (href) {
        out.push(
          <a
            key={k++}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent)", textDecoration: "underline" }}
          >
            {m[9]}
          </a>,
        );
      } else {
        out.push(m[9]);
      }
    }
    rest = rest.slice(m.index + m[0].length);
  }
  return out;
}

function renderParagraph(lines: string[], key: number): ReactNode {
  const kids: ReactNode[] = [];
  lines.forEach((ln, i) => {
    if (i > 0) kids.push(<br key={`br-${i}`} />);
    kids.push(<Fragment key={`ln-${i}`}>{renderInline(ln)}</Fragment>);
  });
  return (
    <p
      key={key}
      style={{
        margin: "0 0 0.6em",
        fontSize: "var(--text-body)",
        color: "var(--color-foreground)",
        lineHeight: 1.65,
      }}
    >
      {kids}
    </p>
  );
}

const HEADING_STYLE: Record<1 | 2 | 3, CSSProperties> = {
  1: { fontSize: "var(--text-heading-sm)", fontWeight: 600, margin: "0.5em 0 0.3em" },
  2: { fontSize: "var(--text-body-lg)", fontWeight: 700, margin: "0.5em 0 0.25em" },
  3: { fontSize: "var(--text-body)", fontWeight: 700, margin: "0.5em 0 0.2em" },
};

export function NoteMarkdown({
  source,
  inline = false,
}: {
  source: string;
  inline?: boolean;
}): ReactNode {
  const text = fixMojibake(source ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
  if (!text.trim()) return null;

  // v3.117 — inline mode for compact previews: drop block markers, collapse to
  // one line, render only inline emphasis / links / emoji (safe inside a <p>).
  if (inline) {
    const flat = text
      .replace(/^#{1,3}\s+/gm, "")
      .replace(/^\s*[-*]\s+/gm, "\u2022 ")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/\n+/g, " ")
      .trim();
    return <Fragment>{renderInline(flat)}</Fragment>;
  }

  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") {
      i++;
      continue;
    }

    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1].length as 1 | 2 | 3;
      const hStyle: CSSProperties = {
        ...HEADING_STYLE[level],
        color: "var(--color-foreground)",
        lineHeight: 1.3,
      };
      const inner = renderInline(h[2]);
      blocks.push(
        level === 1 ? (
          <h1 key={key++} style={hStyle}>
            {inner}
          </h1>
        ) : level === 2 ? (
          <h2 key={key++} style={hStyle}>
            {inner}
          </h2>
        ) : (
          <h3 key={key++} style={hStyle}>
            {inner}
          </h3>
        ),
      );
      i++;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push(
        <ul
          key={key++}
          style={{
            margin: "0 0 0.6em",
            paddingLeft: "1.35em",
            fontSize: "var(--text-body)",
            color: "var(--color-foreground)",
            lineHeight: 1.6,
          }}
        >
          {items.map((it, idx) => (
            <li key={idx} style={{ margin: "0.15em 0" }}>
              {renderInline(it)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push(
        <ol
          key={key++}
          style={{
            margin: "0 0 0.6em",
            paddingLeft: "1.5em",
            fontSize: "var(--text-body)",
            color: "var(--color-foreground)",
            lineHeight: 1.6,
          }}
        >
          {items.map((it, idx) => (
            <li key={idx} style={{ margin: "0.15em 0" }}>
              {renderInline(it)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,3})\s+/.test(lines[i]) &&
      !/^\s*[-*]\s+/.test(lines[i]) &&
      !/^\s*\d+\.\s+/.test(lines[i])
    ) {
      para.push(lines[i]);
      i++;
    }
    blocks.push(renderParagraph(para, key++));
  }

  return <div style={{ color: "var(--color-foreground)" }}>{blocks}</div>;
}
