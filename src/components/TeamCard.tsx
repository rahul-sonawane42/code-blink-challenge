import { useMemo, useState } from "react";
import { Check, Eye, EyeOff, HeartCrack, HeartPulse, Pencil, ShieldBan, SwatchBook, X, RotateCcw } from "lucide-react";

import type { HostTeam, Team } from "@/lib/blind";
import { cn } from "@/lib/utils";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { TeamColorPicker } from "./TeamColorPicker";

const STATUS_META: Record<string, { label: string; tone: string }> = {
  pending: { label: "In lobby", tone: "bg-ridge text-ash" },
  accepted: { label: "Active", tone: "bg-ridge text-bone" },
  typing: { label: "Typing", tone: "bg-signal/10 text-signal ring-signal/25" },
  submitted: { label: "Awaiting review", tone: "bg-amber/10 text-amber ring-amber/25" },
  finished: { label: "Finished", tone: "bg-mint/10 text-mint ring-mint/25" },
  kicked: { label: "Kicked", tone: "bg-ember/10 text-ember ring-ember/25" },
};

function EditName({ team, onSave }: { team: Team; onSave: (name: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(team.name);

  const commit = () => {
    const trimmed = name.trim();
    if (trimmed && trimmed !== team.name) onSave(trimmed);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="group flex items-center gap-2 focus-visible:outline-none"
      >
        <span className="font-display text-lg font-bold tracking-tight">{team.name}</span>
        <Pencil className="h-3.5 w-3.5 text-ash opacity-0 transition-opacity group-hover:opacity-100" />
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="h-7 w-44"
        autoFocus
      />
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={commit}
        aria-label="Save name"
      >
        <Check className="h-3.5 w-3.5 text-mint" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={() => setEditing(false)}
        aria-label="Cancel"
      >
        <X className="h-3.5 w-3.5 text-ash" />
      </Button>
    </div>
  );
}

export function TeamCard({
  team,
  busy,
  onAccept,
  onKick,
  onRename,
  onColor,
  onGrantLife,
  onRemoveLife,
  onReopen,
  maxLives,
}: {
  team: HostTeam;
  busy?: boolean;
  onAccept: (color?: string) => void;
  onKick: () => void;
  onRename: (name: string) => void;
  onColor: (color: string) => void;
  onGrantLife: () => void;
  onRemoveLife: () => void;
  onReopen?: () => void;
  maxLives: number;
}) {
  const [picking, setPicking] = useState(false);
  const [codeHidden, setCodeHidden] = useState(false);
  const meta: { label: string; tone: string } = STATUS_META[team.status] ?? {
    label: "In lobby",
    tone: "bg-ridge text-ash",
  };
  const live = team.accepted;
  const pending = team.status === "submitted";
  const isTyping = team.status === "typing";

  return (
    <article
      className={cn(
        "group relative overflow-hidden rounded-2xl border bg-card shadow-sm transition-shadow",
        live && "hover:shadow-lg",
      )}
      style={{
        borderColor: live ? undefined : "var(--border)",
      }}
    >
      <div className="h-1.5 w-full" style={{ backgroundColor: team.color ?? "var(--ridge)" }} />
      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <EditName team={team} onSave={onRename} />
          <span
            className={cn(
              "mt-1 inline-flex shrink-0 rounded-full px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.18em] ring-1",
              meta.tone,
              !meta.tone.includes("ring-") && "ring-border",
            )}
          >
            {meta.label}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 font-mono text-xs text-ash">
          <span className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: team.color ?? "var(--ridge)" }} />
            {team.color ?? "—"}
          </span>
          <span>
            {team.lives} {team.lives === 1 ? "life" : "lives"}
          </span>
          <span>member {team.current_member}</span>
          <span>{team.char_count} chars</span>
        </div>

        {!live && team.status === "pending" && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => onAccept("")} disabled={busy}>
              Accept
            </Button>
            <Button size="sm" variant="secondary" onClick={onKick} disabled={busy}>
              Decline
            </Button>
          </div>
        )}

        {pending && (
          <p className="rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 font-mono text-[11px] uppercase tracking-[0.15em] text-amber">
            Code submitted — judge it below
          </p>
        )}

        {live && (
          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setCodeHidden((h) => !h)}
              className={cn(!codeHidden && "text-signal")}
            >
              {codeHidden ? (
                <><EyeOff className="h-3.5 w-3.5" /> Show code</>
              ) : (
                <><Eye className="h-3.5 w-3.5" /> Hide code</>
              )}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPicking((p) => !p)}>
              <SwatchBook className="h-3.5 w-3.5" />
              Color
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onGrantLife}
              disabled={team.lives >= maxLives}
            >
              <HeartPulse className="h-3.5 w-3.5 text-mint" />
              +1
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onRemoveLife}
              disabled={team.lives <= 0}
            >
              <HeartCrack className="h-3.5 w-3.5 text-ember" />
              −1
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={onKick}
              className="text-ember hover:text-ember"
            >
              <ShieldBan className="h-3.5 w-3.5" />
              Kick
            </Button>
            {team.status === "finished" && onReopen && (
              <Button size="sm" variant="ghost" onClick={onReopen}>
                <RotateCcw className="h-3.5 w-3.5 text-signal" />
                Re-open
              </Button>
            )}
          </div>
        )}

        {picking && (
          <div className="rounded-lg border border-border bg-ridge/50 p-2">
            <TeamColorPicker value={team.color ?? ""} onChange={onColor} />
          </div>
        )}

        {/* Live code preview — always visible for accepted teams unless host hides it */}
        {live && !codeHidden && (
          <div className="relative">
            {isTyping && (
              <span className="absolute right-2 top-2 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-signal" />
                <span className="font-mono text-[9px] uppercase tracking-[0.2em] text-signal">live</span>
              </span>
            )}
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-lg border border-border bg-void/60 p-3 font-mono text-xs leading-relaxed text-bone/90">
              {team.draft_code || "(no code typed yet)"}
            </pre>
          </div>
        )}
      </div>
    </article>
  );
}
