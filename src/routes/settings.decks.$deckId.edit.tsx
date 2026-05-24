/**
 * EJ34 — Deck Edit page with Aspects + Journal Prompts.
 *
 * URL: /settings/decks/$deckId/edit
 *
 * Three sections:
 *   1. Aspects (4 user-defined slots + voice guide + hydrating
 *      meta-prompt clipboard).
 *   2. Generate (gated on aspects + descriptions + credits).
 *   3. Cards list — each card with 4 prompt slots (✓ / ✗ / pending,
 *      inline editable, per-card and per-slot regenerate).
 *
 * Plus a "Edit in your own tools" power-user section: CSV download,
 * instructions copy, CSV upload.
 *
 * All AI calls flow through the journal-prompts server functions
 * which gate on credits + admin kill switch.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronLeft, Clipboard, Download, Sparkles, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import {
  fetchUserDecks,
  fetchDeckCards,
  type CustomDeck,
  type CustomDeckCard,
  type AspectConfig,
} from "@/lib/custom-decks";
import {
  buildHydratingMetaPrompt,
  buildCsvInstructionsPrompt,
  parseHydratingResponse,
} from "@/lib/journal-prompts-meta";
import {
  setDeckAspectConfig,
  setDeckVoiceGuide,
  generateDeckPrompts,
  regenerateAspect,
  regenerateCard,
  regenerateRejected,
  updateCardPrompt,
  updatePromptStatus,
  bulkPromptStatus,
  importDeckPromptsCsv,
} from "@/lib/journal-prompts.functions";
import { getAuthHeaders } from "@/lib/server-fn-auth";
import { LoadingSkeleton } from "@/components/ui/loading-skeleton";
import { LoadingText } from "@/components/ui/loading-text";

export const Route = createFileRoute("/settings/decks/$deckId/edit")({
  component: DeckEditPage,
});

type StatusFilter = "all" | "approved" | "rejected" | "pending";

const DEFAULT_ASPECTS: AspectConfig[] = [
  { name: "", hydrating_thought: "" },
  { name: "", hydrating_thought: "" },
  { name: "", hydrating_thought: "" },
  { name: "", hydrating_thought: "" },
];

/* ─────────────────────────────────────────────────────────────────
   Top-level page
   ───────────────────────────────────────────────────────────────── */

function DeckEditPage() {
  // EJ38 — SSR safety. React #418 (hydration mismatch) fires when the
  // server's rendered HTML differs from the client's first render.
  // Auth state, fetched data, and any state hydration in this page
  // resolves only on the client, so we mount in a "not hydrated" state
  // (matches the server output: a stable loading shell) and flip to
  // the real content after the first useEffect tick. Keeps the server
  // and the client's first paint byte-for-byte identical, then
  // upgrades.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const { deckId } = Route.useParams();
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [deck, setDeck] = useState<CustomDeck | null>(null);
  const [cards, setCards] = useState<CustomDeckCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [aspects, setAspects] = useState<AspectConfig[]>(DEFAULT_ASPECTS);
  const [voiceGuide, setVoiceGuide] = useState<string>("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  // EJ39 — buffer for the auto-parse textarea. The user pastes their
  // external AI's response in here once; clicking "Parse and fill"
  // populates the 4 aspect slots + voiceGuide. All fields stay
  // editable after parse so they can refine anything.
  const [aiPaste, setAiPaste] = useState<string>("");

  // Load deck + cards.
  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const decks = await fetchUserDecks(user.id);
      const d = decks.find((x) => x.id === deckId);
      if (!d) {
        toast.error("Deck not found");
        navigate({ to: "/settings/decks" });
        return;
      }
      setDeck(d);
      const cfg =
        Array.isArray(d.aspect_config) && d.aspect_config.length === 4
          ? (d.aspect_config as AspectConfig[])
          : DEFAULT_ASPECTS;
      setAspects(cfg);
      setVoiceGuide(d.ai_voice_guide ?? "");
      const cs = await fetchDeckCards(d.id);
      setCards(cs);
    } catch (e) {
      toast.error(`Couldn't load deck: ${e instanceof Error ? e.message : "unknown"}`);
    } finally {
      setLoading(false);
    }
  }, [deckId, navigate, user]);

  useEffect(() => {
    if (!authLoading) void reload();
  }, [authLoading, reload]);

  // ─── Aspect editing ─────────────────────────────────────────────
  const aspectsDirty = useMemo(() => {
    const stored = (deck?.aspect_config as AspectConfig[] | null) ?? null;
    if (!stored) {
      return aspects.some(
        (a) => (a.name ?? "").trim().length > 0 || (a.hydrating_thought ?? "").trim().length > 0,
      );
    }
    return aspects.some(
      (a, i) =>
        a.name !== (stored[i]?.name ?? "") ||
        a.hydrating_thought !== (stored[i]?.hydrating_thought ?? ""),
    );
  }, [aspects, deck]);

  const aspectsComplete = aspects.every((a) => a.name.trim().length > 0);

  const saveAspects = async () => {
    if (!deck || !aspectsComplete) return;
    const headers = await getAuthHeaders();
    try {
      await setDeckAspectConfig({
        data: { deckId: deck.id, aspects },
        headers,
      });
      toast.success("Aspects saved");
      await reload();
    } catch (e) {
      toast.error(`Couldn't save aspects: ${e instanceof Error ? e.message : "unknown"}`);
    }
  };

  // ─── Voice guide ─────────────────────────────────────────────────
  const voiceDirty = (deck?.ai_voice_guide ?? "") !== voiceGuide;

  const saveVoice = async () => {
    if (!deck) return;
    const headers = await getAuthHeaders();
    try {
      await setDeckVoiceGuide({
        data: { deckId: deck.id, voiceGuide: voiceGuide || null },
        headers,
      });
      toast.success("Voice guide saved");
      await reload();
    } catch (e) {
      toast.error(`Couldn't save voice guide: ${e instanceof Error ? e.message : "unknown"}`);
    }
  };

  // ─── Clipboard helpers ───────────────────────────────────────────
  const copyHydratingMetaPrompt = async () => {
    if (!deck) return;
    const text = buildHydratingMetaPrompt(deck.name);
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Hydrating prompt copied to clipboard");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  // EJ39 — auto-parse the AI's response. Extracts 4 ASPECT/THOUGHT
  // pairs + VOICE GUIDE from one paste, populates the slots, leaves
  // everything editable so the user can hand-tune any field.
  const parseAiResponse = () => {
    const trimmed = aiPaste.trim();
    if (!trimmed) {
      toast.error("Paste your AI's response above first");
      return;
    }
    const parsed = parseHydratingResponse(trimmed);
    if (!parsed) {
      toast.error("Couldn't read that — check that it has lines like 'ASPECT 1:' and 'THOUGHT 1:'");
      return;
    }
    // Fill aspect slots, preserving any existing value when the AI
    // left a slot blank (this is rare but possible if the response
    // is malformed mid-list).
    setAspects((prev) =>
      prev.map((cur, i) => ({
        name: parsed.aspects[i]?.name?.trim() || cur.name,
        hydrating_thought: parsed.aspects[i]?.hydrating_thought?.trim() || cur.hydrating_thought,
      })),
    );
    if (parsed.voiceGuide && parsed.voiceGuide.trim().length > 0) {
      setVoiceGuide(parsed.voiceGuide);
    }
    const filled = parsed.aspects.filter((a) => a.name?.trim()).length;
    const voiceMsg = parsed.voiceGuide ? " + voice guide" : "";
    toast.success(`Filled ${filled} of 4 aspects${voiceMsg}. Edit any field to refine.`);
    setAiPaste("");
  };

  const copyCsvInstructions = async () => {
    if (!deck) return;
    const text = buildCsvInstructionsPrompt({
      deckName: deck.name,
      cardCount: cards.length,
      aspects,
      voiceGuide,
    });
    try {
      await navigator.clipboard.writeText(text);
      toast.success("CSV instructions copied to clipboard");
    } catch {
      toast.error("Couldn't copy to clipboard");
    }
  };

  // ─── CSV download ────────────────────────────────────────────────
  const downloadCsv = () => {
    if (!deck) return;
    const header = [
      "card_id",
      "card_name",
      "card_description",
      ...aspects.map((a, i) => `Aspect ${i + 1}: ${a.name?.trim() || `Aspect ${i + 1}`}`),
    ];
    const esc = (s: string) => {
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };
    const lines = [header.map(esc).join(",")];
    for (const c of cards) {
      const prompts = c.journal_prompts ?? ["", "", "", ""];
      const row = [
        String(c.card_id),
        c.card_name ?? "",
        c.card_description ?? "",
        ...[0, 1, 2, 3].map((i) => prompts[i] ?? ""),
      ];
      lines.push(row.map(esc).join(","));
    }
    const csv = lines.join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safe = (deck.name ?? "deck").replace(/[^a-z0-9._-]+/gi, "_");
    a.href = url;
    a.download = `tarotseed-${safe}-prompts.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  // ─── CSV upload ──────────────────────────────────────────────────
  const fileInputRef = useRef<HTMLInputElement>(null);
  const onUploadClick = () => fileInputRef.current?.click();
  const onUploadFile = async (file: File) => {
    if (!deck) return;
    const text = await file.text();
    const headers = await getAuthHeaders();
    const toastId = toast.loading("Importing CSV…");
    try {
      const res = await importDeckPromptsCsv({
        data: { deckId: deck.id, csv: text },
        headers,
      });
      if (!res.ok) {
        toast.error(`Import failed: ${res.error}`, { id: toastId });
        return;
      }
      toast.success(`${res.updatedCards} cards updated · ${res.changedSlots} slots changed`, {
        id: toastId,
      });
      await reload();
    } catch (e) {
      toast.error(`Import failed: ${e instanceof Error ? e.message : "unknown"}`, { id: toastId });
    }
  };

  // ─── Generation gates ────────────────────────────────────────────
  const cardsWithDesc = cards.filter((c) => (c.card_description ?? "").trim().length > 0);
  const cardsWithoutDesc = cards.length - cardsWithDesc.length;
  const aspectsSaved =
    Array.isArray(deck?.aspect_config) &&
    deck!.aspect_config!.length === 4 &&
    deck!.aspect_config!.every((a) => a.name?.trim().length > 0);
  const cardsMissingPrompts = cardsWithDesc.filter(
    (c) =>
      !c.journal_prompts ||
      c.journal_prompts.length < 4 ||
      c.journal_prompts.some((p) => !p?.trim()),
  ).length;

  const genGateReasons: string[] = [];
  if (!aspectsSaved) genGateReasons.push("Define and save 4 aspects first");
  if (cardsWithoutDesc > 0) {
    genGateReasons.push(
      `${cardsWithoutDesc} card${cardsWithoutDesc === 1 ? "" : "s"} need a description for the AI reader`,
    );
  }
  if (cardsMissingPrompts === 0 && aspectsSaved) {
    genGateReasons.push("All cards already have prompts (use per-card or aspect regenerate)");
  }

  // ─── Generate all ────────────────────────────────────────────────
  const [generating, setGenerating] = useState(false);
  const runGenerateAll = async () => {
    if (!deck || genGateReasons.length > 0) return;
    if (
      !window.confirm(
        `Generate prompts for ${cardsMissingPrompts} cards? This will cost up to ${cardsMissingPrompts} credits.`,
      )
    ) {
      return;
    }
    setGenerating(true);
    const headers = await getAuthHeaders();
    const toastId = toast.loading(`Generating prompts for ${cardsMissingPrompts} cards…`);
    try {
      const res = await generateDeckPrompts({
        data: { deckId: deck.id },
        headers,
      });
      if (!res.ok) {
        toast.error(`Generation failed: ${res.error}`, { id: toastId });
      } else {
        toast.success(
          `Generated ${res.generated} cards · ${res.failed} failed · ${res.creditsUsed} credits used`,
          { id: toastId },
        );
      }
      await reload();
    } catch (e) {
      toast.error(`Generation failed: ${e instanceof Error ? e.message : "unknown"}`, {
        id: toastId,
      });
    } finally {
      setGenerating(false);
    }
  };

  // ─── Per-aspect bulk regenerate ──────────────────────────────────
  const [aspectRegen, setAspectRegen] = useState<number | null>(null);
  const runRegenerateAspect = async (aspectIndex: number) => {
    if (!deck) return;
    if (
      !window.confirm(
        `Regenerate Aspect ${aspectIndex + 1} across all ${cardsWithDesc.length} cards? This will cost up to ${cardsWithDesc.length} credits.`,
      )
    ) {
      return;
    }
    setAspectRegen(aspectIndex);
    const headers = await getAuthHeaders();
    const toastId = toast.loading(`Regenerating aspect ${aspectIndex + 1}…`);
    try {
      const res = await regenerateAspect({
        data: { deckId: deck.id, aspectIndex },
        headers,
      });
      if (!res.ok) {
        toast.error(`Failed: ${res.error}`, { id: toastId });
      } else {
        toast.success(`${res.updated} cards updated · ${res.creditsUsed} credits used`, {
          id: toastId,
        });
      }
      await reload();
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : "unknown"}`, { id: toastId });
    } finally {
      setAspectRegen(null);
    }
  };

  // ─── Regenerate-all-rejected ─────────────────────────────────────
  const rejectedCount = useMemo(() => {
    let n = 0;
    for (const c of cards) {
      for (const s of c.prompt_status ?? []) if (s === "rejected") n++;
    }
    return n;
  }, [cards]);
  const rejectedCardCount = useMemo(() => {
    let n = 0;
    for (const c of cards) {
      if ((c.prompt_status ?? []).some((s) => s === "rejected")) n++;
    }
    return n;
  }, [cards]);
  const [rejectedBusy, setRejectedBusy] = useState(false);
  const runRegenerateRejected = async () => {
    if (!deck || rejectedCount === 0) return;
    if (
      !window.confirm(
        `Regenerate ${rejectedCount} rejected prompts? This will cost up to ${rejectedCardCount} credits.`,
      )
    ) {
      return;
    }
    setRejectedBusy(true);
    const headers = await getAuthHeaders();
    const toastId = toast.loading("Regenerating rejected prompts…");
    try {
      const res = await regenerateRejected({
        data: { deckId: deck.id },
        headers,
      });
      if (!res.ok) {
        toast.error(`Failed: ${res.error}`, { id: toastId });
      } else {
        toast.success(`${res.updated} cards updated · ${res.creditsUsed} credits used`, {
          id: toastId,
        });
      }
      await reload();
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : "unknown"}`, { id: toastId });
    } finally {
      setRejectedBusy(false);
    }
  };

  // ─── Per-card actions ────────────────────────────────────────────
  const onAcceptReject = async (
    cardId: number,
    aspectIndex: number,
    newStatus: "approved" | "rejected" | null,
  ) => {
    if (!deck) return;
    // Optimistic update.
    setCards((prev) =>
      prev.map((c) => {
        if (c.card_id !== cardId) return c;
        const status = [...(c.prompt_status ?? [null, null, null, null])];
        while (status.length < 4) status.push(null);
        status[aspectIndex] = newStatus;
        return { ...c, prompt_status: status };
      }),
    );
    try {
      const headers = await getAuthHeaders();
      await updatePromptStatus({
        data: { deckId: deck.id, cardId, aspectIndex, status: newStatus },
        headers,
      });
    } catch {
      toast.error("Couldn't update status");
      await reload();
    }
  };

  const onSavePromptEdit = async (cardId: number, aspectIndex: number, text: string) => {
    if (!deck) return;
    try {
      const headers = await getAuthHeaders();
      await updateCardPrompt({
        data: { deckId: deck.id, cardId, aspectIndex, prompt: text },
        headers,
      });
      await reload();
    } catch (e) {
      toast.error(`Couldn't save: ${e instanceof Error ? e.message : "unknown"}`);
    }
  };

  const onRegenerateOneCard = async (cardId: number) => {
    if (!deck) return;
    const headers = await getAuthHeaders();
    const toastId = toast.loading("Regenerating card…");
    try {
      const res = await regenerateCard({
        data: { deckId: deck.id, cardId },
        headers,
      });
      if (!res.ok) {
        toast.error(`Failed: ${res.error}`, { id: toastId });
      } else {
        toast.success(`Card regenerated · ${res.creditsUsed} credits`, {
          id: toastId,
        });
      }
      await reload();
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : "unknown"}`, { id: toastId });
    }
  };

  const onBulkAspectStatus = async (
    aspectIndex: number,
    status: "approved" | "rejected" | null,
  ) => {
    if (!deck) return;
    const headers = await getAuthHeaders();
    try {
      await bulkPromptStatus({
        data: { deckId: deck.id, aspectIndex, status },
        headers,
      });
      await reload();
    } catch (e) {
      toast.error(`Failed: ${e instanceof Error ? e.message : "unknown"}`);
    }
  };

  // ─── Filter ──────────────────────────────────────────────────────
  const filteredCards = useMemo(() => {
    if (filter === "all") return cards;
    return cards.filter((c) => {
      const statuses = c.prompt_status ?? [];
      const prompts = c.journal_prompts ?? [];
      if (filter === "approved") return statuses.some((s) => s === "approved");
      if (filter === "rejected") return statuses.some((s) => s === "rejected");
      // pending = has at least one prompt that is null status
      return prompts.some((p, i) => (p ?? "").trim().length > 0 && (statuses[i] ?? null) === null);
    });
  }, [cards, filter]);

  // ─── Per-aspect status counts (for the cards in the deck) ────────
  const aspectCounts = useMemo(() => {
    const counts: Array<{ approved: number; rejected: number; pending: number }> = [
      { approved: 0, rejected: 0, pending: 0 },
      { approved: 0, rejected: 0, pending: 0 },
      { approved: 0, rejected: 0, pending: 0 },
      { approved: 0, rejected: 0, pending: 0 },
    ];
    for (const c of cards) {
      const prompts = c.journal_prompts ?? [];
      const statuses = c.prompt_status ?? [];
      for (let i = 0; i < 4; i++) {
        const text = (prompts[i] ?? "").trim();
        if (!text) continue;
        const s = statuses[i] ?? null;
        if (s === "approved") counts[i].approved += 1;
        else if (s === "rejected") counts[i].rejected += 1;
        else counts[i].pending += 1;
      }
    }
    return counts;
  }, [cards]);

  /* ─────────────────────────────────────────────────────────────── */

  if (!hydrated || authLoading || loading || !deck) {
    return (
      <div
        style={{
          display: "flex",
          minHeight: "60vh",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <LoadingText>Loading deck…</LoadingText>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: 1100,
        margin: "0 auto",
        padding: "16px 16px 120px",
        color: "var(--color-foreground)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 20,
        }}
      >
        <button
          type="button"
          onClick={() => navigate({ to: "/settings/decks" })}
          aria-label="Back to decks"
          style={{
            background: "transparent",
            border: "1px solid var(--border-subtle)",
            borderRadius: 9999,
            width: 32,
            height: 32,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
            color: "var(--color-foreground)",
          }}
        >
          <ChevronLeft size={16} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1
            style={{
              margin: 0,
              fontFamily: "var(--font-display)",
              fontStyle: "italic",
              fontSize: 22,
              fontWeight: 400,
              color: "var(--color-foreground)",
            }}
          >
            Edit {deck.name}
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 12,
              color: "var(--color-foreground-muted)",
            }}
          >
            {cards.length} cards · {deck.deck_type}
          </p>
        </div>
      </div>

      {/* ── Aspects section ── */}
      <Section title="The 4 aspects of this deck">
        <p
          style={{
            margin: "0 0 12px",
            fontSize: 13,
            color: "var(--color-foreground-muted)",
          }}
        >
          Every card will get 4 journaling prompts, one for each aspect. Pick what this deck is for,
          and write a short hydrating thought for each.
        </p>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 12,
          }}
        >
          {aspects.map((a, i) => (
            <AspectCard
              key={i}
              index={i}
              value={a}
              counts={aspectCounts[i]}
              onChange={(next) => setAspects((prev) => prev.map((p, j) => (j === i ? next : p)))}
              onRegenerate={() => runRegenerateAspect(i)}
              onBulkAccept={() => onBulkAspectStatus(i, "approved")}
              onBulkReject={() => onBulkAspectStatus(i, "rejected")}
              onBulkClear={() => onBulkAspectStatus(i, null)}
              regenerating={aspectRegen === i}
              aspectSavedExists={aspectsSaved}
            />
          ))}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 12,
            flexWrap: "wrap",
          }}
        >
          <button
            type="button"
            onClick={saveAspects}
            disabled={!aspectsDirty || !aspectsComplete}
            style={primaryBtnStyle(!aspectsDirty || !aspectsComplete)}
          >
            Save aspects
          </button>
          <button type="button" onClick={copyHydratingMetaPrompt} style={ghostBtnStyle()}>
            <Clipboard size={14} />
            Get my hydrating prompt
          </button>
        </div>

        {/* EJ39 — auto-parse flow. One paste, one click, all 4 slots
            + voice guide populate. Every field stays editable below. */}
        <div
          style={{
            marginTop: 16,
            padding: 12,
            borderRadius: 8,
            border: "1px dashed var(--border-default)",
            background: "var(--surface-card)",
          }}
        >
          <label
            style={{
              fontSize: 12,
              color: "var(--color-foreground-muted)",
              display: "block",
              marginBottom: 4,
              fontWeight: 600,
            }}
          >
            Used AI? Paste the response here for one-click fill
          </label>
          <div
            style={{
              fontSize: 11,
              color: "var(--color-foreground-muted)",
              marginBottom: 8,
              lineHeight: 1.4,
            }}
          >
            Paste the full reply from your AI (the one with ASPECT 1, THOUGHT 1, ASPECT 2, etc., and
            the VOICE GUIDE at the bottom). One click fills all 4 aspect slots + voice guide. You
            can still edit any field after.
          </div>
          <textarea
            value={aiPaste}
            onChange={(e) => setAiPaste(e.target.value)}
            rows={6}
            placeholder="Paste your AI's full response here…"
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 6,
              border: "1px solid var(--border-default)",
              background: "var(--color-background)",
              color: "var(--color-foreground)",
              fontFamily: "var(--font-mono, monospace)",
              fontSize: 12,
              resize: "vertical",
            }}
          />
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={parseAiResponse}
              disabled={!aiPaste.trim()}
              style={primaryBtnStyle(!aiPaste.trim())}
            >
              Parse and fill
            </button>
            {aiPaste.trim().length > 0 && (
              <button type="button" onClick={() => setAiPaste("")} style={ghostBtnStyle()}>
                Clear
              </button>
            )}
          </div>
        </div>

        <div style={{ marginTop: 16 }}>
          <label
            style={{
              fontSize: 12,
              color: "var(--color-foreground-muted)",
              display: "block",
              marginBottom: 4,
            }}
          >
            Voice guide (or paste your AI&apos;s voice guide here)
          </label>
          <textarea
            value={voiceGuide}
            onChange={(e) => setVoiceGuide(e.target.value)}
            rows={4}
            placeholder="Paste the voice guide your AI gave you after the interview…"
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 6,
              border: "1px solid var(--border-default)",
              background: "var(--surface-card)",
              color: "var(--color-foreground)",
              fontFamily: "var(--font-serif)",
              fontSize: 13,
              resize: "vertical",
            }}
          />
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={saveVoice}
              disabled={!voiceDirty}
              style={primaryBtnStyle(!voiceDirty)}
            >
              Save voice guide
            </button>
          </div>
        </div>
      </Section>

      {/* ── Generate section ── */}
      <Section title="Generate prompts">
        {genGateReasons.length > 0 && (
          <ul
            style={{
              margin: "0 0 12px",
              padding: 0,
              listStyle: "none",
              fontSize: 12,
              color: "var(--color-foreground-muted)",
            }}
          >
            {genGateReasons.map((r) => (
              <li key={r}>· {r}</li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={runGenerateAll}
          disabled={genGateReasons.length > 0 || generating}
          style={primaryBtnStyle(genGateReasons.length > 0 || generating)}
        >
          {generating ? (
            <LoadingText>Generating…</LoadingText>
          ) : (
            <>
              <Sparkles size={14} />
              {cardsMissingPrompts > 0
                ? `Generate prompts for ${cardsMissingPrompts} cards (~${cardsMissingPrompts} credits)`
                : "All cards have prompts"}
            </>
          )}
        </button>
      </Section>

      {/* ── Power-user CSV section ── */}
      <Section title="Edit in your own tools">
        <p
          style={{
            margin: "0 0 12px",
            fontSize: 13,
            color: "var(--color-foreground-muted)",
          }}
        >
          Prefer to write prompts yourself or use your own AI? Download the CSV, edit it however you
          want, then upload it back.
        </p>
        <div
          style={{
            display: "flex",
            gap: 12,
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <button type="button" onClick={downloadCsv} style={ghostBtnStyle()}>
            <Download size={14} />
            Download CSV
          </button>
          <button type="button" onClick={copyCsvInstructions} style={ghostBtnStyle()}>
            <Clipboard size={14} />
            Copy CSV instructions prompt
          </button>
          <button type="button" onClick={onUploadClick} style={ghostBtnStyle()}>
            <Upload size={14} />
            Upload edited CSV
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            style={{ display: "none" }}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onUploadFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </Section>

      {/* ── Cards section ── */}
      <Section
        title={`Cards (${filteredCards.length}${filter === "all" ? "" : ` of ${cards.length}`})`}
      >
        <FilterRow filter={filter} onFilterChange={setFilter} />
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {filteredCards.length === 0 ? (
            <p
              style={{
                margin: 0,
                fontSize: 13,
                color: "var(--color-foreground-muted)",
                fontStyle: "italic",
              }}
            >
              No cards match this filter.
            </p>
          ) : (
            filteredCards.map((c) => (
              <CardEditRow
                key={c.id}
                card={c}
                aspects={aspects}
                hasDescription={(c.card_description ?? "").trim().length > 0}
                aspectsSaved={aspectsSaved}
                onAcceptReject={onAcceptReject}
                onSavePromptEdit={onSavePromptEdit}
                onRegenerateCard={onRegenerateOneCard}
              />
            ))
          )}
        </div>
      </Section>

      {/* ── Sticky bottom regen-rejected bar ── */}
      {rejectedCount > 0 && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            bottom: 0,
            zIndex: 40,
            background: "var(--surface-elevated)",
            borderTop: "1px solid var(--border-default)",
            padding: "12px 16px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 13, color: "var(--color-foreground)" }}>
            {rejectedCount} prompts marked ✗ across {rejectedCardCount} cards
          </span>
          <button
            type="button"
            onClick={runRegenerateRejected}
            disabled={rejectedBusy}
            style={primaryBtnStyle(rejectedBusy)}
          >
            {rejectedBusy ? (
              <LoadingText>Regenerating…</LoadingText>
            ) : (
              `Regenerate all ✗ (~${rejectedCardCount} credits)`
            )}
          </button>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Sub-components
   ───────────────────────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section
      style={{
        marginBottom: 24,
        padding: 16,
        background: "var(--surface-card)",
        border: "1px solid var(--border-subtle)",
        borderRadius: 10,
      }}
    >
      <h2
        style={{
          margin: "0 0 12px",
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: 16,
          fontWeight: 400,
          color: "var(--color-foreground)",
        }}
      >
        {title}
      </h2>
      {children}
    </section>
  );
}

function AspectCard({
  index,
  value,
  counts,
  onChange,
  onRegenerate,
  onBulkAccept,
  onBulkReject,
  onBulkClear,
  regenerating,
  aspectSavedExists,
}: {
  index: number;
  value: AspectConfig;
  counts: { approved: number; rejected: number; pending: number };
  onChange: (next: AspectConfig) => void;
  onRegenerate: () => void;
  onBulkAccept: () => void;
  onBulkReject: () => void;
  onBulkClear: () => void;
  regenerating: boolean;
  aspectSavedExists: boolean;
}) {
  return (
    <div
      style={{
        padding: 12,
        border: "1px solid var(--border-default)",
        borderRadius: 8,
        background: "var(--surface-elevated)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          color: "var(--color-foreground-muted)",
          marginBottom: 4,
        }}
      >
        Aspect {index + 1}
      </div>
      <input
        type="text"
        value={value.name}
        onChange={(e) => onChange({ ...value, name: e.target.value })}
        placeholder="e.g. Shadow"
        style={{
          width: "100%",
          padding: "6px 8px",
          borderRadius: 6,
          border: "1px solid var(--border-default)",
          background: "var(--surface-card)",
          color: "var(--color-foreground)",
          fontSize: 14,
          fontFamily: "var(--font-serif)",
          marginBottom: 6,
        }}
      />
      <textarea
        value={value.hydrating_thought}
        onChange={(e) => onChange({ ...value, hydrating_thought: e.target.value })}
        rows={2}
        placeholder="A short thought about what prompts in this aspect should do…"
        style={{
          width: "100%",
          padding: "6px 8px",
          borderRadius: 6,
          border: "1px solid var(--border-default)",
          background: "var(--surface-card)",
          color: "var(--color-foreground)",
          fontSize: 12,
          fontFamily: "var(--font-serif)",
          resize: "vertical",
        }}
      />
      <div
        style={{
          marginTop: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          fontSize: 11,
          color: "var(--color-foreground-muted)",
        }}
      >
        <span>
          ✓ {counts.approved} · ✗ {counts.rejected} · ○ {counts.pending}
        </span>
      </div>
      <div
        style={{
          marginTop: 8,
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        <button
          type="button"
          onClick={onRegenerate}
          disabled={regenerating || !aspectSavedExists}
          style={smallBtnStyle(regenerating || !aspectSavedExists)}
          title="Regenerate this aspect for every card"
        >
          {regenerating ? "Regenerating…" : "Regenerate column"}
        </button>
        <button
          type="button"
          onClick={onBulkAccept}
          style={smallBtnStyle(false)}
          title="Mark every prompt in this column as approved"
        >
          ✓ all
        </button>
        <button
          type="button"
          onClick={onBulkReject}
          style={smallBtnStyle(false)}
          title="Mark every prompt in this column as rejected"
        >
          ✗ all
        </button>
        <button
          type="button"
          onClick={onBulkClear}
          style={smallBtnStyle(false)}
          title="Clear status on every prompt in this column"
        >
          Clear
        </button>
      </div>
    </div>
  );
}

function FilterRow({
  filter,
  onFilterChange,
}: {
  filter: StatusFilter;
  onFilterChange: (f: StatusFilter) => void;
}) {
  const items: { key: StatusFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "approved", label: "Approved" },
    { key: "rejected", label: "Rejected" },
    { key: "pending", label: "Pending" },
  ];
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        marginBottom: 12,
        flexWrap: "wrap",
      }}
    >
      {items.map((it) => {
        const active = filter === it.key;
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => onFilterChange(it.key)}
            style={{
              padding: "4px 10px",
              borderRadius: 9999,
              fontSize: 12,
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              cursor: "pointer",
              background: active
                ? "color-mix(in oklab, var(--accent, var(--gold)) 18%, transparent)"
                : "transparent",
              color: active ? "var(--color-foreground)" : "var(--color-foreground-muted)",
              border: active
                ? "1px solid color-mix(in oklab, var(--accent, var(--gold)) 50%, transparent)"
                : "1px solid var(--border-subtle)",
            }}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

function CardEditRow({
  card,
  aspects,
  hasDescription,
  aspectsSaved,
  onAcceptReject,
  onSavePromptEdit,
  onRegenerateCard,
}: {
  card: CustomDeckCard;
  aspects: AspectConfig[];
  hasDescription: boolean;
  aspectsSaved: boolean;
  onAcceptReject: (
    cardId: number,
    aspectIndex: number,
    next: "approved" | "rejected" | null,
  ) => void;
  onSavePromptEdit: (cardId: number, aspectIndex: number, text: string) => void;
  onRegenerateCard: (cardId: number) => void;
}) {
  const prompts = useMemo(() => card.journal_prompts ?? ["", "", "", ""], [card.journal_prompts]);
  const statuses = useMemo(
    () => card.prompt_status ?? [null, null, null, null],
    [card.prompt_status],
  );
  return (
    <div
      style={{
        padding: 12,
        border: "1px solid var(--border-subtle)",
        borderRadius: 8,
        background: "var(--surface-elevated)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          marginBottom: 8,
          flexWrap: "wrap",
        }}
      >
        <div>
          <div
            style={{
              fontSize: 14,
              fontWeight: 500,
              color: "var(--color-foreground)",
            }}
          >
            {card.card_name ?? `Card ${card.card_id}`}
          </div>
          {!hasDescription && (
            <div
              style={{
                fontSize: 11,
                color: "var(--color-foreground-muted)",
                fontStyle: "italic",
              }}
            >
              Needs a description before prompts can be generated.
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={() => onRegenerateCard(card.card_id)}
          disabled={!hasDescription || !aspectsSaved}
          style={smallBtnStyle(!hasDescription || !aspectsSaved)}
          title="Regenerate all 4 prompts for this card"
        >
          <Sparkles size={11} /> Regenerate card
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
        }}
      >
        {[0, 1, 2, 3].map((i) => (
          <PromptSlot
            key={i}
            aspectName={aspects[i]?.name ?? `Aspect ${i + 1}`}
            prompt={prompts[i] ?? ""}
            status={statuses[i] ?? null}
            onAccept={() => onAcceptReject(card.card_id, i, "approved")}
            onReject={() => onAcceptReject(card.card_id, i, "rejected")}
            onClear={() => onAcceptReject(card.card_id, i, null)}
            onSave={(t) => onSavePromptEdit(card.card_id, i, t)}
          />
        ))}
      </div>
    </div>
  );
}

function PromptSlot({
  aspectName,
  prompt,
  status,
  onAccept,
  onReject,
  onClear,
  onSave,
}: {
  aspectName: string;
  prompt: string;
  status: string | null;
  onAccept: () => void;
  onReject: () => void;
  onClear: () => void;
  onSave: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(prompt);
  useEffect(() => {
    setDraft(prompt);
  }, [prompt]);
  const borderColor =
    status === "approved"
      ? "color-mix(in oklab, var(--accent, var(--gold)) 55%, transparent)"
      : status === "rejected"
        ? "color-mix(in oklab, #d97a7a 60%, transparent)"
        : "var(--border-subtle)";
  return (
    <div
      style={{
        padding: 10,
        borderRadius: 6,
        border: `1.5px solid ${borderColor}`,
        background: "var(--surface-card)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        minHeight: 100,
      }}
    >
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--color-foreground-muted)",
          fontStyle: "italic",
        }}
      >
        {aspectName}
      </div>
      {editing ? (
        <>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            style={{
              width: "100%",
              padding: 6,
              borderRadius: 4,
              border: "1px solid var(--border-default)",
              background: "var(--surface-elevated)",
              color: "var(--color-foreground)",
              fontFamily: "var(--font-serif)",
              fontSize: 12,
              resize: "vertical",
            }}
            autoFocus
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              onClick={() => {
                onSave(draft);
                setEditing(false);
              }}
              style={smallBtnStyle(false)}
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setDraft(prompt);
                setEditing(false);
              }}
              style={smallBtnStyle(false)}
            >
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <div
            onClick={() => setEditing(true)}
            style={{
              flex: 1,
              fontSize: 12,
              fontFamily: "var(--font-serif)",
              color: prompt ? "var(--color-foreground)" : "var(--color-foreground-muted)",
              fontStyle: prompt ? "normal" : "italic",
              cursor: "text",
              minHeight: 36,
              padding: "4px 0",
            }}
          >
            {prompt || "Click to write…"}
          </div>
          <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
            <button
              type="button"
              onClick={status === "approved" ? onClear : onAccept}
              title={status === "approved" ? "Clear approval" : "Approve"}
              style={iconBtnStyle(status === "approved")}
              aria-label="Approve prompt"
            >
              <Check size={14} />
            </button>
            <button
              type="button"
              onClick={status === "rejected" ? onClear : onReject}
              title={status === "rejected" ? "Clear rejection" : "Reject"}
              style={iconBtnStyle(status === "rejected")}
              aria-label="Reject prompt"
            >
              <X size={14} />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────
   Style helpers (inline; design-token compliant)
   ───────────────────────────────────────────────────────────────── */

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid color-mix(in oklab, var(--accent, var(--gold)) 50%, transparent)",
    background: disabled
      ? "transparent"
      : "color-mix(in oklab, var(--accent, var(--gold)) 18%, transparent)",
    color: "var(--color-foreground)",
    fontFamily: "var(--font-serif)",
    fontStyle: "italic",
    fontSize: 13,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
}

function ghostBtnStyle(): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 12px",
    borderRadius: 8,
    border: "1px solid var(--border-default)",
    background: "transparent",
    color: "var(--color-foreground)",
    fontFamily: "var(--font-serif)",
    fontSize: 12,
    cursor: "pointer",
  };
}

function smallBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    padding: "4px 8px",
    borderRadius: 6,
    border: "1px solid var(--border-default)",
    background: "transparent",
    color: disabled ? "var(--color-foreground-muted)" : "var(--color-foreground)",
    fontFamily: "var(--font-serif)",
    fontSize: 11,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
  };
}

function iconBtnStyle(active: boolean): React.CSSProperties {
  return {
    width: 24,
    height: 24,
    borderRadius: 6,
    border: active
      ? "1px solid color-mix(in oklab, var(--accent, var(--gold)) 60%, transparent)"
      : "1px solid var(--border-subtle)",
    background: active
      ? "color-mix(in oklab, var(--accent, var(--gold)) 20%, transparent)"
      : "transparent",
    color: "var(--color-foreground)",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: 0,
  };
}
