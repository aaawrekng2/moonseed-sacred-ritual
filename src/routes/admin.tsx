/**
 * Admin dashboard (vF).
 *
 * Sections:
 *   - Dashboard  — counts, daily readings chart, user health, recent signups.
 *   - Users      — searchable/filterable table with icon actions.
 *   - Backups    — automatic + manual snapshots.
 *   - Audit Log  — immutable history of admin actions.
 *   - Back to App — link home.
 *
 * Access is gated by role on `user_preferences`. Non-admins are redirected
 * to '/' immediately.
 */
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CalendarDays,
  Copy,
  Download,
  Eye,
  KeyRound,
  PencilLine,
  RotateCcw,
  ShieldCheck,
  ShieldOff,
  UserX,
  XCircle,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";
import {
  adminAction,
  createAdminBackup,
  getAnonymousSessionCounts,
  getBackupDownloadUrl,
  listAdminUsers,
  listDetectWeavesAlerts,
  previewDetectWeavesAdmin,
  resolveDetectWeavesAlert,
  restoreAdminBackup,
  runDetectWeavesAdmin,
  type DetectWeavesAlert,
} from "@/lib/admin.functions";
import { setDevMode } from "@/components/dev/DevOverlay";
import { useConfirm } from "@/hooks/use-confirm";
import { toast } from "sonner";

/**
 * Fetch the current Supabase access token and return a headers object
 * suitable for passing to a `createServerFn` call (e.g.
 * `listAdminUsers({ headers: await authHeaders() })`).
 *
 * The admin server functions are protected by `requireSupabaseAuth`,
 * which reads the Authorization header off the request. Without this
 * helper every admin call would be rejected with 401.
 */
async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — Moonseed" }] }),
  component: AdminPage,
});

type Role = "user" | "admin" | "super_admin";

type AdminUser = Awaited<ReturnType<typeof listAdminUsers>>[number];

type Tab = "dashboard" | "users" | "backups" | "audit";

const serif = { fontFamily: "var(--font-serif)" } as const;
const display = { fontFamily: "var(--font-display)" } as const;

/* ---------------- Page shell ---------------- */

function AdminPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [myRole, setMyRole] = useState<Role | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      void navigate({ to: "/" });
      return;
    }
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("role")
        .eq("user_id", user.id)
        .maybeSingle();
      const role = ((data as { role?: Role } | null)?.role ?? "user") as Role;
      if (role !== "admin" && role !== "super_admin") {
        void navigate({ to: "/" });
        return;
      }
      setMyRole(role);
      setChecked(true);
    })();
  }, [user, loading, navigate]);

  if (!checked || !myRole) return null;

  // High-contrast admin theme — GitHub-dark inspired. Scoped here so the
  // app's cosmic theme tokens never bleed in. We override the CSS custom
  // properties used throughout this file so existing `var(--accent)` /
  // `var(--background)` / `var(--border-subtle)` references all resolve
  // to the admin palette without rewriting every style block.
  const adminThemeVars: React.CSSProperties = {
    // Override design tokens locally on the admin root.
    ["--background" as never]: "#0f1117",
    ["--color-foreground" as never]: "#e6edf3",
    ["--foreground" as never]: "#e6edf3",
    ["--border-subtle" as never]: "#30363d",
    ["--border" as never]: "#30363d",
    ["--accent" as never]: "#d4a843",
    ["--gold" as never]: "#d4a843",
    background: "#0f1117",
    color: "#e6edf3",
    fontFamily: "var(--font-serif)",
    height: "100dvh",
    width: "100%",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  };

  return (
    <div style={adminThemeVars}>
      <div
        className="mx-auto flex w-full max-w-7xl flex-col md:flex-row"
        style={{ flex: 1, minHeight: 0 }}
      >
        <Sidebar tab={tab} setTab={setTab} myRole={myRole} />
        <main
          className="flex-1 px-5 pb-32 md:px-10"
          style={{
            paddingTop: "calc(env(safe-area-inset-top, 0px) + 32px)",
            overflowY: "auto",
            height: "100dvh",
            background: "#0f1117",
            color: "#e6edf3",
          }}
        >
          <Header tab={tab} myRole={myRole} />
          <div className="mt-8">
            {tab === "dashboard" && <DashboardTab />}
            {tab === "users" && (
              <UsersTab myRole={myRole} myUserId={user!.id} />
            )}
            {tab === "backups" && <BackupsTab />}
            {tab === "audit" && <AuditTab />}
          </div>
        </main>
      </div>
      <MobileTabBar tab={tab} setTab={setTab} />
    </div>
  );
}

function Header({ tab, myRole }: { tab: Tab; myRole: Role }) {
  const titles: Record<Tab, string> = {
    dashboard: "Dashboard",
    users: "Users",
    backups: "Backups",
    audit: "Audit Log",
  };
  return (
    <div>
      <div
        style={{
          fontSize: "var(--text-caption)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color:
            "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
        }}
      >
        {myRole === "super_admin" ? "Super Admin" : "Admin"}
      </div>
      <h1
        style={{
          color: "var(--accent, var(--gold))",
          fontSize: "var(--text-heading-lg)",
          fontStyle: "italic",
          letterSpacing: "0.02em",
          marginTop: 4,
        }}
      >
        {titles[tab]}
      </h1>
    </div>
  );
}

/* ---------------- Sidebar / mobile tab bar ---------------- */

const TABS: Array<{ key: Tab; label: string }> = [
  { key: "dashboard", label: "Dashboard" },
  { key: "users", label: "Users" },
  { key: "backups", label: "Backups" },
  { key: "audit", label: "Audit Log" },
];

function Sidebar({
  tab,
  setTab,
  myRole,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
  myRole: Role;
}) {
  const [devOn, setDevOn] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.localStorage.getItem("moonseed:dev_mode") === "true";
  });
  return (
    <aside
      className="hidden w-60 shrink-0 flex-col gap-1 border-r px-5 py-10 md:flex"
      style={{
        borderColor: "#30363d",
        background: "#161b22",
        height: "100dvh",
        overflowY: "auto",
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 40px)",
      }}
    >
      <div
        style={{
          ...display,
          fontSize: "var(--text-caption)",
          letterSpacing: "0.22em",
          textTransform: "uppercase",
          color: "var(--accent, var(--gold))",
          marginBottom: 24,
        }}
      >
        Moonseed Admin
      </div>
      {TABS.map((t) => (
        <SidebarItem
          key={t.key}
          active={tab === t.key}
          label={t.label}
          onClick={() => setTab(t.key)}
        />
      ))}
      <div className="mt-2">
        <Link
          to="/"
          className="flex items-center gap-2 px-2 py-2 text-left transition-opacity hover:opacity-80"
          style={{
            ...serif,
            fontSize: "var(--text-body)",
            color:
              "color-mix(in oklab, var(--color-foreground) 70%, transparent)",
          }}
        >
          <ArrowLeft size={14} strokeWidth={1.5} />
          Back to App
        </Link>
      </div>

      <div className="mt-auto pt-8">
        <DevModeToggle devOn={devOn} setDevOn={setDevOn} />
        <div
          className="mt-3"
          style={{
            fontSize: "var(--text-caption)",
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color:
              "color-mix(in oklab, var(--color-foreground) 40%, transparent)",
          }}
        >
          {myRole === "super_admin" ? "Super Admin" : "Admin"}
        </div>
      </div>
    </aside>
  );
}

function SidebarItem({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-left transition-opacity"
      style={{
        ...serif,
        fontSize: "var(--text-body)",
        color: active
          ? "var(--accent, var(--gold))"
          : "color-mix(in oklab, var(--color-foreground) 65%, transparent)",
        background: "none",
        border: "none",
        padding: "8px",
        borderLeft: active
          ? "2px solid var(--accent, var(--gold))"
          : "2px solid transparent",
        cursor: "pointer",
      }}
    >
      {label}
    </button>
  );
}

function DevModeToggle({
  devOn,
  setDevOn,
}: {
  devOn: boolean;
  setDevOn: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => {
        const next = !devOn;
        setDevOn(next);
        setDevMode(next);
      }}
      className="flex items-center gap-3"
      style={{
        ...display,
        fontSize: "var(--text-caption)",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: devOn
          ? "var(--accent, var(--gold))"
          : "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
        background: "none",
        border: "none",
        padding: 8,
        cursor: "pointer",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 28,
          height: 14,
          borderRadius: 999,
          background: devOn
            ? "color-mix(in oklab, var(--accent, var(--gold)) 55%, transparent)"
            : "color-mix(in oklab, var(--color-foreground) 18%, transparent)",
          position: "relative",
          transition: "background 120ms",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 1,
            left: devOn ? 15 : 1,
            width: 12,
            height: 12,
            borderRadius: 999,
            background: devOn ? "var(--accent, var(--gold))" : "#aaa",
            transition: "left 120ms",
          }}
        />
      </span>
      Dev Mode
    </button>
  );
}

function MobileTabBar({
  tab,
  setTab,
}: {
  tab: Tab;
  setTab: (t: Tab) => void;
}) {
  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t px-2 py-2 md:hidden"
      style={{
        borderColor: "#30363d",
        background: "#161b22",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 8px)",
      }}
    >
      {TABS.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => setTab(t.key)}
          style={{
            ...display,
            fontSize: 10,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color:
              tab === t.key
                ? "var(--accent, var(--gold))"
                : "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
            background: "none",
            border: "none",
            padding: "6px 4px",
          }}
        >
          {t.label}
        </button>
      ))}
      <Link
        to="/"
        style={{
          ...display,
          fontSize: 10,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color:
            "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
        }}
      >
        Back
      </Link>
    </nav>
  );
}

/* ---------------- Dashboard tab ---------------- */

function DashboardTab() {
  const [stats, setStats] = useState<{
    totalUsers: number;
    totalReadings: number;
    activeToday: number;
    activeWeek: number;
    activeMonth: number;
    staleUsers: number;
    dormantUsers: number;
    today: number;
    week: number;
    month: number;
    avgPerActive: number;
    topSpread: { type: string; count: number } | null;
    daily: Array<{ d: string; standard: number; deep: number }>;
    recent: Array<AdminUser>;
  } | null>(null);
  const [anon, setAnon] = useState<{
    today: number;
    last30Days: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      const users = await listAdminUsers({ headers: await authHeaders() });
      const since30 = new Date();
      since30.setDate(since30.getDate() - 30);
      const { data: rows } = await supabase
        .from("readings")
        .select("user_id, created_at, spread_type, is_deep_reading")
        .gte("created_at", since30.toISOString());
      const reads = (rows ?? []) as Array<{
        user_id: string;
        created_at: string;
        spread_type: string;
        is_deep_reading: boolean;
      }>;

      const now = Date.now();
      const dayMs = 86_400_000;
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const weekAgo = now - 7 * dayMs;
      const monthAgo = now - 30 * dayMs;
      const ninetyAgo = now - 90 * dayMs;

      // Counts.
      const totalReadings = users.reduce((acc, u) => acc + u.reading_count, 0);
      const activeIds = new Set<string>();
      const weekIds = new Set<string>();
      const monthIds = new Set<string>();
      let today = 0;
      let week = 0;
      let month = 0;
      const spreadCounts: Record<string, number> = {};
      const byDay: Record<string, { standard: number; deep: number }> = {};
      for (let i = 29; i >= 0; i--) {
        const d = new Date(now - i * dayMs);
        const k = d.toISOString().slice(0, 10);
        byDay[k] = { standard: 0, deep: 0 };
      }
      for (const r of reads) {
        const t = new Date(r.created_at).getTime();
        if (t >= todayStart.getTime()) {
          today += 1;
          activeIds.add(r.user_id);
        }
        if (t >= weekAgo) {
          week += 1;
          weekIds.add(r.user_id);
        }
        if (t >= monthAgo) {
          month += 1;
          monthIds.add(r.user_id);
        }
        spreadCounts[r.spread_type] =
          (spreadCounts[r.spread_type] ?? 0) + 1;
        const key = new Date(r.created_at).toISOString().slice(0, 10);
        if (byDay[key]) {
          if (r.is_deep_reading) byDay[key].deep += 1;
          else byDay[key].standard += 1;
        }
      }
      const topSpreadEntry = Object.entries(spreadCounts).sort(
        (a, b) => b[1] - a[1],
      )[0];

      // Stale / dormant from `last_reading` on users.
      let stale = 0;
      let dormant = 0;
      for (const u of users) {
        const last = u.last_reading ? new Date(u.last_reading).getTime() : 0;
        if (!last) {
          dormant += 1;
          continue;
        }
        if (last < ninetyAgo) dormant += 1;
        else if (last < monthAgo) stale += 1;
      }

      const recent = [...users]
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() -
            new Date(a.created_at).getTime(),
        )
        .slice(0, 10);

      setStats({
        totalUsers: users.length,
        totalReadings,
        activeToday: activeIds.size,
        activeWeek: weekIds.size,
        activeMonth: monthIds.size,
        staleUsers: stale,
        dormantUsers: dormant,
        today,
        week,
        month,
        avgPerActive: monthIds.size
          ? Math.round((month / monthIds.size) * 10) / 10
          : 0,
        topSpread: topSpreadEntry
          ? { type: topSpreadEntry[0], count: topSpreadEntry[1] }
          : null,
        daily: Object.entries(byDay).map(([d, v]) => ({
          d: d.slice(5),
          standard: v.standard,
          deep: v.deep,
        })),
        recent,
      });
      try {
        const a = await getAnonymousSessionCounts({ headers: await authHeaders() });
        setAnon(a);
      } catch {
        setAnon({ today: 0, last30Days: 0, total: 0 });
      }
    })();
  }, []);

  if (!stats)
    return (
      <p style={{ ...serif, fontStyle: "italic", opacity: 0.5 }}>Loading…</p>
    );

  return (
    <div className="space-y-10">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="Total users" value={stats.totalUsers} />
        <StatCard label="Total readings" value={stats.totalReadings} />
        <StatCard label="Active today" value={stats.activeToday} />
        <StatCard label="Active this week" value={stats.activeWeek} />
      </div>

      <section>
        <SectionTitle>Daily readings · last 30 days</SectionTitle>
        <div
          className="mt-4"
          style={{
            border: "1px solid var(--border-subtle)",
            background:
              "color-mix(in oklab, var(--background) 92%, transparent)",
            padding: 16,
          }}
        >
          <div style={{ width: "100%", height: 220 }}>
            <ResponsiveContainer>
              <BarChart data={stats.daily}>
                <CartesianGrid
                  vertical={false}
                  stroke="color-mix(in oklab, var(--color-foreground) 12%, transparent)"
                />
                <XAxis
                  dataKey="d"
                  tick={{
                    fill: "color-mix(in oklab, var(--color-foreground) 50%, transparent)",
                    fontSize: 10,
                  }}
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  tick={{
                    fill: "color-mix(in oklab, var(--color-foreground) 50%, transparent)",
                    fontSize: 10,
                  }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  width={28}
                />
                <RTooltip
                  cursor={{
                    fill: "color-mix(in oklab, var(--accent, var(--gold)) 8%, transparent)",
                  }}
                  contentStyle={{
                    background: "rgba(0,0,0,0.85)",
                    border:
                      "1px solid color-mix(in oklab, var(--accent, var(--gold)) 25%, transparent)",
                    color: "var(--foreground)",
                    fontFamily: "var(--font-serif)",
                    fontSize: 12,
                  }}
                />
                <Bar
                  dataKey="standard"
                  stackId="r"
                  fill="color-mix(in oklab, var(--accent, var(--gold)) 35%, transparent)"
                  radius={[0, 0, 0, 0]}
                />
                <Bar
                  dataKey="deep"
                  stackId="r"
                  fill="var(--accent, var(--gold))"
                  radius={[2, 2, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <HealthCard
          label="Active users"
          value={stats.activeMonth}
          sublabel={
            stats.totalUsers
              ? `${Math.round((stats.activeMonth / stats.totalUsers) * 100)}% of total`
              : "—"
          }
          tone="ok"
        />
        <HealthCard
          label="Stale users"
          value={stats.staleUsers}
          sublabel="30–90 days"
          tone="warn"
        />
        <HealthCard
          label="Dormant users"
          value={stats.dormantUsers}
          sublabel="90+ days"
          tone="bad"
        />
      </div>

      <section>
        <SectionTitle>Reading stats</SectionTitle>
        <dl className="mt-4 grid grid-cols-2 gap-y-3 md:grid-cols-5">
          <MiniStat label="Today" value={stats.today} />
          <MiniStat label="This week" value={stats.week} />
          <MiniStat label="This month" value={stats.month} />
          <MiniStat label="Avg / active user" value={stats.avgPerActive} />
          <MiniStat
            label="Top spread"
            value={
              stats.topSpread
                ? `${stats.topSpread.type}: ${stats.topSpread.count}`
                : "—"
            }
          />
        </dl>
      </section>

      <section>
        <SectionTitle>Anonymous sessions</SectionTitle>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
          <StatCard label="Today" value={anon?.today ?? 0} />
          <StatCard label="Last 30 days" value={anon?.last30Days ?? 0} />
          <StatCard label="Total" value={anon?.total ?? 0} />
        </div>
        <p
          className="mt-3"
          style={{
            ...serif,
            fontStyle: "italic",
            fontSize: "var(--text-caption)",
            opacity: 0.55,
          }}
        >
          Anonymous sessions are excluded from the Users tab.
        </p>
      </section>

      <section>
        <SectionTitle>Recent signups</SectionTitle>
        <div className="mt-4 overflow-x-auto">
          <table
            className="w-full"
            style={{ ...serif, fontSize: "var(--text-body-sm)" }}
          >
            <thead>
              <tr style={thRow()}>
                <Th>Email</Th>
                <Th>Joined</Th>
                <Th>Readings</Th>
                <Th>Last active</Th>
              </tr>
            </thead>
            <tbody>
              {stats.recent.map((u) => (
                <tr
                  key={u.user_id}
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <Td>{u.email ?? <span style={{ opacity: 0.4 }}>anon</span>}</Td>
                  <Td>{new Date(u.created_at).toLocaleDateString()}</Td>
                  <Td>{u.reading_count}</Td>
                  <Td>
                    {u.last_reading
                      ? new Date(u.last_reading).toLocaleDateString()
                      : "—"}
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <DetectWeavesPanel />
      <DetectWeavesAlertsPanel />
    </div>
  );
}

/* ---------- Detect-weaves manual trigger ---------- */

function DetectWeavesPanel() {
  const [userId, setUserId] = useState("");
  const [busy, setBusy] = useState<
    "user" | "all" | "preview-user" | "preview-all" | null
  >(null);
  const [result, setResult] = useState<{
    tone: "ok" | "warn" | "err";
    text: string;
  } | null>(null);
  const [runPerUser, setRunPerUser] = useState<Array<{
    user_id: string;
    inserted: number;
    existing: number;
    error?: string;
  }> | null>(null);
  const [preview, setPreview] = useState<{
    scope: "user" | "all";
    users_scanned: number;
    would_create: number;
    already_existing: number;
    errors: number;
    per_user: Array<{
      user_id: string;
      already_existing: number;
      error?: string;
      would_create: Array<{
        title: string;
        description: string;
        shared_readings: number;
        pattern_names: [string, string];
      }>;
    }>;
  } | null>(null);

  const validUuid = (v: string) =>
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      v.trim(),
    );

  const run = async (scope: "user" | "all") => {
    if (busy) return;
    if (scope === "user" && !validUuid(userId)) {
      setResult({ tone: "err", text: "Enter a valid user UUID first." });
      return;
    }
    setBusy(scope);
    setResult(null);
    setRunPerUser(null);
    try {
      const res = await runDetectWeavesAdmin({
        headers: await authHeaders(),
        data:
          scope === "user"
            ? { scope: "user", userId: userId.trim() }
            : { scope: "all" },
      });
      const tone =
        res.status === "success"
          ? "ok"
          : res.status === "partial"
            ? "warn"
            : "err";
      setResult({
        tone,
        text: `Scanned ${res.users_scanned} user${
          res.users_scanned === 1 ? "" : "s"
        } · ${res.weaves_detected} new weave${
          res.weaves_detected === 1 ? "" : "s"
        } · ${res.weaves_existing} already existed${res.errors > 0 ? ` · ${res.errors} error${res.errors === 1 ? "" : "s"}` : ""}.`,
      });
      setRunPerUser(res.per_user ?? []);
    } catch (e) {
      setResult({
        tone: "err",
        text: e instanceof Error ? e.message : "Run failed.",
      });
    } finally {
      setBusy(null);
    }
  };

  const runPreview = async (scope: "user" | "all") => {
    if (busy) return;
    if (scope === "user" && !validUuid(userId)) {
      setResult({ tone: "err", text: "Enter a valid user UUID first." });
      return;
    }
    setBusy(scope === "user" ? "preview-user" : "preview-all");
    setResult(null);
    setPreview(null);
    setRunPerUser(null);
    try {
      const res = await previewDetectWeavesAdmin({
        headers: await authHeaders(),
        data:
          scope === "user"
            ? { scope: "user", userId: userId.trim() }
            : { scope: "all" },
      });
      setPreview({
        scope,
        users_scanned: res.users_scanned,
        would_create: res.would_create,
        already_existing: res.already_existing,
        errors: res.errors,
        per_user: res.per_user,
      });
      setResult({
        tone: res.errors > 0 ? "warn" : "ok",
        text: `Dry run · scanned ${res.users_scanned} user${
          res.users_scanned === 1 ? "" : "s"
        } · would create ${res.would_create} weave${
          res.would_create === 1 ? "" : "s"
        } · ${res.already_existing} already existed${res.errors > 0 ? ` · ${res.errors} error${res.errors === 1 ? "" : "s"}` : ""}. No data was written.`,
      });
    } catch (e) {
      setResult({
        tone: "err",
        text: e instanceof Error ? e.message : "Preview failed.",
      });
    } finally {
      setBusy(null);
    }
  };

  const toneColor =
    result?.tone === "ok"
      ? "var(--accent, var(--gold))"
      : result?.tone === "warn"
        ? "oklch(0.78 0.13 70)"
        : "oklch(0.7 0.18 25)";

  return (
    <section>
      <SectionTitle>Detect weaves · manual run</SectionTitle>
      <div
        className="mt-4"
        style={{
          border: "1px solid var(--border-subtle)",
          background:
            "color-mix(in oklab, var(--background) 92%, transparent)",
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <p
          style={{
            ...serif,
            fontSize: "var(--text-body-sm)",
            opacity: 0.7,
            margin: 0,
          }}
        >
          Re-run weave detection on demand. Each run is logged with timing,
          counts, and any per-user errors.
        </p>

        <div
          className="flex flex-col gap-2 md:flex-row md:items-center"
          style={{ gap: 8 }}
        >
          <input
            type="text"
            placeholder="User UUID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            disabled={busy !== null}
            spellCheck={false}
            style={{
              ...serif,
              flex: "1 1 320px",
              padding: "8px 10px",
              border: "1px solid var(--border-subtle)",
              background: "rgba(0,0,0,0.25)",
              color: "var(--foreground)",
              fontSize: "var(--text-body-sm)",
              fontFamily: "var(--font-mono, monospace)",
              opacity: busy !== null ? 0.5 : 1,
            }}
          />
          <button
            type="button"
            onClick={() => void run("user")}
            disabled={busy !== null || !userId.trim()}
            style={{
              ...display,
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              padding: "8px 14px",
              border: "1px solid var(--accent, var(--gold))",
              background: "transparent",
              color: "var(--accent, var(--gold))",
              cursor:
                busy !== null || !userId.trim() ? "default" : "pointer",
              opacity: busy !== null || !userId.trim() ? 0.5 : 1,
            }}
          >
            {busy === "user" ? "Running…" : "Run for user"}
          </button>
          <button
            type="button"
            onClick={() => void run("all")}
            disabled={busy !== null}
            style={{
              ...display,
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              padding: "8px 14px",
              border: "1px solid var(--accent, var(--gold))",
              background: "var(--accent, var(--gold))",
              color: "#0f1117",
              cursor: busy !== null ? "default" : "pointer",
              opacity: busy !== null ? 0.7 : 1,
            }}
          >
            {busy === "all" ? "Running…" : "Run for all users"}
          </button>
        </div>

        <div
          className="flex flex-col gap-2 md:flex-row md:items-center"
          style={{ gap: 8 }}
        >
          <span
            style={{
              ...serif,
              fontSize: "var(--text-caption)",
              opacity: 0.55,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              alignSelf: "center",
            }}
          >
            Dry run (no writes)
          </span>
          <button
            type="button"
            onClick={() => void runPreview("user")}
            disabled={busy !== null || !userId.trim()}
            style={{
              ...display,
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              padding: "8px 14px",
              border: "1px solid var(--border-subtle)",
              background: "transparent",
              color: "var(--foreground)",
              cursor:
                busy !== null || !userId.trim() ? "default" : "pointer",
              opacity: busy !== null || !userId.trim() ? 0.5 : 1,
            }}
          >
            {busy === "preview-user" ? "Previewing…" : "Preview for user"}
          </button>
          <button
            type="button"
            onClick={() => void runPreview("all")}
            disabled={busy !== null}
            style={{
              ...display,
              fontSize: 11,
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              padding: "8px 14px",
              border: "1px solid var(--border-subtle)",
              background: "transparent",
              color: "var(--foreground)",
              cursor: busy !== null ? "default" : "pointer",
              opacity: busy !== null ? 0.5 : 1,
            }}
          >
            {busy === "preview-all" ? "Previewing…" : "Preview for all users"}
          </button>
        </div>

        {result && (
          <p
            style={{
              ...serif,
              fontSize: "var(--text-body-sm)",
              fontStyle: "italic",
              color: toneColor,
              margin: 0,
            }}
          >
            {result.text}
          </p>
        )}

        {runPerUser && runPerUser.length > 0 && (
          <div
            style={{
              border: "1px solid var(--border-subtle)",
              padding: 12,
              maxHeight: 320,
              overflowY: "auto",
              fontSize: "var(--text-body-sm)",
              ...serif,
            }}
          >
            <div
              style={{
                ...display,
                fontSize: 11,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                opacity: 0.7,
                marginBottom: 8,
              }}
            >
              Per-user results
            </div>
            {runPerUser.map((u) => (
              <div key={u.user_id} style={{ marginBottom: 8 }}>
                <div
                  style={{
                    fontFamily: "var(--font-mono, monospace)",
                    fontSize: "var(--text-caption)",
                    opacity: 0.75,
                  }}
                >
                  {u.user_id}
                </div>
                <div style={{ marginTop: 2, opacity: 0.85 }}>
                  {u.error ? (
                    <span style={{ color: "oklch(0.7 0.18 25)" }}>
                      error: {u.error}
                    </span>
                  ) : (
                    <>
                      <strong>{u.inserted}</strong> new ·{" "}
                      <span style={{ opacity: 0.7 }}>
                        {u.existing} already existed
                      </span>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {preview && (preview.would_create > 0 || preview.errors > 0) && (
          <div
            style={{
              border: "1px solid var(--border-subtle)",
              padding: 12,
              maxHeight: 320,
              overflowY: "auto",
              fontSize: "var(--text-body-sm)",
              ...serif,
            }}
          >
            {preview.per_user.length === 0 && (
              <p style={{ margin: 0, opacity: 0.6 }}>
                Nothing to create — all candidate weaves already exist.
              </p>
            )}
            {preview.per_user.map((u) => (
              <div key={u.user_id} style={{ marginBottom: 12 }}>
                <div
                  style={{
                    ...display,
                    fontSize: 11,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    opacity: 0.7,
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  {u.user_id}
                  {u.error ? ` · error: ${u.error}` : ""}
                </div>
                {u.would_create.length === 0 && !u.error && (
                  <p style={{ margin: "4px 0 0", opacity: 0.55 }}>
                    No new weaves ({u.already_existing} already existed)
                  </p>
                )}
                <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                  {u.would_create.map((w, i) => (
                    <li key={i} style={{ marginTop: 2 }}>
                      <em>{w.title}</em> — {w.shared_readings} shared readings
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function DetectWeavesAlertsPanel() {
  const [alerts, setAlerts] = useState<DetectWeavesAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listDetectWeavesAlerts({
        headers: await authHeaders(),
        data: { includeResolved: false, limit: 50 },
      });
      setAlerts(res.alerts);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load alerts.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const resolve = async (id: string) => {
    setBusyId(id);
    try {
      await resolveDetectWeavesAlert({
        headers: await authHeaders(),
        data: { alertId: id },
      });
      setAlerts((prev) => prev.filter((a) => a.id !== id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to resolve alert.");
    } finally {
      setBusyId(null);
    }
  };

  const sevColor = (s: DetectWeavesAlert["severity"]) =>
    s === "error"
      ? "oklch(0.7 0.18 25)"
      : s === "warn"
        ? "oklch(0.78 0.13 70)"
        : "var(--accent, var(--gold))";

  return (
    <section style={{ marginTop: 24 }}>
      <SectionTitle>
        Detect-weaves alerts
        {alerts.length > 0 && (
          <span
            style={{
              marginLeft: 10,
              padding: "2px 8px",
              fontSize: 11,
              border: "1px solid oklch(0.7 0.18 25)",
              color: "oklch(0.7 0.18 25)",
              borderRadius: 999,
            }}
          >
            {alerts.length}
          </span>
        )}
      </SectionTitle>
      <div
        className="mt-4"
        style={{
          border: "1px solid var(--border-subtle)",
          background:
            "color-mix(in oklab, var(--background) 92%, transparent)",
          padding: 16,
        }}
      >
        <p
          style={{
            ...serif,
            fontSize: "var(--text-body-sm)",
            opacity: 0.7,
            margin: "0 0 12px",
          }}
        >
          Raised automatically when a run fails, when more than 25% of users
          error in a single run, or when 7 consecutive scheduled runs detect
          zero new weaves. Admins are also emailed when email infrastructure
          is configured.
        </p>
        {loading && <p style={{ ...serif, opacity: 0.6 }}>Loading…</p>}
        {error && (
          <p style={{ ...serif, color: "oklch(0.7 0.18 25)" }}>{error}</p>
        )}
        {!loading && !error && alerts.length === 0 && (
          <p style={{ ...serif, opacity: 0.6, margin: 0 }}>
            No unresolved alerts. ✦
          </p>
        )}
        {alerts.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {alerts.map((a) => (
              <li
                key={a.id}
                style={{
                  borderTop: "1px solid var(--border-subtle)",
                  padding: "10px 0",
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 12,
                }}
              >
                <div style={{ flex: 1 }}>
                  <div
                    style={{
                      ...display,
                      fontSize: 11,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      color: sevColor(a.severity),
                    }}
                  >
                    {a.kind} · {a.severity}
                  </div>
                  <div
                    style={{
                      ...serif,
                      fontSize: "var(--text-body-sm)",
                      marginTop: 2,
                    }}
                  >
                    {a.message}
                  </div>
                  <div
                    style={{
                      ...serif,
                      fontSize: "var(--text-caption)",
                      opacity: 0.5,
                      marginTop: 2,
                    }}
                  >
                    {new Date(a.created_at).toLocaleString()}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void resolve(a.id)}
                  disabled={busyId === a.id}
                  style={{
                    ...display,
                    fontSize: 11,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    padding: "6px 12px",
                    border: "1px solid var(--border-subtle)",
                    background: "transparent",
                    color: "var(--foreground)",
                    cursor: busyId === a.id ? "default" : "pointer",
                    opacity: busyId === a.id ? 0.5 : 1,
                  }}
                >
                  {busyId === a.id ? "…" : "Resolve"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div
      style={{
        border: "1px solid var(--border-subtle)",
        padding: 16,
        background:
          "color-mix(in oklab, var(--background) 92%, transparent)",
      }}
    >
      <div
        style={{
          ...display,
          fontSize: "var(--text-caption)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color:
            "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: "var(--accent, var(--gold))",
          fontSize: "var(--text-heading-md)",
          fontStyle: "italic",
          marginTop: 6,
        }}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}

function HealthCard({
  label,
  value,
  sublabel,
  tone,
}: {
  label: string;
  value: number;
  sublabel: string;
  tone: "ok" | "warn" | "bad";
}) {
  const color =
    tone === "ok"
      ? "var(--accent, var(--gold))"
      : tone === "warn"
        ? "oklch(0.78 0.13 70)"
        : "color-mix(in oklab, var(--color-foreground) 55%, transparent)";
  return (
    <div
      style={{
        border: "1px solid var(--border-subtle)",
        padding: 16,
        background:
          "color-mix(in oklab, var(--background) 92%, transparent)",
      }}
    >
      <div
        style={{
          ...display,
          fontSize: "var(--text-caption)",
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color:
            "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          color,
          fontSize: "var(--text-heading-md)",
          fontStyle: "italic",
          marginTop: 6,
        }}
      >
        {value.toLocaleString()}
      </div>
      <div
        style={{
          fontSize: "var(--text-caption)",
          color:
            "color-mix(in oklab, var(--color-foreground) 50%, transparent)",
          marginTop: 4,
        }}
      >
        {sublabel}
      </div>
    </div>
  );
}

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div>
      <div
        style={{
          ...display,
          fontSize: "var(--text-caption)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color:
            "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          color: "var(--accent, var(--gold))",
          fontSize: "var(--text-body)",
          marginTop: 4,
        }}
      >
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        ...display,
        fontSize: "var(--text-caption)",
        letterSpacing: "0.22em",
        textTransform: "uppercase",
        color: "var(--accent, var(--gold))",
      }}
    >
      {children}
    </h2>
  );
}

/* ---------------- Users tab ---------------- */

function UsersTab({
  myRole,
  myUserId,
}: {
  myRole: Role;
  myUserId: string;
}) {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<"all" | Role>("all");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "active" | "stale" | "dormant"
  >("all");
  const [premiumFilter, setPremiumFilter] = useState<
    "all" | "premium" | "free"
  >("all");
  // CP — master/detail. selectedUserId === null shows the list; otherwise
  // the detail page replaces the list within the same tab. Search and
  // filters above are preserved across the transition because they're
  // colocated state on this same component.
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const data = await listAdminUsers({ headers: await authHeaders() });
      setUsers(data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const now = Date.now();
  const dayMs = 86_400_000;
  const userStatus = (u: AdminUser): "active" | "stale" | "dormant" => {
    if (!u.last_reading) return "dormant";
    const t = new Date(u.last_reading).getTime();
    if (t >= now - 30 * dayMs) return "active";
    if (t >= now - 90 * dayMs) return "stale";
    return "dormant";
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (q && !(u.email ?? "").toLowerCase().includes(q)) return false;
      if (roleFilter !== "all" && u.role !== roleFilter) return false;
      if (premiumFilter === "premium" && !u.is_premium) return false;
      if (premiumFilter === "free" && u.is_premium) return false;
      if (statusFilter !== "all" && userStatus(u) !== statusFilter)
        return false;
      return true;
    });
  }, [users, search, roleFilter, premiumFilter, statusFilter]);

  const summary = useMemo(() => {
    const premium = users.filter((u) => u.is_premium).length;
    const supers = users.filter((u) => u.role === "super_admin").length;
    const admins = users.filter((u) => u.role === "admin").length;
    return `${users.length} users · ${premium} premium · ${supers} super admins · ${admins} admins`;
  }, [users]);

  const selectedUser = useMemo(
    () =>
      selectedUserId
        ? users.find((u) => u.user_id === selectedUserId) ?? null
        : null,
    [users, selectedUserId],
  );

  // CP — detail view replaces the list within the same tab. Filters
  // and search remain in state so returning restores them automatically.
  if (selectedUser) {
    return (
      <UserDetailPage
        user={selectedUser}
        myRole={myRole}
        myUserId={myUserId}
        onBack={() => setSelectedUserId(null)}
        onNoteSaved={() => void load()}
      />
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search by email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-transparent py-2"
          style={{
            ...serif,
            fontSize: "var(--text-body)",
            color: "var(--foreground)",
            borderBottom: "1px solid var(--border-subtle)",
            outline: "none",
            minWidth: 240,
          }}
        />
        <FilterSelect
          label="Role"
          value={roleFilter}
          onChange={(v) => setRoleFilter(v as typeof roleFilter)}
          options={[
            ["all", "All roles"],
            ["user", "User"],
            ["admin", "Admin"],
            ["super_admin", "Super Admin"],
          ]}
        />
        <FilterSelect
          label="Status"
          value={statusFilter}
          onChange={(v) => setStatusFilter(v as typeof statusFilter)}
          options={[
            ["all", "Any status"],
            ["active", "Active"],
            ["stale", "Stale"],
            ["dormant", "Dormant"],
          ]}
        />
        <FilterSelect
          label="Premium"
          value={premiumFilter}
          onChange={(v) => setPremiumFilter(v as typeof premiumFilter)}
          options={[
            ["all", "All"],
            ["premium", "Premium"],
            ["free", "Free"],
          ]}
        />
      </div>

      <div
        className="mt-3"
        style={{
          ...display,
          fontSize: "var(--text-caption)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color:
            "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
        }}
      >
        {summary}
      </div>
      <div
        className="mt-1"
        style={{
          ...serif,
          fontStyle: "italic",
          fontSize: "var(--text-caption)",
          color:
            "color-mix(in oklab, var(--color-foreground) 45%, transparent)",
        }}
      >
        Anonymous sessions visible on Dashboard.
      </div>

      {loading ? (
        <p
          className="mt-8"
          style={{ ...serif, fontStyle: "italic", opacity: 0.5 }}
        >
          Loading users…
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table
            className="w-full"
            style={{ ...serif, fontSize: "var(--text-body-sm)" }}
          >
            <thead>
              <tr style={thRow()}>
                <Th>User</Th>
                <Th>Role</Th>
                <Th>Activity</Th>
                <Th>Joined</Th>
                <Th>Premium</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((u) => (
                <UserListRow
                  key={u.user_id}
                  user={u}
                  onSelect={() => setSelectedUserId(u.user_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- CP — Users master/detail helpers ---------------- */

/**
 * Slim list row. Whole row is clickable and selects the user via the
 * parent's `onSelect` callback. Hover gets a subtle gold tint; the
 * inline action icons that used to live here are gone — they belong on
 * the detail page (CQ adds them).
 */
function UserListRow({
  user,
  onSelect,
}: {
  user: AdminUser;
  onSelect: () => void;
}) {
  const [hover, setHover] = useState(false);
  const name = user.display_name?.trim() || null;
  const primary = name ?? user.email ?? `${user.user_id.slice(0, 8)}…`;
  const showEmailLine = !!name && !!user.email;
  return (
    <tr
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={onSelect}
      style={{
        borderBottom: "1px solid var(--border-subtle)",
        cursor: "pointer",
        background: hover
          ? "color-mix(in oklab, var(--accent, var(--gold)) 7%, transparent)"
          : "transparent",
      }}
    >
      <Td>
        <div style={{ ...serif, fontSize: "var(--text-body)" }}>{primary}</div>
        {showEmailLine && (
          <div
            style={{
              fontSize: "var(--text-body-sm)",
              opacity: 0.6,
              marginTop: 2,
            }}
          >
            {user.email}
          </div>
        )}
      </Td>
      <Td>
        <RoleBadge role={user.role} />
      </Td>
      <Td>{formatActivity(user.reading_count, user.last_reading)}</Td>
      <Td>{new Date(user.created_at).toLocaleDateString()}</Td>
      <Td>{formatPremiumCell(user)}</Td>
    </tr>
  );
}

function formatActivity(count: number, last: string | null): string {
  if (count === 0 && !last) return "No activity";
  return `${count} reading${count === 1 ? "" : "s"} · ${formatRelative(last)}`;
}

function formatRelative(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const sec = Math.max(1, Math.floor(ms / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  if (w < 5) return `${w}w ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  const yr = Math.floor(d / 365);
  return `${yr}y ago`;
}

function formatPremiumCell(user: AdminUser): React.ReactNode {
  if (!user.is_premium) return <span style={{ opacity: 0.4 }}>—</span>;
  const exp = user.premium_expires_at
    ? new Date(user.premium_expires_at)
    : null;
  if (!exp) return <Badge>Yes</Badge>;
  const daysLeft = Math.max(
    0,
    Math.ceil((exp.getTime() - Date.now()) / 86_400_000),
  );
  return <Badge>Yes · {daysLeft}d</Badge>;
}

/**
 * CP — Read-only user detail page. Replaces the list when a row is
 * selected. Header band + four stacked panels. Notes panel is the only
 * editable surface; CQ adds the action modals (gift/extend/revoke
 * premium, role changes, password reset, deactivate) into the panels
 * that currently say "Actions available in CQ".
 */
function UserDetailPage({
  user,
  myRole,
  myUserId,
  onBack,
  onNoteSaved,
}: {
  user: AdminUser;
  myRole: Role;
  myUserId: string;
  onBack: () => void;
  onNoteSaved: () => void;
}) {
  const [readings, setReadings] = useState<
    Array<{ id: string; spread_type: string; created_at: string }>
  >([]);
  const [deckCount, setDeckCount] = useState<number | null>(null);
  const [photoCount, setPhotoCount] = useState<number | null>(null);
  const [tagCount, setTagCount] = useState<number | null>(null);
  const [noteText, setNoteText] = useState(user.admin_note ?? "");
  const [noteSaving, setNoteSaving] = useState(false);
  const [noteSavedAt, setNoteSavedAt] = useState<number | null>(null);
  const [grantOpen, setGrantOpen] = useState<null | "grant" | "extend">(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const confirm = useConfirm();

  const isSelf = user.user_id === myUserId;
  const isDeactivated = !!user.banned_until &&
    new Date(user.banned_until).getTime() > Date.now();
  const isSuperAdmin = user.role === "super_admin";

  const labelOf = (email: string | null, id: string) =>
    email ?? id.slice(0, 8);
  const targetLabel = labelOf(user.email, user.user_id);

  const runAction = async (
    actionLabel: string,
    payload: Record<string, unknown>,
    successMsg: string,
  ) => {
    setBusyAction(actionLabel);
    try {
      await adminAction({
        data: payload as never,
        headers: await authHeaders(),
      });
      toast.success(successMsg);
      onNoteSaved();
    } catch (e) {
      toast.error((e as Error).message ?? "Action failed");
    } finally {
      setBusyAction(null);
    }
  };

  const onRevokePremium = async () => {
    const ok = await confirm({
      title: `Revoke Premium from ${targetLabel}?`,
      description:
        "This immediately removes Premium access. The user will revert to free features.",
      confirmLabel: "Revoke Premium",
      destructive: true,
    });
    if (!ok) return;
    await runAction(
      "revoke",
      { type: "revoke_premium", targetUserId: user.user_id },
      `Premium revoked from ${targetLabel}`,
    );
  };

  const onPasswordReset = async () => {
    const ok = await confirm({
      title: `Send password reset to ${targetLabel}?`,
      description: "A recovery email will be generated for this account.",
      confirmLabel: "Send Reset",
    });
    if (!ok) return;
    await runAction(
      "pwreset",
      { type: "password_reset", targetUserId: user.user_id },
      `Password reset sent to ${targetLabel}`,
    );
  };

  const onPromoteSuper = async () => {
    const ok = await confirm({
      title: `Promote ${targetLabel} to Super Admin?`,
      description:
        "Super admins can grant or revoke admin roles for any user. Use sparingly.",
      confirmLabel: "Promote",
    });
    if (!ok) return;
    await runAction(
      "promote",
      { type: "assign_admin", targetUserId: user.user_id, role: "super_admin" },
      `${targetLabel} promoted to Super Admin`,
    );
  };

  const onDemoteSuper = async () => {
    const ok = await confirm({
      title: `Demote ${targetLabel} from Super Admin?`,
      description:
        "This removes the super admin role and resets the user back to a regular user.",
      confirmLabel: "Demote",
      destructive: true,
    });
    if (!ok) return;
    await runAction(
      "demote",
      { type: "remove_admin", targetUserId: user.user_id },
      `${targetLabel} demoted from Super Admin`,
    );
  };

  const onDeactivate = async () => {
    const ok = await confirm({
      title: `Deactivate ${targetLabel}?`,
      description:
        "The user will be unable to sign in until reactivated. Their data is preserved.",
      confirmLabel: "Deactivate Account",
      destructive: true,
    });
    if (!ok) return;
    await runAction(
      "deactivate",
      { type: "deactivate_user", targetUserId: user.user_id },
      `${targetLabel} deactivated`,
    );
  };

  const onReactivate = async () => {
    const ok = await confirm({
      title: `Reactivate ${targetLabel}?`,
      description: "The user will be able to sign in again.",
      confirmLabel: "Reactivate Account",
    });
    if (!ok) return;
    await runAction(
      "reactivate",
      { type: "reactivate_user", targetUserId: user.user_id },
      `${targetLabel} reactivated`,
    );
  };

  useEffect(() => {
    void (async () => {
      const [readingsRes, allReadingsRes, decksRes] = await Promise.all([
        supabase
          .from("readings")
          .select("id, spread_type, created_at")
          .eq("user_id", user.user_id)
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("readings")
          .select("id, tags")
          .eq("user_id", user.user_id),
        supabase
          .from("custom_decks")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.user_id),
      ]);
      setReadings((readingsRes.data ?? []) as typeof readings);
      setDeckCount(decksRes.count ?? 0);

      const readingIds = (allReadingsRes.data ?? []).map(
        (r) => (r as { id: string }).id,
      );
      const tagSet = new Set<string>();
      for (const r of (allReadingsRes.data ?? []) as Array<{
        tags?: string[] | null;
      }>) {
        for (const t of r.tags ?? []) tagSet.add(t);
      }
      setTagCount(tagSet.size);

      if (readingIds.length === 0) {
        setPhotoCount(0);
      } else {
        const photosRes = await supabase
          .from("reading_photos")
          .select("id", { count: "exact", head: true })
          .in("reading_id", readingIds);
        setPhotoCount(photosRes.count ?? 0);
      }
    })();
  }, [user.user_id]);

  const saveNote = async () => {
    const trimmed = noteText.trim();
    const next = trimmed.length ? trimmed : null;
    if ((next ?? "") === (user.admin_note ?? "")) return;
    setNoteSaving(true);
    try {
      const headers = await authHeaders();
      await adminAction({
        data: { type: "set_note", targetUserId: user.user_id, note: next },
        headers,
      });
      setNoteSavedAt(Date.now());
      onNoteSaved();
    } catch (e) {
      window.alert(`Couldn't save note: ${(e as Error).message}`);
    } finally {
      setNoteSaving(false);
    }
  };

  const initials =
    (user.display_name || user.email || user.user_id)
      .split(/[\s@.]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((s: string) => s[0]?.toUpperCase() ?? "")
      .join("") || "?";

  const provider = user.is_anonymous
    ? "anonymous"
    : user.email
      ? "email"
      : "unknown";
  const accountStatus = user.banned_until ? "Deactivated" : "Active";

  return (
    <div>
      {/* Header band */}
      <div className="flex items-start gap-4">
        <button
          type="button"
          onClick={onBack}
          aria-label="Back to users"
          style={{
            ...iconBtnStyle,
            color: "var(--accent, var(--gold))",
            padding: 8,
            marginTop: 4,
          }}
        >
          <ArrowLeft size={16} strokeWidth={1.5} />
        </button>
        <div
          aria-hidden
          style={{
            width: 56,
            height: 56,
            borderRadius: 999,
            display: "grid",
            placeItems: "center",
            background:
              "color-mix(in oklab, var(--accent, var(--gold)) 12%, transparent)",
            color: "var(--accent, var(--gold))",
            ...display,
            fontSize: 18,
            letterSpacing: "0.1em",
          }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div
            style={{
              ...display,
              fontSize: "var(--text-body-lg)",
              color: "var(--foreground)",
            }}
          >
            {user.display_name?.trim() ||
              user.email ||
              user.user_id.slice(0, 8)}
          </div>
          {user.email && (
            <div
              style={{
                fontSize: "var(--text-body-sm)",
                opacity: 0.6,
                marginTop: 2,
              }}
            >
              {user.email}
            </div>
          )}
          <div
            className="mt-2 flex flex-wrap items-center gap-3"
            style={{
              fontSize: "var(--text-caption)",
              color:
                "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
              ...display,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
            }}
          >
            <RoleBadge role={user.role} />
            <span>
              Joined {new Date(user.created_at).toLocaleDateString()}
            </span>
            <span>· Last active {formatRelative(user.last_reading)}</span>
          </div>
        </div>
      </div>

      {/* Panels */}
      <div className="mt-8 grid gap-6">
        <DetailPanel title="Subscription">
          <DetailRow
            label="Status"
            value={subscriptionStatusLabel(user)}
          />
          {user.is_premium && user.premium_expires_at && (
            <DetailRow
              label="Expires"
              value={(() => {
                const exp = new Date(user.premium_expires_at);
                const days = Math.ceil(
                  (exp.getTime() - Date.now()) / 86_400_000,
                );
                if (days < 0)
                  return `Expired on ${exp.toLocaleDateString()}`;
                return `${exp.toLocaleDateString()} · ${days} day${days === 1 ? "" : "s"} left`;
              })()}
            />
          )}
          <DetailRow
            label="Months used"
            value={String(user.premium_months_used ?? 0)}
          />
          <ActionRow>
            {!user.is_premium && (
              <ActionBtn
                tone="primary"
                disabled={busyAction !== null}
                onClick={() => setGrantOpen("grant")}
              >
                Grant Premium
              </ActionBtn>
            )}
            {user.is_premium && (
              <>
                <ActionBtn
                  tone="secondary"
                  disabled={busyAction !== null}
                  onClick={() => setGrantOpen("extend")}
                >
                  Extend Premium
                </ActionBtn>
                <ActionBtn
                  tone="destructive"
                  disabled={busyAction !== null}
                  onClick={() => void onRevokePremium()}
                >
                  Revoke Premium
                </ActionBtn>
              </>
            )}
          </ActionRow>
        </DetailPanel>

        <DetailPanel title="Account">
          <DetailRow
            label="User ID"
            value={
              <span className="inline-flex items-center gap-2">
                <code
                  style={{
                    fontFamily:
                      "ui-monospace, SFMono-Regular, Menlo, monospace",
                    fontSize: "var(--text-body-sm)",
                  }}
                >
                  {user.user_id}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard?.writeText(user.user_id);
                  }}
                  aria-label="Copy user ID"
                  title="Copy user ID"
                  style={{
                    ...iconBtnStyle,
                    color: "var(--accent, var(--gold))",
                  }}
                >
                  <Copy size={12} strokeWidth={1.5} />
                </button>
              </span>
            }
          />
          <DetailRow label="Auth provider" value={provider} />
          <DetailRow
            label="Email confirmed"
            value={user.email ? "yes" : "—"}
          />
          <DetailRow label="Account status" value={accountStatus} />
          <ActionRow>
            {user.email && (
              <ActionBtn
                tone="secondary"
                disabled={busyAction !== null}
                onClick={() => void onPasswordReset()}
              >
                Send password reset
              </ActionBtn>
            )}
            {myRole === "super_admin" && !isSelf && !isSuperAdmin && (
              <ActionBtn
                tone="primary"
                disabled={busyAction !== null}
                onClick={() => void onPromoteSuper()}
              >
                Promote to Super Admin
              </ActionBtn>
            )}
            {myRole === "super_admin" && !isSelf && isSuperAdmin && (
              <ActionBtn
                tone="destructive"
                disabled={busyAction !== null}
                onClick={() => void onDemoteSuper()}
              >
                Demote from Super Admin
              </ActionBtn>
            )}
            {!isSelf && !isDeactivated && (
              <ActionBtn
                tone="destructive"
                disabled={busyAction !== null}
                onClick={() => void onDeactivate()}
              >
                Deactivate account
              </ActionBtn>
            )}
            {!isSelf && isDeactivated && (
              <ActionBtn
                tone="primary"
                disabled={busyAction !== null}
                onClick={() => void onReactivate()}
              >
                Reactivate account
              </ActionBtn>
            )}
          </ActionRow>
        </DetailPanel>

        <DetailPanel title="Activity">
          <DetailRow
            label="Total readings"
            value={String(user.reading_count)}
          />
          <DetailRow
            label="Custom decks"
            value={deckCount === null ? "…" : String(deckCount)}
          />
          <DetailRow
            label="Reading photos"
            value={photoCount === null ? "…" : String(photoCount)}
          />
          <DetailRow
            label="Tags"
            value={tagCount === null ? "…" : String(tagCount)}
          />
          <div className="mt-4">
            <div
              style={{
                ...display,
                fontSize: "var(--text-caption)",
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                color:
                  "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
                marginBottom: 8,
              }}
            >
              Last 5 readings
            </div>
            {readings.length === 0 ? (
              <p style={{ ...serif, fontStyle: "italic", opacity: 0.5 }}>
                No readings yet.
              </p>
            ) : (
              <ul className="space-y-2">
                {readings.map((r) => (
                  <li
                    key={r.id}
                    className="flex items-baseline justify-between"
                    style={{
                      borderBottom: "1px solid var(--border-subtle)",
                      paddingBottom: 6,
                    }}
                  >
                    <span
                      style={{
                        ...serif,
                        fontSize: "var(--text-body-sm)",
                      }}
                    >
                      {r.spread_type}
                    </span>
                    <span
                      style={{
                        fontSize: "var(--text-caption)",
                        color:
                          "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
                      }}
                    >
                      {new Date(r.created_at).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DetailPanel>

        <DetailPanel title="Notes">
          <textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            onBlur={() => void saveNote()}
            rows={4}
            placeholder="Internal note about this seeker (saves on blur)…"
            className="w-full bg-transparent p-2"
            style={{
              ...serif,
              fontSize: "var(--text-body)",
              color: "var(--foreground)",
              border: "1px solid var(--border-subtle)",
              outline: "none",
              resize: "vertical",
            }}
          />
          <div
            className="mt-2"
            style={{
              ...serif,
              fontStyle: "italic",
              fontSize: "var(--text-caption)",
              color:
                "color-mix(in oklab, var(--color-foreground) 50%, transparent)",
            }}
          >
            {noteSaving
              ? "Saving…"
              : noteSavedAt
                ? "Saved."
                : "Saves automatically when you click away."}
          </div>
        </DetailPanel>
      </div>
      {grantOpen !== null && (
        <GrantPremiumModal
          mode={grantOpen}
          targetLabel={targetLabel}
          currentExpires={user.premium_expires_at}
          onClose={() => setGrantOpen(null)}
          onConfirm={async (months) => {
            const type = grantOpen === "extend" ? "extend_premium" : "grant_premium";
            const verb = grantOpen === "extend" ? "extended" : "granted";
            setGrantOpen(null);
            await runAction(
              "premium",
              { type, targetUserId: user.user_id, months },
              `Premium ${verb} for ${targetLabel}`,
            );
          }}
        />
      )}
    </div>
  );
}

function subscriptionStatusLabel(u: AdminUser): string {
  if (u.role === "super_admin") return "Super Admin";
  if (u.is_premium) return "Premium";
  return "Free";
}

function DetailPanel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      style={{
        background: "var(--surface-card, transparent)",
        border: "1px solid var(--border-subtle)",
        padding: 20,
        borderRadius: 4,
      }}
    >
      <SectionTitle>{title}</SectionTitle>
      <div className="mt-4 flex flex-col gap-2">{children}</div>
    </section>
  );
}

function DetailRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-3">
      <div
        style={{
          ...display,
          fontSize: "var(--text-caption)",
          letterSpacing: "0.16em",
          textTransform: "uppercase",
          color:
            "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
          minWidth: 140,
        }}
      >
        {label}
      </div>
      <div
        style={{
          ...serif,
          fontSize: "var(--text-body-sm)",
          color: "var(--foreground)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

/* ---------------- CQ — User detail action UI ---------------- */

function ActionRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-4 flex flex-wrap gap-2">{children}</div>
  );
}

function ActionBtn({
  tone,
  onClick,
  disabled,
  children,
}: {
  tone: "primary" | "secondary" | "destructive";
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  const colors =
    tone === "primary"
      ? {
          color: "#0f1117",
          background: "var(--accent, var(--gold))",
          border: "1px solid var(--accent, var(--gold))",
        }
      : tone === "destructive"
        ? {
            color: "oklch(0.78 0.18 25)",
            background: "transparent",
            border: "1px solid oklch(0.5 0.15 25)",
          }
        : {
            color: "var(--foreground)",
            background: "transparent",
            border: "1px solid var(--border-subtle)",
          };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        ...display,
        ...colors,
        fontSize: "var(--text-caption)",
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        padding: "8px 14px",
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  );
}

function GrantPremiumModal({
  mode,
  targetLabel,
  currentExpires,
  onClose,
  onConfirm,
}: {
  mode: "grant" | "extend";
  targetLabel: string;
  currentExpires: string | null;
  onClose: () => void;
  onConfirm: (months: number) => void | Promise<void>;
}) {
  // Day chips per spec: 30 / 60 / 90 / 180 / 365.
  const chips: Array<{ days: number; label: string }> = [
    { days: 30, label: "30 days" },
    { days: 60, label: "60 days" },
    { days: 90, label: "90 days" },
    { days: 180, label: "180 days" },
    { days: 365, label: "1 year" },
  ];
  const [days, setDays] = useState(30);
  const [customStr, setCustomStr] = useState("");

  const effectiveDays = (() => {
    const c = parseInt(customStr, 10);
    if (Number.isFinite(c) && c > 0) return c;
    return days;
  })();

  // For grant: expiry = now + days. For extend: extend from existing
  // expiry if still in the future, otherwise from now. Mirrors server.
  const baseTime =
    mode === "extend" && currentExpires &&
    new Date(currentExpires).getTime() > Date.now()
      ? new Date(currentExpires).getTime()
      : Date.now();
  const expiryDate = new Date(baseTime + effectiveDays * 86_400_000);
  // Server takes months; convert days → months (~30 day units), min 1.
  const monthsParam = Math.max(1, Math.round(effectiveDays / 30));

  return (
    <ModalShell
      title={`${mode === "extend" ? "Extend" : "Grant"} Premium to ${targetLabel}?`}
      onClose={onClose}
    >
      <p style={{ ...serif, fontSize: "var(--text-body-sm)", opacity: 0.75 }}>
        {mode === "extend"
          ? "Extends Premium from the current expiration date."
          : "Grants Premium starting today."}{" "}
        Expires on{" "}
        <strong style={{ color: "var(--accent, var(--gold))" }}>
          {expiryDate.toLocaleDateString()}
        </strong>
        .
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {chips.map((c) => {
          const active = !customStr && days === c.days;
          return (
            <button
              key={c.days}
              type="button"
              onClick={() => {
                setDays(c.days);
                setCustomStr("");
              }}
              style={{
                ...display,
                fontSize: "var(--text-caption)",
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                padding: "8px 12px",
                background: "none",
                border: active
                  ? "1px solid var(--accent, var(--gold))"
                  : "1px solid var(--border-subtle)",
                color: active
                  ? "var(--accent, var(--gold))"
                  : "color-mix(in oklab, var(--color-foreground) 60%, transparent)",
                cursor: "pointer",
              }}
            >
              {c.label}
            </button>
          );
        })}
      </div>
      <label
        className="mt-4 flex items-center gap-3"
        style={{
          ...serif,
          fontSize: "var(--text-body-sm)",
          color: "color-mix(in oklab, var(--color-foreground) 70%, transparent)",
        }}
      >
        Custom days:
        <input
          type="number"
          min={1}
          value={customStr}
          onChange={(e) => setCustomStr(e.target.value)}
          placeholder="—"
          style={{
            ...serif,
            width: 100,
            padding: "6px 10px",
            background: "rgba(0,0,0,0.25)",
            border: "1px solid var(--border-subtle)",
            color: "var(--foreground)",
            fontSize: "var(--text-body-sm)",
          }}
        />
      </label>
      <div className="mt-6 flex justify-end gap-4">
        <button type="button" onClick={onClose} style={textBtnStyle("muted")}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void onConfirm(monthsParam)}
          style={textBtnStyle("gold")}
        >
          {mode === "extend" ? "Extend Premium" : "Grant Premium"}
        </button>
      </div>
    </ModalShell>
  );
}

/* ---------------- Backups tab ---------------- */

type BackupRow = {
  id: string;
  created_at: string;
  kind: string;
  status: string;
  size_bytes: number;
  storage_path: string | null;
};

function BackupsTab() {
  const [rows, setRows] = useState<BackupRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const confirm = useConfirm();

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("admin_backups" as never)
      .select("id, created_at, kind, status, size_bytes, storage_path")
      .order("created_at", { ascending: false });
    setRows(((data as unknown) as BackupRow[]) ?? []);
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const automatic = rows.filter((r) => r.kind === "automatic");
  const manual = rows.filter((r) => r.kind !== "automatic");

  const fmtSize = (n: number) => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
  };

  const onDownload = async (r: BackupRow) => {
    if (!r.storage_path) return;
    const { url } = await getBackupDownloadUrl({
      data: { storagePath: r.storage_path },
      headers: await authHeaders(),
    });
    window.open(url, "_blank", "noopener");
  };

  const onRestore = async (r: BackupRow) => {
    const ok = await confirm({
      title: "Restore this backup?",
      description:
        "This will request a manual restore from the snapshot file. Live data is not overwritten by the app — a team member runs the actual restore for safety.",
      confirmLabel: "Request Restore",
      destructive: true,
    });
    if (!ok) return;
    await restoreAdminBackup({
      data: { backupId: r.id },
      headers: await authHeaders(),
    });
    toast.success(
      "Restore request logged. A team member will run the restore manually.",
    );
  };

  const Section = ({
    title,
    list,
    emptyMsg,
  }: {
    title: string;
    list: BackupRow[];
    emptyMsg: string;
  }) => (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <div className="mt-4 overflow-x-auto">
        <table
          className="w-full"
          style={{ ...serif, fontSize: "var(--text-body-sm)" }}
        >
          <thead>
            <tr style={thRow()}>
              <Th>Date</Th>
              <Th>Size</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {list.length === 0 && (
              <tr>
                <Td>
                  <span style={{ opacity: 0.5, fontStyle: "italic" }}>
                    {emptyMsg}
                  </span>
                </Td>
                <Td>—</Td>
                <Td>—</Td>
                <Td>—</Td>
              </tr>
            )}
            {list.map((r) => (
              <tr
                key={r.id}
                style={{ borderBottom: "1px solid var(--border-subtle)" }}
              >
                <Td>{new Date(r.created_at).toLocaleString()}</Td>
                <Td>{fmtSize(r.size_bytes)}</Td>
                <Td>{r.status}</Td>
                <Td>
                  <div className="flex items-center gap-3">
                    <IconAction
                      title="Download"
                      onClick={() => void onDownload(r)}
                      disabled={!r.storage_path}
                    >
                      <Download size={14} strokeWidth={1.5} />
                    </IconAction>
                    <IconAction
                      title="Restore"
                      onClick={() => void onRestore(r)}
                    >
                      <RotateCcw size={14} strokeWidth={1.5} />
                    </IconAction>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );

  return (
    <div className="space-y-10">
      <div>
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await createAdminBackup({ headers: await authHeaders() });
              await load();
            } catch (e) {
              window.alert(`Backup failed: ${(e as Error).message}`);
            } finally {
              setBusy(false);
            }
          }}
          style={{
            ...display,
            fontSize: "var(--text-caption)",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "var(--accent, var(--gold))",
            background: "none",
            border: "none",
            padding: 0,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.5 : 1,
          }}
        >
          {busy ? "Creating backup…" : "Create backup now"}
        </button>
      </div>
      {loading ? (
        <p style={{ ...serif, fontStyle: "italic", opacity: 0.5 }}>Loading…</p>
      ) : (
        <>
          <Section
            title="Automatic backups"
            list={automatic}
            emptyMsg="No automatic backups yet"
          />
          <Section
            title="Manual backups"
            list={manual}
            emptyMsg="No manual backups yet"
          />
        </>
      )}
    </div>
  );
}

/* ---------------- Audit Log tab ---------------- */

type AuditRow = {
  id: string;
  created_at: string;
  admin_email: string | null;
  action: string;
  target_email: string | null;
  details: Record<string, unknown>;
};

function AuditTab() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionFilter, setActionFilter] = useState<string>("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("admin_audit_log" as never)
        .select("id, created_at, admin_email, action, target_email, details")
        .order("created_at", { ascending: false })
        .limit(2000);
      setRows(((data as unknown) as AuditRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const actions = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) set.add(r.action);
    return ["all", ...Array.from(set).sort()];
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (actionFilter !== "all" && r.action !== actionFilter) return false;
      const t = new Date(r.created_at).getTime();
      if (from && t < new Date(from).getTime()) return false;
      if (to && t > new Date(to).getTime() + 86_400_000) return false;
      return true;
    });
  }, [rows, actionFilter, from, to]);

  const exportCsv = () => {
    const header = "timestamp,admin_email,action,target_email,details";
    const lines = filtered.map((r) =>
      [
        r.created_at,
        r.admin_email ?? "",
        r.action,
        r.target_email ?? "",
        JSON.stringify(r.details).replace(/"/g, '""'),
      ]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const csv = [header, ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <FilterSelect
          label="Action"
          value={actionFilter}
          onChange={setActionFilter}
          options={actions.map((a) => [a, a === "all" ? "All actions" : a])}
        />
        <DateField label="From" value={from} onChange={setFrom} />
        <DateField label="To" value={to} onChange={setTo} />
        <button
          type="button"
          onClick={exportCsv}
          className="ml-auto"
          style={{
            ...display,
            fontSize: "var(--text-caption)",
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            color: "var(--accent, var(--gold))",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
        >
          Export CSV
        </button>
      </div>

      {loading ? (
        <p
          className="mt-8"
          style={{ ...serif, fontStyle: "italic", opacity: 0.5 }}
        >
          Loading…
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table
            className="w-full"
            style={{ ...serif, fontSize: "var(--text-body-sm)" }}
          >
            <thead>
              <tr style={thRow()}>
                <Th>Timestamp</Th>
                <Th>Admin</Th>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <Td>{new Date(r.created_at).toLocaleString()}</Td>
                  <Td>{r.admin_email ?? "—"}</Td>
                  <Td>{auditActionLabel(r.action)}</Td>
                  <Td>{r.target_email ?? "—"}</Td>
                  <Td>
                    <button
                      type="button"
                      onClick={() =>
                        setExpanded(expanded === r.id ? null : r.id)
                      }
                      style={{
                        ...display,
                        fontSize: "var(--text-caption)",
                        letterSpacing: "0.18em",
                        textTransform: "uppercase",
                        color: "var(--accent, var(--gold))",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      {expanded === r.id ? "Hide" : "Show"}
                    </button>
                    {expanded === r.id && (
                      <pre
                        style={{
                          marginTop: 6,
                          padding: 8,
                          background:
                            "color-mix(in oklab, var(--background) 80%, black)",
                          fontSize: 11,
                          whiteSpace: "pre-wrap",
                          maxWidth: 480,
                        }}
                      >
                        {JSON.stringify(r.details, null, 2)}
                      </pre>
                    )}
                  </Td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <Td>
                    <span style={{ opacity: 0.5, fontStyle: "italic" }}>
                      No actions match the current filters.
                    </span>
                  </Td>
                  <Td>—</Td>
                  <Td>—</Td>
                  <Td>—</Td>
                  <Td>—</Td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/* ---------------- Modals ---------------- */

function ModalShell({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "color-mix(in oklab, var(--background) 96%, black)",
          border:
            "1px solid color-mix(in oklab, var(--accent, var(--gold)) 25%, transparent)",
          padding: 24,
          maxWidth: 520,
          width: "100%",
          maxHeight: "85dvh",
          overflowY: "auto",
        }}
      >
        <div
          className="mb-4 flex items-baseline justify-between"
          style={{ borderBottom: "1px solid var(--border-subtle)", paddingBottom: 12 }}
        >
          <h2
            style={{
              color: "var(--accent, var(--gold))",
              fontSize: "var(--text-heading-sm)",
              fontStyle: "italic",
            }}
          >
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            style={{
              ...display,
              fontSize: "var(--text-caption)",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
              color: "var(--foreground)",
              background: "none",
              border: "none",
              cursor: "pointer",
            }}
          >
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function HistoryModal({
  user,
  onClose,
}: {
  user: AdminUser;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<
    Array<{
      id: string;
      spread_type: string;
      created_at: string;
      is_deep_reading: boolean;
    }>
  >([]);
  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from("readings")
        .select("id, spread_type, created_at, is_deep_reading")
        .eq("user_id", user.user_id)
        .order("created_at", { ascending: false })
        .limit(100);
      setRows((data ?? []) as typeof rows);
    })();
  }, [user.user_id]);
  return (
    <ModalShell
      title={`Readings · ${user.email ?? user.user_id.slice(0, 8)}`}
      onClose={onClose}
    >
      {rows.length === 0 ? (
        <p style={{ ...serif, fontStyle: "italic", opacity: 0.6 }}>
          No readings yet.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-baseline justify-between"
              style={{
                borderBottom: "1px solid var(--border-subtle)",
                paddingBottom: 6,
              }}
            >
              <span style={{ ...serif, fontSize: "var(--text-body-sm)" }}>
                {r.spread_type}
                {r.is_deep_reading && (
                  <span
                    style={{
                      marginLeft: 8,
                      color: "var(--accent, var(--gold))",
                      fontSize: 10,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                    }}
                  >
                    Deep
                  </span>
                )}
              </span>
              <span
                style={{
                  fontSize: "var(--text-caption)",
                  color:
                    "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
                }}
              >
                {new Date(r.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </ModalShell>
  );
}

function PremiumPanel({
  user,
  onClose,
  onConfirm,
}: {
  user: AdminUser;
  onClose: () => void;
  onConfirm: (months: number) => void | Promise<void>;
}) {
  const [months, setMonths] = useState(1);
  return (
    <ModalShell
      title={user.is_premium ? "Extend premium" : "Gift premium"}
      onClose={onClose}
    >
      <p style={{ ...serif, fontSize: "var(--text-body-sm)", opacity: 0.7 }}>
        Choose a duration for {user.email ?? user.user_id.slice(0, 8)}.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        {[1, 3, 6, 12].map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMonths(m)}
            style={{
              ...display,
              fontSize: "var(--text-caption)",
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              padding: "8px 14px",
              background: "none",
              border:
                months === m
                  ? "1px solid var(--accent, var(--gold))"
                  : "1px solid var(--border-subtle)",
              color:
                months === m
                  ? "var(--accent, var(--gold))"
                  : "color-mix(in oklab, var(--color-foreground) 60%, transparent)",
              cursor: "pointer",
            }}
          >
            {m === 12 ? "1 year" : `${m} mo`}
          </button>
        ))}
      </div>
      <div className="mt-6 flex justify-end gap-4">
        <button
          type="button"
          onClick={onClose}
          style={textBtnStyle("muted")}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void onConfirm(months)}
          style={textBtnStyle("gold")}
        >
          Confirm
        </button>
      </div>
    </ModalShell>
  );
}

function NoteModal({
  user,
  onClose,
  onSave,
}: {
  user: AdminUser;
  onClose: () => void;
  onSave: (note: string | null) => void | Promise<void>;
}) {
  const [text, setText] = useState(user.admin_note ?? "");
  return (
    <ModalShell
      title={`Note · ${user.email ?? user.user_id.slice(0, 8)}`}
      onClose={onClose}
    >
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        className="w-full bg-transparent p-2"
        style={{
          ...serif,
          fontSize: "var(--text-body)",
          color: "var(--foreground)",
          border: "1px solid var(--border-subtle)",
          outline: "none",
        }}
      />
      <div className="mt-4 flex justify-end gap-4">
        <button
          type="button"
          onClick={onClose}
          style={textBtnStyle("muted")}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void onSave(text.trim() ? text.trim() : null)}
          style={textBtnStyle("gold")}
        >
          Save
        </button>
      </div>
    </ModalShell>
  );
}

/* ---------------- Primitives ---------------- */

function thRow() {
  return {
    fontSize: "var(--text-caption)",
    textTransform: "uppercase" as const,
    letterSpacing: "0.16em",
    color:
      "color-mix(in oklab, var(--color-foreground) 50%, transparent)",
  };
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="px-2 py-2 text-left font-normal"
      style={{ whiteSpace: "nowrap" }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td
      className="px-2 py-3 align-top"
      style={{ whiteSpace: "nowrap" }}
    >
      {children}
    </td>
  );
}

const iconBtnStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  background: "none",
  border: "none",
  padding: 4,
  cursor: "pointer",
  color: "color-mix(in oklab, var(--color-foreground) 70%, transparent)",
};

function IconAction({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string;
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      disabled={disabled}
      style={{
        ...iconBtnStyle,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.3 : 1,
        color: "var(--accent, var(--gold))",
      }}
    >
      {children}
    </button>
  );
}

function textBtnStyle(tone: "gold" | "muted"): React.CSSProperties {
  return {
    ...display,
    fontSize: "var(--text-caption)",
    letterSpacing: "0.22em",
    textTransform: "uppercase",
    color:
      tone === "gold"
        ? "var(--accent, var(--gold))"
        : "color-mix(in oklab, var(--color-foreground) 60%, transparent)",
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
  };
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<[string, string]>;
}) {
  return (
    <label
      className="flex flex-col gap-1"
      style={{
        ...display,
        fontSize: "var(--text-caption)",
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color:
          "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
      }}
    >
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...serif,
          fontSize: "var(--text-body-sm)",
          color: "var(--foreground)",
          background: "transparent",
          border: "1px solid var(--border-subtle)",
          padding: "6px 10px",
          textTransform: "none",
          letterSpacing: 0,
        }}
      >
        {options.map(([v, l]) => (
          <option key={v} value={v} style={{ background: "#111" }}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label
      className="flex flex-col gap-1"
      style={{
        ...display,
        fontSize: "var(--text-caption)",
        letterSpacing: "0.16em",
        textTransform: "uppercase",
        color:
          "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
      }}
    >
      {label}
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          ...serif,
          fontSize: "var(--text-body-sm)",
          color: "var(--foreground)",
          background: "transparent",
          border: "1px solid var(--border-subtle)",
          padding: "6px 10px",
        }}
      />
    </label>
  );
}

function RoleBadge({ role }: { role: Role }) {
  if (role === "user") return <span style={{ opacity: 0.4 }}>—</span>;
  return (
    <span
      style={{
        ...display,
        fontSize: 10,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        padding: "3px 8px",
        color: "var(--accent, var(--gold))",
        background:
          "color-mix(in oklab, var(--accent, var(--gold)) 12%, transparent)",
        opacity: role === "super_admin" ? 1 : 0.7,
      }}
    >
      {role === "super_admin" ? "Super Admin" : "Admin"}
    </span>
  );
}

function StatusBadge({
  status,
}: {
  status: "active" | "stale" | "dormant";
}) {
  const color =
    status === "active"
      ? "var(--accent, var(--gold))"
      : status === "stale"
        ? "oklch(0.78 0.13 70)"
        : "color-mix(in oklab, var(--color-foreground) 50%, transparent)";
  return (
    <span
      style={{
        ...display,
        fontSize: 10,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color,
      }}
    >
      {status}
    </span>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        ...display,
        fontSize: 10,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        padding: "3px 8px",
        color: "var(--accent, var(--gold))",
        background:
          "color-mix(in oklab, var(--accent, var(--gold)) 12%, transparent)",
      }}
    >
      {children}
    </span>
  );
}