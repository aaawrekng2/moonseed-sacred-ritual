import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/lib/auth";

export const Route = createFileRoute("/admin")({
  head: () => ({ meta: [{ title: "Admin — Moonseed" }] }),
  component: AdminPage,
});

type Role = "user" | "admin" | "super_admin";
type SubType = "none" | "trial" | "stripe" | "gifted";

type UserRow = {
  user_id: string;
  display_name: string | null;
  role: Role;
  subscription_type: SubType;
  is_premium: boolean;
  premium_since: string | null;
  admin_note: string | null;
  email?: string | null;
  reading_count?: number;
  last_reading?: string | null;
};

const serif = { fontFamily: "var(--font-serif)" } as const;

function AdminPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [tab, setTab] = useState<"users" | "stats">("users");
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
      const role = (data as { role?: Role } | null)?.role ?? "user";
      if (role !== "admin" && role !== "super_admin") {
        void navigate({ to: "/" });
        return;
      }
      setMyRole(role);
      setChecked(true);
    })();
  }, [user, loading, navigate]);

  if (!checked || !myRole) return null;

  return (
    <main
      className="bg-cosmos h-dvh overflow-y-auto px-5 pb-28 text-foreground"
      style={{ paddingTop: "var(--topbar-pad)", ...serif }}
    >
      <div className="mx-auto w-full max-w-5xl">
        <h1
          className="text-gold"
          style={{
            fontSize: "var(--text-heading-lg)",
            fontStyle: "italic",
            letterSpacing: "0.02em",
          }}
        >
          Admin
        </h1>
        <div
          className="mt-2"
          style={{
            fontSize: "var(--text-caption)",
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
          }}
        >
          {myRole === "super_admin" ? "Super Admin" : "Admin"}
        </div>

        <nav
          className="mt-6 flex gap-6"
          style={{ borderBottom: "1px solid var(--border-subtle)" }}
        >
          {(["users", "stats"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setTab(k)}
              className="pb-3 transition-opacity"
              style={{
                ...serif,
                fontSize: "var(--text-body)",
                color:
                  tab === k
                    ? "var(--gold)"
                    : "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
                borderBottom:
                  tab === k
                    ? "1px solid var(--gold)"
                    : "1px solid transparent",
                background: "none",
                cursor: "pointer",
              }}
            >
              {k === "users" ? "Users" : "Stats"}
            </button>
          ))}
        </nav>

        <div className="mt-8">
          {tab === "users" ? (
            <UsersTab myRole={myRole} myUserId={user!.id} />
          ) : (
            <StatsTab />
          )}
        </div>
      </div>
    </main>
  );
}

function UsersTab({
  myRole,
  myUserId,
}: {
  myRole: Role;
  myUserId: string;
}) {
  const [rows, setRows] = useState<UserRow[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    const [{ data: prefs }, { data: readings }] = await Promise.all([
      supabase
        .from("user_preferences")
        .select(
          "user_id, display_name, role, subscription_type, is_premium, premium_since, admin_note",
        )
        .order("premium_since", { ascending: false, nullsFirst: false }),
      supabase
        .from("readings")
        .select("user_id, created_at"),
    ]);
    const counts: Record<string, { n: number; last: string | null }> = {};
    for (const r of (readings ?? []) as Array<{
      user_id: string;
      created_at: string;
    }>) {
      const c = counts[r.user_id] ?? { n: 0, last: null };
      c.n += 1;
      if (!c.last || r.created_at > c.last) c.last = r.created_at;
      counts[r.user_id] = c;
    }
    setRows(
      ((prefs ?? []) as UserRow[]).map((r) => ({
        ...r,
        reading_count: counts[r.user_id]?.n ?? 0,
        last_reading: counts[r.user_id]?.last ?? null,
      })),
    );
    setLoading(false);
  };

  useEffect(() => {
    void load();
  }, []);

  const filtered = rows.filter((r) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      (r.display_name ?? "").toLowerCase().includes(q) ||
      r.user_id.toLowerCase().includes(q)
    );
  });

  const updateRow = async (
    user_id: string,
    patch: Partial<UserRow>,
  ): Promise<void> => {
    const { error } = await supabase
      .from("user_preferences")
      .update(patch)
      .eq("user_id", user_id);
    if (error) {
      console.error("[Admin] update failed", error);
      window.alert("Update failed: " + error.message);
      return;
    }
    setRows((prev) =>
      prev.map((r) => (r.user_id === user_id ? { ...r, ...patch } : r)),
    );
  };

  const giftPremium = (row: UserRow) =>
    updateRow(row.user_id, {
      is_premium: true,
      subscription_type: "gifted",
      premium_since: new Date().toISOString(),
      // gifted_by tracked via raw update
    } as Partial<UserRow>).then(() =>
      supabase
        .from("user_preferences")
        .update({ gifted_by: myUserId })
        .eq("user_id", row.user_id),
    );

  const revokePremium = (row: UserRow) =>
    updateRow(row.user_id, {
      is_premium: false,
      subscription_type: "none",
    });

  return (
    <div>
      <input
        type="search"
        placeholder="Search by name or id…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="w-full bg-transparent py-2"
        style={{
          ...serif,
          fontSize: "var(--text-body)",
          color: "var(--foreground)",
          borderBottom: "1px solid var(--border-subtle)",
          outline: "none",
        }}
      />

      {loading ? (
        <p
          className="mt-8 text-center"
          style={{ ...serif, fontStyle: "italic", opacity: 0.5 }}
        >
          Loading users…
        </p>
      ) : (
        <div className="mt-6 overflow-x-auto">
          <table className="w-full" style={{ ...serif, fontSize: "var(--text-body-sm)" }}>
            <thead>
              <tr
                style={{
                  fontSize: "var(--text-caption)",
                  textTransform: "uppercase",
                  letterSpacing: "0.16em",
                  color: "color-mix(in oklab, var(--color-foreground) 50%, transparent)",
                }}
              >
                <Th>Name</Th>
                <Th>Role</Th>
                <Th>Sub</Th>
                <Th>Premium</Th>
                <Th>Since</Th>
                <Th>Readings</Th>
                <Th>Last reading</Th>
                <Th>Note</Th>
                <Th>Actions</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.user_id}
                  style={{ borderBottom: "1px solid var(--border-subtle)" }}
                >
                  <Td>
                    {r.display_name ?? (
                      <span style={{ opacity: 0.5 }}>
                        {r.user_id.slice(0, 8)}…
                      </span>
                    )}
                  </Td>
                  <Td>{r.role}</Td>
                  <Td>{r.subscription_type}</Td>
                  <Td>{r.is_premium ? "yes" : "no"}</Td>
                  <Td>
                    {r.premium_since
                      ? new Date(r.premium_since).toLocaleDateString()
                      : "—"}
                  </Td>
                  <Td>{r.reading_count ?? 0}</Td>
                  <Td>
                    {r.last_reading
                      ? new Date(r.last_reading).toLocaleDateString()
                      : "—"}
                  </Td>
                  <Td>
                    <input
                      type="text"
                      defaultValue={r.admin_note ?? ""}
                      onBlur={(e) => {
                        const v = e.target.value.trim() || null;
                        if (v !== (r.admin_note ?? null)) {
                          void updateRow(r.user_id, { admin_note: v });
                        }
                      }}
                      className="w-32 bg-transparent"
                      style={{
                        ...serif,
                        fontSize: "var(--text-body-sm)",
                        color: "var(--foreground)",
                        borderBottom: "1px solid var(--border-subtle)",
                        outline: "none",
                      }}
                    />
                  </Td>
                  <Td>
                    <div className="flex flex-wrap gap-3">
                      {!r.is_premium && (
                        <RowAction onClick={() => void giftPremium(r)}>
                          Gift
                        </RowAction>
                      )}
                      {r.is_premium && (
                        <RowAction onClick={() => void revokePremium(r)}>
                          Revoke
                        </RowAction>
                      )}
                      {myRole === "super_admin" && r.role !== "admin" && (
                        <RowAction
                          onClick={() =>
                            void updateRow(r.user_id, { role: "admin" })
                          }
                        >
                          Make admin
                        </RowAction>
                      )}
                      {myRole === "super_admin" &&
                        r.role !== "super_admin" && (
                          <RowAction
                            onClick={() =>
                              void updateRow(r.user_id, {
                                role: "super_admin",
                              })
                            }
                          >
                            Make super
                          </RowAction>
                        )}
                      {myRole === "super_admin" &&
                        (r.role === "admin" || r.role === "super_admin") &&
                        r.user_id !== myUserId && (
                          <RowAction
                            onClick={() =>
                              void updateRow(r.user_id, { role: "user" })
                            }
                          >
                            Remove admin
                          </RowAction>
                        )}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatsTab() {
  const [stats, setStats] = useState<{
    users: number;
    readings: number;
    deep: number;
    premium: number;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      const [u, r, d, p] = await Promise.all([
        supabase
          .from("user_preferences")
          .select("*", { count: "exact", head: true }),
        supabase
          .from("readings")
          .select("*", { count: "exact", head: true }),
        supabase
          .from("readings")
          .select("*", { count: "exact", head: true })
          .eq("is_deep_reading", true),
        supabase
          .from("user_preferences")
          .select("*", { count: "exact", head: true })
          .eq("is_premium", true),
      ]);
      setStats({
        users: u.count ?? 0,
        readings: r.count ?? 0,
        deep: d.count ?? 0,
        premium: p.count ?? 0,
      });
    })();
  }, []);

  if (!stats)
    return (
      <p style={{ ...serif, fontStyle: "italic", opacity: 0.5 }}>Loading…</p>
    );

  return (
    <dl className="space-y-3" style={{ ...serif, fontSize: "var(--text-body)" }}>
      <StatRow label="Total users" value={stats.users} />
      <StatRow label="Total readings" value={stats.readings} />
      <StatRow label="Total deep readings" value={stats.deep} />
      <StatRow label="Total premium users" value={stats.premium} />
    </dl>
  );
}

function StatRow({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="flex items-baseline justify-between"
      style={{ borderBottom: "1px solid var(--border-subtle)", paddingBottom: 8 }}
    >
      <dt
        className="uppercase"
        style={{
          fontSize: "var(--text-caption)",
          letterSpacing: "0.18em",
          color: "color-mix(in oklab, var(--color-foreground) 55%, transparent)",
        }}
      >
        {label}
      </dt>
      <dd className="text-gold">{value.toLocaleString()}</dd>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-2 py-2 text-left font-normal" style={{ whiteSpace: "nowrap" }}>
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-2 py-3 align-top" style={{ whiteSpace: "nowrap" }}>
      {children}
    </td>
  );
}

function RowAction({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-gold transition-opacity hover:opacity-80"
      style={{
        ...serif,
        fontSize: "var(--text-body-sm)",
        background: "none",
        border: "none",
        padding: 0,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}