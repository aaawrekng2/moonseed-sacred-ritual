/**
 * Q61 Fix 12 — Thin wrapper around the canonical DrawCalendar.
 * Existing call sites (StalkersTab) keep their {appearances} prop shape.
 */
import { DrawCalendar } from "./DrawCalendar";

export function StalkerCalendar({
  appearances,
}: {
  appearances: Array<{ readingId: string; date: string }>;
}) {
  return <DrawCalendar appearances={appearances} monthsBack={3} />;
}