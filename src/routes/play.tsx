import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { toast } from "sonner";

import { LivesRow } from "@/components/LivesRow";
import { MascotOverlay } from "@/components/MascotOverlay";
import { ProblemPanel } from "@/components/ProblemPanel";
import { VerdictOverlay } from "@/components/VerdictOverlay";
import { TimerRail } from "@/components/TimerRail";
import { Button } from "@/components/ui/button";
import { useCountdown } from "@/hooks/useCountdown";
import { useRoom, useTeams } from "@/hooks/useRoomSync";
import { useVerdict } from "@/hooks/useVerdict";
import { supabase } from "@/integrations/supabase/client";
import {
  clearSession,
  formatClock,
  loadSession,
  saveSession,
  type BlindSession,
} from "@/lib/blind";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/play")({
  head: () => ({
    meta: [
      { title: "Blind Coding Arena — Participant Console" },
      {
        name: "description",
        content:
          "Type your solution blind: hidden text, a shared 4-life relay and a synced round timer that survives page reloads.",
      },
      { property: "og:title", content: "Blind Coding Arena — Participant Console" },
      {
        property: "og:description",
        content: "Hidden typing, 4 lives per team, and a host-synced countdown.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PlayPage,
});

function PlayPage() {
  const navigate = useNavigate();
  const [session, setSession] = useState<BlindSession | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastPing = useRef(0);
  const [verdictDismissed, setVerdictDismissed] = useState(false);

  // --- Recovery: pull the whole session back out of localStorage on mount.
  useEffect(() => {
    const restored = loadSession();
    setSession(restored);
    setHydrated(true);
    if (!restored) void navigate({ to: "/" });
  }, [navigate]);

  // Move cursor to end of textarea on mount/hydration
  useEffect(() => {
    if (hydrated && session && textareaRef.current) {
      const ta = textareaRef.current;
      ta.setSelectionRange(ta.value.length, ta.value.length);
      ta.focus();
    }
  }, [hydrated, session?.teamId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Always force cursor to end — player must never position it in the middle
  const forceCursorToEnd = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    requestAnimationFrame(() => {
      ta.setSelectionRange(ta.value.length, ta.value.length);
      ta.scrollTop = ta.scrollHeight;
    });
  }, []);

  const { room } = useRoom(session?.roomCode ?? null);

  // Poll the team record for acceptance status + color
  const teamList = useTeams(session?.roomId ?? null);
  const myTeam = useMemo(
    () => teamList.find((t) => t.id === session?.teamId) ?? null,
    [teamList, session?.teamId],
  );

  /** Persist + update in one place so storage never drifts from state. */
  const patch = useCallback((changes: Partial<BlindSession>) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...changes };
      saveSession(next);
      return next;
    });
  }, []);

  // --- Sync acceptance + color from team record
  useEffect(() => {
    if (!myTeam || !session) return;
    const updates: Partial<BlindSession> = {};
    if (myTeam.accepted !== session.accepted) updates.accepted = myTeam.accepted;
    if (myTeam.color && myTeam.color !== session.color) updates.color = myTeam.color;
    if (myTeam.lives !== session.livesLeft) updates.livesLeft = myTeam.lives;
    if (myTeam.current_member !== session.currentMember)
      updates.currentMember = myTeam.current_member;
    if (myTeam.status === "accepted" && session.verdictKind === "success") {
      updates.verdictKind = null;
      updates.revealed = false;
      toast.success("The host re-opened your team. You can continue typing.");
    }
    if (myTeam.status === "kicked") {
      // Kicked by host
      toast.error("You have been removed from this room by the host");
      clearSession();
      void navigate({ to: "/" });
      return;
    }
    if (Object.keys(updates).length > 0) patch(updates);
  }, [myTeam, session, patch, navigate]);

  // --- Timer: derived from the host's start time so every machine agrees.
  useEffect(() => {
    if (!room || !session) return;
    if (room.status === "running" && room.started_at) {
      const deadline = new Date(room.started_at).getTime() + room.duration_seconds * 1000;
      if (session.deadline !== deadline) patch({ deadline });
    }
    if (room.status === "paused") {
      patch({ deadline: null });
    }
    if (room.status === "lobby" && session.deadline !== null) {
      patch({ deadline: null, revealed: false });
    }
  }, [room, session, patch]);

  const { remaining, expired } = useCountdown(session?.deadline ?? null);
  const outOfLives = (session?.livesLeft ?? 0) <= 0;
  const roundOver = room?.status === "ended" || expired || outOfLives;
  const isAccepted = session?.accepted ?? false;
  const codeAccepted = session?.verdictKind === "success";
  const live = room?.status === "running" && !roundOver && isAccepted && !codeAccepted;
  const isPaused = room?.status === "paused";
  const inLobby = !isAccepted && !roundOver;
  const canType = live && !isPaused;

  // --- Verdict tracking
  const verdictResult = useVerdict(
    session?.pendingSubmissionId ?? null,
    session?.teamId ?? null,
    session?.teamSecret ?? null,
  );

  // Handle verdict arriving
  useEffect(() => {
    if (!session?.pendingSubmissionId) return;
    const v = verdictResult.data;
    if (v.status === "correct") {
      patch({
        pendingSubmissionId: null,
        verdictKind: "success",
        revealed: true,
        code: v.code ?? session.code,
      });
      setVerdictDismissed(false);
    } else if (v.status === "rejected") {
      patch({
        pendingSubmissionId: null,
        verdictKind: "lifelost",
      });
      setVerdictDismissed(false);
    }
  }, [verdictResult.data, session?.pendingSubmissionId, session?.code, patch]);

  // Auto-dismiss verdict overlay after 3 seconds
  useEffect(() => {
    if (session?.verdictKind && !verdictDismissed) {
      const timer = setTimeout(() => {
        setVerdictDismissed(true);
        if (session.verdictKind === "success") {
          // Keep revealed
        } else {
          patch({ verdictKind: null });
        }
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [session?.verdictKind, verdictDismissed, patch]);

  // --- Reveal + report finish once.
  useEffect(() => {
    if (!session || !roundOver || session.revealed) return;
    patch({ revealed: true });
    void (async () => {
      try {
        await supabase.rpc("update_draft", {
          p_team_id: session.teamId,
          p_secret: session.teamSecret,
          p_code: session.code,
          p_char_count: session.code.length,
        });
      } catch {
        /* transient — ignore */
      }
    })();
  }, [roundOver, session, patch]);

  const onType = (value: string) => {
    if (!canType || !session) return;
    patch({ code: value });
    const now = Date.now();
    if (now - lastPing.current > 1500) {
      lastPing.current = now;
      void supabase.rpc("update_draft", {
        p_team_id: session.teamId,
        p_secret: session.teamSecret,
        p_code: value,
        p_char_count: value.length,
      });
    }
  };

  // Block paste
  const onPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    toast.error("Pasting is not allowed in blind mode");
  };

  const endTurn = async () => {
    if (!session || !live) return;
    // Submit the code
    const { data, error } = await supabase.rpc("submit_turn", {
      p_team_id: session.teamId,
      p_secret: session.teamSecret,
      p_member: session.currentMember,
      p_code: session.code,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    const row = Array.isArray(data) ? data[0] : data;
    const submissionId = row?.submission_id as string | undefined;
    if (submissionId) {
      patch({
        pendingSubmissionId: submissionId,
      });
      toast("Code submitted — waiting for host to review");
    }
    textareaRef.current?.focus();
  };

  const leave = () => {
    clearSession();
    void navigate({ to: "/" });
  };

  // --- Timer display logic
  const displayRemaining = useMemo(() => {
    if (isPaused && room?.remaining_ms != null) return room.remaining_ms;
    return remaining;
  }, [isPaused, room, remaining]);

  const durationMs = (room?.duration_seconds ?? 600) * 1000;

  // Timer tone — use team color as default when available
  const tc = session?.color;
  const timerTone = roundOver
    ? "text-ember"
    : !live
      ? "text-muted-foreground"
      : displayRemaining !== null && displayRemaining < 10_000
        ? "text-ember"
        : displayRemaining !== null && displayRemaining < 60_000
          ? "text-amber"
          : undefined; // will use inline style for team color

  const timeFraction =
    (live || isPaused) && room && displayRemaining !== null
      ? Math.max(0, Math.min(1, displayRemaining / durationMs))
      : roundOver
        ? 0
        : 0;

  const isTimerDanger = live && displayRemaining !== null && displayRemaining < 10_000;
  const isTimerWarn = live && displayRemaining !== null && displayRemaining < 60_000;

  // Progress bar color — use team color as default, override with danger/warn
  const barColor = isTimerDanger ? "bg-ember" : isTimerWarn ? "bg-amber" : undefined; // will use inline style for team color

  const barStyle =
    !barColor && session?.color
      ? { width: `${timeFraction * 100}%`, backgroundColor: session.color }
      : { width: `${timeFraction * 100}%` };

  // Team color CSS variable + colored top border + gradient bg
  const teamColorStyle = session?.color
    ? ({
        "--team-color": session.color,
        borderTop: `3px solid ${session.color}`,
        backgroundImage: `radial-gradient(ellipse at 100% 100%, color-mix(in oklch, ${session.color} 12%, transparent) 0%, transparent 55%), radial-gradient(ellipse at 0% 0%, color-mix(in oklch, ${session.color} 6%, transparent) 0%, transparent 50%)`,
      } as React.CSSProperties)
    : undefined;

  // Timer display text
  const timerText = roundOver
    ? "00:00"
    : isPaused && room?.remaining_ms != null
      ? formatClock(room.remaining_ms)
      : displayRemaining === null
        ? "--:--"
        : formatClock(displayRemaining);

  const timerLabel = roundOver ? "ended" : isPaused ? "paused" : "time left";

  if (!hydrated || !session) return null;

  // Waiting for verdict
  const waitingVerdict = !!session.pendingSubmissionId;
  const showVerdict = session.verdictKind && !verdictDismissed;

  /* ---- Lobby: waiting for host to accept ---- */
  if (inLobby && !roundOver) {
    return (
      <main
        className="flex min-h-screen flex-col items-center justify-center px-4"
        style={teamColorStyle}
      >
        <div className="max-w-md text-center">
          <div className="mx-auto mb-6 h-20 w-20 animate-pulse rounded-2xl border border-border bg-card flex items-center justify-center">
            <span className="font-mono text-3xl text-signal">⏳</span>
          </div>
          <h1 className="font-display text-3xl font-extrabold tracking-tight">
            {session.teamName}
          </h1>
          <p className="mt-2 font-mono text-xs text-ash">room {session.roomCode}</p>
          <p className="mt-6 text-muted-foreground">
            Waiting for the host to accept your team into the room. Hang tight.
          </p>
          <div className="mt-4 rounded-xl border border-dashed border-border bg-card/50 px-6 py-4">
            <p className="font-mono text-sm text-muted-foreground">
              Waiting for acceptance
              <span className="animate-blink text-signal">_</span>
            </p>
          </div>
          <Button variant="ghost" size="sm" className="mt-6" onClick={leave}>
            Leave room
          </Button>
        </div>
      </main>
    );
  }

  /* ---- Code accepted: waiting for round to end ---- */
  if (codeAccepted && !roundOver) {
    return (
      <main
        className="flex min-h-screen flex-col items-center justify-center px-4"
        style={teamColorStyle}
      >
        <div className="max-w-lg text-center">
          {/* Animated success icon */}
          <div className="relative mx-auto mb-8 flex h-28 w-28 items-center justify-center">
            <span
              className="animate-pulse-ring absolute h-28 w-28 rounded-full border-2"
              style={{ borderColor: tc ?? "var(--mint)" }}
            />
            <span
              className="animate-pop flex h-20 w-20 items-center justify-center rounded-full"
              style={{
                backgroundColor: `color-mix(in oklch, ${tc ?? "var(--mint)"} 15%, transparent)`,
              }}
            >
              <svg
                className="h-10 w-10"
                viewBox="0 0 24 24"
                fill="none"
                stroke={tc ?? "var(--mint)"}
                strokeWidth={3}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
          </div>

          <h1
            className="font-display text-4xl font-extrabold tracking-tight"
            style={tc ? { color: tc } : undefined}
          >
            Code accepted
          </h1>
          <p className="mt-4 text-lg text-muted-foreground">The host has accepted your solution.</p>

          {/* Timer still counting */}
          <div className="mx-auto mt-8 inline-flex flex-col items-center rounded-2xl border border-border bg-card px-8 py-5 shadow-sm">
            <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-muted-foreground">
              {timerLabel}
            </p>
            <p
              className={cn("mt-1 font-mono text-3xl leading-none tabular-nums", timerTone)}
              style={!timerTone && tc ? { color: tc } : undefined}
            >
              {timerText}
            </p>
          </div>

          <div
            className="mt-8 rounded-2xl border border-dashed bg-card/50 px-8 py-6"
            style={tc ? { borderColor: `color-mix(in oklch, ${tc} 30%, transparent)` } : undefined}
          >
            <p className="font-mono text-sm text-muted-foreground">
              Wait for the round to end to view your code
              <span className="animate-blink" style={tc ? { color: tc } : undefined}>
                _
              </span>
            </p>
          </div>

          <p className="mt-4 font-mono text-xs text-ash">
            {session.code.length} characters · {session.teamName}
          </p>
        </div>
      </main>
    );
  }

  /* ---- Main game view ---- */
  return (
    <main className="command-canvas min-h-screen px-4 pb-10 pt-5 md:px-8" style={teamColorStyle}>
      {/* Team color accent strip at top */}
      {tc && (
        <div className="fixed left-0 right-0 top-0 z-50 h-1" style={{ backgroundColor: tc }} />
      )}

      <header className="mx-auto flex max-w-7xl flex-wrap items-end justify-between gap-4">
        <div>
          <p
            className="font-mono text-[11px] uppercase tracking-[0.35em]"
            style={tc ? { color: tc } : undefined}
          >
            SPPU ACM · Blind coding
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight">
            {session.teamName}
            <span className="ml-3 align-middle font-mono text-sm font-normal text-muted-foreground">
              room {session.roomCode}
            </span>
          </h1>
          {tc && (
            <div className="mt-1 flex items-center gap-2">
              <span
                className="h-3 w-3 rounded-full ring-2 ring-offset-1 ring-offset-background"
                style={{ backgroundColor: tc }}
              />
              <span className="font-mono text-[10px]" style={{ color: tc }}>
                {tc}
              </span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <LivesRow
            lives={session.livesLeft}
            current={session.currentMember}
            maxLives={session.maxLives}
          />
          <div
            className={cn(
              "rounded-xl border bg-card px-4 py-2 text-center shadow-sm",
              isTimerDanger && "timer-shake",
              roundOver && "border-ember/40",
            )}
            style={
              isTimerDanger
                ? { borderColor: "oklch(0.65 0.2 25 / 0.3)" }
                : tc && !roundOver
                  ? { borderColor: `color-mix(in oklch, ${tc} 40%, transparent)` }
                  : undefined
            }
          >
            <p className="font-mono text-[9px] uppercase tracking-[0.3em] text-muted-foreground">
              {timerLabel}
            </p>
            <p
              className={cn("font-mono text-2xl leading-none tabular-nums", timerTone)}
              style={!timerTone && tc ? { color: tc } : undefined}
            >
              {timerText}
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={leave}>
            Leave
          </Button>
        </div>
      </header>

      {/* Progress bar */}
      {(live || isPaused) && (
        <div className="mx-auto mt-6 max-w-7xl">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-500 ease-linear",
                barColor,
              )}
              style={barStyle}
            />
          </div>
        </div>
      )}

      <div
        className={cn(
          "mx-auto mt-8 grid max-w-[1500px] gap-8 transition-all duration-700 ease-out",
          live || roundOver || waitingVerdict || codeAccepted
            ? "lg:grid-cols-[1fr_20rem]"
            : "lg:grid-cols-1",
        )}
      >
        {/* Typing surface */}
        <div
          className={cn(
            "order-2 lg:order-1",
            !live && !roundOver && !waitingVerdict && !codeAccepted && "hidden lg:hidden",
          )}
        >
          <div
            className="relative overflow-hidden glass-panel p-1 shadow-[0_24px_80px_-40px_var(--signal)]"
            style={
              tc && (live || isPaused)
                ? {
                    borderColor: `color-mix(in oklch, ${tc} 25%, transparent)`,
                    boxShadow: `0 0 20px -8px ${tc}, inset 0 0 20px -16px ${tc}`,
                  }
                : undefined
            }
          >
            <textarea
              ref={textareaRef}
              value={session.code}
              onChange={(e) => onType(e.target.value)}
              onPaste={onPaste}
              onClick={forceCursorToEnd}
              onFocus={forceCursorToEnd}
              readOnly={!canType || waitingVerdict}
              spellCheck={false}
              autoFocus
              placeholder=""
              className={cn(
                "h-[26rem] w-full resize-none rounded-xl bg-transparent p-5 font-mono text-sm leading-relaxed outline-none",
                canType && !waitingVerdict
                  ? "blind-caret"
                  : roundOver || session.revealed
                    ? "text-foreground"
                    : "blind-caret",
              )}
            />
            {live && !waitingVerdict && <MascotOverlay active />}
            {waitingVerdict && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center rounded-xl bg-void/80 backdrop-blur-sm">
                <div className="animate-pulse">
                  <span className="font-mono text-lg text-amber">⏳</span>
                </div>
                <p className="mt-3 font-mono text-xs uppercase tracking-[0.3em] text-amber">
                  Awaiting host verdict
                </p>
                <p className="mt-2 font-mono text-[11px] text-ash">
                  The host is reviewing your code
                </p>
              </div>
            )}
            {showVerdict && (
              <VerdictOverlay
                kind={session.verdictKind!}
                label={
                  session.verdictKind === "success"
                    ? "The host accepted your solution"
                    : `Life lost — ${session.livesLeft} remaining`
                }
              />
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-xs text-muted-foreground">
              {session.code.length} characters written blind
            </p>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  if (confirm("Are you sure you want to delete all your code and start over?")) {
                    onType("");
                    textareaRef.current?.focus();
                  }
                }}
                disabled={!canType || waitingVerdict || session.code.length === 0}
                className="text-muted-foreground hover:text-ember"
              >
                <RotateCcw className="mr-2 h-4 w-4" />
                Start over
              </Button>
              <Button
                onClick={() => void endTurn()}
                disabled={!canType || waitingVerdict || session.livesLeft === 0}
                style={tc && canType ? { backgroundColor: tc, color: "#1a1a1a" } : undefined}
              >
                End turn · submit code
              </Button>
            </div>
          </div>
          {roundOver && session.revealed && (
            <div
              className="mt-4 animate-ink-in rounded-2xl border p-5"
              style={
                tc
                  ? {
                      borderColor: `color-mix(in oklch, ${tc} 30%, transparent)`,
                      backgroundColor: `color-mix(in oklch, ${tc} 5%, transparent)`,
                    }
                  : {
                      borderColor: "oklch(0.72 0.15 185 / 0.3)",
                      backgroundColor: "oklch(0.72 0.15 185 / 0.05)",
                    }
              }
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p
                  className="font-mono text-[11px] uppercase tracking-[0.3em]"
                  style={tc ? { color: tc } : { color: "var(--signal)" }}
                >
                  Revealed — copy into your compiler
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(session.code);
                    toast.success("Code copied");
                  }}
                >
                  Copy code
                </Button>
              </div>
              <pre className="mt-4 max-h-80 overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-card p-4 font-mono text-sm leading-relaxed">
                {session.code || "(nothing was typed)"}
              </pre>
            </div>
          )}
        </div>

        {/* Problem statement */}
        <div className="order-1 lg:order-2">
          <ProblemPanel
            title={room?.problem_title ?? "Waiting for the host"}
            statement={room?.problem_statement ?? ""}
            compact={live || roundOver || waitingVerdict || codeAccepted}
          />
          {!live && !roundOver && !waitingVerdict && !codeAccepted && isAccepted && (
            <div
              className="mt-6 rounded-2xl border border-dashed bg-card/50 p-10 text-center"
              style={
                tc ? { borderColor: `color-mix(in oklch, ${tc} 30%, transparent)` } : undefined
              }
            >
              <p className="font-mono text-sm text-muted-foreground">
                {isPaused ? (
                  <>Round is paused by the host</>
                ) : (
                  <>
                    Waiting for the host to start the round
                    <span className="animate-blink" style={tc ? { color: tc } : undefined}>
                      _
                    </span>
                  </>
                )}
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
