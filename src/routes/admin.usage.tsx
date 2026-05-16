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
} from "@/lib/admin-usage.functions";
import { listAdminUsers } from "@/lib/admin.functions";
import { formatDateLong } from "@/lib/dates";

export const Route = createFileRoute("/admin/usage")({
  head: () => ({ meta: [{ title: "Usage — Admin · Tarot Seed" }] }),
  component: AdminUsagePage,
});

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
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

type Tab = "overview" | "seekers" | "anomalies" | "settings";

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
      <div style={{ borderBottom: "0.5px solid rgba(255,255,255,0.1)", marginBottom: 24 }}>
        {(["overview", "seekers", "anomalies", "settings"] as Tab[]).map((t) => (
          <button key={t} style={tabBtnStyle(tab === t)} onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {tab === "overview" && <OverviewTab />}
      {tab === "seekers" && <SeekersTab />}
      {tab === "anomalies" && <AnomaliesTab />}
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