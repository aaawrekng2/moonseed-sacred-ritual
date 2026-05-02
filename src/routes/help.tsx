/**
 * DP-5 — Help hub.
 *
 * Lists the six categories with their articles. A search box across the
 * top filters articles by title and body in real time.
 */
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ArrowLeft, Search } from "lucide-react";
import {
  HELP_ARTICLES,
  HELP_CATEGORIES,
  getArticlesByCategory,
} from "@/lib/help-articles";

export const Route = createFileRoute("/help")({
  component: HelpHub,
});

function HelpHub() {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = useMemo(() => {
    if (!q) return null;
    return HELP_ARTICLES.filter(
      (a) =>
        a.title.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        a.body.toLowerCase().includes(q),
    );
  }, [q]);

  return (
    <div
      className="min-h-screen w-full px-5 pt-6 pb-24"
      style={{ color: "var(--color-foreground)" }}
    >
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/"
          aria-label="Back"
          className="flex h-9 w-9 items-center justify-center rounded-full"
          style={{ color: "var(--accent)", opacity: 0.7 }}
        >
          <ArrowLeft size={18} strokeWidth={1.5} />
        </Link>
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-h2, 1.5rem)",
            color: "var(--foreground)",
          }}
        >
          Help
        </h1>
      </div>

      <div
        className="flex items-center gap-2 rounded-xl px-3 py-2 mb-7"
        style={{
          background: "var(--surface-card)",
          border: "1px solid var(--border-default)",
        }}
      >
        <Search size={14} strokeWidth={1.5} style={{ opacity: 0.5 }} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help"
          className="flex-1 bg-transparent focus:outline-none"
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-body)",
            color: "var(--foreground)",
          }}
        />
      </div>

      {matches ? (
        <section>
          <h2
            className="font-display text-[10px] uppercase tracking-[0.2em] mb-3"
            style={{ color: "var(--accent)" }}
          >
            {matches.length} result{matches.length === 1 ? "" : "s"}
          </h2>
          <ul className="flex flex-col gap-3">
            {matches.map((a) => (
              <li key={a.id}>
                <Link
                  to="/help/$category/$article"
                  params={{ category: a.category, article: a.id }}
                  className="block rounded-xl px-4 py-3"
                  style={{
                    background: "var(--surface-card)",
                    border: "1px solid var(--border-subtle)",
                  }}
                >
                  <div
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontSize: "var(--text-body-lg)",
                      color: "var(--foreground)",
                    }}
                  >
                    {a.title}
                  </div>
                  <div
                    style={{
                      fontSize: "var(--text-body-sm)",
                      color: "var(--foreground-muted)",
                      opacity: 0.85,
                      marginTop: 2,
                    }}
                  >
                    {a.summary}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <div className="flex flex-col gap-7">
          {HELP_CATEGORIES.map((cat) => {
            const arts = getArticlesByCategory(cat.id);
            return (
              <section key={cat.id}>
                <h2
                  className="font-display text-[10px] uppercase tracking-[0.2em] mb-2"
                  style={{ color: "var(--accent)" }}
                >
                  {cat.name}
                  {arts.length > 0 && (
                    <span style={{ opacity: 0.55, marginLeft: 6 }}>
                      · {arts.length}
                    </span>
                  )}
                </h2>
                <p
                  style={{
                    fontFamily: "var(--font-serif)",
                    fontStyle: "italic",
                    fontSize: "var(--text-body-sm)",
                    color: "var(--foreground-muted)",
                    opacity: 0.8,
                    marginBottom: 10,
                  }}
                >
                  {cat.blurb}
                </p>
                {arts.length === 0 ? (
                  <p
                    style={{
                      fontFamily: "var(--font-serif)",
                      fontStyle: "italic",
                      fontSize: "var(--text-body-sm)",
                      color: "var(--foreground-muted)",
                      opacity: 0.5,
                    }}
                  >
                    More articles soon.
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2">
                    {arts.map((a) => (
                      <li key={a.id}>
                        <Link
                          to="/help/$category/$article"
                          params={{ category: a.category, article: a.id }}
                          className="block rounded-xl px-4 py-3"
                          style={{
                            background: "var(--surface-card)",
                            border: "1px solid var(--border-subtle)",
                          }}
                        >
                          <div
                            style={{
                              fontFamily: "var(--font-serif)",
                              fontSize: "var(--text-body-lg)",
                              color: "var(--foreground)",
                            }}
                          >
                            {a.title}
                          </div>
                          <div
                            style={{
                              fontSize: "var(--text-body-sm)",
                              color: "var(--foreground-muted)",
                              opacity: 0.85,
                              marginTop: 2,
                            }}
                          >
                            {a.summary}
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}