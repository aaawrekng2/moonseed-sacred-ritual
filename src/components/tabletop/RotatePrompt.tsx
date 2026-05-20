import { RotateCcw } from "lucide-react";

export function RotatePrompt() {
  return (
    <div
      style={{
        width: "100%",
        minHeight: "60vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        padding: 24,
        textAlign: "center",
      }}
    >
      <RotateCcw size={48} style={{ color: "var(--color-foreground-muted)" }} />
      <p
        style={{
          fontSize: "var(--text-body)",
          color: "var(--color-foreground)",
          margin: 0,
        }}
      >
        Turn your tablet sideways to open Quick Log.
      </p>
    </div>
  );
}