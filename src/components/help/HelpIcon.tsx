/**
 * DP-5 — small "?" icon that deep-links to a specific help article.
 *
 * Renders inline next to a feature label (Mirror Artifact, Story, etc.).
 * Tap navigates to /help/{category}/{article}. Low-opacity at rest;
 * picks up the active accent on hover.
 */
import { HelpCircle } from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import { getArticleById } from "@/lib/help-articles";

export function HelpIcon({
  articleId,
  size = 14,
  className,
}: {
  articleId: string;
  size?: number;
  className?: string;
}) {
  const navigate = useNavigate();
  const article = getArticleById(articleId);
  if (!article) return null;
  return (
    <button
      type="button"
      aria-label={`Help: ${article.title}`}
      title={`Help: ${article.title}`}
      onClick={(e) => {
        e.stopPropagation();
        void navigate({
          to: "/help/$category/$article",
          params: { category: article.category, article: article.id },
        });
      }}
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "none",
        border: "none",
        padding: 2,
        marginLeft: 4,
        cursor: "pointer",
        color: "var(--accent)",
        opacity: "var(--ro-plus-30, 0.6)",
      }}
    >
      <HelpCircle size={size} strokeWidth={1.5} />
    </button>
  );
}