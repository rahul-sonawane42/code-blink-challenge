import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Clock, Download, Minus, Pause, Play, Plus, Square, Timer, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { TeamCard } from "@/components/TeamCard";
import { ReviewPanel } from "@/components/ReviewPanel";
import { TimerRail } from "@/components/TimerRail";
import { useCountdown } from "@/hooks/useCountdown";
import { useRoom } from "@/hooks/useRoomSync";
import { useHostData } from "@/hooks/useHostData";
import { supabase } from "@/integrations/supabase/client";
import { exportRoomToExcel } from "@/lib/excel";
import {
  clearHostSession,
  formatClock,
  loadHostSession,
  saveHostSession,
  type HostSession,
  type Room,
} from "@/lib/blind";

export const Route = createFileRoute("/host")({
  head: () => ({
    meta: [
      { title: "Host Dashboard — Blind Coding Arena" },
      {
        name: "description",
        content:
          "Create a room, watch every team connect in real time and start the blind coding countdown on all machines at once.",
      },
      { property: "og:title", content: "Host Dashboard — Blind Coding Arena" },
      {
        property: "og:description",
        content: "Real-time control room for a LAN blind coding competition.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: HostPage,
});

/* ------------------------------------------------------------------ */
/*  Host Page                                                          */
/* ------------------------------------------------------------------ */

function HostPage() {
  const [hostSession, setHostSession] = useState<HostSession | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Room creation form
  const [title, setTitle] = useState("Reverse a linked list");
  const [statement, setStatement] = useState(
    "Given the head of a singly linked list, reverse it in place and return the new head.\n\nConstraints: O(n) time, O(1) extra space.",
  );
  const [minutes, setMinutes] = useState(10);
  const [maxLives, setMaxLives] = useState(4);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  // Time-add input
  const [extraMinutes, setExtraMinutes] = useState(1);

  useEffect(() => {
    setHostSession(loadHostSession());
    setHydrated(true);
  }, []);

  // Live room record
  const { room } = useRoom(hostSession?.roomCode ?? null);

  // Host-privileged data (teams with draft code + submissions)
  const roomId = hostSession?.roomId ?? null;
  const hostSecret = hostSession?.hostSecret ?? null;
  const running = room?.status === "running";
  const { teams, submissions, refresh } = useHostData(roomId, hostSecret, running);

  // Timer
  const deadline = useMemo(() => {
    if (!room) return null;
    if (room.status === "running" && room.started_at) {
      return new Date(room.started_at).getTime() + room.duration_seconds * 1000;
    }
    return null;
  }, [room]);

  const { remaining, expired } = useCountdown(deadline);

  // Auto-end when timer expires
  useEffect(() => {
    if (expired && room?.status === "running" && hostSecret) {
      void supabase.rpc("end_round", { p_room_id: room.id, p_secret: hostSecret });
    }
  }, [expired, room, hostSecret]);

  /* ---- RPC wrappers ---- */

  const createRoom = async () => {
    setCreating(true);
    const { data, error } = await supabase.rpc("create_room", {
      p_title: title,
      p_statement: statement,
      p_duration_seconds: Math.max(1, minutes) * 60,
      p_max_lives: maxLives,
    });
    setCreating(false);
    if (error || !data || !Array.isArray(data) || data.length === 0) {
      toast.error(error?.message ?? "Could not create room");
      return;
    }
    const row = data[0] as { code: string; host_secret: string };

    // We need the room ID — fetch it
    const { data: roomRow } = await supabase
      .from("rooms")
      .select("id")
      .eq("code", row.code)
      .single();
    if (!roomRow) {
      toast.error("Room created but could not fetch ID");
      return;
    }

    const session: HostSession = {
      roomCode: row.code,
      roomId: roomRow.id,
      hostSecret: row.host_secret,
    };
    saveHostSession(session);
    setHostSession(session);
    toast.success(`Room ${row.code} is live`);
  };

  const rpc = useCallback(
    async (fn: string, params: Record<string, unknown>) => {
      if (!roomId || !hostSecret) return;
      setBusy(true);
      const { error } = await supabase.rpc(fn, {
        p_room_id: roomId,
        p_secret: hostSecret,
        ...params,
      });
      setBusy(false);
      if (error) toast.error(error.message);
      else refresh();
    },
    [roomId, hostSecret, refresh],
  );

  const startRound = () => rpc("start_round", {});
  const pauseRound = () => rpc("pause_round", {});
  const resumeRound = () => rpc("resume_round", {});
  const endRound = () => rpc("end_round", {});
  const addTime = () => rpc("increase_time", { p_seconds: Math.max(1, extraMinutes) * 60 });
  const subTime = () => rpc("decrease_time", { p_seconds: Math.max(1, extraMinutes) * 60 });

  const acceptTeam = (teamId: string, color: string = "") =>
    rpc("accept_team", { p_team_id: teamId, p_color: color });
  const kickTeam = (teamId: string) => rpc("kick_team", { p_team_id: teamId });
  const renameTeam = (teamId: string, name: string) =>
    rpc("rename_team", { p_team_id: teamId, p_name: name });
  const setTeamColor = (teamId: string, color: string) =>
    rpc("set_team_color", { p_team_id: teamId, p_color: color });
  const grantLife = (teamId: string) => rpc("grant_life", { p_team_id: teamId });
  const removeLife = (teamId: string) => rpc("remove_life", { p_team_id: teamId });
  const reopenTeam = (teamId: string) => rpc("reopen_team", { p_team_id: teamId });

  const reviewSubmission = async (submissionId: string, verdict: "correct" | "rejected") => {
    if (!roomId || !hostSecret) return;
    setBusy(true);
    const { error } = await supabase.rpc("review_submission", {
      p_submission_id: submissionId,
      p_room_id: roomId,
      p_verdict: verdict,
      p_secret: hostSecret,
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else {
      toast.success(verdict === "correct" ? "Marked correct" : "Rejected — life deducted");
      refresh();
    }
  };

  const exportExcel = () => {
    if (!room) return;
    exportRoomToExcel({ room: room as Room, teams, submissions, remaining: displayRemaining });
    toast.success("Excel downloaded");
  };

  const closeRoom = () => {
    clearHostSession();
    setHostSession(null);
  };

  // Team name lookup for ReviewPanel
  const teamNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const t of teams) map.set(t.id, t.name);
    return map;
  }, [teams]);
  const teamName = (id: string) => teamNameMap.get(id) ?? "Unknown";

  // Pause-aware remaining for display
  const displayRemaining = useMemo(() => {
    if (room?.status === "paused" && room.remaining_ms != null) return room.remaining_ms;
    return remaining;
  }, [room, remaining]);

  const durationMs = (room?.duration_seconds ?? 600) * 1000;

  if (!hydrated) return null;

  /* ---- Room Creation Form ---- */
  if (!hostSession || !room) {
    return (
      <main className="command-canvas min-h-screen px-5 py-6 md:px-10">
        <div className="mx-auto grid max-w-6xl gap-8 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="glass-panel p-8 lg:p-12">
            <p className="hud-label text-signal">Host control room / create</p>
            <h1 className="mt-2 font-display text-4xl font-extrabold tracking-tight">
              Create a room
            </h1>

            <section className="mt-8 space-y-5 rounded-2xl border border-border bg-card p-7 shadow-sm">
              <div className="space-y-2">
                <Label htmlFor="title">Problem title</Label>
                <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="statement">Problem statement</Label>
                <Textarea
                  id="statement"
                  rows={7}
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="minutes">Round length (minutes)</Label>
                  <Input
                    id="minutes"
                    type="number"
                    min={1}
                    max={60}
                    value={minutes}
                    onChange={(e) => setMinutes(Number(e.target.value))}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="maxLives">Lives per team</Label>
                  <Input
                    id="maxLives"
                    type="number"
                    min={1}
                    max={9}
                    value={maxLives}
                    onChange={(e) => setMaxLives(Number(e.target.value))}
                  />
                </div>
              </div>
              <Button onClick={() => void createRoom()} disabled={creating} className="w-full">
                {creating ? "Creating…" : "Create room"}
              </Button>
            </section>
          </div>
          <aside className="hidden lg:block glass-panel min-h-64 p-8">
            <p className="hud-label text-signal">Control brief</p>
            <p className="mt-6 max-w-xs font-display text-3xl font-bold leading-tight">
              Set the rules. Let the room run itself.
            </p>
            <p className="mt-4 font-mono text-xs leading-relaxed text-muted-foreground">
              Your room code appears here after launch. Teams connect over the LAN and every state
              change is synced live.
            </p>
          </aside>
        </div>
      </main>
    );
  }

  /* ---- Host Dashboard ---- */

  const isPaused = room.status === "paused";
  const isRunning = room.status === "running";
  const isLobby = room.status === "lobby";
  const isEnded = room.status === "ended";

  const acceptedTeams = teams.filter((t) => t.accepted);
  const pendingTeams = teams.filter((t) => t.status === "pending");

  return (
    <main className="command-canvas min-h-screen px-4 py-5 md:px-8 lg:px-10">
      <div className="mx-auto flex max-w-[1500px] flex-col gap-6">
        {/* Header */}
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="hud-label text-signal">Host control room</p>
            <h1 className="mt-1 font-display text-3xl font-extrabold tracking-tight">
              Room <span className="font-mono tracking-[0.12em] text-signal">{room.code}</span>
            </h1>
            <p className="mt-1 font-mono text-xs text-ash truncate max-w-md">
              {room.problem_title}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" size="sm" onClick={exportExcel} disabled={teams.length === 0}>
              <Download className="h-4 w-4" /> Export Excel
            </Button>
            <Button variant="ghost" size="sm" onClick={closeRoom}>
              <X className="h-4 w-4" /> Close
            </Button>
          </div>
        </div>

        {/* Timer Rail */}
        <TimerRail remaining={displayRemaining} duration={durationMs} status={room.status} />

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Status badge */}
          <span
            className={`rounded-full px-3 py-1 font-mono text-[10px] uppercase tracking-[0.25em] ring-1 ${
              isLobby
                ? "bg-ridge text-ash ring-border"
                : isRunning
                  ? "bg-signal/10 text-signal ring-signal/25"
                  : isPaused
                    ? "bg-amber/10 text-amber ring-amber/25"
                    : "bg-ridge text-ash ring-border"
            }`}
          >
            {isLobby ? "Lobby" : isRunning ? "Live" : isPaused ? "Paused" : "Ended"}
          </span>

          {/* Start */}
          {isLobby && (
            <Button size="sm" onClick={() => void startRound()} disabled={busy}>
              <Play className="h-4 w-4" /> Start timer
            </Button>
          )}

          {/* Pause / Resume */}
          {isRunning && (
            <Button size="sm" variant="secondary" onClick={() => void pauseRound()} disabled={busy}>
              <Pause className="h-4 w-4" /> Pause
            </Button>
          )}
          {isPaused && (
            <Button size="sm" onClick={() => void resumeRound()} disabled={busy}>
              <Play className="h-4 w-4" /> Resume
            </Button>
          )}

          {/* Add time */}
          {(isRunning || isPaused) && (
            <div className="flex items-center gap-1.5">
              <Input
                type="number"
                min={1}
                max={60}
                value={extraMinutes}
                onChange={(e) => setExtraMinutes(Number(e.target.value))}
                className="h-8 w-16 text-center font-mono text-xs"
              />
              <Button size="sm" variant="secondary" onClick={() => void addTime()} disabled={busy}>
                <Plus className="h-3.5 w-3.5" />
              </Button>
              <Button size="sm" variant="secondary" onClick={() => void subTime()} disabled={busy}>
                <Minus className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* End round */}
          {(isRunning || isPaused) && (
            <Button size="sm" variant="destructive" onClick={() => void endRound()} disabled={busy}>
              <Square className="h-4 w-4" /> End round
            </Button>
          )}

          {/* Team count + timer info */}
          <span className="ml-auto flex items-center gap-2 font-mono text-xs text-ash">
            <Timer className="h-3.5 w-3.5" />
            {teams.length} team{teams.length !== 1 ? "s" : ""}
            {acceptedTeams.length < teams.length && ` · ${pendingTeams.length} pending`}
          </span>
        </div>

        {/* Submission review */}
        <ReviewPanel
          submissions={submissions}
          teamName={teamName}
          busy={busy}
          onReview={reviewSubmission}
        />

        {/* Team grid */}
        {pendingTeams.length > 0 && (
          <div>
            <h2 className="hud-label mb-3">Lobby — awaiting acceptance</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {pendingTeams.map((t) => (
                <TeamCard
                  key={t.id}
                  team={t}
                  busy={busy}
                  onAccept={(color) => void acceptTeam(t.id, color ?? "")}
                  onKick={() => void kickTeam(t.id)}
                  onRename={(name) => void renameTeam(t.id, name)}
                  onColor={(color) => void setTeamColor(t.id, color)}
                  onGrantLife={() => void grantLife(t.id)}
                  onRemoveLife={() => void removeLife(t.id)}
                  onReopen={() => void reopenTeam(t.id)}
                  maxLives={room?.max_lives ?? 4}
                />
              ))}
            </div>
          </div>
        )}

        {acceptedTeams.length > 0 && (
          <div>
            <h2 className="hud-label mb-3">Active teams</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {acceptedTeams.map((t) => (
                <TeamCard
                  key={t.id}
                  team={t}
                  busy={busy}
                  onAccept={(color) => void acceptTeam(t.id, color ?? "")}
                  onKick={() => void kickTeam(t.id)}
                  onRename={(name) => void renameTeam(t.id, name)}
                  onColor={(color) => void setTeamColor(t.id, color)}
                  onGrantLife={() => void grantLife(t.id)}
                  onRemoveLife={() => void removeLife(t.id)}
                  onReopen={() => void reopenTeam(t.id)}
                  maxLives={room?.max_lives ?? 4}
                />
              ))}
            </div>
          </div>
        )}

        {teams.length === 0 && (
          <div className="rounded-2xl border border-dashed border-border bg-card/40 p-10 text-center">
            <Clock className="mx-auto h-8 w-8 text-ash" />
            <p className="mt-3 font-mono text-sm text-ash">
              Waiting for teams to join with code{" "}
              <span className="text-signal tracking-[0.15em]">{room.code}</span>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
