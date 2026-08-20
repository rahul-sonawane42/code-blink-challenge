import { MAX_LIVES } from "@/lib/blind";
import { cn } from "@/lib/utils";

export function LivesRow({ lives, current }: { lives: number; current: number }) {
  return (
    <div className="flex items-center gap-3">
      <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
        Lives
      </span>
      <div className="flex gap-1.5">
        {Array.from({ length: MAX_LIVES }).map((_, i) => (
          <span
            key={i}
            className={cn(
              "h-2.5 w-7 rounded-full transition-colors",
              i < lives ? "bg-laser" : "bg-surface-2 ring-1 ring-inset ring-border",
            )}
          />
        ))}
      </div>
      <span className="rounded-full bg-ember/10 px-2.5 py-0.5 font-mono text-[11px] tracking-[0.08em] text-ember ring-1 ring-ember/30">
        Member {Math.min(current, MAX_LIVES)}/{MAX_LIVES}
      </span>
    </div>
  );
}
