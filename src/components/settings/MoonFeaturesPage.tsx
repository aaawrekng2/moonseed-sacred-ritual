import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/lib/supabase";

const ADMIN_EMAIL = "mark@spiekerstudios.com";

type PlanKey = "1m" | "3m" | "6m" | "12m";

type Plan = {
  key: PlanKey;
  label: string;
  price: string;
  note?: string;
};

const PLANS: Plan[] = [
  { key: "1m", label: "1 Month", price: "$9.99 / mo" },
  { key: "3m", label: "3 Months", price: "$8.99 / mo" },
  { key: "6m", label: "6 Months", price: "$7.99 / mo" },
  { key: "12m", label: "1 Year", price: "$6.99 / mo", note: "Best value" },
];

const serif = { fontFamily: "var(--font-serif)" } as const;

export function MoonFeaturesPage() {
  const { user } = useAuth();
  const [isPremium, setIsPremium] = useState<boolean>(false);
  const [premiumSince, setPremiumSince] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selected, setSelected] = useState<PlanKey>("12m");

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("user_preferences")
        .select("is_premium, premium_since")
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      setIsPremium(Boolean(data?.is_premium));
      setPremiumSince(data?.premium_since ?? null);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const isAdmin = user?.email === ADMIN_EMAIL;

  return (
    <div className="pb-16 pt-2" style={serif}>
      <header className="mb-10 text-center">
        <h1
          className="text-gold"
          style={{
            ...serif,
            fontSize: "calc(2.4rem * var(--heading-scale, 1))",
            fontWeight: 500,
            letterSpacing: "0.01em",
          }}
        >
          Moonseed Moon
        </h1>
        <p
          className="mt-3 text-foreground/60"
          style={{ ...serif, fontStyle: "italic", fontSize: "var(--text-body)" }}
        >
          Deepen your practice. The cards remember.
        </p>
      </header>

      {isPremium ? (
        <ActiveState premiumSince={premiumSince} />
      ) : (
        <>
          <Unlocks />

          <div className="my-12 flex flex-col items-center">
            <button
              type="button"
              onClick={() => console.log("free trial tapped")}
              className="text-gold transition-opacity hover:opacity-80"
              style={{
                ...serif,
                fontSize: "var(--text-heading-md)",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            >
              Begin one month free
            </button>
            <p
              className="mt-3 text-foreground/45"
              style={{ ...serif, fontStyle: "italic", fontSize: "var(--text-body-sm)" }}
            >
              No charge until your trial ends. Cancel any time.
            </p>
          </div>

          <div className="mx-auto max-w-md">
            {PLANS.map((p) => {
              const active = selected === p.key;
              return (
                <button
                  key={p.key}
                  type="button"
                  onClick={() => setSelected(p.key)}
                  className="flex w-full items-baseline justify-between py-4 pl-4 pr-2 text-left transition-colors"
                  style={{
                    ...serif,
                    background: active
                      ? "oklch(0.82 0.14 82 / 0.08)"
                      : "transparent",
                    borderLeft: active
                      ? "2px solid var(--gold, oklch(0.82 0.14 82))"
                      : "2px solid transparent",
                    cursor: "pointer",
                  }}
                >
                  <span
                    className="text-foreground/90"
                    style={{ fontSize: "var(--text-body-lg)" }}
                  >
                    {p.label}
                    {p.note && (
                      <span
                        className="ml-2 text-foreground/50"
                        style={{ fontStyle: "italic", fontSize: "var(--text-body-sm)" }}
                      >
                        {p.note}
                      </span>
                    )}
                  </span>
                  <span
                    className="text-foreground/65"
                    style={{ fontSize: "var(--text-body)" }}
                  >
                    {p.price}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-10 flex justify-center">
            <button
              type="button"
              onClick={() => console.log("begin moon tapped", selected)}
              className="text-gold transition-opacity hover:opacity-80"
              style={{
                ...serif,
                fontSize: "var(--text-body-lg)",
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            >
              Begin Moon
            </button>
          </div>

          <div className="mt-16 flex justify-center">
            <button
              type="button"
              onClick={() => console.log("restore purchase tapped")}
              style={{
                ...serif,
                fontStyle: "italic",
                fontSize: "var(--text-body-sm)",
                color: "var(--foreground)",
                opacity: 0.4,
                background: "none",
                border: "none",
                padding: 0,
                cursor: "pointer",
              }}
            >
              Restore purchase
            </button>
          </div>

          {loaded && isAdmin && (
            <div className="mt-10 flex justify-center">
              <button
                type="button"
                onClick={async () => {
                  if (!user) return;
                  await supabase
                    .from("user_preferences")
                    .update({
                      is_premium: true,
                      premium_since: new Date().toISOString(),
                    })
                    .eq("user_id", user.id);
                  window.location.reload();
                }}
                style={{
                  ...serif,
                  fontSize: "var(--text-caption)",
                  color: "var(--foreground)",
                  opacity: 0.18,
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                }}
              >
                [Dev] Enable premium
              </button>
            </div>
          )}
        </>
      )}

      {loaded && isAdmin && isPremium && (
        <div className="mt-10 flex justify-center">
          <button
            type="button"
            onClick={async () => {
              if (!user) return;
              await supabase
                .from("user_preferences")
                .update({ is_premium: false })
                .eq("user_id", user.id);
              window.location.reload();
            }}
            style={{
              ...serif,
              fontSize: "var(--text-caption)",
              color: "var(--foreground)",
              opacity: 0.18,
              background: "none",
              border: "none",
              padding: 0,
              cursor: "pointer",
            }}
          >
            [Dev] Disable premium
          </button>
        </div>
      )}
    </div>
  );
}

function Unlocks() {
  const items = [
    "Unlimited deep readings",
    "All four lenses, every session",
    "Full archive memory — the guide sees everything",
    "Unlimited custom guides",
    "The cards never forget",
  ];
  return (
    <ul className="mx-auto max-w-md space-y-3 text-center">
      {items.map((t) => (
        <li
          key={t}
          className="text-foreground/75"
          style={{ ...serif, fontSize: "var(--text-body)" }}
        >
          {t}
        </li>
      ))}
    </ul>
  );
}

function ActiveState({ premiumSince }: { premiumSince: string | null }) {
  const since = premiumSince ? new Date(premiumSince) : null;
  return (
    <div className="mx-auto max-w-md text-center">
      <p
        className="text-foreground/85"
        style={{ ...serif, fontSize: "var(--text-body-lg)", fontStyle: "italic" }}
      >
        Your Moon practice is active. Thank you for being here.
      </p>
      {since && (
        <p
          className="mt-4 text-foreground/50"
          style={{ ...serif, fontSize: "var(--text-body-sm)" }}
        >
          Since{" "}
          {since.toLocaleDateString(undefined, {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
      )}
      <div className="mt-10">
        <button
          type="button"
          onClick={() => console.log("manage subscription tapped")}
          className="text-gold transition-opacity hover:opacity-80"
          style={{
            ...serif,
            fontSize: "var(--text-body)",
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
        >
          Manage subscription
        </button>
      </div>
    </div>
  );
}