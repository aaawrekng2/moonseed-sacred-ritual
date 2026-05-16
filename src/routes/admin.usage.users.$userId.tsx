/**
 * Q32 / Q71 — /admin/usage/users/$userId — per-seeker command center.
 *
 * Q71 rebuild: credit snapshot with quick grants, trend chart with
 * selectable dataset, "most used feature" metric. The old separate
 * Actions section was folded into the credit snapshot card.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  getSeekerDetail,
  grantBonusCredits,
  resetMonthlyQuota,
  setAiBlocked,
  getUserCreditSummary,
  getUserTrendSeries,
} from "@/lib/admin-usage.functions";
import { formatDateTime } from "@/lib/dates";
import { formatDateLong } from "@/lib/dates";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";

export const Route = createFileRoute("/admin/usage/users/$userId")({
  head: () => ({ meta: [{ title: "Seeker — Admin · Tarot Seed" }] }),
  component: SeekerPage,
});

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function fmtUsd(n: number) { return `$${(n ?? 0).toFixed(2)}`; }
function fmtBytes(b: number) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; let v = b;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${u[i]}`;
}

const labelStyle: CSSProperties = { fontFamily: "var(--font-sans)", fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", opacity: 0.55, marginBottom: 6 };
const goldNumber: CSSProperties = { fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 24, color: "var(--accent, var(--gold))" };
const cardStyle: CSSProperties = { padding: 16, borderRadius: 10, border: "0.5px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.025)" };
const grantBtn: CSSProperties = {
  padding: "10px 18px",
  background: "none",
  border: "1px solid var(--accent, var(--gold))",
  color: "var(--accent, var(--gold))",
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: 14,
  cursor: "pointer",
  borderRadius: 6,
};
const textLink: CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  color: "var(--accent, var(--gold))",
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: 13,
  padding: 0,
  textDecoration: "underline",
  textUnderlineOffset: 3,
};

type Dataset = "credits_consumed" | "ai_calls" | "cost_usd" | "grants" | "storage";
const DATASETS: Array<{ id: Dataset; label: string }> = [
  { id: "credits_consumed", label: "Credits consumed" },
  { id: "ai_calls", label: "AI calls" },
  { id: "cost_usd", label: "API cost (USD)" },
  { id: "grants", label: "Credit grants" },
  { id: "storage", label: "Storage usage" },
];

function SeekerPage() {
  const { userId } = Route.useParams();
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [summary, setSummary] = useState<{
    available: number;
    monthlyAllowance: number;
    nextResetAt: string | null;
    lifetimeGranted: number;
    lifetimeConsumed: number;
  } | null>(null);
  const [customAmount, setCustomAmount] = useState("");
  const [dataset, setDataset] = useState<Dataset>("credits_consumed");
  const [series, setSeries] = useState<Array<{ d: string; value: number }>>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);

  const reload = async () => {
    const headers = await authHeaders();
    const [detail, sum] = await Promise.all([
      getSeekerDetail({ data: { userId }, headers }),
      getUserCreditSummary({ data: { userId }, headers }).catch(() => null),
    ]);
    setData(detail);
    if (sum) setSummary(sum);
  };
  useEffect(() => { reload().catch(console.error); }, [userId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setSeriesLoading(true);
      try {
        const headers = await authHeaders();
        const res = await getUserTrendSeries({
          data: { userId, dataset, days: 90 },
          headers,
        });
        if (!cancelled) setSeries(res.series);
      } catch {
        if (!cancelled) setSeries([]);
      } finally {
        if (!cancelled) setSeriesLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId, dataset]);

  if (!data) return <div style={{ padding: 32, opacity: 0.5 }}>loading…</div>;
  const s = data.seeker;
  const prefs = data.prefs;
  const blocked = !!prefs?.ai_blocked;

  const doGrant = async (credits: number, silent = false) => {
    const note = silent
      ? "admin quick grant"
      : window.prompt(`Grant ${credits} bonus credits — note?`, "");
    if (note === null) return;
    setBusy("grant");
    try {
      const headers = await authHeaders();
      await grantBonusCredits({ data: { userId, credits, note }, headers });
      await reload();
    } finally { setBusy(null); }
  };
  const doCustomGrant = async () => {
    const n = parseInt(customAmount, 10);
    if (!Number.isFinite(n) || n <= 0) return;
    const note = window.prompt(`Grant ${n} credits — note?`, "") ?? "";
    setBusy("grant");
    try {
      const headers = await authHeaders();
      await grantBonusCredits({ data: { userId, credits: n, note }, headers });
      setCustomAmount("");
      await reload();
    } finally { setBusy(null); }
  };
  const doReset = async () => {
    if (!confirm("Issue a fresh monthly grant for this seeker?")) return;
    setBusy("reset");
    try {
      const headers = await authHeaders();
      await resetMonthlyQuota({ data: { userId }, headers });
      await reload();
    } finally { setBusy(null); }
  };
  const doBlock = async (block: boolean) => {
    let reason: string | null = null;
    if (block) {
      reason = window.prompt("Reason for blocking AI for this seeker?", "");
      if (reason === null) return;
    } else if (!confirm("Unblock AI for this seeker?")) return;
    setBusy("block");
    try {
      const headers = await authHeaders();
      await setAiBlocked({ data: { userId, blocked: block, reason: reason ?? undefined }, headers });
      await reload();
    } finally { setBusy(null); }
  };

  // Most-used feature this month (from the recent ai calls we already have).
  // We approximate "this month" by filtering aiCalls by current month start.
  const monthStartIso = new Date(
    Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1),
  ).toISOString();
  const mostUsedFeature = (() => {
    const tally: Record<string, number> = {};
    for (const c of data.aiCalls as Array<{ call_type: string; created_at: string; status: string }>) {
      if (c.status !== "success") continue;
      if (c.created_at < monthStartIso) continue;
      tally[c.call_type] = (tally[c.call_type] ?? 0) + 1;
    }
    const entries = Object.entries(tally).sort((a, b) => b[1] - a[1]);
    return entries[0]?.[0] ?? "—";
  })();

  return (
    <div style={{ padding: "24px 32px", maxWidth: 1100, margin: "0 auto" }}>
      <Link to="/admin/usage" style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: 0.6, marginBottom: 20 }}>
        <ArrowLeft size={16} /> usage
      </Link>
      <header style={{ marginBottom: 32 }}>
        <h1 style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 28, margin: 0 }}>
          {s?.email ?? userId}
        </h1>
        <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap", opacity: 0.7, fontSize: 13 }}>
          <span>{s?.plan ?? "—"}</span>
          {s?.member_since && <span>· member since {formatDateTime(s.member_since)}</span>}
          {blocked && <span style={{ color: "var(--destructive, #c25450)" }}>· AI BLOCKED ({prefs?.ai_blocked_reason})</span>}
          {s?.hit_abuse_cap_this_month && <span style={{ color: "var(--destructive)" }}>· hit abuse cap</span>}
        </div>
      </header>

      {/* Credit snapshot + quick grants */}
      <section style={{ ...cardStyle, padding: 24, marginBottom: 32 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 20, marginBottom: 24 }}>
          <div>
            <div style={labelStyle}>current balance</div>
            <div style={{ ...goldNumber, fontSize: 36 }}>
              {summary ? summary.available : "…"}
            </div>
          </div>
          <div>
            <div style={labelStyle}>monthly allowance</div>
            <div style={{ ...goldNumber, fontSize: 20 }}>
              {summary ? summary.monthlyAllowance : "…"}
            </div>
          </div>
          <div>
            <div style={labelStyle}>next reset</div>
            <div style={{ ...goldNumber, fontSize: 16 }}>
              {summary?.nextResetAt ? formatDateLong(summary.nextResetAt) : "—"}
            </div>
          </div>
          <div>
            <div style={labelStyle}>lifetime granted</div>
            <div style={{ ...goldNumber, fontSize: 20 }}>
              {summary ? summary.lifetimeGranted : "…"}
            </div>
          </div>
          <div>
            <div style={labelStyle}>lifetime consumed</div>
            <div style={{ ...goldNumber, fontSize: 20 }}>
              {summary ? summary.lifetimeConsumed : "…"}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", marginBottom: 12 }}>
          <button style={grantBtn} onClick={() => doGrant(50, true)} disabled={busy !== null}>+50</button>
          <button style={grantBtn} onClick={() => doGrant(200, true)} disabled={busy !== null}>+200</button>
          <button style={grantBtn} onClick={() => doGrant(500, true)} disabled={busy !== null}>+500</button>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 8 }}>
            <input
              type="number"
              min={1}
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value)}
              placeholder="custom"
              style={{
                width: 100,
                padding: "8px 10px",
                background: "rgba(0,0,0,0.25)",
                border: "1px solid rgba(255,255,255,0.15)",
                color: "inherit",
                fontFamily: "var(--font-serif)",
                fontSize: 14,
                borderRadius: 6,
              }}
            />
            <button style={grantBtn} onClick={doCustomGrant} disabled={busy !== null || !customAmount}>Grant</button>
          </div>
        </div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 18, alignItems: "center" }}>
          <button style={textLink} onClick={doReset} disabled={busy !== null}>Reset monthly quota</button>
          {!blocked ? (
            <button style={{ ...textLink, color: "var(--destructive, #c25450)" }} onClick={() => doBlock(true)} disabled={busy !== null}>Block AI for this seeker</button>
          ) : (
            <button style={textLink} onClick={() => doBlock(false)} disabled={busy !== null}>Unblock AI</button>
          )}
        </div>
      </section>

      {/* Trend chart */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 12 }}>
          <h2 style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 18, margin: 0 }}>Trends · last 90 days</h2>
          <select
            value={dataset}
            onChange={(e) => setDataset(e.target.value as Dataset)}
            style={{
              background: "rgba(0,0,0,0.25)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "inherit",
              padding: "6px 10px",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 14,
              borderRadius: 6,
            }}
          >
            {DATASETS.map((d) => (
              <option key={d.id} value={d.id}>{d.label}</option>
            ))}
          </select>
        </div>
        <div style={{ ...cardStyle, padding: 16, height: 240 }}>
          {seriesLoading ? (
            <div style={{ opacity: 0.5, padding: 20 }}>loading…</div>
          ) : series.every((p) => p.value === 0) ? (
            <div style={{ opacity: 0.5, padding: 20, fontStyle: "italic", fontFamily: "var(--font-serif)" }}>
              No data in this window.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="d" tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fill: "rgba(255,255,255,0.45)", fontSize: 10 }} tickLine={false} axisLine={false} width={40} />
                <RTooltip
                  contentStyle={{
                    background: "rgba(0,0,0,0.85)",
                    border: "1px solid rgba(212,175,55,0.3)",
                    fontFamily: "var(--font-serif)",
                    fontSize: 12,
                  }}
                />
                <Line type="monotone" dataKey="value" stroke="var(--accent, var(--gold, #d4af37))" strokeWidth={1.5} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </section>

      <h2 style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 18, margin: "0 0 12px" }}>This month</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
        <Metric label="ai cost" value={fmtUsd(s?.ai_cost_usd_this_month ?? 0)} />
        <Metric label="storage size" value={fmtBytes(s?.storage_bytes_current ?? 0)} />
        <Metric label="total cost" value={fmtUsd(s?.total_cost_usd_this_month ?? 0)} />
        <Metric label="revenue" value={fmtUsd(s?.revenue_this_month ?? 0)} />
        <Metric label="margin" value={fmtUsd(s?.margin_this_month ?? 0)} color={(s?.margin_this_month ?? 0) >= 0 ? "var(--success)" : "var(--destructive)"} />
        <Metric label="ai calls" value={String(s?.ai_calls_this_month ?? 0)} />
        <Metric label="credits used" value={String(s?.ai_credits_used_this_month ?? 0)} />
        <Metric label="most used feature" value={mostUsedFeature} />
      </div>

      <h2 style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 18, margin: "0 0 12px" }}>Lifetime</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 32 }}>
        <Metric label="ai cost" value={fmtUsd(s?.ai_cost_usd_lifetime ?? 0)} />
        <Metric label="ai calls" value={String(s?.ai_calls_lifetime ?? 0)} />
        <Metric label="last call" value={s?.last_call_at ? formatDateTime(s.last_call_at) : "—"} />
        <Metric label="last upload" value={s?.last_upload_at ? formatDateTime(s.last_upload_at) : "—"} />
      </div>

      <h2 style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 18, margin: "0 0 12px" }}>Recent activity</h2>
      <div style={{ marginBottom: 32 }}>
        {[...data.aiCalls.map((c: any) => ({ ...c, kind: "ai" })),
          ...data.storageEvents.map((e: any) => ({ ...e, kind: "storage" }))]
          .sort((a, b) => b.created_at.localeCompare(a.created_at))
          .slice(0, 50)
          .map((row: any) => (
            <div key={`${row.kind}-${row.id}`} style={{ display: "grid", gridTemplateColumns: "1.5fr 0.6fr 1.5fr 1fr 0.8fr", gap: 8, padding: "8px 0", borderBottom: "0.5px solid rgba(255,255,255,0.05)", fontSize: 13, opacity: 0.85 }}>
              <span style={{ opacity: 0.6 }}>{formatDateTime(row.created_at)}</span>
              <span style={{ opacity: 0.5 }}>{row.kind}</span>
              <span>{row.kind === "ai" ? `${row.call_type} · ${row.model}` : `${row.bucket}`}</span>
              <span>{row.kind === "ai" ? fmtUsd(Number(row.cost_usd)) : fmtBytes(row.size_bytes)}</span>
              <span style={{ color: row.kind === "ai" && row.status !== "success" ? "var(--destructive)" : "inherit", opacity: 0.7 }}>{row.kind === "ai" ? row.status : row.event_type}</span>
            </div>
          ))}
      </div>

      <h2 style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 18, margin: "0 0 12px" }}>Credit grant history</h2>
      <div style={{ marginBottom: 32 }}>
        {data.grants.length === 0 ? <div style={{ opacity: 0.4 }}>no grants</div> :
          data.grants.map((g: any) => (
            <div key={g.id} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 0.8fr 1fr 1fr", gap: 8, padding: "8px 0", borderBottom: "0.5px solid rgba(255,255,255,0.05)", fontSize: 13 }}>
              <span style={{ opacity: 0.6 }}>{formatDateTime(g.created_at)}</span>
              <span>{g.source}</span>
              <span>{g.credits_amount}</span>
              <span style={{ opacity: 0.6 }}>{g.expires_at ? `expires ${formatDateTime(g.expires_at)}` : "no expiry"}</span>
              <span style={{ opacity: 0.5, fontSize: 11 }}>{g.metadata?.note ?? ""}</span>
            </div>
          ))}
      </div>
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={cardStyle}>
      <div style={labelStyle}>{label}</div>
      <div style={{ ...goldNumber, color: color ?? goldNumber.color, fontSize: 20 }}>{value}</div>
    </div>
  );
}