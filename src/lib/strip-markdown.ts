/**
 * Strip raw markdown markers from AI-generated text so the seeker sees
 * clean prose instead of `**bold**` or `### headers`. Conservative —
 * we only remove the syntactic noise, never the words around it.
 *
 * Used both at render-time (for legacy journal entries already saved
 * with raw markdown) and going forward (for fresh AI responses).
 */
export function stripMarkdown(input: string | null | undefined): string {
  if (!input) return "";
  let s = String(input);
  // Fenced code blocks → keep the inner text
  s = s.replace(/```[a-zA-Z]*\n?([\s\S]*?)```/g, "$1");
  // Inline code `x` → x
  s = s.replace(/`([^`]+)`/g, "$1");
  // Images ![alt](url) → alt
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Links [text](url) → text
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
  // Headings: leading #'s (one-or-more) followed by space
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, "");
  // Blockquotes: leading >
  s = s.replace(/^\s{0,3}>\s?/gm, "");
  // Horizontal rules
  s = s.replace(/^\s*([-*_])\1{2,}\s*$/gm, "");
  // Bold + italic combined ***text***
  s = s.replace(/\*\*\*([^*]+)\*\*\*/g, "$1");
  // Bold **text** or __text__
  s = s.replace(/\*\*([^*]+)\*\*/g, "$1");
  s = s.replace(/__([^_]+)__/g, "$1");
  // Italic *text* or _text_  (avoid eating bare apostrophes by requiring word boundary)
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, "$1$2");
  s = s.replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, "$1$2");
  // Strikethrough ~~text~~
  s = s.replace(/~~([^~]+)~~/g, "$1");
  // List markers at line start: -, *, +
  s = s.replace(/^\s*[-*+]\s+/gm, "");
  // Numbered list markers: "1. "
  s = s.replace(/^\s*\d+\.\s+/gm, "");
  return s;
}

/**
 * Q16 Fix 3 — strip the legacy "{spread} — Moonseed reading" prefix
 * that older readings captured into `readings.interpretation` because
 * `buildCopyText` was being persisted instead of the body.
 * Defensive: applied at render time wherever the interpretation is
 * shown, in addition to the one-time DB cleanup migration.
 */
export function stripLegacyMoonseedPrefix(
  input: string | null | undefined,
): string {
  if (!input) return "";
  return String(input).replace(
    /^[A-Za-z]+(\s+[A-Za-z]+)?\s+—\s+Moonseed reading\s*\n*/i,
    "",
  );
}