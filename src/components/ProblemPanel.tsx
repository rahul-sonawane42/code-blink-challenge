import { cn } from "@/lib/utils";

export function ProblemPanel({
  title,
  statement,
  compact,
}: {
  title: string;
  statement: string;
  compact: boolean;
}) {
  return (
    <section
      className={cn("brief-panel glass-panel transition-all duration-500", compact ? "p-5" : "p-8")}
    >
      <div className="flex items-center justify-between gap-3 font-mono text-[10px] uppercase tracking-[0.28em] text-muted-foreground">
        <span>
          <span className="mr-2 inline-block size-1.5 rounded-full bg-signal shadow-[0_0_10px_var(--signal)]" />
          Problem brief
        </span>
        <span className="text-signal">/ spec</span>
      </div>
      <h2
        className={cn(
          "mt-7 font-display font-bold leading-[0.95] tracking-[-0.04em]",
          compact ? "text-2xl" : "text-4xl",
        )}
      >
        {title}
      </h2>
      <p
        className={cn(
          "mt-6 whitespace-pre-wrap text-muted-foreground",
          compact ? "text-xs leading-relaxed" : "text-base leading-relaxed",
        )}
      >
        {statement || "The host has not published a statement yet."}
      </p>
    </section>
  );
}
