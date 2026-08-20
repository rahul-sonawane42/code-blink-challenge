import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useCountdown } from "@/hooks/useCountdown";
import { useRoom, useTeams } from "@/hooks/useRoomSync";
import { supabase } from "@/integrations/supabase/client";
import {
  clearHostRoom,
  formatClock,
  generateRoomCode,
  loadHostRoom,
  saveHostRoom,
  MAX_LIVES,
} from "@/lib/blind";
import { cn } from "@/lib/utils";

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

const STATUS_LABEL: Record<string, string> = {
  joined: "connected",
  typing: "is typing…",
  finished: "finished",
};

function HostPage() {
  const [code, setCode] = useState<string | null>(null);
  const [title, setTitle] = useState("Reverse a linked list");
  const [statement, setStatement] = useState(
    "Given the head of a singly linked list, reverse it in place and return the new head.\n\nConstraints: O(n) time, O(1) extra space.",
  );
  const [minutes, setMinutes] = useState(10);
  const [creating, setCreating] = useState(false);

  useEffect(() => setCode(loadHostRoom()), []);

  const { room } = useRoom(code);
  const teams = useTeams(room?.id ?? null);

  const deadline =
    room?.status === "running" && room.started_at
      ? new Date(room.started_at).getTime() + room.duration_seconds * 1000
      : null;
  const { remaining, expired } = useCountdown(deadline);

  useEffect(() => {
    if (expired && room?.status === "running") {
      void supabase.from("rooms").update({ status: "ended" }).eq("id", room.id);
    }
  }, [expired, room]);

  const createRoom = async () => {
    setCreating(true);
    const newCode = generateRoomCode();
    const { error } = await supabase.from("rooms").insert({
      code: newCode,
      problem_title: title,
      problem_statement: statement,
      duration_seconds: Math.max(1, minutes) * 60,
    });
    setCreating(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    saveHostRoom(newCode);
    setCode(newCode);
    toast.success(`Room ${newCode} is live`);
  };

  const startRound = async () => {
    if (!room) return;
    await supabase
      .from("rooms")
      .update({ status: "running", started_at: new Date().toISOString() })
      .eq("id", room.id);
    toast.success("Timer started on every machine");
  };

  const endRound = async () => {
    if (!room) return;
    await supabase.from("rooms").update({ status: "ended" }).eq("id", room.id);
  };

  const closeRoom = () => {
    clearHostRoom();
    setCode(null);
  };

  return (
    <main className="min-h-screen px-4 py-10 md:px-8">
      <div className="mx-auto max-w-6xl">
        <p className="font-mono text-[11px] uppercase tracking-[0.35em] text-primary">
          Host control room
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Blind Coding Arena</h1>

        {!room ? (
          <section className="mt-8 max-w-2xl space-y-5 rounded-xl border border-border bg-card/80 p-6">
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
            <div className="space-y-2">
              <Label htmlFor="minutes">Round length (minutes)</Label>
              <Input
                id="minutes"
                type="number"
                min={1}
                value={minutes}
                onChange={(e) => setMinutes(Number(e.target.value))}
                className="w-32"
              />
            </div>
            <Button onClick={() => void createRoom()} disabled={creating}>
              {creating ? "Creating…" : "Create room"}
            </Button>
          </section>
        ) : (
          <>
            <section className="mt-8 grid gap-4 md:grid-cols-3">
              <div className="rounded-xl border border-border bg-card/80 p-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                  Room code
                </p>
                <p className="mt-2 font-mono text-4xl tracking-[0.2em] text-primary">
                  {room.code}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card/80 p-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                  Timer
                </p>
                <p className="mt-2 font-mono text-4xl tabular-nums text-signal">
                  {remaining === null
                    ? formatClock(room.duration_seconds * 1000)
                    : formatClock(remaining)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-card/80 p-6">
                <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                  Teams connected
                </p>
                <p className="mt-2 font-mono text-4xl">{teams.length}</p>
              </div>
            </section>

            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => void startRound()} disabled={room.status !== "lobby"}>
                Start timer for everyone
              </Button>
              <Button
                variant="secondary"
                onClick={() => void endRound()}
                disabled={room.status !== "running"}
              >
                End round &amp; reveal
              </Button>
              <Button variant="ghost" onClick={closeRoom}>
                Close dashboard
              </Button>
            </div>

            <section className="mt-8 overflow-hidden rounded-xl border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-secondary/60 font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Team</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Member</th>
                    <th className="px-4 py-3">Lives</th>
                    <th className="px-4 py-3">Chars</th>
                  </tr>
                </thead>
                <tbody>
                  {teams.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                        Waiting for teams to join with code {room.code}…
                      </td>
                    </tr>
                  )}
                  {teams.map((t) => (
                    <tr key={t.id} className="border-t border-border">
                      <td className="px-4 py-3 font-medium">{t.name}</td>
                      <td
                        className={cn(
                          "px-4 py-3 font-mono text-xs",
                          t.status === "typing" && "text-primary",
                          t.status === "finished" && "text-signal",
                        )}
                      >
                        {STATUS_LABEL[t.status] ?? t.status}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">
                        {t.current_member}/{MAX_LIVES}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{t.lives}</td>
                      <td className="px-4 py-3 font-mono text-xs">{t.char_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </>
        )}
      </div>
    </main>
  );
}