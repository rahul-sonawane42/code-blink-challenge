import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { LivesRow } from "@/components/LivesRow";
import { MascotOverlay } from "@/components/MascotOverlay";
import { ProblemPanel } from "@/components/ProblemPanel";
import { Button } from "@/components/ui/button";
import { useCountdown } from "@/hooks/useCountdown";
import { useRoom } from "@/hooks/useRoomSync";
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

  // --- Recovery: pull the whole session back out of localStorage on mount.
  useEffect(() => {
    const restored = loadSession();
    setSession(restored);
    setHydrated(true);
    if (!restored) void navigate({ to: "/" });
  }, [navigate]);

  const { room } = useRoom(session?.roomCode ?? null);

  /** Persist + update in one place so storage never drifts from state. */
  const patch = useCallback((changes: Partial<BlindSession>) => {
    setSession((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...changes };
      saveSession(next);
      return next;
    });
  }, []);

  // --- Timer: derived from the host's start time so every machine agrees.
  useEffect(() => {
    if (!room || !session) return;
    if (room.status === "running" && room.started_at) {
      const deadline = new Date(room.started_at).getTime() + room.duration_seconds * 1000;
      if (session.deadline !== deadline) patch({ deadline });
    }
    if (room.status === "lobby" && session.deadline !== null) {
      patch({ deadline: null, revealed: false });
    }
  }, [room, session, patch]);

  const { remaining, expired } = useCountdown(session?.deadline ?? null);
  const outOfLives = (session?.livesLeft ?? 0) <= 0;
  const roundOver = room?.status === "ended" || expired || outOfLives;
  const live = room?.status === "running" && !roundOver;

  // --- Reveal + report finish once.
  useEffect(() => {
    if (!session || !roundOver || session.revealed) return;
    patch({ revealed: true });
    void supabase
      .from("teams")
      .update({ status: "finished", char_count: session.code.length })
      .eq("id", session.teamId);
  }, [roundOver, session, patch]);

  const onType = (value: string) => {
    if (!live || !session) return;
    patch({ code: value });
    const now = Date.now();
    if (now - lastPing.current > 1500) {
      lastPing.current = now;
      void supabase
        .from("teams")
        .update({ status: "typing", char_count: value.length })
        .eq("id", session.teamId);
    }
  };

  const endTurn = () => {
    if (!session) return;
    const livesLeft = Math.max(0, session.livesLeft - 1);
    patch({ livesLeft, currentMember: Math.min(4, session.currentMember + 1) });
    void supabase
      .from("teams")
      .update({
        lives: livesLeft,
        current_member: Math.min(4, session.currentMember + 1),
        status: livesLeft === 0 ? "finished" : "typing",
        char_count: session.code.length,
      })
      .eq("id", session.teamId);
    toast(livesLeft === 0 ? "All 4 turns used" : `Next up: member ${session.currentMember + 1}`);
    textareaRef.current?.focus();
  };

  const leave = () => {
    clearSession();
    void navigate({ to: "/" });
  };

  if (!hydrated || !session) return null;

  return (
    <main className="min-h-screen px-4 py-6 md:px-8">
      <header className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
        <div>
          <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-primary">
            SPPU ACM · Blind Coding
          </p>
          <h1 className="text-xl font-semibold">
            {session.teamName}{" "}
            <span className="font-mono text-sm text-muted-foreground">
              · room {session.roomCode}
            </span>
          </h1>
        </div>
        <div className="flex items-center gap-6">
          <LivesRow lives={session.livesLeft} current={session.currentMember} />
          <div
            className={cn(
              "rounded-lg border border-border bg-card px-4 py-2 font-mono text-2xl tabular-nums",
              live && remaining !== null && remaining < 60_000 && "border-danger text-danger",
              live && "text-primary",
            )}
          >
            {remaining === null ? "--:--" : formatClock(remaining)}
          </div>
          <Button variant="ghost" size="sm" onClick={leave}>
            Leave
          </Button>
        </div>
      </header>

      <div
        className={cn(
          "mx-auto mt-6 grid max-w-7xl gap-6 transition-all duration-700 ease-out",
          live || roundOver ? "lg:grid-cols-[1fr_20rem]" : "lg:grid-cols-1",
        )}
      >
        {/* Typing surface — first in DOM, but pushed after the statement while idle. */}
        <div className={cn("order-2 lg:order-1", !live && !roundOver && "hidden lg:hidden")}>
          <div className="relative rounded-xl border border-border bg-surface/70 p-1">
            <textarea
              ref={textareaRef}
              value={session.code}
              onChange={(e) => onType(e.target.value)}
              readOnly={!live}
              spellCheck={false}
              autoFocus
              placeholder=""
              className={cn(
                "h-[26rem] w-full resize-none rounded-lg bg-transparent p-5 font-mono text-sm leading-relaxed outline-none",
                live ? "blind-caret" : "text-foreground",
              )}
            />
            {live && <MascotOverlay active />}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <p className="font-mono text-xs text-muted-foreground">
              {session.code.length} characters written blind
            </p>
            <Button onClick={endTurn} disabled={!live || session.livesLeft === 0}>
              End turn · pass the keyboard
            </Button>
          </div>
          {roundOver && (
            <div className="mt-4 rounded-xl border border-signal/40 bg-signal/5 p-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-signal">
                Revealed — copy into your compiler
              </p>
              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap font-mono text-sm">
                {session.code || "(nothing was typed)"}
              </pre>
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                onClick={() => {
                  void navigator.clipboard.writeText(session.code);
                  toast.success("Code copied");
                }}
              >
                Copy code
              </Button>
            </div>
          )}
        </div>

        {/* Problem statement — full width while idle, shrinks to the right once live. */}
        <div className="order-1 lg:order-2">
          <ProblemPanel
            title={room?.problem_title ?? "Waiting for the host"}
            statement={room?.problem_statement ?? ""}
            compact={live || roundOver}
          />
          {!live && !roundOver && (
            <div className="mt-6 rounded-xl border border-dashed border-border p-10 text-center">
              <p className="font-mono text-sm text-muted-foreground">
                Waiting for the host to start the round
                <span className="animate-blink">_</span>
              </p>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}