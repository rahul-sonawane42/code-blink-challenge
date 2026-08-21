import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import acmLogo from "@/assets/acm-logo.png";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { loadSession, saveSession, MAX_LIVES, TEAM_SIZE } from "@/lib/blind";
import { cn } from "@/lib/utils";

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
    if (teamName.length > 40) {
      toast.error("Team name is too long (max 40 characters)");
      return;
    }
    setBusy(true);

    // Load any previous secret for this team (reconnection)
    const prevSession = loadSession();
    const prevSecret =
      prevSession?.roomCode === roomCode && prevSession?.teamName === teamName
        ? prevSession.teamSecret
        : null;

    const { data, error } = await supabase.rpc("join_room", {
      p_code: roomCode,
      p_name: teamName,
      p_prev_secret: prevSecret,
    });

    if (error || !data || !Array.isArray(data) || data.length === 0) {
      setBusy(false);
      toast.error(error?.message ?? "Could not join");
      return;
    }

    const row = data[0] as {
      team_id: string;
      room_id: string;
      team_secret: string;
      room_code: string;
      max_lives: number;
      lives: number;
    };

    saveSession({
      roomCode: row.room_code,
      roomId: row.room_id,
      teamId: row.team_id,
      teamName,
      teamSecret: row.team_secret,
      code: "",
      deadline: null,
      livesLeft: row.lives,
      maxLives: row.max_lives,
      currentMember: 1,
      revealed: false,
      color: null,
      accepted: false,
      pendingSubmissionId: null,
      verdictKind: null,
    });
    setBusy(false);
    void navigate({ to: "/play" });
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center px-4 py-12 md:px-8">
      <div className="grid w-full max-w-6xl items-center gap-14 lg:grid-cols-[1.15fr_0.85fr]">
        <div>
          <div className="flex items-center gap-5">
            <div className="animate-float rounded-2xl bg-card p-2 shadow-[0_12px_30px_-18px_oklch(0.72_0.15_185_/_0.3)] ring-1 ring-border">
              <img
                src={acmLogo}
                alt="SPPU ACM blindfolded owl emblem"
                width={512}
                height={512}
                className="h-16 w-16 rounded-xl"
              />
            </div>
            <p className="font-mono text-[11px] uppercase leading-relaxed tracking-[0.35em] text-signal">
              SPPU ACM presents
              <span className="mt-0.5 block text-muted-foreground tracking-[0.3em]">
                LAN · blind round
              </span>
            </p>
          </div>

          <h1 className="mt-10 font-display text-6xl font-extrabold leading-[0.92] tracking-tight md:text-7xl">
            Blind coding
            <span className="block italic text-signal">arena.</span>
          </h1>

          <p className="mt-6 max-w-md text-lg leading-relaxed text-muted-foreground">
            One machine. Four teammates. {MAX_LIVES} lives. Your code stays invisible until the
            host&apos;s timer hits zero — then it is revealed, ready to compile.
          </p>

          <dl className="mt-10 flex max-w-md items-stretch overflow-hidden rounded-xl border border-border bg-card">
            {[
              ["Members", String(TEAM_SIZE)],
              ["Lives", String(MAX_LIVES)],
              ["Peeking", "0"],
            ].map(([label, value], i) => (
              <div
                key={label}
                className={cn("flex-1 px-5 py-4", i > 0 && "border-l border-border")}
              >
                <dt className="font-mono text-[10px] uppercase tracking-[0.25em] text-muted-foreground">
                  {label}
                </dt>
                <dd className="mt-1 font-display text-2xl font-bold tabular-nums">{value}</dd>
              </div>
            ))}
          </dl>
        </div>

        <section className="rounded-3xl border border-border bg-card p-8 shadow-[0_30px_70px_-45px_oklch(0.72_0.15_185_/_0.15)]">
          <div className="flex items-center justify-between gap-4">
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
              Entry pass
            </p>
            <span className="rounded-full bg-signal/10 px-3 py-1 font-mono text-[10px] uppercase tracking-[0.25em] text-signal ring-1 ring-signal/25">
              LAN round
            </span>
          </div>

          <div className="my-7 h-px w-full bg-gradient-to-r from-border via-border to-transparent" />

          <div className="space-y-5">
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
                maxLength={40}
                onKeyDown={(e) => e.key === "Enter" && void join()}
              />
            </div>
            <Button className="w-full" onClick={() => void join()} disabled={busy}>
              {busy ? "Joining…" : "Enter the arena"}
            </Button>
            <p className="font-mono text-[11px] leading-relaxed text-muted-foreground">
              Reloading is safe — your room, hidden code, timer and lives are restored instantly.
            </p>
          </div>
        </section>
      </div>

      <Link
        to="/host"
        className="mt-12 inline-block font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground underline-offset-4 hover:text-signal hover:underline"
      >
        I&apos;m running the show →
      </Link>
    </main>
  );
}
