/**
 * Q32 — /admin/usage/users/$userId — per-seeker drill-down.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  getSeekerDetail,
  grantBonusCredits,
  resetMonthlyQuota,
  setAiBlocked,
} from "@/lib/admin-usage.functions";
import { formatDateTime } from "@/lib/dates";

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
const actionBtn: CSSProperties = { background: "none", border: "none", cursor: "pointer", color: "var(--accent, var(--gold))", fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 14, padding: "8px 0", display: "block", textAlign: "left" };

function SeekerPage() {
  const { userId } = Route.useParams();
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reload = async () => {
    const headers = await authHeaders();
    setData(await getSeekerDetail({ data: { userId }, headers }));
  };
  useEffect(() => { reload().catch(console.error); }, [userId]);

  if (!data) return <div style={{ padding: 32, opacity: 0.5 }}>loading…</div>;
  const s = data.seeker;
  const prefs = data.prefs;
  const blocked = !!prefs?.ai_blocked;

  const doGrant = async (credits: number) => {
    const note = window.prompt(`Grant ${credits} bonus credits — note?`, "");
    if (note === null) return;
    setBusy("grant");
    try {
      const headers = await authHeaders();
      await grantBonusCredits({ data: { userId, credits, note }, headers });
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

      <h2 style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 18, margin: "0 0 12px" }}>This month</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
        <Metric label="ai cost" value={fmtUsd(s?.ai_cost_usd_this_month ?? 0)} />
        <Metric label="storage size" value={fmtBytes(s?.storage_bytes_current ?? 0)} />
        <Metric label="total cost" value={fmtUsd(s?.total_cost_usd_this_month ?? 0)} />
        <Metric label="revenue" value={fmtUsd(s?.revenue_this_month ?? 0)} />
        <Metric label="margin" value={fmtUsd(s?.margin_this_month ?? 0)} color={(s?.margin_this_month ?? 0) >= 0 ? "var(--success)" : "var(--destructive)"} />
        <Metric label="ai calls" value={String(s?.ai_calls_this_month ?? 0)} />
        <Metric label="credits used" value={String(s?.ai_credits_used_this_month ?? 0)} />
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

      <h2 style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 18, margin: "0 0 12px" }}>Active grants</h2>
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

      <h2 style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 18, margin: "0 0 12px" }}>Actions</h2>
      <div style={cardStyle}>
        <button style={actionBtn} onClick={() => doGrant(50)} disabled={busy !== null}>grant 50 bonus credits</button>
        <button style={actionBtn} onClick={() => doGrant(100)} disabled={busy !== null}>grant 100 bonus credits</button>
        <button style={actionBtn} onClick={() => doGrant(500)} disabled={busy !== null}>grant 500 bonus credits</button>
        <button style={actionBtn} onClick={doReset} disabled={busy !== null}>reset monthly quota now</button>
        {!blocked ? (
          <button style={{ ...actionBtn, color: "var(--destructive, #c25450)" }} onClick={() => doBlock(true)} disabled={busy !== null}>block AI for this seeker</button>
        ) : (
          <button style={actionBtn} onClick={() => doBlock(false)} disabled={busy !== null}>unblock AI</button>
        )}
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