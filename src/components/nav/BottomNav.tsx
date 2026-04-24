import { Link, useLocation } from "@tanstack/react-router";
import { Moon, BookOpen, SlidersHorizontal } from "lucide-react";
import { useRestingOpacity } from "@/lib/use-resting-opacity";
import { cn } from "@/lib/utils";

const TABS = [
  { to: "/", label: "Home", Icon: Moon },
  { to: "/journal", label: "Journal", Icon: BookOpen },
  { to: "/settings", label: "Settings", Icon: SlidersHorizontal },
] as const;

export function BottomNav() {
  const { opacity } = useRestingOpacity();
  const restingAlpha = opacity / 100;
  const location = useLocation();

  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[color:var(--border)] backdrop-blur-xl"
      style={{
        background: "linear-gradient(to top, rgba(10,8,22,0.85), rgba(10,8,22,0.55))",
      }}
    >
      <ul className="mx-auto flex max-w-md items-stretch justify-around px-4 pt-2 pb-[calc(env(safe-area-inset-bottom)+0.5rem)]">
        {TABS.map(({ to, label, Icon }) => {
          const active = location.pathname === to;
          return (
            <li key={to} className="flex-1">
              <Link
                to={to}
                style={{ opacity: active ? 1 : restingAlpha }}
                className={cn(
                  "flex flex-col items-center gap-1 py-1.5 transition-all hover:opacity-100",
                  active ? "text-gold" : "text-muted-foreground",
                )}
              >
                <Icon size={22} strokeWidth={1.6} />
                <span className="font-display text-[11px] tracking-wide">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}