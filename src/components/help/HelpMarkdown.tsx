/**
 * DP-5 — tiny markdown renderer scoped to the help system.
 *
 * Intentionally minimal — we don't want to ship a full markdown
 * dependency just for five articles. Supports:
 *   ## heading
 *   - bullet
 *   1. ordered (rendered as bullet — order doesn't matter for UX)
 *   **bold**
 *   *italic*
 *   [text](#article-id)  → router Link to /help/{cat}/{id}
 *   [text](https://...)  → external link
 */
import { Link } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";
import { getArticleById } from "@/lib/help-articles";

function renderInline(text: string, keyBase: string): ReactNode[] {
  // Tokenize into [link, bold, italic, text] segments.
  const out: ReactNode[] = [];
  const re =
    /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*|\*([^*]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${keyBase}-${i++}`;
    if (m[1] !== undefined && m[2] !== undefined) {
      const label = m[1];
      const target = m[2];
      if (target.startsWith("#")) {
        const article = getArticleById(target.slice(1));
        if (article) {
          out.push(
            <Link
              key={k}
              to="/help/$category/$article"
              params={{ category: article.category, article: article.id }}
              style={{
                color: "var(--accent)",
                fontStyle: "italic",
                textDecoration: "none",
              }}
            >
              {label}
            </Link>,
          );
        } else {
          out.push(label);
        }
      } else {
        out.push(
          <a
            key={k}
            href={target}
            target="_blank"
            rel="noreferrer noopener"
            style={{ color: "var(--accent)", fontStyle: "italic" }}
          >
            {label}
          </a>,
        );
      }
    } else if (m[3] !== undefined) {
      out.push(<strong key={k}>{m[3]}</strong>);
    } else if (m[4] !== undefined) {
      out.push(<em key={k}>{m[4]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function HelpMarkdown({ source }: { source: string }) {
  const blocks = source.split(/\n\n+/);
  const nodes: ReactNode[] = [];
  blocks.forEach((block, bi) => {
    const trimmed = block.trim();
    if (!trimmed) return;
    if (trimmed.startsWith("## ")) {
      nodes.push(
        <h2
          key={`h-${bi}`}
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-h3, 1.25rem)",
            color: "var(--foreground)",
            margin: "1.4em 0 0.4em",
            opacity: 0.95,
          }}
        >
          {renderInline(trimmed.slice(3), `h-${bi}`)}
        </h2>,
      );
      return;
    }
    const lines = trimmed.split("\n");
    const isList = lines.every((l) => /^(\s*[-*]|\s*\d+\.)\s+/.test(l));
    if (isList) {
      nodes.push(
        <ul
          key={`ul-${bi}`}
          style={{
            margin: "0.6em 0",
            paddingLeft: "1.2em",
            color: "var(--foreground)",
            opacity: 0.9,
            lineHeight: 1.6,
          }}
        >
          {lines.map((l, li) => (
            <li key={`li-${bi}-${li}`} style={{ marginBottom: "0.3em" }}>
              {renderInline(l.replace(/^(\s*[-*]|\s*\d+\.)\s+/, ""), `li-${bi}-${li}`)}
            </li>
          ))}
        </ul>,
      );
      return;
    }
    nodes.push(
      <p
        key={`p-${bi}`}
        style={{
          fontFamily: "var(--font-serif)",
          color: "var(--foreground)",
          opacity: 0.9,
          lineHeight: 1.7,
          margin: "0.6em 0",
        }}
      >
        {renderInline(trimmed, `p-${bi}`)}
      </p>,
    );
  });
  return <Fragment>{nodes}</Fragment>;
}