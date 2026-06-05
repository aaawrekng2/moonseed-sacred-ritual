/**
 * Q32 — /admin/usage
 *
 * Tabs: Overview · Seekers · Anomalies · Settings
 * Cori is the only seeker on the dashboard so far; the spec values
 * design over density — italic gold numbers, small-caps meta labels.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type CSSProperties } from "react";
import { ArrowLeft } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  getAnomalies,
  getOverviewTops,
  getSeekerUsageList,
  getUsageSummary,
  listAdminSettings,
  updateAdminSetting,
  getLatestUnresolvedTrip,
  reEnableAI,
  type CircuitBreakerTripRow,
} from "@/lib/admin-usage.functions";
import {
  listAdminUsers,
  listAIGateViolations,
  countUnresolvedAIGateViolations,
  reviewAIGateViolation,
} from "@/lib/admin.functions";
import { formatDateLong } from "@/lib/dates";
import { Modal } from "@/components/ui/modal";
import { toast } from "sonner";

export const Route = createFileRoute("/admin/usage")({
  head: () => ({ meta: [{ title: "Usage — Admin · Tarot Seed" }] }),
  component: AdminUsagePage,
});

async function authHeaders(): Promise<Record<string, string>> {
  // Q84 — refresh near-expired sessions so admin calls don't fail with a stale token.
  let { data } = await supabase.auth.getSession();
  let t = data.session?.access_token;
  const expiresAt = data.session?.expires_at ?? 0;
  if (!t || expiresAt - Math.floor(Date.now() / 1000) < 60) {
    try {
      const r = await supabase.auth.refreshSession();
      t = r.data.session?.access_token ?? t;
    } catch {}
  }
  return t ? { Authorization: `Bearer ${t}` } : {};
}

function fmtUsd(n: number) {
  return `$${(n ?? 0).toFixed(2)}`;
}
function fmtBytes(b: number) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v < 10 ? 2 : 1)} ${u[i]}`;
}

const labelStyle: CSSProperties = {
  fontFamily: "var(--font-sans)",
  fontSize: 11,
  letterSpacing: "0.14em",
  textTransform: "uppercase",
  opacity: 0.55,
  marginBottom: 6,
};
const goldNumber: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: 32,
  color: "var(--accent, var(--gold, #d4af37))",
  fontWeight: 400,
};
const cardStyle: CSSProperties = {
  padding: 20,
  borderRadius: 10,
  border: "0.5px solid var(--border-subtle, rgba(255,255,255,0.1))",
  background: "var(--surface-card, rgba(255,255,255,0.025))",
};
const tabBtnStyle = (active: boolean): CSSProperties => ({
  background: "none",
  border: "none",
  padding: "10px 0",
  marginRight: 24,
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: 16,
  color: active ? "var(--accent, var(--gold))" : "var(--foreground)",
  borderBottom: active ? "1px solid var(--accent, var(--gold))" : "1px solid transparent",
  cursor: "pointer",
});
const headerStyle: CSSProperties = {
  fontFamily: "var(--font-serif)",
  fontStyle: "italic",
  fontSize: 32,
  margin: 0,
};

type Tab = "overview" | "seekers" | "anomalies" | "violations" | "settings";

function formatTimeAgo(iso: string): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (diffSec < 60) return `${diffSec}s ago`;
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

function CircuitBreakerBanner() {
  const [trip, setTrip] = useState<CircuitBreakerTripRow | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const refresh = async () => {
    try {
      const headers = await authHeaders();
      const t = await getLatestUnresolvedTrip({ headers });
      setTrip(t ?? null);
    } catch (e) {
      console.error("[circuit-breaker] fetch trip", e);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const handleReEnable = async () => {
    if (!trip) return;
    setSubmitting(true);
    try {
      const headers = await authHeaders();
      await reEnableAI({ data: { tripId: trip.id, note: note || undefined }, headers });
      toast.success(
        "AI re-enabled. Cost-tracking windows reset — caps now count from this moment forward.",
      );
      setShowModal(false);
      setNote("");
      await refresh();
    } catch (e) {
      console.error("[circuit-breaker] re-enable failed", e);
      toast.error("Re-enable failed. Try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!trip) return null;

  return (
    <>
      <div
        style={{
          background: "color-mix(in oklab, var(--destructive, #c25450) 18%, transparent)",
          border: "1px solid var(--destructive, #c25450)",
          borderRadius: 8,
          padding: 16,
          marginBottom: 20,
          color: "var(--foreground)",
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          ⚠️ AI circuit breaker tripped —{" "}
          {trip.threshold_type === "hourly" ? "hourly" : "12-hour"} cost cap exceeded
        </div>
        <div style={{ fontSize: 14, opacity: 0.85, lineHeight: 1.5 }}>
          Threshold: ${Number(trip.threshold_usd).toFixed(2)} · Actual: $
          {Number(trip.actual_cost_usd).toFixed(4)} ·{" "}
          {trip.call_count_in_window} calls in window · Tripped{" "}
          {formatTimeAgo(trip.created_at)}
        </div>
        <div style={{ marginTop: 12 }}>
          <button
            onClick={() => setShowModal(true)}
            style={{
              background: "var(--accent, var(--gold))",
              color: "var(--background)",
              border: "none",
              borderRadius: 6,
              padding: "8px 16px",
              cursor: "pointer",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 14,
            }}
          >
            Review & re-enable AI
          </button>
        </div>
      </div>
      <Modal
        open={showModal}
        onClose={() => (submitting ? undefined : setShowModal(false))}
        title="Re-enable AI"
        size="md"
      >
        <div style={{ padding: 20, fontSize: 14, lineHeight: 1.6 }}>
          <p style={{ marginTop: 0 }}>
            Re-enabling will reset the cost-tracking windows. The hourly and
            12-hour caps will count from this moment forward — previous activity
            in the last 1 and 12 hours will NOT count against the limit, so the
            breaker will not immediately re-trip on stale data.
          </p>
          <p>
            Make sure you have reviewed the trip details and addressed the cause
            (e.g. blocked an abusive user, adjusted thresholds, or confirmed the
            spike was legitimate) before continuing.
          </p>
          <textarea
            placeholder="Resolution note (optional, kept in audit log)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            style={{
              width: "100%",
              padding: 8,
              borderRadius: 6,
              border: "0.5px solid rgba(255,255,255,0.15)",
              background: "transparent",
              color: "inherit",
              fontFamily: "inherit",
              fontSize: 13,
              marginTop: 8,
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", gap: 12, marginTop: 16, justifyContent: "flex-end" }}>
            <button
              onClick={() => setShowModal(false)}
              disabled={submitting}
              style={{
                background: "transparent",
                color: "var(--foreground)",
                border: "0.5px solid rgba(255,255,255,0.2)",
                borderRadius: 6,
                padding: "8px 16px",
                cursor: submitting ? "default" : "pointer",
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleReEnable}
              disabled={submitting}
              style={{
                background: "var(--accent, var(--gold))",
                color: "var(--background)",
                border: "none",
                borderRadius: 6,
                padding: "8px 16px",
                cursor: submitting ? "default" : "pointer",
                fontWeight: 600,
              }}
            >
              {submitting ? "…" : "Re-enable AI and reset windows"}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function AdminUsagePage() {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div style={{ padding: "24px 32px", maxWidth: 1280, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
        <Link
          to="/admin"
          style={{ display: "inline-flex", alignItems: "center", gap: 6, opacity: 0.6 }}
        >
          <ArrowLeft size={16} /> back
        </Link>
        <h1 style={{ ...headerStyle, marginLeft: 8 }}>Usage</h1>
      </div>
      <CircuitBreakerBanner />
      {/* EK38 — Red banner at the top of /admin/usage when there
          are unresolved AI gate violations. Drives the admin into
          the Gate Violations tab so issues don't sit unnoticed. */}
      <AIGateViolationsBanner onClickGo={() => setTab("violations")} />
      <div style={{ borderBottom: "0.5px solid rgba(255,255,255,0.1)", marginBottom: 24 }}>
        {(["overview", "seekers", "anomalies", "violations", "settings"] as Tab[]).map((t) => (
          <button key={t} style={tabBtnStyle(tab === t)} onClick={() => setTab(t)}>
            {t === "violations" ? "Gate Violations" : t}
          </button>
        ))}
      </div>
      {tab === "overview" && <OverviewTab />}
      {tab === "seekers" && <SeekersTab />}
      {tab === "anomalies" && <AnomaliesTab />}
      {tab === "violations" && <ViolationsTab />}
      {tab === "settings" && <SettingsTab />}
    </div>
  );
}

/* ---------------- Overview ---------------- */

function OverviewTab() {
  const [data, setData] = useState<any>(null);
  const [tops, setTops] = useState<any>(null);
  useEffect(() => {
    (async () => {
      const headers = await authHeaders();
      const [s, t] = await Promise.all([
        getUsageSummary({ headers }),
        getOverviewTops({ headers }),
      ]);
      setData(s);
      setTops(t);
    })().catch((e) => console.error("[admin.usage] overview", e));
  }, []);
  if (!data) return <div style={{ opacity: 0.5 }}>loading…</div>;
  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 16,
          marginBottom: 32,
        }}
      >
        <div style={cardStyle}>
          <div style={labelStyle}>this month's spend</div>
          <div style={goldNumber}>{fmtUsd(data.totalSpend)}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>this month's revenue</div>
          <div style={goldNumber}>{fmtUsd(data.totalRevenue)}</div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>net margin</div>
          <div style={{ ...goldNumber, color: data.netMargin >= 0 ? "var(--success, #6a8d6f)" : "var(--destructive, #c25450)" }}>
            {fmtUsd(data.netMargin)}
          </div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>ai calls</div>
          <div style={goldNumber}>{data.successfulCalls}</div>
          <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>
            {data.failedCalls} failed
          </div>
        </div>
        <div style={cardStyle}>
          <div style={labelStyle}>anomalies</div>
          <div style={goldNumber}>{data.abuseHits + data.quotaHits}</div>
          <div style={{ fontSize: 11, opacity: 0.5, marginTop: 4 }}>
            {data.abuseHits} rate-limit · {data.quotaHits} quota
          </div>
        </div>
      </div>
      {tops && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 32 }}>
          <TopTable title="Top 10 most expensive" rows={tops.topCost} />
          <TopTable title="Top 10 highest loss-ratio" rows={tops.topLoss} />
        </div>
      )}
    </div>
  );
}

function TopTable({ title, rows }: { title: string; rows: any[] }) {
  return (
    <div>
      <h2 style={{ ...headerStyle, fontSize: 20, marginBottom: 12 }}>{title}</h2>
      {rows.length === 0 && <div style={{ opacity: 0.4 }}>no data this month</div>}
      {rows.map((r) => (
        <Link
          key={r.user_id}
          to="/admin/usage/users/$userId"
          params={{ userId: r.user_id }}
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "12px 0",
            borderBottom: "0.5px solid rgba(255,255,255,0.08)",
            color: "inherit",
            textDecoration: "none",
          }}
        >
          <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}>
            {r.email}
          </span>
          <span style={{ ...goldNumber, fontSize: 16 }}>
            {fmtUsd(r.total_cost_usd_this_month)}
            <span style={{ opacity: 0.4, fontSize: 11, marginLeft: 8 }}>
              {r.plan} · loss {r.loss_ratio.toFixed(1)}×
            </span>
          </span>
        </Link>
      ))}
    </div>
  );
}

/* ---------------- Seekers ---------------- */

function SeekersTab() {
  const [rows, setRows] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<"all" | "free" | "premium" | "loss_makers" | "abusive" | "blocked">("all");
  const [sortBy, setSortBy] = useState<"total_cost" | "loss_ratio" | "ai_cost" | "storage_bytes" | "last_activity" | "revenue" | "member_since">("total_cost");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const limit = 50;
  useEffect(() => {
    (async () => {
      const headers = await authHeaders();
      // Q68 — fetch a large page of usage rows AND the full admin
      // users list, then merge. Users with zero activity exist in
      // `listAdminUsers` (reads auth.users) but not in
      // `seeker_usage_monthly`. Without this merge, brand-new signups
      // are invisible in the Users tab and admins cannot gift them
      // premium.
      const [r, admins] = await Promise.all([
        getSeekerUsageList({
          data: { sortBy, sortDir, filter, limit: 200, offset: 0, search: search || undefined },
          headers,
        }),
        listAdminUsers({ headers }),
      ]);
      const byId = new Map<string, any>();
      for (const row of r.rows) byId.set(row.user_id, row);
      for (const u of admins) {
        if (!u.email) continue;
        if (byId.has(u.user_id)) {
          const ex = byId.get(u.user_id);
          ex.email_confirmed = (u as any).email_confirmed ?? !!u.email_confirmed_at;
          continue;
        }
        byId.set(u.user_id, {
          user_id: u.user_id,
          email: u.email,
          plan: u.is_premium ? "premium" : "free",
          ai_cost_usd_this_month: 0,
          storage_bytes_current: 0,
          total_cost_usd_this_month: 0,
          revenue_this_month: 0,
          margin_this_month: 0,
          loss_ratio: 0,
          ai_credits_used_this_month: 0,
          last_call_at: null,
          member_since: u.created_at,
          email_confirmed: (u as any).email_confirmed ?? !!u.email_confirmed_at,
        });
      }
      let merged = Array.from(byId.values());
      // Apply search client-side so zero-activity users are searchable.
      if (search) {
        const q = search.toLowerCase();
        merged = merged.filter((m) => (m.email ?? "").toLowerCase().includes(q));
      }
      // Apply filter chips that the server may have ignored for the
      // zero-rows we added.
      if (filter === "free") merged = merged.filter((m) => m.plan === "free");
      else if (filter === "premium") merged = merged.filter((m) => m.plan === "premium" || m.plan === "premium_gifted");
      else if (filter === "loss_makers") merged = merged.filter((m) => (m.margin_this_month ?? 0) < 0);
      // Sort client-side across the merged list.
      const sortKey: Record<string, string> = {
        total_cost: "total_cost_usd_this_month",
        ai_cost: "ai_cost_usd_this_month",
        storage_bytes: "storage_bytes_current",
        revenue: "revenue_this_month",
        loss_ratio: "loss_ratio",
        last_activity: "last_call_at",
        member_since: "member_since",
      };
      const k = sortKey[sortBy] ?? "total_cost_usd_this_month";
      merged.sort((a, b) => {
        const av = a[k] ?? 0;
        const bv = b[k] ?? 0;
        if (av === bv) return 0;
        const cmp = av > bv ? 1 : -1;
        return sortDir === "asc" ? cmp : -cmp;
      });
      setTotal(merged.length);
      setRows(merged.slice(offset, offset + limit));
    })().catch((e) => console.error(e));
  }, [filter, sortBy, sortDir, offset, search]);

  const chips = ["all", "free", "premium", "loss_makers", "abusive", "blocked"] as const;
  return (
    <div>
      <div style={{ display: "flex", gap: 8, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        {chips.map((c) => (
          <button
            key={c}
            onClick={() => { setFilter(c); setOffset(0); }}
            style={{
              background: filter === c ? "var(--accent, var(--gold))" : "transparent",
              color: filter === c ? "var(--background)" : "var(--foreground)",
              border: "0.5px solid rgba(255,255,255,0.15)",
              borderRadius: 999,
              padding: "6px 14px",
              fontFamily: "var(--font-serif)",
              fontStyle: "italic",
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {c.replace("_", " ")}
          </button>
        ))}
        <input
          placeholder="search email…"
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
          style={{
            marginLeft: "auto",
            padding: "6px 12px",
            borderRadius: 6,
            border: "0.5px solid rgba(255,255,255,0.15)",
            background: "transparent",
            color: "inherit",
          }}
        />
      </div>
      <div>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 0.5fr", gap: 8, padding: "8px 0", fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", opacity: 0.5, borderBottom: "0.5px solid rgba(255,255,255,0.1)" }}>
          {([
            ["email", null],
            ["plan", null],
            ["ai cost", "ai_cost"],
            ["storage", "storage_bytes"],
            ["total", "total_cost"],
            ["revenue", "revenue"],
            ["p/l", "loss_ratio"],
          ] as const).map(([label, key]) => (
            <button
              key={label}
              onClick={() => {
                if (!key) return;
                if (sortBy === key) setSortDir(sortDir === "asc" ? "desc" : "asc");
                else { setSortBy(key as any); setSortDir("desc"); }
              }}
              style={{ background: "none", border: "none", color: "inherit", cursor: key ? "pointer" : "default", textAlign: "left", textTransform: "uppercase", fontSize: 11, letterSpacing: "0.12em", opacity: sortBy === key ? 1 : 0.5 }}
            >
              {label}{sortBy === key ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
            </button>
          ))}
        </div>
        {rows.map((r) => (
          <Link
            key={r.user_id}
            to="/admin/usage/users/$userId"
            params={{ userId: r.user_id }}
            style={{
              display: "grid",
              gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr 1fr 0.5fr",
              gap: 8,
              padding: "12px 0",
              borderBottom: "0.5px solid rgba(255,255,255,0.06)",
              alignItems: "center",
              color: "inherit",
              textDecoration: "none",
            }}
          >
            <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic" }}>
              {r.email}
              {r.email_confirmed === false && (
                <span style={{ opacity: 0.5, fontSize: 11, marginLeft: 8, fontStyle: "italic" }}>
                  unconfirmed
                </span>
              )}
            </span>
            <span style={{ opacity: 0.7 }}>{r.plan}</span>
            <span>{fmtUsd(r.ai_cost_usd_this_month)}</span>
            <span>{fmtBytes(r.storage_bytes_current)}</span>
            <span style={{ color: "var(--accent, var(--gold))", fontStyle: "italic" }}>{fmtUsd(r.total_cost_usd_this_month)}</span>
            <span>{fmtUsd(r.revenue_this_month)}</span>
            <span style={{ color: r.margin_this_month >= 0 ? "var(--success, #6a8d6f)" : "var(--destructive, #c25450)" }}>
              {r.margin_this_month >= 0 ? "+" : ""}{fmtUsd(r.margin_this_month)}
            </span>
          </Link>
        ))}
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 16, opacity: 0.6 }}>
          <button onClick={() => setOffset(Math.max(0, offset - limit))} disabled={offset === 0}>← prev</button>
          <span>{offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
          <button onClick={() => setOffset(offset + limit)} disabled={offset + limit >= total}>next →</button>
        </div>
      </div>
    </div>
  );
}

/* ---------------- Anomalies ---------------- */

function AnomaliesTab() {
  const [data, setData] = useState<any>(null);
  useEffect(() => {
    (async () => {
      const headers = await authHeaders();
      setData(await getAnomalies({ headers }));
    })().catch((e) => console.error(e));
  }, []);
  if (!data) return <div style={{ opacity: 0.5 }}>loading…</div>;
  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div style={{ marginBottom: 32 }}>
      <h2 style={{ ...headerStyle, fontSize: 20, marginBottom: 12 }}>{title}</h2>
      {children}
    </div>
  );
  return (
    <div>
      <Section title="Hit abuse cap this month">
        {data.abuse.length === 0 ? <div style={{ opacity: 0.4 }}>none</div> :
          data.abuse.map((a: any) => (
            <Link key={a.user_id} to="/admin/usage/users/$userId" params={{ userId: a.user_id }} style={rowLink}>
              <span style={{ fontStyle: "italic" }}>{a.email}</span>
              <span style={{ opacity: 0.6 }}>{a.count}× · first {formatDateLong(a.first_at)}</span>
            </Link>
          ))}
      </Section>
      <Section title="Approaching quota (75%+)">
        {data.approaching.length === 0 ? <div style={{ opacity: 0.4 }}>none</div> :
          data.approaching.map((a: any) => (
            <Link key={a.user_id} to="/admin/usage/users/$userId" params={{ userId: a.user_id }} style={rowLink}>
              <span style={{ fontStyle: "italic" }}>{a.email}</span>
              <span style={{ opacity: 0.6 }}>{a.used} / {a.quota} ({Math.round(a.used / a.quota * 100)}%) · {a.plan}</span>
            </Link>
          ))}
      </Section>
      <Section title="Upload spikes (>10 MB/day)">
        {data.spikes.length === 0 ? <div style={{ opacity: 0.4 }}>none</div> :
          data.spikes.map((s: any) => (
            <Link key={`${s.user_id}-${s.day}`} to="/admin/usage/users/$userId" params={{ userId: s.user_id }} style={rowLink}>
              <span style={{ fontStyle: "italic" }}>{s.email}</span>
              <span style={{ opacity: 0.6 }}>{fmtBytes(s.bytes)} on {s.day}</span>
            </Link>
          ))}
      </Section>
    </div>
  );
}

const rowLink: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  padding: "10px 0",
  borderBottom: "0.5px solid rgba(255,255,255,0.06)",
  color: "inherit",
  textDecoration: "none",
};

/* ---------------- Settings ---------------- */

function SettingsTab() {
  const [rows, setRows] = useState<Array<{ key: string; value: any; description: string | null; updated_at: string }>>([]);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const headers = await authHeaders();
      const data = await listAdminSettings({ headers });
      setRows(data as any);
    })().catch(console.error);
  }, []);
  const save = async (key: string) => {
    setSaving(key);
    try {
      const headers = await authHeaders();
      await updateAdminSetting({ data: { key, value: edits[key] ?? "" }, headers });
      const refreshed = await listAdminSettings({ headers });
      setRows(refreshed as any);
      setEdits((e) => { const n = { ...e }; delete n[key]; return n; });
    } finally {
      setSaving(null);
    }
  };
  return (
    <div>
      <p style={{ opacity: 0.5, fontSize: 13, marginBottom: 16 }}>
        Editing here writes directly to <code>admin_settings</code>. Changes
        take effect on the next AI call (no deploy).
      </p>
      {rows.map((r) => {
        const current = edits[r.key] ?? String(typeof r.value === "object" ? JSON.stringify(r.value) : r.value);
        const dirty = edits[r.key] !== undefined && edits[r.key] !== String(typeof r.value === "object" ? JSON.stringify(r.value) : r.value);
        return (
          <div key={r.key} style={{ display: "grid", gridTemplateColumns: "1.5fr 2fr 1fr auto", gap: 12, padding: "12px 0", borderBottom: "0.5px solid rgba(255,255,255,0.06)", alignItems: "center" }}>
            <code style={{ fontSize: 13 }}>{r.key}</code>
            <span style={{ opacity: 0.55, fontSize: 12 }}>{r.description ?? ""}</span>
            <input
              value={current}
              onChange={(e) => setEdits({ ...edits, [r.key]: e.target.value })}
              style={{ padding: "4px 8px", borderRadius: 4, border: "0.5px solid rgba(255,255,255,0.15)", background: "transparent", color: "inherit" }}
            />
            <button
              disabled={!dirty || saving === r.key}
              onClick={() => save(r.key)}
              style={{ background: dirty ? "var(--accent, var(--gold))" : "transparent", color: dirty ? "var(--background)" : "var(--foreground)", border: "0.5px solid rgba(255,255,255,0.15)", borderRadius: 6, padding: "4px 12px", cursor: dirty ? "pointer" : "default", opacity: dirty ? 1 : 0.4 }}
            >
              {saving === r.key ? "…" : "save"}
            </button>
          </div>
        );
      })}
    </div>
  );
}
/* ---------------- EK38 — AI Gate Violations ---------------- */

/**
 * Red banner at the top of /admin/usage when there are unresolved
 * violations. Lights up loud — admin needs to investigate, money
 * may have been spent.
 */
function AIGateViolationsBanner({ onClickGo }: { onClickGo: () => void }) {
  const [counts, setCounts] = useState<{
    money_spent: number;
    blocked_attempt: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const r = await countUnresolvedAIGateViolations();
        if (!cancelled) setCounts(r);
      } catch {
        // Silent — banner just won't render.
      }
    };
    void load();
    const interval = window.setInterval(load, 60_000); // poll every minute
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  if (!counts || counts.total === 0) return null;

  const moneyOnly = counts.money_spent > 0;
  const blockedOnly = counts.blocked_attempt > 0 && counts.money_spent === 0;

  return (
    <div
      style={{
        background: moneyOnly
          ? "color-mix(in oklch, oklch(0.55 0.21 25) 22%, transparent)"
          : "color-mix(in oklch, oklch(0.7 0.18 80) 18%, transparent)",
        border: `1px solid ${
          moneyOnly
            ? "color-mix(in oklch, oklch(0.65 0.21 25) 60%, transparent)"
            : "color-mix(in oklch, oklch(0.75 0.18 80) 50%, transparent)"
        }`,
        borderRadius: 8,
        padding: "12px 16px",
        marginBottom: 16,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div
          style={{
            fontFamily: "var(--font-display)",
            fontStyle: "italic",
            fontSize: "var(--text-body-lg)",
            color: moneyOnly ? "oklch(0.75 0.21 25)" : "oklch(0.85 0.18 80)",
          }}
        >
          {moneyOnly
            ? `⚠️ AI gate violation — money spent (${counts.money_spent})`
            : blockedOnly
              ? `AI gate flagged ${counts.blocked_attempt} blocked attempt${counts.blocked_attempt === 1 ? "" : "s"}`
              : `AI gate violations — ${counts.money_spent} money, ${counts.blocked_attempt} blocked`}
        </div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontSize: "var(--text-body-sm)",
            opacity: 0.7,
          }}
        >
          {moneyOnly
            ? "An AI call succeeded for a user whose AI is supposed to be off. Investigate immediately."
            : "Calls were blocked by the server gate but shouldn't have been attempted. Likely a UI gate leak."}
        </div>
      </div>
      <button
        type="button"
        onClick={onClickGo}
        style={{
          background: "transparent",
          border: `1px solid ${moneyOnly ? "oklch(0.65 0.21 25)" : "oklch(0.75 0.18 80)"}`,
          borderRadius: 999,
          padding: "8px 16px",
          color: moneyOnly ? "oklch(0.85 0.21 25)" : "oklch(0.9 0.18 80)",
          fontFamily: "var(--font-display)",
          fontStyle: "italic",
          fontSize: "var(--text-body-sm)",
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        Review →
      </button>
    </div>
  );
}

type AIGateViolation = {
  id: string;
  created_at: string;
  call_log_id: string | null;
  user_id: string;
  user_email: string | null;
  call_type: string | null;
  model: string | null;
  provider: string | null;
  status: string;
  cost_usd: number;
  credits_consumed: number;
  user_override: boolean | null;
  global_default: boolean | null;
  effective_gate: boolean | null;
  category: "money_spent" | "blocked_attempt";
  reviewed_at: string | null;
  reviewed_by: string | null;
  reviewed_note: string | null;
};

/**
 * EK38 — Full Gate Violations panel. Lists violations with filter
 * controls, per-row review/dismiss action, and review note. Money
 * spent violations are visually emphasized.
 */
function ViolationsTab() {
  const [violations, setViolations] = useState<AIGateViolation[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvedFilter, setResolvedFilter] = useState<"unresolved" | "all">(
    "unresolved",
  );
  const [categoryFilter, setCategoryFilter] = useState<
    "all" | "money_spent" | "blocked_attempt"
  >("all");
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const result = await listAIGateViolations({
        data: {
          resolved: resolvedFilter === "all" ? undefined : false,
          category: categoryFilter === "all" ? undefined : categoryFilter,
          limit: 200,
        },
      });
      setViolations(result as AIGateViolation[]);
    } catch (e) {
      console.error("[admin] listAIGateViolations failed", e);
      toast.error("Failed to load violations");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedFilter, categoryFilter]);

  const handleReview = async (id: string) => {
    setSubmitting(true);
    try {
      await reviewAIGateViolation({
        data: { violationId: id, note: reviewNote || undefined },
      });
      toast.success("Marked as reviewed");
      setReviewingId(null);
      setReviewNote("");
      void load();
    } catch (e) {
      console.error("[admin] reviewAIGateViolation failed", e);
      toast.error("Failed to mark as reviewed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 8 }}>
          <span
            style={{
              fontSize: "var(--text-caption)",
              opacity: 0.6,
              alignSelf: "center",
            }}
          >
            Show:
          </span>
          {(["unresolved", "all"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setResolvedFilter(v)}
              style={{
                background: "transparent",
                border: "none",
                borderBottom: `1px solid ${
                  resolvedFilter === v
                    ? "color-mix(in oklab, var(--gold) 70%, transparent)"
                    : "transparent"
                }`,
                color: "var(--color-foreground)",
                opacity: resolvedFilter === v ? 1 : 0.6,
                fontStyle: "italic",
                fontSize: "var(--text-body-sm)",
                padding: "4px 0",
                cursor: "pointer",
              }}
            >
              {v}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <span
            style={{
              fontSize: "var(--text-caption)",
              opacity: 0.6,
              alignSelf: "center",
            }}
          >
            Category:
          </span>
          {(["all", "money_spent", "blocked_attempt"] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCategoryFilter(c)}
              style={{
                background: "transparent",
                border: "none",
                borderBottom: `1px solid ${
                  categoryFilter === c
                    ? "color-mix(in oklab, var(--gold) 70%, transparent)"
                    : "transparent"
                }`,
                color: "var(--color-foreground)",
                opacity: categoryFilter === c ? 1 : 0.6,
                fontStyle: "italic",
                fontSize: "var(--text-body-sm)",
                padding: "4px 0",
                cursor: "pointer",
              }}
            >
              {c.replace("_", " ")}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <p style={{ fontStyle: "italic", opacity: 0.6 }}>Loading…</p>
      )}

      {!loading && violations.length === 0 && (
        <p style={{ fontStyle: "italic", opacity: 0.55 }}>
          No violations in this view. The gate is holding.
        </p>
      )}

      {!loading && violations.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {violations.map((v) => (
            <div
              key={v.id}
              style={{
                border: "1px solid var(--border-subtle)",
                borderRadius: 8,
                padding: 12,
                background:
                  v.category === "money_spent"
                    ? "color-mix(in oklch, oklch(0.55 0.21 25) 8%, transparent)"
                    : "var(--surface-card)",
                opacity: v.reviewed_at ? 0.55 : 1,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 12,
                  marginBottom: 8,
                }}
              >
                <div>
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontStyle: "italic",
                      fontSize: "var(--text-body)",
                      color:
                        v.category === "money_spent"
                          ? "oklch(0.85 0.21 25)"
                          : "var(--color-foreground)",
                      marginBottom: 2,
                    }}
                  >
                    {v.category === "money_spent"
                      ? "⚠️ Money spent"
                      : "Blocked attempt"}{" "}
                    · {v.call_type ?? "?"} · {v.status}
                  </div>
                  <div
                    style={{
                      fontSize: "var(--text-body-sm)",
                      opacity: 0.7,
                    }}
                  >
                    {v.user_email ?? v.user_id} · {formatDateLong(v.created_at)}
                  </div>
                </div>
                {!v.reviewed_at && (
                  <button
                    type="button"
                    onClick={() => {
                      setReviewingId(v.id);
                      setReviewNote("");
                    }}
                    style={{
                      background: "transparent",
                      border: "1px solid var(--border-subtle)",
                      borderRadius: 999,
                      padding: "4px 12px",
                      fontFamily: "var(--font-display)",
                      fontStyle: "italic",
                      fontSize: "var(--text-caption)",
                      color: "var(--color-foreground)",
                      cursor: "pointer",
                      flexShrink: 0,
                    }}
                  >
                    Review
                  </button>
                )}
              </div>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "auto 1fr auto 1fr",
                  gap: "4px 12px",
                  fontSize: "var(--text-caption)",
                  opacity: 0.75,
                }}
              >
                <span style={{ opacity: 0.7 }}>Model</span>
                <span>{v.model ?? "—"}</span>
                <span style={{ opacity: 0.7 }}>Cost</span>
                <span>${v.cost_usd}</span>
                <span style={{ opacity: 0.7 }}>Credits</span>
                <span>{v.credits_consumed}</span>
                <span style={{ opacity: 0.7 }}>Override</span>
                <span>
                  {v.user_override === true
                    ? "true"
                    : v.user_override === false
                      ? "false"
                      : "null (follows global)"}
                </span>
                <span style={{ opacity: 0.7 }}>Global default</span>
                <span>
                  {v.global_default === true ? "true" : "false"}
                </span>
                <span style={{ opacity: 0.7 }}>Effective gate</span>
                <span>
                  {v.effective_gate === true ? "true" : "false"}
                </span>
              </div>
              {v.reviewed_at && (
                <div
                  style={{
                    marginTop: 8,
                    paddingTop: 8,
                    borderTop: "1px solid var(--border-subtle)",
                    fontSize: "var(--text-caption)",
                    fontStyle: "italic",
                    opacity: 0.7,
                  }}
                >
                  Reviewed {formatDateLong(v.reviewed_at)}
                  {v.reviewed_note ? ` — "${v.reviewed_note}"` : ""}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Review note modal */}
      {reviewingId && (
        <Modal open onClose={() => setReviewingId(null)}>
          <div style={{ padding: 20, minWidth: 380 }}>
            <h3
              style={{
                fontFamily: "var(--font-display)",
                fontStyle: "italic",
                fontSize: "var(--text-heading-md)",
                marginBottom: 12,
              }}
            >
              Mark as reviewed
            </h3>
            <p
              style={{
                fontSize: "var(--text-body-sm)",
                opacity: 0.7,
                marginBottom: 12,
              }}
            >
              Optional note about what you found.
            </p>
            <textarea
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              rows={4}
              style={{
                width: "100%",
                background: "var(--surface-card)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 6,
                padding: 10,
                color: "var(--color-foreground)",
                fontFamily: "var(--font-serif)",
                fontSize: "var(--text-body-sm)",
                resize: "vertical",
              }}
              placeholder="e.g. test account, patched in EK39, false positive"
            />
            <div
              style={{
                display: "flex",
                gap: 12,
                marginTop: 14,
                justifyContent: "flex-end",
              }}
            >
              <button
                type="button"
                onClick={() => setReviewingId(null)}
                disabled={submitting}
                style={{
                  background: "transparent",
                  border: "1px solid var(--border-subtle)",
                  borderRadius: 999,
                  padding: "6px 14px",
                  color: "var(--color-foreground)",
                  cursor: submitting ? "wait" : "pointer",
                  fontStyle: "italic",
                  opacity: submitting ? 0.5 : 0.8,
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleReview(reviewingId)}
                disabled={submitting}
                style={{
                  background: "color-mix(in oklab, var(--gold) 18%, transparent)",
                  border: "1px solid color-mix(in oklab, var(--gold) 50%, transparent)",
                  borderRadius: 999,
                  padding: "6px 14px",
                  color: "var(--gold)",
                  cursor: submitting ? "wait" : "pointer",
                  fontStyle: "italic",
                  opacity: submitting ? 0.5 : 1,
                }}
              >
                {submitting ? "Saving…" : "Mark reviewed"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
