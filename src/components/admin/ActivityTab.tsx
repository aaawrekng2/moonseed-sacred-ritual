/**
 * v3.52 — Activity dashboard. Filterable (date range, event type, user).
 * Pass `userId` to render it as a per-user timeline (reused on the user
 * drill-down). Self-contained; no external chart lib.
 *
 * v3.55 — the user filter is now a searchable picker (all seekers listed
 * alphabetically by email, filters as you type); the feed shows each
 * person's email in the "Who" column.
 */
import { useEffect, useMemo, useState } from "react";
import { getActivityMetrics, getActivityFeed } from "@/lib/admin-activity.functions";
import { listAdminUsers } from "@/lib/admin.functions";

type Metrics = {
  activeToday: number;
  active7d: number;
  active30d: number;
  totalEvents: number;
  volume: { day: string; count: number }[];
  topEvents: { event_name: string; count: number }[];
};
type FeedItem = {
  created_at: string;
  user_id: string | null;
  email: string | null;
  event_name: string;
  detail: string;
  time_zone: string | null;
  user_agent: string | null;
};
type Feed = FeedItem[];
type PickUser = { user_id: string; email: string | null; display_name: string | null };

export function ActivityTab({ userId }: { userId?: string }) {
  const [days, setDays] = useState(30);
  const [eventName, setEventName] = useState<string>("");
  const [userFilter, setUserFilter] = useState<string>(userId ?? "");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [feed, setFeed] = useState<Feed>([]);
  const [loading, setLoading] = useState(true);
  // v3.55 — user picker
  const [users, setUsers] = useState<PickUser[]>([]);
  const [userQuery, setUserQuery] = useState("");
  const [showList, setShowList] = useState(false);

  // Load the seeker list once (dashboard mode only) for the picker + emails.
  useEffect(() => {
    if (userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const list = (await listAdminUsers()) as unknown as PickUser[];
        if (cancelled) return;
        const us = list
          .map((u) => ({
            user_id: u.user_id,
            email: u.email,
            display_name: u.display_name,
          }))
          .sort((a, b) =>
            (a.email ?? a.display_name ?? "")
              .toLowerCase()
              .localeCompare((b.email ?? b.display_name ?? "").toLowerCase()),
          );
        setUsers(us);
      } catch {
        /* non-fatal: picker falls back to a plain text field */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const emailById = useMemo(
    () => new Map(users.map((u) => [u.user_id, u.email ?? u.display_name])),
    [users],
  );

  const filteredUsers = useMemo(() => {
    const q = userQuery.trim().toLowerCase();
    const arr = users.filter(
      (u) =>
        !q ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.display_name ?? "").toLowerCase().includes(q),
    );
    return arr.slice(0, 100);
  }, [users, userQuery]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const mRaw = userId
          ? null
          : await getActivityMetrics({ data: { days } });
        const fRaw = await getActivityFeed({
          data: {
            days,
            eventName: eventName || undefined,
            userId: userId || userFilter || undefined,
            limit: 200,
          },
        });
        if (cancelled) return;
        setMetrics(mRaw as unknown as Metrics | null);
        setFeed(fRaw as unknown as Feed);
      } catch {
        if (!cancelled) {
          setMetrics(null);
          setFeed([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [days, eventName, userFilter, userId]);

  const maxVol = useMemo(
    () => Math.max(1, ...(metrics?.volume ?? []).map((v) => v.count)),
    [metrics],
  );

  const card = {
    flex: "1 1 120px",
    padding: "12px 14px",
    borderRadius: 10,
    border: "1px solid var(--border-subtle, #ddd)",
    background: "var(--surface-card, #fff)",
  } as const;

  const selectUser = (u: PickUser) => {
    setUserFilter(u.user_id);
    setUserQuery(u.email ?? u.display_name ?? u.user_id);
    setShowList(false);
  };
  const clearUser = () => {
    setUserFilter("");
    setUserQuery("");
    setShowList(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Filters */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
        <label>
          Range:{" "}
          <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
            <option value={1}>Today</option>
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
        <label>
          Event:{" "}
          <select value={eventName} onChange={(e) => setEventName(e.target.value)}>
            <option value="">All</option>
            {(metrics?.topEvents ?? []).map((t) => (
              <option key={t.event_name} value={t.event_name}>
                {t.event_name}
              </option>
            ))}
          </select>
        </label>
        {!userId && (
          <div style={{ position: "relative", minWidth: 260 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                placeholder="Filter by user (type email or name)…"
                value={userQuery}
                onFocus={() => setShowList(true)}
                onBlur={() => window.setTimeout(() => setShowList(false), 150)}
                onChange={(e) => {
                  setUserQuery(e.target.value);
                  setShowList(true);
                  if (!e.target.value) setUserFilter("");
                }}
                style={{ padding: "5px 8px", width: "100%", boxSizing: "border-box" }}
              />
              {userFilter && (
                <button
                  type="button"
                  onClick={clearUser}
                  aria-label="Clear user filter"
                  style={{ border: "none", background: "none", cursor: "pointer", fontSize: 16, opacity: 0.6 }}
                >
                  ×
                </button>
              )}
            </div>
            {showList && users.length > 0 && (
              <div
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: 0,
                  zIndex: 20,
                  maxHeight: 280,
                  overflowY: "auto",
                  marginTop: 4,
                  background: "var(--surface-card, #fff)",
                  border: "1px solid var(--border-subtle, #ccc)",
                  borderRadius: 8,
                  boxShadow: "0 8px 24px rgba(0,0,0,0.25)",
                }}
              >
                {filteredUsers.map((u) => (
                  <div
                    key={u.user_id}
                    onMouseDown={() => selectUser(u)}
                    style={{ padding: "7px 10px", cursor: "pointer", fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                  >
                    {u.email ?? u.display_name ?? u.user_id.slice(0, 8)}
                    {u.email && u.display_name && (
                      <span style={{ opacity: 0.5 }}> · {u.display_name}</span>
                    )}
                  </div>
                ))}
                {filteredUsers.length === 0 && (
                  <div style={{ padding: "7px 10px", opacity: 0.5, fontSize: 13 }}>No match</div>
                )}
              </div>
            )}
          </div>
        )}
        {loading && <span style={{ opacity: 0.6 }}>Loading…</span>}
      </div>

      {/* Stat cards + volume + top events (hidden in per-user mode) */}
      {!userId && metrics && (
        <>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <div style={card}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Active today</div>
              <div style={{ fontSize: 22, fontWeight: 600 }}>{metrics.activeToday}</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Active 7d</div>
              <div style={{ fontSize: 22, fontWeight: 600 }}>{metrics.active7d}</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Active 30d</div>
              <div style={{ fontSize: 22, fontWeight: 600 }}>{metrics.active30d}</div>
            </div>
            <div style={card}>
              <div style={{ fontSize: 12, opacity: 0.7 }}>Events ({days}d)</div>
              <div style={{ fontSize: 22, fontWeight: 600 }}>{metrics.totalEvents}</div>
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>Activity — last 14 days</div>
            <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 90 }}>
              {metrics.volume.map((v) => (
                <div key={v.day} style={{ flex: 1, textAlign: "center" }} title={`${v.day}: ${v.count}`}>
                  <div
                    style={{
                      height: `${(v.count / maxVol) * 80}px`,
                      background: "var(--accent, #b8912f)",
                      borderRadius: 3,
                    }}
                  />
                  <div style={{ fontSize: 9, opacity: 0.5 }}>{v.day.slice(5)}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={card}>
            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>Top events</div>
            {metrics.topEvents.map((t) => (
              <div key={t.event_name} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                <span>{t.event_name}</span>
                <strong>{t.count}</strong>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Recent activity feed */}
      <div style={card}>
        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 8 }}>
          {userId ? "Recent activity" : "Live activity feed"}
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", opacity: 0.6 }}>
                <th style={{ padding: "4px 6px" }}>When</th>
                {!userId && <th style={{ padding: "4px 6px" }}>Who</th>}
                <th style={{ padding: "4px 6px" }}>Event</th>
                <th style={{ padding: "4px 6px" }}>Detail</th>
                {!userId && <th style={{ padding: "4px 6px" }}>Where</th>}
              </tr>
            </thead>
            <tbody>
              {feed.map((f, i) => (
                <tr key={i} style={{ borderTop: "1px solid var(--border-subtle, #eee)" }}>
                  <td style={{ padding: "4px 6px", whiteSpace: "nowrap" }}>
                    {new Date(f.created_at).toLocaleString()}
                  </td>
                  {!userId && (
                    <td style={{ padding: "4px 6px" }}>
                      {emailById.get(f.user_id ?? "") ??
                        f.email ??
                        (f.user_id ? `${f.user_id.slice(0, 8)}…` : "—")}
                    </td>
                  )}
                  <td style={{ padding: "4px 6px" }}>{f.event_name}</td>
                  <td style={{ padding: "4px 6px", maxWidth: 340, overflow: "hidden", textOverflow: "ellipsis" }}>
                    {f.detail}
                  </td>
                  {!userId && <td style={{ padding: "4px 6px" }}>{f.time_zone ?? "—"}</td>}
                </tr>
              ))}
              {feed.length === 0 && !loading && (
                <tr>
                  <td colSpan={5} style={{ padding: 12, opacity: 0.6 }}>
                    No activity in this range yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
