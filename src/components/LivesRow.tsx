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
              "h-2.5 w-8 rounded-full transition-colors",
              i < lives ? "bg-primary" : "bg-secondary",
            )}
          />
        ))}
      </div>
      <span className="font-mono text-xs text-signal">
        Member {Math.min(current, MAX_LIVES)}/{MAX_LIVES}
      </span>
    </div>
  );
}