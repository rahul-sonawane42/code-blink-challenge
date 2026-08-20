import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import acmLogo from "@/assets/acm-logo.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { loadSession, saveSession, MAX_LIVES, type Room, type Team } from "@/lib/blind";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Blind Coding Arena — SPPU ACM LAN Competition" },
      {
        name: "description",
        content:
          "Join a blind coding round: four teammates, four lives, one keyboard and code you cannot see until the timer runs out.",
      },
      { property: "og:title", content: "Blind Coding Arena — SPPU ACM" },
      {
        property: "og:description",
        content: "Four teammates, four lives, invisible code. Join with your room code.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [team, setTeam] = useState("");
  const [busy, setBusy] = useState(false);

  // Reload resilience: a machine that already joined goes straight back in.
  useEffect(() => {
    if (loadSession()) void navigate({ to: "/play" });
  }, [navigate]);

  const join = async () => {
    const roomCode = code.trim().toUpperCase();
    const teamName = team.trim();
    if (!roomCode || !teamName) {
      toast.error("Room code and team name are required");
      return;
    }
    setBusy(true);

    const { data: room } = await supabase
      .from("rooms")
      .select("*")
      .eq("code", roomCode)
      .maybeSingle<Room>();
    if (!room) {
      setBusy(false);
      toast.error("No room with that code");
      return;
    }

    const { data: existing } = await supabase
      .from("teams")
      .select("*")
      .eq("room_id", room.id)
      .eq("name", teamName)
      .maybeSingle<Team>();

    let record = existing;
    if (!record) {
      const { data, error } = await supabase
        .from("teams")
        .insert({ room_id: room.id, name: teamName })
        .select()
        .single<Team>();
      if (error || !data) {
        setBusy(false);
        toast.error(error?.message ?? "Could not join");
        return;
      }
      record = data;
    }

    saveSession({
      roomCode: room.code,
      teamId: record.id,
      teamName: record.name,
      code: "",
      deadline:
        room.status === "running" && room.started_at
          ? new Date(room.started_at).getTime() + room.duration_seconds * 1000
          : null,
      livesLeft: record.lives,
      currentMember: record.current_member,
      revealed: false,
    });
    setBusy(false);
    void navigate({ to: "/play" });
  };

  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <div className="grid w-full max-w-5xl gap-10 lg:grid-cols-2 lg:items-center">
        <div>
          <img
            src={acmLogo}
            alt="SPPU ACM blindfolded owl emblem"
            width={512}
            height={512}
            className="h-24 w-24 animate-float"
          />
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.35em] text-primary">
            SPPU ACM presents
          </p>
          <h1 className="mt-3 text-5xl font-semibold leading-[1.05]">
            Blind Coding
            <span className="block text-signal">Arena</span>
          </h1>
          <p className="mt-5 max-w-md text-muted-foreground">
            One machine. Four teammates. {MAX_LIVES} lives. Your code stays invisible until the
            host's timer hits zero — then it is revealed, ready to compile.
          </p>
          <Link
            to="/host"
            className="mt-6 inline-block font-mono text-xs uppercase tracking-[0.2em] text-primary underline-offset-4 hover:underline"
          >
            I am the host →
          </Link>
        </div>

        <section className="space-y-5 rounded-xl border border-border bg-card/80 p-7 backdrop-blur">
          <div className="space-y-2">
            <Label htmlFor="room">Room code</Label>
            <Input
              id="room"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. K7QM2"
              className="font-mono text-lg tracking-[0.3em]"
              maxLength={8}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="team">Team name</Label>
            <Input
              id="team"
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              placeholder="Segfault Squad"
              onKeyDown={(e) => e.key === "Enter" && void join()}
            />
          </div>
          <Button className="w-full" onClick={() => void join()} disabled={busy}>
            {busy ? "Joining…" : "Enter the arena"}
          </Button>
          <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
            Reloading is safe — your room, hidden code, timer and lives are restored instantly.
          </p>
        </section>
      </div>
    </main>
  );
}
