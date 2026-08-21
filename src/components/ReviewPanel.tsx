import { useMemo, useState } from "react";
import { Check, Clock, X } from "lucide-react";

import type { Submission } from "@/lib/blind";
import { formatStamp } from "@/lib/blind";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

export function ReviewPanel({
  submissions,
  teamName,
  busy,
  onReview,
}: {
  submissions: Submission[];
  teamName: (teamId: string) => string;
  busy?: boolean;
  onReview: (submissionId: string, verdict: "correct" | "rejected") => void;
}) {
  const pending = useMemo(() => submissions.filter((s) => s.status === "pending"), [submissions]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const active = pending.find((s) => s.id === activeId) ?? pending[0] ?? null;

  if (pending.length === 0) {
    return (
      <section className="rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center">
        <Clock className="mx-auto h-6 w-6 text-ash" />
        <p className="mt-3 font-mono text-xs uppercase tracking-[0.25em] text-ash">
          No submissions to judge
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Submissions land here the moment a team ends a turn.
        </p>
      </section>
    );
  }

  return (
    <section className="overflow-hidden rounded-2xl border border-amber/25 bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div>
          <p className="hud-label text-amber">Judgement queue</p>
          <p className="mt-0.5 font-display text-sm font-bold tracking-tight">
            {pending.length} {pending.length === 1 ? "code" : "codes"} waiting on you
          </p>
        </div>
      </div>

      <div className="grid gap-px bg-border/40 md:grid-cols-[15rem_1fr]">
        <div className="space-y-1 bg-card p-2">
          {pending.map((s) => (
            <button
              key={s.id}
              onClick={() => setActiveId(s.id)}
              className={cn(
                "w-full rounded-lg px-3 py-2 text-left transition-colors",
                active?.id === s.id
                  ? "bg-amber/10 text-bone"
                  : "text-ash hover:bg-ridge/60 hover:text-bone",
              )}
            >
              <p className="truncate text-sm font-semibold">{teamName(s.team_id)}</p>
              <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-ash">
                member {s.member} · {formatStamp(s.submitted_at)} · {s.code.length} chars
              </p>
            </button>
          ))}
        </div>

        {active && (
          <div className="bg-void/40 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ash">
                {teamName(active.team_id)} · member {active.member} submitted at{" "}
                {formatStamp(active.submitted_at)}
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => onReview(active.id, "correct")}
                  disabled={busy}
                  className="bg-mint text-void hover:bg-mint/90"
                >
                  <Check className="h-4 w-4" />
                  Correct
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => onReview(active.id, "rejected")}
                  disabled={busy}
                >
                  <X className="h-4 w-4" />
                  Reject · lose a life
                </Button>
              </div>
            </div>
            <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-card p-4 font-mono text-sm leading-relaxed text-bone">
              {active.code || "(empty submission)"}
            </pre>
          </div>
        )}
      </div>
    </section>
  );
}
