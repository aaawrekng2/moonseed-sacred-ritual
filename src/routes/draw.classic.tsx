/**
 * Phase 23 — legacy QuickLog access path.
 *
 * `/draw` now renders the new Manual Entry (ConstellationPage) on desktop
 * landscape. The historical QuickLog surface lives here for back-compat.
 */
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { QuickLog } from "@/components/tabletop/QuickLog";

export const Route = createFileRoute("/draw/classic")({
  component: ClassicDrawShell,
});

function ClassicDrawShell() {
  const navigate = useNavigate();
  const [question, setQuestion] = useState("");
  return (
    <QuickLog
      spread="daily"
      question={question}
      onQuestionChange={setQuestion}
      onCancel={() => navigate({ to: "/" })}
      onComplete={() => navigate({ to: "/" })}
    />
  );
}