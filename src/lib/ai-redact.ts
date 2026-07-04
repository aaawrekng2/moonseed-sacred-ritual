/**
 * v2.70 — Never-share guard for outbound AI requests.
 *
 * Applied at the SINGLE callAI() gateway before any content leaves for a model
 * provider (Anthropic / the AI gateway). This is a hard-coded, defense-in-depth
 * backstop: callers already avoid putting sensitive identifiers in the prompt,
 * but this guarantees IN CODE that the never-share categories below cannot leak
 * even if a future feature accidentally includes them.
 *
 * NEVER shared with AI (scrubbed here by pattern):
 *   - email addresses
 *   - credit-card-like numbers
 *   - raw geographic coordinates (latitude/longitude pairs)
 *   - API keys / bearer tokens / JWT-like secrets
 *
 * Also never placed in AI context by callers (so there is nothing to scrub):
 *   - real name / display name / birth name
 *   - passwords, session tokens, MFA recovery codes
 *   - Stripe customer/subscription ids and card data
 *   - account UUID, IP address, device identifiers
 *   - raw uploaded images (photos, deck scans)
 *
 * What MAY be sent, and only when the seeker uses AI features (and, for the
 * memory summary, has granted memory permission): the reading itself (cards,
 * spread, their question and notes, moon phase), the memory summary (card
 * frequencies, recent tags, pattern/thread summaries), and — for deep readings
 * — birth date/time and birth place as a city name (never raw coordinates).
 */

const EMAIL = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
// 13–19 digit runs (optionally space/dash separated) = card-like
const CARD = /\b(?:\d[ -]?){13,19}\b/g;
// "lat, long" decimal coordinate pairs
const COORD = /-?\d{1,3}\.\d{3,}\s*,\s*-?\d{1,3}\.\d{3,}/g;
// api keys, bearer tokens, JWTs
const TOKEN = /\b(?:sk-|pk_|rk_|Bearer\s+|eyJ)[A-Za-z0-9._-]{12,}/g;

/** Scrub a single string of never-share patterns. */
export function redactForAI(text: string): string {
  if (!text) return text;
  return text
    .replace(EMAIL, "[redacted-email]")
    .replace(TOKEN, "[redacted]")
    .replace(CARD, "[redacted-number]")
    .replace(COORD, "[redacted-location]");
}

/** Recursively scrub any string values inside AI message content. */
export function redactContent(content: unknown): unknown {
  if (typeof content === "string") return redactForAI(content);
  if (Array.isArray(content)) return content.map(redactContent);
  if (content && typeof content === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(content as Record<string, unknown>)) {
      out[k] = redactContent(v);
    }
    return out;
  }
  return content;
}
