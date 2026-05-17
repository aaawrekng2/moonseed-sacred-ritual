export type DetectWeavesResult = {
  ok: boolean;
  weaves_detected: number;
  weaves_existing: number;
};

export type DetectWeavesCounts = {
  inserted: number;
  existing: number;
};

export type WeavePreview = {
  pattern_ids: [string, string];
  pattern_names: [string, string];
  title: string;
  description: string;
  reading_ids: string[];
  shared_readings: number;
  already_exists: boolean;
};

export type PreviewWeavesResult = {
  would_create: WeavePreview[];
  already_existing: number;
};

export async function detectWeavesForUser(
  supabase: { from: (table: string) => any },
  userId: string,
): Promise<DetectWeavesCounts> {
  const sb = supabase as any;

  const { data: patternRows } = await sb
    .from("patterns")
    .select("id, name, reading_ids, thread_ids, lifecycle_state")
    .eq("user_id", userId)
    .in("lifecycle_state", ["emerging", "active", "reawakened"]);
  const patterns = (patternRows ?? []) as Array<{
    id: string;
    name: string;
    reading_ids: string[];
    thread_ids: string[];
    lifecycle_state: string;
  }>;
  if (patterns.length < 2) return { inserted: 0, existing: 0 };

  const { data: existingWeaves } = await sb
    .from("weaves")
    .select("id, pattern_ids")
    .eq("user_id", userId);
  const existingKeys = new Set<string>(
    ((existingWeaves ?? []) as Array<{ pattern_ids: string[] }>).map((w) =>
      [...(w.pattern_ids ?? [])].sort().join("|"),
    ),
  );

  let inserted = 0;
  let existing = 0;
  for (let i = 0; i < patterns.length; i++) {
    for (let j = i + 1; j < patterns.length; j++) {
      const a = patterns[i];
      const b = patterns[j];
      const sharedReadings = (a.reading_ids ?? []).filter((r) =>
        (b.reading_ids ?? []).includes(r),
      );
      if (sharedReadings.length < 2) continue;

      const key = [a.id, b.id].sort().join("|");
      if (existingKeys.has(key)) {
        existing += 1;
        continue;
      }

      const { error } = await sb.from("weaves").insert({
        user_id: userId,
        weave_type: "pattern_weave",
        title: `${a.name} ↔ ${b.name}`,
        description: `These patterns share ${sharedReadings.length} readings — a weave is forming.`,
        pattern_ids: [a.id, b.id],
        reading_ids: sharedReadings,
      });
      if (!error) {
        inserted += 1;
        existingKeys.add(key);
      } else if ((error as { code?: string }).code === "23505") {
        existing += 1;
        existingKeys.add(key);
      } else {
        console.error("[detectWeavesForUser] insert failed", error);
      }
    }
  }
  return { inserted, existing };
}

export async function previewWeavesForUser(
  supabase: { from: (table: string) => any },
  userId: string,
): Promise<PreviewWeavesResult> {
  const sb = supabase as any;

  const { data: patternRows } = await sb
    .from("patterns")
    .select("id, name, reading_ids, thread_ids, lifecycle_state")
    .eq("user_id", userId)
    .in("lifecycle_state", ["emerging", "active", "reawakened"]);
  const patterns = (patternRows ?? []) as Array<{
    id: string;
    name: string;
    reading_ids: string[];
    thread_ids: string[];
    lifecycle_state: string;
  }>;
  if (patterns.length < 2) return { would_create: [], already_existing: 0 };

  const { data: existingWeaves } = await sb
    .from("weaves")
    .select("id, pattern_ids")
    .eq("user_id", userId);
  const existingKeys = new Set<string>(
    ((existingWeaves ?? []) as Array<{ pattern_ids: string[] }>).map((w) =>
      [...(w.pattern_ids ?? [])].sort().join("|"),
    ),
  );

  const wouldCreate: WeavePreview[] = [];
  let alreadyExisting = 0;
  for (let i = 0; i < patterns.length; i++) {
    for (let j = i + 1; j < patterns.length; j++) {
      const a = patterns[i];
      const b = patterns[j];
      const sharedReadings = (a.reading_ids ?? []).filter((r) =>
        (b.reading_ids ?? []).includes(r),
      );
      if (sharedReadings.length < 2) continue;

      const key = [a.id, b.id].sort().join("|");
      if (existingKeys.has(key)) {
        alreadyExisting += 1;
        continue;
      }
      wouldCreate.push({
        pattern_ids: [a.id, b.id],
        pattern_names: [a.name, b.name],
        title: `${a.name} ↔ ${b.name}`,
        description: `These patterns share ${sharedReadings.length} readings — a weave is forming.`,
        reading_ids: sharedReadings,
        shared_readings: sharedReadings.length,
        already_exists: false,
      });
    }
  }
  return { would_create: wouldCreate, already_existing: alreadyExisting };
}
