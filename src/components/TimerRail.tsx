import { formatClock } from "@/lib/blind";
import { cn } from "@/lib/utils";

type RailTone = "idle" | "live" | "warn" | "danger" | "paused";

function toneFor(remaining: number | null, duration: number, status: string): RailTone {
  if (status === "paused") return "paused";
  if (status === "lobby" || status === "ended") return "idle";
  if (remaining === null) return "idle";
  if (remaining <= 10_000) return "danger";
  if (remaining <= 60_000) return "warn";
  return "live";
}

const TONE_CLOCK: Record<RailTone, string> = {
  idle: "text-ash",
  live: "text-signal",
  warn: "text-amber",
  danger: "text-ember",
  paused: "text-ash",
};

const TONE_BAR: Record<RailTone, string> = {
  idle: "bg-ash/40",
  live: "bg-signal",
  warn: "bg-amber",
  danger: "bg-ember",
  paused: "bg-ash/50",
};

const TONE_SEGMENT_LIT: Record<RailTone, string> = {
  idle: "bg-ash/50",
  live: "bg-signal",
  warn: "bg-amber",
  danger: "bg-ember",
  paused: "bg-ash/60",
};

/**
 * The live light rail — the round clock rendered as a draining track of
 * segments. Signal teal while fresh, amber in the last minute, red with a
 * shake in the final ten seconds. Frozen while paused.
 */
export function TimerRail({
  remaining,
  duration,
  status,
  className,
}: {
  remaining: number | null;
  duration: number;
  status: string;
  className?: string;
}) {
  const tone = toneFor(remaining, duration, status);
  const fraction = remaining !== null ? Math.max(0, Math.min(1, remaining / duration)) : 0;

  const segments = 26;
  const lit = Math.round(fraction * segments);
  const isShaking = tone === "danger";

  return (
    <div
      className={cn(
        "glass-panel signal-meter flex items-center gap-4 rounded-2xl px-5 py-4 shadow-sm",
        isShaking && "timer-shake",
        className,
      )}
    >
      <div className="min-w-28">
        <p className="hud-label">Round clock</p>
        <p
          className={cn(
            "mt-1 font-mono text-4xl font-medium leading-none tabular-nums",
            TONE_CLOCK[tone],
          )}
        >
          {remaining === null ? "--:--" : formatClock(remaining)}
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-2">
        <div className="flex gap-1" aria-hidden>
          {Array.from({ length: segments }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors duration-300",
                i < lit ? TONE_SEGMENT_LIT[tone] : "bg-ridge",
              )}
            />
          ))}
        </div>
        <div className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.25em] text-ash">
          <span>{status === "paused" ? "paused" : status === "running" ? "live" : "standby"}</span>
          <span className="tabular-nums">{formatClock(duration)}</span>
        </div>
      </div>
    </div>
  );
}
