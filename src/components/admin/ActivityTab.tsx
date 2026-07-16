/**
 * v3.52 — Activity dashboard. Filterable (date range, event type, user).
 * Pass `userId` to render it as a per-user timeline (reused on the user
 * drill-down). Self-contained; no external chart lib.
 */
import { useEffect, useMemo, useState } from "react";
import { getActivityMetrics, getActivityFeed } from "@/lib/admin-activity.functions";

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

export function ActivityTab({ userId }: { userId?: string }) {
  const [days, setDays] = useState(30);
  const [eventName, setEventName] = useState<string>("");
  const [userFilter, setUserFilter] = useState<string>(userId ?? "");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [feed, setFeed] = useState<Feed>([]);
  const [loading, setLoading] = useState(true);

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
          <input
            placeholder="Filter by user id…"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value.trim())}
            style={{ padding: "4px 8px" }}
          />
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
                <th style={{ padding: "4px 6px" }}>Who</th>
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
                  <td style={{ padding: "4px 6px" }}>{f.email ?? f.user_id?.slice(0, 8) ?? "—"}</td>
                  <td style={{ padding: "4px 6px" }}>{f.event_name}</td>
                  <td style={{ padding: "4px 6px", maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>
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
