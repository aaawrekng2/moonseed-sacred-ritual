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

const INLINE_RE =
  /(\*\*([^*]+)\*\*)|(_([^_]+)_)|(\*([^*]+)\*)|(\[([^\]]+)\]\(([^)]+)\))/;

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
      out.push(
        <strong key={k++} style={{ fontWeight: 600 }}>
          {m[2]}
        </strong>,
      );
    } else if (m[3]) {
      out.push(
        <em key={k++} style={{ fontStyle: "italic" }}>
          {m[4]}
        </em>,
      );
    } else if (m[5]) {
      out.push(
        <em key={k++} style={{ fontStyle: "italic" }}>
          {m[6]}
        </em>,
      );
    } else if (m[7]) {
      const href = safeHref(m[9]);
      if (href) {
        out.push(
          <a
            key={k++}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--accent)", textDecoration: "underline" }}
          >
            {m[8]}
          </a>,
        );
      } else {
        out.push(m[8]);
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
  const text = (source ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
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
