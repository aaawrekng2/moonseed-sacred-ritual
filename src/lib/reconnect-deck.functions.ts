/**
 * EJ44 — Self-healing reconnect tool.
 *
 * Scans the seeker's reading history and, for any card slot whose
 * `card_id` exists in the target deck but whose `card_deck_ids[i]`
 * doesn't point at that deck, updates the slot to reference the
 * target deck. Returns counts so the UI can show a clear summary.
 *
 * Architecture notes:
 *   - Tarot card_ids (0–77) are canonical across all decks — they
 *     describe the same archetype regardless of which deck rendered
 *     them. We DO NOT touch card_ids in this fix; only the per-slot
 *     deck_id pointer is updated.
 *   - Aggregations (stalkers, frequency) bucket by card_id only, so
 *     they remain unaffected by this operation.
 *   - Oracle card_ids (1000+) are deck-scoped today. We only reconnect
 *     them if the target deck explicitly carries that card_id.
 *   - This is idempotent: re-running on an already-correct reading
 *     does nothing. Safe to expose as a button users can press more
 *     than once.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const Input = z.object({
  deckId: z.string().uuid(),
  /** If true, only reports what WOULD change without writing. */
  dryRun: z.boolean().optional(),
});

export const reconnectReadingsToDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => Input.parse(raw))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { deckId, dryRun } = data;

    // Confirm the deck belongs to this user.
    const { data: deckRow, error: deckErr } = await supabaseAdmin
      .from("custom_decks" as never)
      .select("id, name, user_id")
      .eq("id", deckId)
      .maybeSingle();
    if (deckErr || !deckRow) {
      return {
        ok: false as const,
        error: "deck_not_found" as const,
      };
    }
    const deckUserId = (deckRow as { user_id?: string }).user_id;
    if (deckUserId !== userId) {
      return {
        ok: false as const,
        error: "not_owner" as const,
      };
    }
    const deckName = (deckRow as { name?: string }).name ?? "this deck";

    // Pull all card_ids this deck carries.
    const { data: cardRows, error: cardErr } = await supabaseAdmin
      .from("custom_deck_cards" as never)
      .select("card_id")
      .eq("deck_id", deckId)
      .is("archived_at", null);
    if (cardErr) {
      return { ok: false as const, error: "card_fetch_failed" as const };
    }
    const deckCardIds = new Set<number>();
    for (const r of (cardRows ?? []) as Array<{ card_id: number }>) {
      deckCardIds.add(r.card_id);
    }
    if (deckCardIds.size === 0) {
      return {
        ok: true as const,
        deckName,
        readingsScanned: 0,
        readingsUpdated: 0,
        cardSlotsReconnected: 0,
        dryRun: !!dryRun,
      };
    }

    // Pull all of this user's readings.
    const { data: readingRows, error: rErr } = await supabaseAdmin
      .from("readings" as never)
      .select("id, card_ids, card_deck_ids")
      .eq("user_id", userId)
      .is("archived_at", null);
    if (rErr) {
      return { ok: false as const, error: "reading_fetch_failed" as const };
    }
    type ReadingRow = {
      id: string;
      card_ids: number[] | null;
      card_deck_ids: (string | null)[] | null;
    };
    const readings = (readingRows ?? []) as ReadingRow[];

    let readingsUpdated = 0;
    let cardSlotsReconnected = 0;
    const updates: Array<{ id: string; card_deck_ids: (string | null)[] }> = [];

    for (const r of readings) {
      const ids = r.card_ids ?? [];
      if (ids.length === 0) continue;
      const current = r.card_deck_ids ?? Array.from({ length: ids.length }, () => null);
      // Normalize length defensively.
      const next: (string | null)[] = Array.from({ length: ids.length }, (_, i) =>
        i < current.length ? current[i] : null,
      );
      let changed = false;
      let slotsThisReading = 0;
      for (let i = 0; i < ids.length; i++) {
        const cardId = ids[i];
        if (!deckCardIds.has(cardId)) continue;
        if (next[i] === deckId) continue; // already correct
        next[i] = deckId;
        slotsThisReading += 1;
        changed = true;
      }
      if (changed) {
        readingsUpdated += 1;
        cardSlotsReconnected += slotsThisReading;
        updates.push({ id: r.id, card_deck_ids: next });
      }
    }

    if (!dryRun && updates.length > 0) {
      // Batch updates in chunks to keep the request body small.
      const CHUNK = 50;
      for (let i = 0; i < updates.length; i += CHUNK) {
        const chunk = updates.slice(i, i + CHUNK);
        // Use individual updates rather than upsert so we don't risk
        // overwriting other columns inadvertently.
        await Promise.all(
          chunk.map((u) =>
            supabaseAdmin
              .from("readings" as never)
              .update({ card_deck_ids: u.card_deck_ids } as never)
              .eq("id", u.id),
          ),
        );
      }
    }

    return {
      ok: true as const,
      deckName,
      readingsScanned: readings.length,
      readingsUpdated,
      cardSlotsReconnected,
      dryRun: !!dryRun,
    };
  });

/* ──────────────────────────────────────────────────────────────────
   EJ45 — Deck swap tools.

   Two functions on top of the EJ44 reconnect primitive:
     • swapReadingDeck — per-entry. Rewrites card_deck_ids[i] for a
       single reading. Tarot-only mode (card_id < 1000) by default so
       oracle slots aren't broken by a swap. Idempotent.
     • swapDeckAcrossReadings — bulk. Scans every reading and rewrites
       slots currently pointing at fromDeckId so they point at
       toDeckId instead. Two modes:
         - 'safe': only swap card slots whose card_id exists in the
           target deck. Slots the target deck doesn't cover are left
           on the original deck.
         - 'all': replace every matching slot regardless. Unmatched
           ids will fall through the EJ44 multi-deck chain.

   Aggregations (stalkers, frequency, pairs, etc.) are by card_id and
   are not affected by either operation. Counting is preserved.
   ────────────────────────────────────────────────────────────────── */

const SwapReadingInput = z.object({
  readingId: z.string().uuid(),
  toDeckId: z.string().uuid(),
  /** 'tarotOnly' (default) skips oracle ids 1000+. 'all' rewrites every slot. */
  mode: z.enum(["tarotOnly", "all"]).optional(),
  dryRun: z.boolean().optional(),
});

export const swapReadingDeck = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SwapReadingInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { readingId, toDeckId, mode = "tarotOnly", dryRun } = data;

    // Confirm the target deck belongs to this user.
    const { data: deckRow, error: deckErr } = await supabaseAdmin
      .from("custom_decks" as never)
      .select("id, name, user_id")
      .eq("id", toDeckId)
      .maybeSingle();
    if (deckErr || !deckRow) {
      return { ok: false as const, error: "deck_not_found" as const };
    }
    if ((deckRow as { user_id?: string }).user_id !== userId) {
      return { ok: false as const, error: "not_owner" as const };
    }
    const toDeckName = (deckRow as { name?: string }).name ?? "this deck";

    // Pull the reading.
    const { data: readingRow, error: rErr } = await supabaseAdmin
      .from("readings" as never)
      .select("id, user_id, card_ids, card_deck_ids")
      .eq("id", readingId)
      .maybeSingle();
    if (rErr || !readingRow) {
      return { ok: false as const, error: "reading_not_found" as const };
    }
    const r = readingRow as {
      id: string;
      user_id: string;
      card_ids: number[] | null;
      card_deck_ids: (string | null)[] | null;
    };
    if (r.user_id !== userId) {
      return { ok: false as const, error: "not_owner" as const };
    }

    const ids = r.card_ids ?? [];
    if (ids.length === 0) {
      return {
        ok: true as const,
        toDeckName,
        slotsSwapped: 0,
        previousDeckId: null,
        dryRun: !!dryRun,
      };
    }

    // Detect the "previous deck" — the dominant deck_id among the
    // slots we'd be changing. The UI uses this to ask "Apply to all
    // readings using [previousDeck] too?" after the user confirms.
    const current = r.card_deck_ids ?? Array.from({ length: ids.length }, () => null);
    const next: (string | null)[] = Array.from({ length: ids.length }, (_, i) =>
      i < current.length ? current[i] : null,
    );

    const prevDeckCounts = new Map<string | null, number>();
    let slotsSwapped = 0;
    for (let i = 0; i < ids.length; i++) {
      const cardId = ids[i];
      if (mode === "tarotOnly" && cardId >= 1000) continue;
      if (next[i] === toDeckId) continue; // already correct
      prevDeckCounts.set(next[i] ?? null, (prevDeckCounts.get(next[i] ?? null) ?? 0) + 1);
      next[i] = toDeckId;
      slotsSwapped += 1;
    }

    // Dominant previous deck id (most frequent among swapped slots).
    let previousDeckId: string | null = null;
    let bestCount = 0;
    for (const [k, v] of prevDeckCounts) {
      if (v > bestCount) {
        bestCount = v;
        previousDeckId = k;
      }
    }

    if (!dryRun && slotsSwapped > 0) {
      await supabaseAdmin
        .from("readings" as never)
        .update({ card_deck_ids: next } as never)
        .eq("id", r.id);
    }

    return {
      ok: true as const,
      toDeckName,
      slotsSwapped,
      previousDeckId,
      dryRun: !!dryRun,
    };
  });

const SwapAcrossInput = z.object({
  /** Source deck to replace. Null means "currently-unlinked default slots". */
  fromDeckId: z.string().uuid().nullable(),
  toDeckId: z.string().uuid(),
  /**
   * 'safe' (default): only swap slots whose card_id exists in the target
   * deck. Slots the target doesn't cover stay on fromDeckId.
   * 'all': swap every matching slot regardless. Unmatched cards will
   * render via the EJ44 multi-deck fallback or the built-in default.
   */
  mode: z.enum(["safe", "all"]).optional(),
  dryRun: z.boolean().optional(),
});

export const swapDeckAcrossReadings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((raw: unknown) => SwapAcrossInput.parse(raw))
  .handler(async ({ data, context }) => {
    const { userId } = context as { userId: string };
    const { fromDeckId, toDeckId, mode = "safe", dryRun } = data;

    if (fromDeckId === toDeckId) {
      return { ok: false as const, error: "same_deck" as const };
    }

    // Confirm the target deck belongs to this user.
    const { data: toDeckRow, error: deckErr } = await supabaseAdmin
      .from("custom_decks" as never)
      .select("id, name, user_id")
      .eq("id", toDeckId)
      .maybeSingle();
    if (deckErr || !toDeckRow) {
      return { ok: false as const, error: "deck_not_found" as const };
    }
    if ((toDeckRow as { user_id?: string }).user_id !== userId) {
      return { ok: false as const, error: "not_owner" as const };
    }
    const toDeckName = (toDeckRow as { name?: string }).name ?? "this deck";

    // If a fromDeckId is provided, confirm it belongs to this user too.
    let fromDeckName: string | null = null;
    if (fromDeckId) {
      const { data: fromDeckRow } = await supabaseAdmin
        .from("custom_decks" as never)
        .select("id, name, user_id")
        .eq("id", fromDeckId)
        .maybeSingle();
      if (!fromDeckRow || (fromDeckRow as { user_id?: string }).user_id !== userId) {
        return { ok: false as const, error: "from_not_owner" as const };
      }
      fromDeckName = (fromDeckRow as { name?: string }).name ?? null;
    }

    // Card_ids the target deck carries (used by safe mode).
    const { data: cardRows, error: cardErr } = await supabaseAdmin
      .from("custom_deck_cards" as never)
      .select("card_id")
      .eq("deck_id", toDeckId)
      .is("archived_at", null);
    if (cardErr) {
      return { ok: false as const, error: "card_fetch_failed" as const };
    }
    const toDeckCardIds = new Set<number>();
    for (const cr of (cardRows ?? []) as Array<{ card_id: number }>) {
      toDeckCardIds.add(cr.card_id);
    }

    // Pull all of this user's readings.
    const { data: readingRows, error: rErr } = await supabaseAdmin
      .from("readings" as never)
      .select("id, card_ids, card_deck_ids")
      .eq("user_id", userId)
      .is("archived_at", null);
    if (rErr) {
      return { ok: false as const, error: "reading_fetch_failed" as const };
    }
    type ReadingRow = {
      id: string;
      card_ids: number[] | null;
      card_deck_ids: (string | null)[] | null;
    };
    const readings = (readingRows ?? []) as ReadingRow[];

    let readingsUpdated = 0;
    let slotsSwapped = 0;
    let slotsSkipped = 0;
    const updates: Array<{ id: string; card_deck_ids: (string | null)[] }> = [];

    for (const r of readings) {
      const ids = r.card_ids ?? [];
      if (ids.length === 0) continue;
      const current = r.card_deck_ids ?? Array.from({ length: ids.length }, () => null);
      const next: (string | null)[] = Array.from({ length: ids.length }, (_, i) =>
        i < current.length ? current[i] : null,
      );
      let changed = false;
      let swappedInThisReading = 0;
      for (let i = 0; i < ids.length; i++) {
        const cardId = ids[i];
        const slotDeck = next[i] ?? null;
        if (slotDeck !== fromDeckId) continue; // not a candidate
        if (mode === "safe" && !toDeckCardIds.has(cardId)) {
          slotsSkipped += 1;
          continue;
        }
        if (next[i] === toDeckId) continue;
        next[i] = toDeckId;
        swappedInThisReading += 1;
        changed = true;
      }
      if (changed) {
        readingsUpdated += 1;
        slotsSwapped += swappedInThisReading;
        updates.push({ id: r.id, card_deck_ids: next });
      }
    }

    if (!dryRun && updates.length > 0) {
      const CHUNK = 50;
      for (let i = 0; i < updates.length; i += CHUNK) {
        const chunk = updates.slice(i, i + CHUNK);
        await Promise.all(
          chunk.map((u) =>
            supabaseAdmin
              .from("readings" as never)
              .update({ card_deck_ids: u.card_deck_ids } as never)
              .eq("id", u.id),
          ),
        );
      }
    }

    return {
      ok: true as const,
      toDeckName,
      fromDeckName,
      readingsScanned: readings.length,
      readingsUpdated,
      slotsSwapped,
      slotsSkipped,
      mode,
      dryRun: !!dryRun,
    };
  });
