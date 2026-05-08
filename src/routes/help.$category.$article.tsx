/**
 * DP-5 — Single help article view at /help/{category}/{article}.
 */
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import {
  HELP_CATEGORIES,
  getArticleById,
} from "@/lib/help-articles";
import { HelpMarkdown } from "@/components/help/HelpMarkdown";

export const Route = createFileRoute("/help/$category/$article")({
  component: HelpArticleView,
  notFoundComponent: () => (
    <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <p
        style={{
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
          color: "var(--foreground)",
          opacity: 0.85,
          marginBottom: 12,
        }}
      >
        That help article isn't here.
      </p>
      <Link
        to="/help"
        style={{
          color: "var(--accent)",
          fontFamily: "var(--font-serif)",
          fontStyle: "italic",
        }}
      >
        Back to Help
      </Link>
    </div>
  ),
});

function HelpArticleView() {
  const { category, article: articleId } = Route.useParams();
  const article = getArticleById(articleId);
  if (!article || article.category !== category) {
    throw notFound();
  }
  const cat = HELP_CATEGORIES.find((c) => c.id === article.category);

  return (
    <div
      className="w-full"
      style={{
        color: "var(--color-foreground)",
        height: "100dvh",
        overflowY: "auto",
        overscrollBehaviorY: "contain",
      }}
    >
      <div className="mx-auto px-5 pt-6 pb-24" style={{ maxWidth: 720 }}>
      <div className="flex items-center gap-3 mb-6">
        <Link
          to="/help"
          aria-label="Back to Help"
          className="flex h-9 w-9 items-center justify-center rounded-full"
          style={{ color: "var(--accent)", opacity: 0.7 }}
        >
          <ArrowLeft size={18} strokeWidth={1.5} />
        </Link>
        <span
          className="font-display text-[10px] uppercase tracking-[0.22em]"
          style={{ color: "var(--accent)" }}
        >
          {cat?.name ?? "Help"}
        </span>
      </div>

      <article
        className="rounded-2xl px-5 py-6"
        style={{
          background: "var(--surface-card)",
          border: "1px solid var(--border-subtle)",
        }}
      >
        <h1
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "var(--text-h2, 1.6rem)",
            color: "var(--foreground)",
            marginBottom: "0.6em",
          }}
        >
          {article.title}
        </h1>
        <HelpMarkdown source={article.body} />
      </article>
      </div>
    </div>
  );
}